import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { AnalysisReportPage } from './AnalysisToolPage';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

// --- New Chat Component ---
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
            const response = await fetch('/.netlify/functions/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    textData: textData,
                    researchQuestion: report.researchQuestion,
                    conversationHistory: newConversation,
                    newQuestion: currentQuestion,
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to get a response from the AI.');
            }

            const result = await response.json();
            setConversation(prev => [...prev, { role: 'ai', content: result.answer }]);

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
                {isAiResponding && <div className="flex justify-start"><div className="max-w-xl p-3 rounded-lg bg-gray-700 text-gray-400">Thinking...</div></div>}
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


const ReportViewerPage = ({ projectId, onNavigate }) => {
    const [reportData, setReportData] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isDownloading, setIsDownloading] = useState(false);
    const [error, setError] = useState(null);
    const reportPrintRef = useRef(null);

    useEffect(() => {
        const fetchReport = async () => {
            if (!projectId) {
                setError("No project ID provided.");
                setIsLoading(false);
                return;
            }
            setIsLoading(true);
            const { data, error } = await supabase.from('projects').select('analysis_report').eq('id', projectId).single();
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

    const generatePdf = () => { /* ... PDF generation logic remains the same ... */ };

    // Function to extract all text data from the original uploaded files
    const getTextDataFromReport = () => {
        if (!reportData?.analysis_report?.dataSet) return "";
        return reportData.analysis_report.dataSet
            .filter(file => file.type === 'text' && file.content)
            .map(file => file.content)
            .join('\n\n---\n\n');
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

    return (
        <div>
            <div ref={reportPrintRef}>
                <AnalysisReportPage
                    dataSet={reportData.analysis_report.dataSet || []}
                    results={reportData.analysis_report}
                    onBack={() => onNavigate('dashboard')}
                    onDownload={generatePdf}
                    isDownloading={isDownloading}
                />
            </div>
            <ChatInterface 
                report={reportData.analysis_report} 
                textData={getTextDataFromReport()} 
            />
        </div>
    );
};

export default ReportViewerPage;
