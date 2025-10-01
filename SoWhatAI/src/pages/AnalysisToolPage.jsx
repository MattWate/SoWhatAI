import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '../supabaseClient';

// --- Sub-components for the AnalysisToolPage ---

const FileUploadPage = ({ dataSet, setDataSet, onNext, onDashboardNavigate }) => {
  const fileInputRef = useRef(null);

  const handleFileChange = (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const filePromises = Array.from(files).map(file => {
      return new Promise((resolve) => {
        const fileId = Date.now() + file.name;

        const warn = (msg) => {
          // Replace alert() with your toast system if available
          console.warn(msg);
          alert(msg);
        };

        if (file.name.toLowerCase().endsWith('.txt')) {
          const reader = new FileReader();
          reader.onload = (e) =>
            resolve({ id: fileId, name: file.name, type: 'text', content: e.target.result });
          reader.readAsText(file);

        } else if (file.name.toLowerCase().endsWith('.docx')) {
          if (!window.mammoth) {
            warn('Word (.docx) support is not available. Please ensure Mammoth is loaded.');
            return resolve(null);
          }
          const reader = new FileReader();
          reader.onload = (e) => {
            window.mammoth
              .extractRawText({ arrayBuffer: e.target.result })
              .then(result =>
                resolve({ id: fileId, name: file.name, type: 'text', content: result.value })
              )
              .catch(() => {
                warn(`Could not parse ${file.name}. Try saving it again as .docx.`);
                resolve(null);
              });
          };
          reader.readAsArrayBuffer(file);

        } else if (file.name.toLowerCase().endsWith('.doc')) {
          // Legacy .doc not supported by Mammoth
          warn(`"${file.name}" is a .doc file. Please convert to .docx and re-upload.`);
          resolve(null);

        } else if (file.name.toLowerCase().endsWith('.csv') || file.name.toLowerCase().endsWith('.xlsx')) {
          resolve({
            id: fileId,
            name: file.name,
            type: 'spreadsheet',
            fileObject: file,
            mappings: {},
            rows: [],
            headers: []
          });

        } else {
          warn(`Unsupported file type for "${file.name}". Allowed: .txt, .docx, .csv, .xlsx`);
          resolve(null);
        }
      });
    });

    Promise.all(filePromises).then(newFiles => {
      setDataSet(prev => [...prev, ...newFiles.filter(Boolean)]);
    });

    event.target.value = null;
  };

  return (
    <div className="bg-gray-900/50 backdrop-blur-lg border border-gray-700/50 rounded-lg shadow-2xl p-6 space-y-6">
      <button onClick={onDashboardNavigate} className="text-sm font-medium text-[#13BBAF] hover:text-teal-400">
        &larr; Back to Dashboard
      </button>

      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-semibold text-white">Step 1: Build Your Data Set</h2>
          <p className="text-sm text-gray-400">Add all your project files (.txt, .docx, .csv, .xlsx).</p>
        </div>
        {dataSet.length > 0 && (
          <button
            onClick={() => setDataSet([])}
            className="inline-flex items-center px-3 py-2 border border-red-500/50 shadow-sm text-sm font-medium rounded-md text-red-400 bg-gray-800 hover:bg-gray-700"
          >
            Clear Data Set
          </button>
        )}
      </div>

      <div className="bg-gray-800/50 border-2 border-dashed border-gray-600 rounded-lg p-8 text-center">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept=".txt,.csv,.xlsx,.docx"
          className="hidden"
          multiple
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center px-4 py-2 border border-gray-600 shadow-sm text-sm font-medium rounded-md text-gray-300 bg-gray-700 hover:bg-gray-600 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Add File(s)
        </button>
      </div>

      <div>
        <h3 className="font-semibold text-lg text-white">Files in Your Data Set:</h3>
        <div className="mt-2 space-y-2">
          {dataSet.map(file => (
            <p key={file.id} className="p-2 bg-gray-800/70 text-gray-300 rounded-md truncate">{file.name}</p>
          ))}
          {dataSet.length === 0 && <p className="text-gray-500">No files uploaded.</p>}
        </div>
      </div>

      <div className="pt-5">
        <div className="flex justify-end">
          <button
            onClick={onNext}
            disabled={dataSet.length === 0}
            className="w-full md:w-auto inline-flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-gradient-to-r from-[#13BBAF] to-teal-500 hover:from-teal-500 hover:to-teal-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500 disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed transition-all duration-300 transform hover:scale-105"
          >
            Next: Configure Data
          </button>
        </div>
      </div>
    </div>
  );
};

const MappingModal = ({ file, onClose, onSave }) => {
  const [parsedData, setParsedData] = useState({ headers: [], rows: [] });
  const [columnMappings, setColumnMappings] = useState(file.mappings || {});
  const [isLoading, setIsLoading] = useState(true);

  const detectColumnType = (header, rows) => {
    const values = rows.map(r => r[header]).filter(Boolean).slice(0, 10);
    if (values.length === 0) return 'ignore';
    const allAreNumbers = values.every(v => !isNaN(Number(v)));
    if (allAreNumbers) return 'stats';
    const uniqueValues = new Set(values);
    if (uniqueValues.size <= 5 || uniqueValues.size / values.length < 0.5) return 'category';
    const averageLength = values.reduce((acc, v) => acc + String(v).length, 0) / values.length;
    if (averageLength > 30) return 'text';
    return 'ignore';
  };

  useEffect(() => {
    const processData = (data) => {
      const headers = Object.keys(data[0] || {});
      setParsedData({ headers, rows: data });

      const initialMappings = { ...file.mappings };
      if (Object.keys(initialMappings).length === 0) {
        headers.forEach(header => {
          initialMappings[header] = detectColumnType(header, data);
        });
      }
      setColumnMappings(initialMappings);
      setIsLoading(false);
    };

    if (file.fileObject.name.toLowerCase().endsWith('.csv')) {
      if (!window.Papa) {
        alert('CSV parser (PapaParse) is not loaded.');
        setIsLoading(false);
        return;
      }
      window.Papa.parse(file.fileObject, { header: true, skipEmptyLines: true, complete: (results) => processData(results.data) });
    } else {
      if (!window.XLSX) {
        alert('XLSX parser is not loaded.');
        setIsLoading(false);
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = window.XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json = window.XLSX.utils.sheet_to_json(worksheet);
        processData(json);
      };
      reader.readAsArrayBuffer(file.fileObject);
    }
  }, [file]);

  const handleSave = () => {
    onSave(file.id, columnMappings, parsedData);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 text-white rounded-lg shadow-xl p-6 space-y-4 w-full max-w-lg">
        <h3 className="text-lg font-semibold">Map Columns for: {file.name}</h3>
        {isLoading ? (
          <p>Loading spreadsheet...</p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto p-1">
            {parsedData.headers.map(header => (
              <div key={header} className="grid grid-cols-2 gap-4 items-center">
                <label className="font-medium truncate">{header}</label>
                <select
                  value={columnMappings[header] || 'ignore'}
                  onChange={(e) => setColumnMappings(prev => ({ ...prev, [header]: e.target.value }))}
                  className="rounded-md border-gray-600 bg-gray-700 text-white"
                >
                  <option value="ignore">Ignore</option>
                  <option value="text">Analyse for Themes</option>
                  <option value="stats">Calculate Statistics</option>
                  <option value="category">Categorise</option>
                </select>
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-end space-x-3 pt-4">
          <button onClick={onClose} className="px-4 py-2 bg-gray-600 rounded-md">Cancel</button>
          <button onClick={handleSave} className="px-4 py-2 bg-[#13BBAF] text-white rounded-md">Save Mappings</button>
        </div>
      </div>
    </div>
  );
};

const ConfigurationPage = ({ dataSet, setDataSet, onAnalyze, onBack, error }) => {
  const [modalFileId, setModalFileId] = useState(null);
  const [researchQuestion, setResearchQuestion] = useState('');
  const [reportOptions, setReportOptions] = useState({
    includeSentiment: true,
    includeQuant: true,
    includeSoWhat: true,
    includeVerbatim: true,
  });
  const [focusThemes, setFocusThemes] = useState(''); // comma-separated
  const modalFile = dataSet.find(f => f.id === modalFileId);

  const handleMappingsUpdate = (fileId, newMappings, parsedData) => {
    setDataSet(prevDataSet =>
      prevDataSet.map(file =>
        file.id === fileId ? { ...file, mappings: newMappings, ...parsedData } : file
      )
    );
  };

  const validateAndAnalyze = () => {
    if (!researchQuestion.trim()) {
      alert('Please enter a research question before analysing.');
      return;
    }
    // If there are spreadsheets that were never parsed/mapped, nudge the user
    const spreadsheets = dataSet.filter(f => f.type === 'spreadsheet');
    const anyUnparsed = spreadsheets.some(s => !s.headers || !s.rows || s.headers.length === 0);
    if (anyUnparsed) {
      const proceed = confirm('Some spreadsheets have not been mapped yet. Proceed anyway?');
      if (!proceed) return;
    }

    onAnalyze(researchQuestion, reportOptions, focusThemes);
  };

  return (
    <div className="bg-gray-900/50 backdrop-blur-lg border border-gray-700/50 rounded-lg shadow-2xl p-6 space-y-6">
      <button onClick={onBack} className="text-sm font-medium text-[#13BBAF] hover:text-teal-400">
        &larr; Back to upload
      </button>

      <div>
        <h2 className="text-2xl font-semibold text-white">Step 2: Configure Your Data Set</h2>
        <p className="text-sm text-gray-400">
          Map columns for each spreadsheet and provide your research question and report options.
        </p>
      </div>

      <div>
        <label htmlFor="research-question" className="block text-lg font-semibold text-white">Research Question</label>
        <div className="mt-1">
          <textarea
            id="research-question"
            rows={3}
            className="shadow-sm focus:ring-[#13BBAF] focus:border-[#13BBAF] block w-full sm:text-sm border-gray-600 bg-gray-800 text-white rounded-md p-2"
            placeholder="e.g., How do our power-users feel about the new interface performance?"
            value={researchQuestion}
            onChange={(e) => setResearchQuestion(e.target.value)}
          />
        </div>
      </div>

      <div className="p-4 rounded-lg border border-gray-700 bg-gray-800/50 backdrop-blur-sm">
        <h3 className="text-lg font-semibold text-white mb-3">Report Options</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="inline-flex items-center space-x-2">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={reportOptions.includeSentiment}
              onChange={(e) => setReportOptions(o => ({ ...o, includeSentiment: e.target.checked }))}
            />
            <span className="text-gray-300">Include Sentiment Analysis</span>
          </label>
          <label className="inline-flex items-center space-x-2">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={reportOptions.includeQuant}
              onChange={(e) => setReportOptions(o => ({ ...o, includeQuant: e.target.checked }))}
            />
            <span className="text-gray-300">Include Quantitative Section</span>
          </label>
          <label className="inline-flex items-center space-x-2">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={reportOptions.includeSoWhat}
              onChange={(e) => setReportOptions(o => ({ ...o, includeSoWhat: e.target.checked }))}
            />
            <span className="text-gray-300">Include “So What?” Actions</span>
          </label>
          <label className="inline-flex items-center space-x-2">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={reportOptions.includeVerbatim}
              onChange={(e) => setReportOptions(o => ({ ...o, includeVerbatim: e.target.checked }))}
            />
            <span className="text-gray-300">Include Verbatim Quotes</span>
          </label>
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-300">
            Focus Themes / Categories (comma-separated)
          </label>
          <input
            type="text"
            className="mt-1 block w-full rounded-md border-gray-600 bg-gray-800 text-white p-2"
            placeholder="e.g., latency, onboarding, pricing"
            value={focusThemes}
            onChange={(e) => setFocusThemes(e.target.value)}
          />
          <p className="text-xs text-gray-500 mt-1">
            We’ll highlight these, if found, in the report.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="font-semibold text-lg text-white">Files to Configure:</h3>
        {dataSet.map(file => (
          <div key={file.id} className="flex items-center justify-between p-3 bg-gray-800/70 rounded-md">
            <span className="font-medium text-gray-300 truncate">{file.name}</span>
            {file.type === 'spreadsheet' && (
              <button
                onClick={() => setModalFileId(file.id)}
                className="inline-flex items-center px-3 py-1 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-[#13BBAF] hover:bg-teal-600 transition-colors"
              >
                Map Columns
              </button>
            )}
            {file.type === 'text' && (
              <span className="text-sm text-green-400">Ready to Analyse</span>
            )}
          </div>
        ))}
      </div>

      <div className="pt-5">
        <div className="flex justify-end">
          <button
            onClick={validateAndAnalyze}
            className="w-full md:w-auto inline-flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 transition-colors transform hover:scale-105"
          >
            Analyse Full Data Set
          </button>
        </div>
        {error && <p className="text-red-400 text-sm mt-4 text-right">{error}</p>}
      </div>

      {modalFile && (
        <MappingModal
          file={modalFile}
          onClose={() => setModalFileId(null)}
          onSave={handleMappingsUpdate}
        />
      )}
    </div>
  );
};

export const AnalysisReportPage = ({ dataSet, onBack, results, onDownload, isDownloading }) => {
  if (!results) {
    return <div className="text-center p-10"><p>No analysis results available.</p></div>;
  }

  const {
    narrativeOverview,
    themes,
    sentiment,
    sentimentDistribution,
    verbatimQuotes,
    quantitativeResults,
    researchQuestion,
    soWhatActions = [],
    options = {}
  } = results;

  const DataSetOverview = ({ dataSet: ds }) => {
    const textFilesCount = ds.filter(f => f.type === 'text').length;
    const spreadsheets = ds.filter(f => f.type === 'spreadsheet');
    const spreadsheetRowsCount = spreadsheets.reduce((acc, file) => acc + (file.rows?.length || 0), 0);
    return (
      <div className="p-4 rounded-lg border border-gray-700 bg-gray-800/50 backdrop-blur-sm mb-6">
        <h3 className="text-lg font-semibold text-white mb-3">Data Set Overview</h3>
        <div className="flex space-x-8">
          {textFilesCount > 0 && (
            <div className="flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-[#13BBAF] mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <div>
                <p className="text-2xl font-bold text-white">{textFilesCount}</p>
                <p className="text-sm text-gray-400">Text Documents</p>
              </div>
            </div>
          )}
          {spreadsheets.length > 0 && (
            <div className="flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-[#13BBAF] mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <div>
                <p className="text-2xl font-bold text-white">{spreadsheetRowsCount}</p>
                <p className="text-sm text-gray-400">Survey Responses</p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const ResearchQuestionDisplay = ({ question }) => (
    <div className="p-4 rounded-lg border border-gray-700 bg-gray-800/50 backdrop-blur-sm mb-6">
      <h3 className="text-lg font-semibold text-white">Research Question</h3>
      <p className="mt-2 text-gray-300 italic">"{question}"</p>
    </div>
  );

  const SentimentDonutChart = ({ distribution }) => {
    if (!distribution) return null;
    const { positive, negative, neutral } = distribution;
    const conicGradient =
      `conic-gradient(#ef4444 0% ${negative}%, #84cc16 ${negative}% ${negative + positive}%, #95A3A6 ${negative + positive}% 100%)`;
    return (
      <div className="flex flex-col items-center">
        <div style={{ background: conicGradient }} className="w-32 h-32 rounded-full flex items-center justify-center">
          <div className="w-20 h-20 bg-[#3C4142] rounded-full"></div>
        </div>
        <div className="flex justify-center space-x-4 mt-4 text-sm">
          <div className="flex items-center"><span className="w-3 h-3 rounded-full bg-red-500 mr-2"></span>Negative ({negative}%)</div>
          <div className="flex items-center"><span className="w-3 h-3 rounded-full bg-lime-500 mr-2"></span>Positive ({positive}%)</div>
          <div className="flex items-center"><span className="w-3 h-3 rounded-full bg-[#95A3A6] mr-2"></span>Neutral ({neutral}%)</div>
        </div>
      </div>
    );
  };

  const SentimentSection = ({ sentiment, distribution }) => {
    const sentimentStyles = {
      Positive: { bgColor: 'bg-green-900/50', textColor: 'text-green-300', borderColor: 'border-green-500/30', emoji: '🙂', label: 'Positive' },
      Negative: { bgColor: 'bg-red-900/50', textColor: 'text-red-300', borderColor: 'border-red-500/30', emoji: '😞', label: 'Negative' },
      Neutral: { bgColor: 'bg-gray-700', textColor: 'text-gray-300', borderColor: 'border-gray-600', emoji: '😐', label: 'Neutral' }
    };
    const styles = sentimentStyles[sentiment] || sentimentStyles['Neutral'];
    return (
      <div className="p-4 rounded-lg border border-gray-700 bg-gray-800/50 backdrop-blur-sm">
        <h3 className="text-lg font-semibold text-white mb-4 text-center">Overall Sentiment</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
          <div className={`p-4 rounded-lg border ${styles.borderColor} ${styles.bgColor}`}>
            <div className="flex items-center justify-center">
              <span className="text-5xl mr-4">{styles.emoji}</span>
              <span className={`text-3xl font-bold ${styles.textColor}`}>{styles.label}</span>
            </div>
          </div>
          <SentimentDonutChart distribution={distribution} />
        </div>
      </div>
    );
  };

  const NarrativeOverviewDisplay = ({ narrative }) => (
    <div className="p-5 rounded-lg border border-purple-500/20 bg-purple-900/20 backdrop-blur-sm">
      <h3 className="text-xl font-semibold text-white mb-2">Overview</h3>
      <p className="text-gray-300 leading-relaxed text-base">{narrative}</p>
    </div>
  );

  const SoWhatDisplay = ({ actions }) => (
    actions && actions.length > 0 && (
      <div className="p-5 rounded-lg border border-teal-500/20 bg-teal-900/20 backdrop-blur-sm">
        <h3 className="text-xl font-semibold text-white mb-3">So What? (Actions & Recommendations)</h3>
        <ul className="list-disc list-inside space-y-2 text-gray-300">
          {actions.map((action, index) => (<li key={index}>{action}</li>))}
        </ul>
      </div>
    )
  );

  const ThematicAnalysisDisplay = ({ themes: thms }) => (
    thms && thms.length > 0 && (
      <div className="p-4 rounded-lg border border-gray-700 bg-gray-800/50 backdrop-blur-sm">
        <h3 className="text-lg font-semibold text-white mb-3">Thematic Analysis</h3>
        {thms[0]?.prominence && (
          <div className="space-y-4 mb-6">
            <h4 className="font-semibold text-gray-300">Theme Prominence</h4>
            {thms.map(theme => (
              <div key={theme.theme} className="w-full">
                <div className="flex items-center mb-1">
                  <span className="text-lg mr-2">{theme.emoji}</span>
                  <span className="text-sm font-medium text-gray-300">{theme.theme}</span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-4">
                  <div className="bg-green-500 h-4 rounded-full" style={{ width: `${theme.prominence * 10}%` }}></div>
                </div>
              </div>
            ))}
          </div>
        )}
        <hr className="my-6 border-gray-700" />
        <ul className="space-y-6">
          {thms.map((item, index) => (
            <li key={index} className="flex flex-col p-4 bg-gray-900/70 rounded-md shadow-sm">
              <div className="flex items-center mb-3">
                <span className="text-2xl mr-4">{item.emoji}</span>
                <span className="text-white font-bold text-lg">{item.theme}</span>
              </div>
              <div className="space-y-3">
                {item.evidence.map((quote, qIndex) => (
                  <blockquote key={qIndex} className="border-l-4 border-[#13BBAF] pl-4">
                    <p className="text-gray-400 italic">"{quote}"</p>
                  </blockquote>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </div>
    )
  );

  const VerbatimQuotesDisplay = ({ quotes }) => (
    quotes && quotes.length > 0 && (
      <div className="p-4 rounded-lg border border-gray-700 bg-gray-800/50 backdrop-blur-sm">
        <h3 className="text-lg font-semibold text-white mb-3">Key Verbatim Quotes</h3>
        <ul className="space-y-4">
          {quotes.map((quote, index) => (
            <li key={index}>
              <blockquote className="relative p-4 text-xl italic border-l-4 bg-gray-900/70 text-gray-300 border-gray-600 quote">
                <div className="stylistic-quote-mark" aria-hidden="true">&ldquo;</div>
                <p className="mb-4">{quote}</p>
              </blockquote>
            </li>
          ))}
        </ul>
      </div>
    )
  );

  const QuantitativeAnalysisDisplay = ({ quantData }) => {
    const [isOpen, setIsOpen] = useState(true);
    if (!quantData || quantData.length === 0) return null;
    return (
      <div className="p-4 rounded-lg border border-gray-700 bg-gray-800/50 backdrop-blur-sm">
        <button onClick={() => setIsOpen(!isOpen)} className="w-full flex justify-between items-center">
          <h3 className="text-lg font-semibold text-white">Quantitative Analysis</h3>
          <svg xmlns="http://www.w3.org/2000/svg" className={`h-6 w-6 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {isOpen && (
          <div className="mt-4 space-y-8">
            {quantData.map(fileResult => (
              <div key={fileResult.sourceFile}>
                <h4 className="font-semibold text-gray-200 text-md border-b border-gray-700 pb-2 mb-4">From: {fileResult.sourceFile}</h4>
                <div className="space-y-6">
                  {fileResult.stats.map(stat => (
                    <div key={stat.title}>
                      <h5 className="font-semibold text-gray-300">{stat.title}</h5>
                      <div className="grid grid-cols-3 gap-4 mt-2 text-center">
                        {stat.error ? (
                          <p className="col-span-3 text-sm text-red-400 bg-red-900/50 p-2 rounded-md">{stat.error}</p>
                        ) : (
                          <>
                            <div className="bg-gray-700 p-2 rounded-md">
                              <p className="text-sm text-gray-400">Mean</p>
                              <p className="text-xl font-bold">{stat.mean ?? '-'}</p>
                            </div>
                            <div className="bg-gray-700 p-2 rounded-md">
                              <p className="text-sm text-gray-400">Median</p>
                              <p className="text-xl font-bold">{stat.median ?? '-'}</p>
                            </div>
                            <div className="bg-gray-700 p-2 rounded-md">
                              <p className="text-sm text-gray-400">Mode</p>
                              <p className="text-xl font-bold">{stat.mode ?? '-'}</p>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                  {fileResult.categories.map(cat => (<CategoryChart key={cat.title} category={cat} />))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const CategoryChart = ({ category }) => {
    const [chartType, setChartType] = useState('donut'); // donut, bar, table
    const total = category.data.reduce((sum, item) => sum + item.count, 0);
    const colors = ['#13BBAF', '#EDC8FF', '#84cc16', '#f97316', '#3b82f6'];
    const renderChart = () => { /* Implement your chart or keep as placeholder */ };
    return (<div>{/* Placeholder for CategoryChart */}</div>);
  };

  return (
    <div className="w-full bg-gray-900/50 backdrop-blur-lg border border-gray-700/50 rounded-lg shadow-2xl p-6">
      <div className="flex justify-between items-center mb-6">
        <button onClick={onBack} className="inline-flex items-center px-4 py-2 border border-gray-600 shadow-sm text-sm font-medium rounded-md text-gray-300 bg-gray-700 hover:bg-gray-600">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back
        </button>
        <h2 className="text-2xl font-semibold text-white">Analysis Report</h2>

        <button
          onClick={onDownload}
          disabled={isDownloading}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 disabled:bg-gray-500"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          {isDownloading ? 'Downloading...' : 'Download Report'}
        </button>
      </div>
      <div className="space-y-6">
        <DataSetOverview dataSet={dataSet} />
        <ResearchQuestionDisplay question={researchQuestion} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <NarrativeOverviewDisplay narrative={narrativeOverview} />
          {options.includeSoWhat !== false && <SoWhatDisplay actions={soWhatActions} />}
        </div>
        {options.includeSentiment !== false && (
          <SentimentSection sentiment={sentiment} distribution={sentimentDistribution} />
        )}
        <ThematicAnalysisDisplay themes={themes} />
        {options.includeVerbatim !== false && <VerbatimQuotesDisplay quotes={verbatimQuotes} />}
        {options.includeQuant !== false && <QuantitativeAnalysisDisplay quantData={quantitativeResults} />}
      </div>
    </div>
  );
};

// --- Main Page Component ---
const AnalysisToolPage = ({ user, onNavigate }) => {
  const [workflowStep, setWorkflowStep] = useState('upload');
  const [dataSet, setDataSet] = useState([]);
  const [analysisResults, setAnalysisResults] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleNextStep = () => setWorkflowStep('configure');

  const handleAnalysis = async (researchQuestion, reportOptions, focusThemes) => {
    setIsLoading(true);
    setError(null);
    try {
      const textFilesContent = dataSet
        .filter(f => f.type === 'text')
        .map(f => f.content)
        .join('\n\n---\n\n');

      const spreadsheets = dataSet.filter(f => f.type === 'spreadsheet');
      let spreadsheetText = '';
      let quantitativePayload = [];

      spreadsheets.forEach(sheet => {
        if (sheet.rows && sheet.headers) {
          const textColumns = sheet.headers.filter(header => sheet.mappings[header] === 'text');
          if (textColumns.length) {
            spreadsheetText += sheet.rows
              .map(row => textColumns.map(header => row[header]).join(' '))
              .join('\n');
          }
          sheet.headers.forEach(header => {
            const mapping = sheet.mappings[header];
            if (mapping === 'stats' || mapping === 'category') {
              const valuesRaw = sheet.rows.map(row => row[header]);
              const values =
                mapping === 'stats'
                  ? valuesRaw.map(v => Number(v)).filter(v => Number.isFinite(v))
                  : valuesRaw.filter(Boolean);
              quantitativePayload.push({
                title: header,
                values,
                mapping,
                sourceFile: sheet.name
              });
            }
          });
        }
      });

      const combinedText = [textFilesContent, spreadsheetText].filter(Boolean).join('\n\n---\n\n');

      const focusList = focusThemes
        ? focusThemes.split(',').map(s => s.trim()).filter(Boolean)
        : [];

      const response = await fetch('/.netlify/functions/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          textData: combinedText,
          quantitativeData: quantitativePayload, // can be []
          researchQuestion,
          options: {
            includeSentiment: !!reportOptions?.includeSentiment,
            includeQuant: !!reportOptions?.includeQuant,
            includeSoWhat: !!reportOptions?.includeSoWhat,
            includeVerbatim: !!reportOptions?.includeVerbatim,
            focusThemes: focusList
          }
        })
      });

      if (!response.ok) {
        let err;
        try {
          err = await response.json();
        } catch {
          // no-op
        }
        throw new Error(err?.error || `API call failed with status: ${response.status}`);
      }

      const results = await response.json();
      results.dataSet = dataSet;
      results.researchQuestion = researchQuestion;
      results.options = {
        includeSentiment: !!reportOptions?.includeSentiment,
        includeQuant: !!reportOptions?.includeQuant,
        includeSoWhat: !!reportOptions?.includeSoWhat,
        includeVerbatim: !!reportOptions?.includeVerbatim,
        focusThemes: focusList
      };

      const shortName = researchQuestion.length > 50 ? researchQuestion.slice(0, 50) + '...' : researchQuestion;

      const { data: inserted, error: insertError } = await supabase
        .from('projects')
        .insert([{
          project_name: shortName,
          research_question: researchQuestion,
          analysis_report: results,
          user_id: user?.id || null
        }])
        .select('id')
        .maybeSingle();

      if (insertError) {
        throw new Error(`Failed to save project: ${insertError.message}`);
      }

      setAnalysisResults(results);
      setWorkflowStep('report');
      // If you prefer to use the global ReportViewerPage route:
      // if (inserted?.id) onNavigate('report', inserted.id);

    } catch (error) {
      console.error("Analysis failed:", error);
      setError(error.message);
      setWorkflowStep('configure');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackToUpload = () => { setWorkflowStep('upload'); setAnalysisResults(null); setDataSet([]); };
  const handleBackToConfig = () => { setWorkflowStep('configure'); setAnalysisResults(null); };
  const handleDownloadReport = () => { /* Download logic will be handled by ReportViewerPage or implement here */ };

  const renderPage = () => {
    if (isLoading) {
      return (
        <div className="w-full p-6 flex flex-col items-center justify-center bg-gray-900/50 backdrop-blur-lg border border-gray-700/50 rounded-lg mt-8 shadow-2xl">
          <div className="animate-pulse rounded-full h-16 w-16 bg-teal-500/50"></div>
          <p className="mt-4 text-gray-300">Synthesizing insights...</p>
        </div>
      );
    }
    switch (workflowStep) {
      case 'configure':
        return (
          <ConfigurationPage
            dataSet={dataSet}
            setDataSet={setDataSet}
            onAnalyze={handleAnalysis}
            onBack={handleBackToUpload}
            error={error}
          />
        );
      case 'report':
        return (
          <AnalysisReportPage
            dataSet={dataSet}
            results={analysisResults}
            onBack={() => onNavigate('dashboard')}
            onDownload={handleDownloadReport}
          />
        );
      case 'upload':
      default:
        return (
          <FileUploadPage
            dataSet={dataSet}
            setDataSet={setDataSet}
            onNext={handleNextStep}
            onDashboardNavigate={() => onNavigate('dashboard')}
          />
        );
    }
  };

  return renderPage();
};

export default AnalysisToolPage;
