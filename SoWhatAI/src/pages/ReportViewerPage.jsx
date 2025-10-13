import React, { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { AnalysisReportPage } from './AnalysisToolPage';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

// ---------- Small utilities ----------
const countWords = (str = '') =>
  (str || '').trim().split(/\s+/).filter(Boolean).length;

const parseDate = (s) => (s ? new Date(s) : null);

// ---------- Chat ----------
const ChatInterface = ({ report, textData }) => {
  const [conversation, setConversation] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [isAiResponding, setIsAiResponding] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation]);

  const handleFollowUpSubmit = async (e) => {
    e.preventDefault();
    if (!currentQuestion.trim() || isAiResponding) return;

    const newConversation = [...conversation, { role: 'user', content: currentQuestion }];
    setConversation(newConversation);
    setCurrentQuestion('');
    setIsAiResponding(true);

    try {
      // NOTE: This uses the same analyze function; you can swap to a dedicated followup function later.
      const response = await fetch('/.netlify/functions/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          textData,
          researchQuestion: report.researchQuestion || report?.results?.researchQuestion || '',
          // Focus the answer on the question and existing overview/themes.
          reportConfig: {
            focus: `Answer the user's follow-up succinctly based ONLY on the dataset and the research question. Keep answers grounded in evidence.`,
            components: {} // no extra fields needed
          }
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get a response from the AI.');
      }

      const result = await response.json();
      // Try to surface a sensible text field
      const aiText =
        result?.narrativeOverview ||
        result?.answer ||
        result?.themes?.map(t => `• ${t.theme}`).join('\n') ||
        'No answer was generated.';

      setConversation(prev => [...prev, { role: 'ai', content: aiText }]);
    } catch (error) {
      console.error("Chat error:", error);
      setConversation(prev => [...prev, { role: 'ai', content: "Sorry, I encountered an error. Please try again." }]);
    } finally {
      setIsAiResponding(false);
    }
  };

  return (
    <div className="mt-8 pt-6 border-t border-gray-700">
      <h3 className="text-xl font-semibold text-white mb-4">Ask a Follow-up Question</h3>
      <div className="bg-gray-800/50 p-4 rounded-lg space-y-4 max-h-96 overflow-y-auto">
        {conversation.map((turn, index) => (
          <div key={index} className={`flex ${turn.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-xl p-3 rounded-lg ${turn.role === 'user' ? 'bg-teal-800' : 'bg-gray-700'}`}>
              <p className="text-white whitespace-pre-wrap">{turn.content}</p>
            </div>
          </div>
        ))}
        {isAiResponding && (
          <div className="flex justify-start">
            <div className="max-w-xl p-3 rounded-lg bg-gray-700 text-gray-400">Thinking...</div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>
      <form onSubmit={handleFollowUpSubmit} className="mt-4 flex gap-x-2">
        <input
          type="text"
          value={currentQuestion}
          onChange={(e) => setCurrentQuestion(e.target.value)}
          placeholder="Ask anything about the data..."
          className="flex-grow bg-gray-700 border border-gray-600 rounded-md text-white px-3 py-2 focus:outline-none focus:ring-teal-500 focus:border-teal-500"
        />
        <button type="submit" disabled={isAiResponding} className="px-4 py-2 bg-teal-600 hover:bg-teal-500 rounded-md text-white font-semibold disabled:bg-gray-500">
          Send
        </button>
      </form>
    </div>
  );
};

// ---------- Top Report Header (new) ----------
const ReportHeader = ({
  report,
  dataSet = [],
  onRegenerateLongOverview,
  isRegenerating,
  longOverview
}) => {
  const defaultOverview =
    longOverview ||
    report?.narrativeOverview ||
    report?.overview ||
    'Overview not available.';

  const [expanded, setExpanded] = useState(false);

  const meta = useMemo(() => {
    const textFiles = dataSet.filter(f => f?.type === 'text' && typeof f?.content === 'string');
    const totalWords = textFiles.reduce((acc, f) => acc + countWords(f.content), 0);
    const dates = dataSet
      .map(f => parseDate(f?.createdAt || f?.uploadedAt))
      .filter(Boolean)
      .sort((a, b) => a - b);
    const from = dates[0] ? dates[0].toLocaleDateString() : null;
    const to = dates[dates.length - 1] ? dates[dates.length - 1].toLocaleDateString() : null;

    return {
      docCount: dataSet.length || 0,
      textDocCount: textFiles.length || 0,
      wordCount: totalWords,
      dateRange: from && to ? `${from} → ${to}` : (from || to || 'n/a'),
    };
  }, [dataSet]);

  return (
    <div className="mb-6">
      {/* Data Set Overview */}
      <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4 mb-4">
        <div className="text-gray-300 text-sm uppercase tracking-wide font-semibold mb-1">Data Set Overview</div>
        <div className="flex flex-wrap items-center gap-4 text-gray-200">
          <div className="bg-gray-900/60 px-3 py-2 rounded-md"><span className="font-bold">{meta.docCount}</span> documents</div>
          <div className="bg-gray-900/60 px-3 py-2 rounded-md"><span className="font-bold">{meta.textDocCount}</span> text files</div>
          <div className="bg-gray-900/60 px-3 py-2 rounded-md"><span className="font-bold">{meta.wordCount.toLocaleString()}</span> words</div>
          <div className="bg-gray-900/60 px-3 py-2 rounded-md">Date range: <span className="font-bold">{meta.dateRange}</span></div>
        </div>
      </div>

      {/* Research Question */}
      <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4 mb-4">
        <div className="text-gray-300 text-sm uppercase tracking-wide font-semibold mb-1">Primary Research Question</div>
        <blockquote className="text-gray-100 italic">
          “{report?.researchQuestion || '—'}”
        </blockquote>
      </div>

      {/* Overview */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-gradient-to-br from-purple-900/60 to-purple-800/40 border border-purple-900/40 rounded-xl p-4">
          <div className="text-white font-semibold text-lg mb-2">Overview</div>
          <div className={`text-gray-200 leading-relaxed ${expanded ? '' : 'line-clamp-6'}`}>
            {defaultOverview}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => setExpanded(e => !e)}
              className="text-teal-300 hover:text-teal-200 underline"
            >
              {expanded ? 'Collapse' : 'Read more'}
            </button>
            <button
              onClick={onRegenerateLongOverview}
              disabled={isRegenerating}
              className="text-xs bg-teal-600 hover:bg-teal-500 text-white rounded-md px-3 py-1 disabled:bg-gray-600"
              title="Generate a 200–300 word executive overview"
            >
              {isRegenerating ? 'Generating…' : 'Make Overview Longer'}
            </button>
          </div>
        </div>

        {/* So What? */}
        <div className="bg-gray-800/70 border border-gray-700 rounded-xl p-4">
          <div className="text-white font-semibold text-lg mb-2">So What? (Actions & Recommendations)</div>
          <ul className="list-disc list-inside text-gray-200 space-y-2">
            {(report?.soWhatActions && report.soWhatActions.length > 0
              ? report.soWhatActions
              : (report?.recommendations || []) // fallback if you stored them under a different key
            ).slice(0, 6).map((item, idx) => (
              <li key={idx}>{item}</li>
            ))}
            {(!report?.soWhatActions || report.soWhatActions.length === 0) && (!report?.recommendations || report.recommendations.length === 0) && (
              <li className="text-gray-400">No explicit actions found in this run.</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
};

const ReportViewerPage = ({ projectId, onNavigate }) => {
  const [reportData, setReportData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState(null);
  const [longOverview, setLongOverview] = useState('');
  const [isRegenerating, setIsRegenerating] = useState(false);
  const reportPrintRef = useRef(null);

  useEffect(() => {
    const fetchReport = async () => {
      if (!projectId) {
        setError("No project ID provided.");
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      const { data, error } = await supabase
        .from('projects')
        .select('analysis_report')
        .eq('id', projectId)
        .single();
      if (error) {
        console.error("Error fetching report:", error);
        setError(error.message);
      } else {
        setReportData(data);
      }
      setIsLoading(false);
    };
    fetchReport();
  }, [projectId]);

  // --- PDF generation (multi-page) ---
  const generatePdf = async () => {
    if (!reportPrintRef.current) return;
    setIsDownloading(true);
    try {
      const canvas = await html2canvas(reportPrintRef.current, {
        scale: 2, // sharper
        useCORS: true,
        backgroundColor: '#0b0f14', // same dark background
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'pt', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        pdf.addPage();
        position = heightLeft - imgHeight;
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      pdf.save('SoWhatAI_Report.pdf');
    } catch (err) {
      console.error('PDF export error:', err);
    } finally {
      setIsDownloading(false);
    }
  };

  // Pull plain-text from dataset for LLM calls
  const getTextDataFromReport = () => {
    const ds = reportData?.analysis_report?.dataSet;
    if (!Array.isArray(ds)) return '';
    return ds
      .filter(file => file?.type === 'text' && file?.content)
      .map(file => file.content)
      .join('\n\n---\n\n');
  };

  const handleRegenerateLongOverview = async () => {
    if (isRegenerating) return;
    setIsRegenerating(true);
    try {
      const response = await fetch('/.netlify/functions/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          textData: getTextDataFromReport(),
          researchQuestion: reportData?.analysis_report?.researchQuestion || '',
          reportConfig: {
            focus:
              'Write a 200–300 word executive-style overview in 2–3 short paragraphs. Synthesize patterns and interpret what they mean for shopper motivations and decision-making. Avoid bullet points and avoid repeating the research question.',
            components: {
              // We only need the narrative/overview back; other components off:
              sentiment: false, quotes: false, soWhat: false, quantitative: false
            }
          }
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || 'Failed to regenerate overview');
      }
      const res = await response.json();
      const text =
        res?.narrativeOverview ||
        res?.overview ||
        res?.themes?.map(t => `• ${t.theme}`).join('\n') ||
        '';
      if (text) setLongOverview(text);
    } catch (e) {
      console.error('Regenerate overview error:', e);
    } finally {
      setIsRegenerating(false);
    }
  };

  if (isLoading) {
    return <div className="text-center p-10"><p>Loading your report...</p></div>;
  }
  if (error) {
    return <div className="text-center p-10 text-red-400"><p>Error: {error}</p></div>;
  }
  if (!reportData) {
    return <div className="text-center p-10"><p>Could not find the requested report.</p></div>;
  }

  const report = reportData.analysis_report || {};
  const dataSet = report.dataSet || [];

  return (
    <div>
      {/* NEW: Rich top section */}
      <ReportHeader
        report={report}
        dataSet={dataSet}
        longOverview={longOverview}
        onRegenerateLongOverview={handleRegenerateLongOverview}
        isRegenerating={isRegenerating}
      />

      {/* Existing printable block */}
      <div ref={reportPrintRef}>
        <AnalysisReportPage
          dataSet={dataSet}
          results={report}
          onBack={() => onNavigate('dashboard')}
          onDownload={generatePdf}
          isDownloading={isDownloading}
        />
      </div>

      {/* Chat */}
      <ChatInterface
        report={report}
        textData={getTextDataFromReport()}
      />
    </div>
  );
};

export default ReportViewerPage;
