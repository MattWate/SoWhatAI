import React, { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from './supabaseClient.js'; // <-- CORRECTED IMPORT PATH

// --- UI Components ---

const Header = ({ user, onLogout, onNavigate }) => (
  <header className="bg-transparent sticky top-0 z-50">
    <div className="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8 flex justify-between items-center">
      <h1 className="text-2xl font-bold leading-tight text-white cursor-pointer" onClick={() => onNavigate(user ? 'dashboard' : 'home')}>So What <span className="text-[#EDC8FF]">AI</span></h1>
      <div className="flex items-center space-x-4">
        {user ? (
          <button onClick={onLogout} className="text-sm font-medium text-gray-300 hover:text-white">
            Logout
          </button>
        ) : (
          <>
            <button onClick={() => onNavigate('login')} className="text-sm font-medium text-gray-300 hover:text-white">Log In</button>
            <button onClick={() => onNavigate('login')} className="px-4 py-2 text-sm font-medium text-black bg-[#EDC8FF] rounded-md hover:bg-purple-200 transition-colors">
              Start Free Trial
            </button>
          </>
        )}
      </div>
    </div>
  </header>
);

const Footer = () => (
    <footer className="bg-transparent mt-12"><div className="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8 text-center text-sm text-gray-500"><p>&copy; 2025 So What AI.</p></div></footer>
);

// --- Page 1: Home Page ---
const HomePage = ({ onNavigate }) => (
    <div className="text-center py-16 sm:py-24">
        <h1 className="text-5xl sm:text-7xl font-extrabold text-white tracking-tight">
            From <span className="text-[#EDC8FF]">Data</span> to <span className="text-[#13BBAF]">'So What?'</span>,
            <br />
            Instantly.
        </h1>
        <p className="mt-6 text-lg text-gray-300 max-w-2xl mx-auto">
            The all-in-one research platform for UX & CX professionals. Aggregate feedback, analyse sentiment, and share actionable insights with your team, faster than ever before.
        </p>
        <div className="mt-10 flex items-center justify-center gap-x-6">
            <button onClick={() => onNavigate('login')} className="px-6 py-3 text-base font-semibold text-black bg-[#EDC8FF] rounded-md shadow-lg hover:bg-purple-200 transition-colors transform hover:scale-105">
                Get Started for Free
            </button>
        </div>
        <div className="mt-20 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            <div className="p-6 bg-gray-800/50 rounded-lg border border-gray-700">
                <h3 className="text-lg font-semibold text-white">Mixed-Method Analysis</h3>
                <p className="mt-2 text-gray-400">Combine interview transcripts (.txt, .docx) with survey data (.csv, .xlsx) in a single, unified project.</p>
            </div>
            <div className="p-6 bg-gray-800/50 rounded-lg border border-gray-700">
                <h3 className="text-lg font-semibold text-white">AI-Powered Synthesis</h3>
                <p className="mt-2 text-gray-400">Leverage AI to generate narrative overviews, key themes, and actionable "So What?" recommendations automatically.</p>
            </div>
            <div className="p-6 bg-gray-800/50 rounded-lg border border-gray-700">
                <h3 className="text-lg font-semibold text-white">Interactive Reports</h3>
                <p className="mt-2 text-gray-400">Explore your findings with interactive charts and downloadable reports, ready for your stakeholders.</p>
            </div>
        </div>
    </div>
);

// --- Page 2: Login/Signup Page ---
const LoginPage = ({ onLogin, onNavigate }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState(null);

    const handleLogin = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError(null);
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
            setError(error.message);
        } else {
            onLogin(data.user);
        }
        setIsSubmitting(false);
    };
    
    const handleSignUp = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError(null);
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) {
            setError(error.message);
        } else {
            onLogin(data.user);
        }
        setIsSubmitting(false);
    };

    return (
         <div className="bg-gray-900/50 backdrop-blur-lg border border-gray-700/50 rounded-lg shadow-2xl p-8 max-w-md mx-auto">
            <button onClick={() => onNavigate('home')} className="text-sm font-medium text-[#13BBAF] hover:text-teal-400 mb-4">&larr; Back to home</button>
            <h2 className="text-2xl font-bold text-white text-center">Welcome</h2>
            <form className="mt-6 space-y-6">
                <div>
                    <label htmlFor="email" className="block text-sm font-medium text-gray-300">Email address</label>
                    <input type="email" id="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 block w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white shadow-sm focus:outline-none focus:ring-[#13BBAF] focus:border-[#13BBAF]" />
                </div>
                 <div>
                    <label htmlFor="password" className="block text-sm font-medium text-gray-300">Password</label>
                    <input type="password" id="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 block w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white shadow-sm focus:outline-none focus:ring-[#13BBAF] focus:border-[#13BBAF]" />
                </div>
                {error && <p className="text-red-400 text-sm">{error}</p>}
                <div className="flex items-center justify-end space-x-4">
                    <button onClick={handleLogin} disabled={isSubmitting} className="px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-gray-600 hover:bg-gray-500">
                        {isSubmitting ? 'Signing in...' : 'Sign In'}
                    </button>
                    <button onClick={handleSignUp} disabled={isSubmitting} className="px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-[#13BBAF] hover:bg-teal-600">
                        {isSubmitting ? 'Signing up...' : 'Sign Up'}
                    </button>
                </div>
            </form>
         </div>
    );
};

// --- Page 3: Dashboard ---
const DashboardPage = ({ user, onNavigate }) => {
    const [projects, setProjects] = useState([]); 

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-3xl font-bold text-white">Welcome back, {user?.email.split('@')[0]}</h2>
                <p className="text-gray-400 mt-1">Ready to find the "So What?" in your data?</p>
            </div>
            <button onClick={() => onNavigate('app')} className="w-full md:w-auto inline-flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-black bg-[#EDC8FF] hover:bg-purple-200 transition-colors transform hover:scale-105">
                + Create New Project
            </button>
            <hr className="border-gray-700/50" />
            <div>
                <h3 className="text-2xl font-semibold text-white mb-4">Your Projects</h3>
                {projects.length === 0 ? (
                    <div className="text-center py-12 bg-gray-900/50 backdrop-blur-lg border border-gray-700/50 rounded-lg">
                        <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
                        <h4 className="mt-4 text-lg font-semibold text-white">No projects yet</h4>
                        <p className="mt-1 text-sm text-gray-400">Click "Create New Project" to get started.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {/* This is where you would map over your real projects */}
                    </div>
                )}
            </div>
        </div>
    );
};


// --- Sub-components for the AnalysisToolPage ---

const FileUploadPage = ({ dataSet, setDataSet, onNext, onDashboardNavigate }) => {
    const fileInputRef = useRef(null);
    
    const handleFileChange = (event) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        const filePromises = Array.from(files).map(file => {
            return new Promise((resolve) => {
                const fileId = Date.now() + file.name;
                if (file.name.endsWith('.txt')) {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve({ id: fileId, name: file.name, type: 'text', content: e.target.result });
                    reader.readAsText(file);
                } else if (file.name.endsWith('.docx') || file.name.endsWith('.doc')) {
                    if (window.mammoth) {
                        const reader = new FileReader();
                        reader.onload = (e) => {
                            window.mammoth.extractRawText({ arrayBuffer: e.target.result })
                                .then(result => resolve({ id: fileId, name: file.name, type: 'text', content: result.value }))
                                .catch(() => resolve(null));
                        };
                        reader.readAsArrayBuffer(file);
                    } else { resolve(null); }
                } else if (file.name.endsWith('.csv') || file.name.endsWith('.xlsx')) {
                    resolve({ id: fileId, name: file.name, type: 'spreadsheet', fileObject: file, mappings: {}, rows: [], headers: [] });
                } else {
                    resolve(null);
                }
            });
        });

        Promise.all(filePromises).then(newFiles => {
            setDataSet(prev => [...prev, ...newFiles.filter(Boolean)]);
        });

        event.target.value = null;
    };
    
    return (<div className="bg-gray-900/50 backdrop-blur-lg border border-gray-700/50 rounded-lg shadow-2xl p-6 space-y-6"><button onClick={onDashboardNavigate} className="text-sm font-medium text-[#13BBAF] hover:text-teal-400">&larr; Back to Dashboard</button><div className="flex justify-between items-center"><div><h2 className="text-2xl font-semibold text-white">Step 1: Build Your Data Set</h2><p className="text-sm text-gray-400">Add all your project files (.txt, .docx, .csv, .xlsx).</p></div>{dataSet.length > 0 && (<button onClick={() => setDataSet([])} className="inline-flex items-center px-3 py-2 border border-red-500/50 shadow-sm text-sm font-medium rounded-md text-red-400 bg-gray-800 hover:bg-gray-700">Clear Data Set</button>)}</div><div className="bg-gray-800/50 border-2 border-dashed border-gray-600 rounded-lg p-8 text-center"><input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".txt,.csv,.xlsx,.doc,.docx" className="hidden" multiple /><button onClick={() => fileInputRef.current.click()} className="inline-flex items-center px-4 py-2 border border-gray-600 shadow-sm text-sm font-medium rounded-md text-gray-300 bg-gray-700 hover:bg-gray-600 transition-colors"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>Add File(s)</button></div><div><h3 className="font-semibold text-lg text-white">Files in Your Data Set:</h3><div className="mt-2 space-y-2">{dataSet.map(file => <p key={file.id} className="p-2 bg-gray-800/70 text-gray-300 rounded-md truncate">{file.name}</p>)}{dataSet.length === 0 && <p className="text-gray-500">No files uploaded.</p>}</div></div><div className="pt-5"><div className="flex justify-end"><button onClick={onNext} disabled={dataSet.length === 0} className="w-full md:w-auto inline-flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-gradient-to-r from-[#13BBAF] to-teal-500 hover:from-teal-500 hover:to-teal-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500 disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed transition-all duration-300 transform hover:scale-105">Next: Configure Data</button></div></div></div>);
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

        if (file.fileObject.name.endsWith('.csv')) {
            window.Papa.parse(file.fileObject, { header: true, skipEmptyLines: true, complete: (results) => processData(results.data) });
        } else {
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

    return (<div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50 p-4"><div className="bg-gray-800 text-white rounded-lg shadow-xl p-6 space-y-4 w-full max-w-lg"><h3 className="text-lg font-semibold">Map Columns for: {file.name}</h3>{isLoading ? <p>Loading spreadsheet...</p> : (<div className="space-y-2 max-h-96 overflow-y-auto p-1">{parsedData.headers.map(header => (<div key={header} className="grid grid-cols-2 gap-4 items-center"><label className="font-medium truncate">{header}</label><select value={columnMappings[header]} onChange={(e) => setColumnMappings(prev => ({...prev, [header]: e.target.value}))} className="rounded-md border-gray-600 bg-gray-700 text-white"><option value="ignore">Ignore</option><option value="text">Analyse for Themes</option><option value="stats">Calculate Statistics</option><option value="category">Categorise</option></select></div>))}</div>)}<div className="flex justify-end space-x-3 pt-4"><button onClick={onClose} className="px-4 py-2 bg-gray-600 rounded-md">Cancel</button><button onClick={handleSave} className="px-4 py-2 bg-[#13BBAF] text-white rounded-md">Save Mappings</button></div></div></div>);
};

const ConfigurationPage = ({ dataSet, setDataSet, onAnalyze, onBack, error }) => {
    const [modalFileId, setModalFileId] = useState(null);
    const [researchQuestion, setResearchQuestion] = useState('');
    const [isDataReady, setIsDataReady] = useState(false);

    const handleMappingsUpdate = (fileId, newMappings, parsedData) => { setDataSet(prevDataSet => prevDataSet.map(file => file.id === fileId ? { ...file, mappings: newMappings, ...parsedData } : file)); };
    const modalFile = dataSet.find(f => f.id === modalFileId);

    useEffect(() => {
        const checkLibraries = () => {
            if (window.Papa && window.XLSX && window.mammoth) {
                setIsDataReady(true);
            } else {
                setTimeout(checkLibraries, 100);
            }
        };
        checkLibraries();
    }, []);

    return (<div className="bg-gray-900/50 backdrop-blur-lg border border-gray-700/50 rounded-lg shadow-2xl p-6 space-y-6"><button onClick={onBack} className="text-sm font-medium text-[#13BBAF] hover:text-teal-400">&larr; Back to upload</button><div><h2 className="text-2xl font-semibold text-white">Step 2: Configure Your Data Set</h2><p className="text-sm text-gray-400">Map columns for each spreadsheet and provide your research question.</p></div><div><label htmlFor="research-question" className="block text-lg font-semibold text-white">Research Question</label><div className="mt-1"><textarea id="research-question" rows={3} className="shadow-sm focus:ring-[#13BBAF] focus:border-[#13BBAF] block w-full sm:text-sm border-gray-600 bg-gray-800 text-white rounded-md p-2" placeholder="e.g., How do our power-users feel about the new interface performance?" value={researchQuestion} onChange={(e) => setResearchQuestion(e.target.value)} /></div></div>
    
    {isDataReady ? (
        <div className="space-y-3">
            <h3 className="font-semibold text-lg text-white">Configure Your Data:</h3>
            {dataSet.map(file => (<div key={file.id} className="flex items-center justify-between p-3 bg-gray-800/70 rounded-md"><span className="font-medium text-gray-300 truncate">{file.name}</span>{file.type === 'spreadsheet' && (<button onClick={() => setModalFileId(file.id)} className="inline-flex items-center px-3 py-1 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-[#13BBAF] hover:bg-teal-600 transition-colors">Map Columns</button>)}{file.type === 'text' && (<span className="text-sm text-green-400">Ready to Analyse</span>)}</div>))}
        </div>
    ) : (
        <div className="text-center text-gray-400 p-8 bg-gray-800/50 rounded-md">
            <div className="animate-pulse">Preparing Data Set...</div>
        </div>
    )}

    <div className="pt-5"><div className="flex justify-end"><button onClick={() => onAnalyze(researchQuestion)} className="w-full md:w-auto inline-flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 transition-colors transform hover:scale-105">Analyse Full Data Set</button></div>{error && <p className="text-red-400 text-sm mt-4 text-right">{error}</p>}</div>{modalFile && (<MappingModal file={modalFile} onClose={() => setModalFileId(null)} onSave={handleMappingsUpdate} />)}</div>);
};

const AnalysisReportPage = ({ dataSet, onBack, results, onDownload }) => {
    const { narrativeOverview, themes, sentiment, sentimentDistribution, verbatimQuotes, quantitativeResults, researchQuestion, soWhatActions = [] } = results;
    const DataSetOverview = ({ dataSet }) => { const textFilesCount = dataSet.filter(f => f.type === 'text').length; const spreadsheets = dataSet.filter(f => f.type === 'spreadsheet'); const spreadsheetRowsCount = spreadsheets.reduce((acc, file) => acc + (file.rows?.length || 0), 0); return (<div className="p-4 rounded-lg border border-gray-700 bg-gray-800/50 backdrop-blur-sm mb-6"><h3 className="text-lg font-semibold text-white mb-3">Data Set Overview</h3><div className="flex space-x-8">{textFilesCount > 0 && (<div className="flex items-center"><svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-[#13BBAF] mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg><div><p className="text-2xl font-bold text-white">{textFilesCount}</p><p className="text-sm text-gray-400">Text Documents</p></div></div>)}{spreadsheets.length > 0 && (<div className="flex items-center"><svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-[#13BBAF] mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg><div><p className="text-2xl font-bold text-white">{spreadsheetRowsCount}</p><p className="text-sm text-gray-400">Survey Responses</p></div></div>)}</div></div>); };
    const ResearchQuestionDisplay = ({ question }) => (<div className="p-4 rounded-lg border border-gray-700 bg-gray-800/50 backdrop-blur-sm mb-6"><h3 className="text-lg font-semibold text-white">Research Question</h3><p className="mt-2 text-gray-300 italic">"{question}"</p></div>);
    const SentimentDonutChart = ({ distribution }) => { const { positive, negative, neutral } = distribution; const conicGradient = `conic-gradient(#ef4444 0% ${negative}%, #84cc16 ${negative}% ${negative + positive}%, #95A3A6 ${negative + positive}% 100%)`; return (<div className="flex flex-col items-center"><div style={{ background: conicGradient }} className="w-32 h-32 rounded-full flex items-center justify-center"><div className="w-20 h-20 bg-[#3C4142] rounded-full"></div></div><div className="flex justify-center space-x-4 mt-4 text-sm"><div className="flex items-center"><span className="w-3 h-3 rounded-full bg-red-500 mr-2"></span>Negative ({negative}%)</div><div className="flex items-center"><span className="w-3 h-3 rounded-full bg-lime-500 mr-2"></span>Positive ({positive}%)</div><div className="flex items-center"><span className="w-3 h-3 rounded-full bg-[#95A3A6] mr-2"></span>Neutral ({neutral}%)</div></div></div>); };
    const SentimentSection = ({ sentiment, distribution }) => { const sentimentStyles = { Positive: { bgColor: 'bg-green-900/50', textColor: 'text-green-300', borderColor: 'border-green-500/30', emoji: '😊', label: 'Positive' }, Negative: { bgColor: 'bg-red-900/50', textColor: 'text-red-300', borderColor: 'border-red-500/30', emoji: '😞', label: 'Negative' }, Neutral: { bgColor: 'bg-gray-700', textColor: 'text-gray-300', borderColor: 'border-gray-600', emoji: '😐', label: 'Neutral' } }; const styles = sentimentStyles[sentiment] || sentimentStyles['Neutral']; return (<div className="p-4 rounded-lg border border-gray-700 bg-gray-800/50 backdrop-blur-sm"><h3 className="text-lg font-semibold text-white mb-4 text-center">Overall Sentiment</h3><div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center"><div className={`p-4 rounded-lg border ${styles.borderColor} ${styles.bgColor}`}><div className="flex items-center justify-center"><span className="text-5xl mr-4">{styles.emoji}</span><span className={`text-3xl font-bold ${styles.textColor}`}>{styles.label}</span></div></div><SentimentDonutChart distribution={distribution} /></div></div>); };
    const NarrativeOverviewDisplay = ({ narrative }) => (<div className="p-5 rounded-lg border border-purple-500/20 bg-purple-900/20 backdrop-blur-sm"><h3 className="text-xl font-semibold text-white mb-2">Overview</h3><p className="text-gray-300 leading-relaxed text-base">{narrative}</p></div>);
    const SoWhatDisplay = ({ actions }) => ( actions && actions.length > 0 && <div className="p-5 rounded-lg border border-teal-500/20 bg-teal-900/20 backdrop-blur-sm"><h3 className="text-xl font-semibold text-white mb-3">So What? (Actions & Recommendations)</h3><ul className="list-disc list-inside space-y-2 text-gray-300">{actions.map((action, index) => (<li key={index}>{action}</li>))}</ul></div>);
    const ThematicAnalysisDisplay = ({ themes }) => ( themes && themes.length > 0 && <div className="p-4 rounded-lg border border-gray-700 bg-gray-800/50 backdrop-blur-sm"><h3 className="text-lg font-semibold text-white mb-3">Thematic Analysis</h3><div className="space-y-4 mb-6"><h4 className="font-semibold text-gray-300">Theme Prominence</h4>{themes.map(theme => (<div key={theme.theme} className="w-full"><div className="flex items-center mb-1"><span className="text-lg mr-2">{theme.emoji}</span><span className="text-sm font-medium text-gray-300">{theme.theme}</span></div><div className="w-full bg-gray-700 rounded-full h-4"><div className="bg-green-500 h-4 rounded-full" style={{ width: `${theme.prominence * 10}%` }}></div></div></div>))}</div><hr className="my-6 border-gray-700"/><ul className="space-y-6">{themes.map((item, index) => (<li key={index} className="flex flex-col p-4 bg-gray-900/70 rounded-md shadow-sm"><div className="flex items-center mb-3"><span className="text-2xl mr-4">{item.emoji}</span><span className="text-white font-bold text-lg">{item.theme}</span></div><div className="space-y-3">{item.evidence.map((quote, qIndex) => (<blockquote key={qIndex} className="border-l-4 border-[#13BBAF] pl-4"><p className="text-gray-400 italic">"{quote}"</p></blockquote>))}</div></li>))}</ul></div>);
    const VerbatimQuotesDisplay = ({ quotes }) => ( quotes && quotes.length > 0 && <div className="p-4 rounded-lg border border-gray-700 bg-gray-800/50 backdrop-blur-sm"><h3 className="text-lg font-semibold text-white mb-3">Key Verbatim Quotes</h3><ul className="space-y-4">{quotes.map((quote, index) => (<li key={index}><blockquote className="relative p-4 text-xl italic border-l-4 bg-gray-900/70 text-gray-300 border-gray-600 quote"><div className="stylistic-quote-mark" aria-hidden="true">&ldquo;</div><p className="mb-4">{quote}</p></blockquote></li>))}</ul></div>);
    const QuantitativeAnalysisDisplay = ({ quantData }) => { const [isOpen, setIsOpen] = useState(true); if (!quantData || quantData.length === 0) return null; return (<div className="p-4 rounded-lg border border-gray-700 bg-gray-800/50 backdrop-blur-sm"><button onClick={() => setIsOpen(!isOpen)} className="w-full flex justify-between items-center"><h3 className="text-lg font-semibold text-white">Quantitative Analysis</h3><svg xmlns="http://www.w3.org/2000/svg" className={`h-6 w-6 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg></button>{isOpen && <div className="mt-4 space-y-8">{quantData.map(fileResult => (<div key={fileResult.sourceFile}><h4 className="font-semibold text-gray-200 text-md border-b border-gray-700 pb-2 mb-4">From: {fileResult.sourceFile}</h4><div className="space-y-6">{fileResult.stats.map(stat => (<div key={stat.title}><h5 className="font-semibold text-gray-300">{stat.title}</h5><div className="grid grid-cols-3 gap-4 mt-2 text-center">{stat.error ? (<p className="col-span-3 text-sm text-red-400 bg-red-900/50 p-2 rounded-md">{stat.error}</p>) : (<><div className="bg-gray-700 p-2 rounded-md"><p className="text-sm text-gray-400">Mean</p><p className="text-xl font-bold">{stat.mean ?? '-'}</p></div><div className="bg-gray-700 p-2 rounded-md"><p className="text-sm text-gray-400">Median</p><p className="text-xl font-bold">{stat.median ?? '-'}</p></div><div className="bg-gray-700 p-2 rounded-md"><p className="text-sm text-gray-400">Mode</p><p className="text-xl font-bold">{stat.mode ?? '-'}</p></div></>)}</div></div>))}{fileResult.categories.map(cat => (<CategoryChart key={cat.title} category={cat} />))}</div></div>))}</div>}</div>); };
    return (<div className="w-full bg-gray-900/50 backdrop-blur-lg border border-gray-700/50 rounded-lg shadow-2xl p-6"><div className="flex justify-between items-center mb-6"><button onClick={onBack} className="inline-flex items-center px-4 py-2 border border-gray-600 shadow-sm text-sm font-medium rounded-md text-gray-300 bg-gray-700 hover:bg-gray-600"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>Back to Data Set</button><h2 className="text-2xl font-semibold text-white">Analysis Report</h2><button onClick={() => onDownload(results)} className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>Download Report</button></div><div className="space-y-6"><DataSetOverview dataSet={dataSet} /><ResearchQuestionDisplay question={researchQuestion} /><div className="grid grid-cols-1 lg:grid-cols-2 gap-6"><NarrativeOverviewDisplay narrative={narrativeOverview} /><SoWhatDisplay actions={soWhatActions} /></div><SentimentSection sentiment={sentiment} distribution={sentimentDistribution} /><ThematicAnalysisDisplay themes={themes} /><VerbatimQuotesDisplay quotes={verbatimQuotes} /><QuantitativeAnalysisDisplay quantData={quantitativeResults} /></div></div>);
};

// --- New Category Chart Component ---
const CategoryChart = ({ category }) => {
    const [chartType, setChartType] = useState('donut'); // donut, bar, table
    const total = category.data.reduce((sum, item) => sum + item.count, 0);
    const colors = ['#13BBAF', '#EDC8FF', '#84cc16', '#f97316', '#3b82f6'];

    const renderChart = () => {
        switch (chartType) {
            case 'bar':
                const maxCount = Math.max(...category.data.map(i => i.count));
                return (
                    <div className="mt-2 space-y-2">
                        {category.data.map((item, index) => (
                            <div key={item.name} className="flex items-center"><span className="w-24 text-sm text-gray-400 truncate">{item.name}</span><div className="flex-1 bg-gray-700 rounded-full h-5"><div className="h-5 rounded-full" style={{ width: `${(item.count / maxCount) * 100}%`, backgroundColor: colors[index % colors.length] }}></div></div><span className="ml-2 text-sm font-semibold">{item.count}</span></div>
                        ))}
                    </div>
                );
            case 'table':
                return (
                    <table className="w-full mt-2 text-sm text-left">
                        <thead className="text-xs text-gray-400 uppercase bg-gray-700/50"><tr><th className="px-4 py-2">Category</th><th className="px-4 py-2">Count</th><th className="px-4 py-2">Percentage</th></tr></thead>
                        <tbody>{category.data.map((item, index) => (<tr key={item.name} className="border-b border-gray-700"><td className="px-4 py-2">{item.name}</td><td className="px-4 py-2">{item.count}</td><td className="px-4 py-2">{((item.count / total) * 100).toFixed(1)}%</td></tr>))}</tbody>
                    </table>
                );
            case 'donut':
            default:
                let accumulated = 0;
                const conicGradient = category.data.map((item, index) => {
                    const percentage = (item.count / total) * 100;
                    const color = colors[index % colors.length];
                    const start = accumulated;
                    accumulated += percentage;
                    const end = accumulated;
                    return `${color} ${start}% ${end}%`;
                }).join(', ');
                return (
                    <div className="flex flex-col items-center">
                        <div style={{ background: `conic-gradient(${conicGradient})` }} className="w-32 h-32 rounded-full flex items-center justify-center">
                            <div className="w-20 h-20 bg-gray-800 rounded-full"></div>
                        </div>
                        <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 mt-4 text-sm">
                            {category.data.map((item, index) => (
                                <div key={item.name} className="flex items-center"><span className="w-3 h-3 rounded-full mr-2" style={{backgroundColor: colors[index % colors.length]}}></span>{item.name} ({item.count})</div>
                            ))}
                        </div>
                    </div>
                );
        }
    };

    return (
        <div>
            <div className="flex justify-between items-center">
                <h5 className="font-semibold text-gray-300">{category.title}</h5>
                <div className="flex space-x-1 bg-gray-700 p-1 rounded-md">
                    <button onClick={() => setChartType('donut')} className={`px-2 py-1 text-xs rounded ${chartType === 'donut' ? 'bg-teal-500 text-white' : 'text-gray-400'}`}>Donut</button>
                    <button onClick={() => setChartType('bar')} className={`px-2 py-1 text-xs rounded ${chartType === 'bar' ? 'bg-teal-500 text-white' : 'text-gray-400'}`}>Bar</button>
                    <button onClick={() => setChartType('table')} className={`px-2 py-1 text-xs rounded ${chartType === 'table' ? 'bg-teal-500 text-white' : 'text-gray-400'}`}>Table</button>
                </div>
            </div>
            {renderChart()}
        </div>
    );
};


// --- Page 4: The Main Application ---
const AnalysisToolPage = ({ onNavigate }) => {
    const [workflowStep, setWorkflowStep] = useState('upload');
    const [dataSet, setDataSet] = useState([]);
    const [analysisResults, setAnalysisResults] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleNextStep = () => setWorkflowStep('configure');
    
    const handleAnalysis = async (researchQuestion) => {
        setIsLoading(true);
        setError(null);
        try {
            const textFilesContent = dataSet.filter(f => f.type === 'text').map(f => f.content).join('\n\n---\n\n');
            const spreadsheets = dataSet.filter(f => f.type === 'spreadsheet');
            let spreadsheetText = '';
            let quantitativePayload = [];

            spreadsheets.forEach(sheet => {
                if(sheet.rows && sheet.headers) {
                    const textColumns = sheet.headers.filter(header => sheet.mappings[header] === 'text');
                    spreadsheetText += sheet.rows.map(row => textColumns.map(header => row[header]).join(' ')).join('\n');
                    sheet.headers.forEach(header => {
                        const mapping = sheet.mappings[header];
                        if (mapping === 'stats' || mapping === 'category') {
                            quantitativePayload.push({ title: header, values: sheet.rows.map(row => row[header]).filter(Boolean), mapping, sourceFile: sheet.name });
                        }
                    });
                }
            });

            const combinedText = [textFilesContent, spreadsheetText].filter(Boolean).join('\n\n---\n\n');
            const response = await fetch('/.netlify/functions/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ textData: combinedText, quantitativeData: quantitativePayload, researchQuestion })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || `API call failed with status: ${response.status}`);
            }

            const results = await response.json();
            setAnalysisResults(results);
            setWorkflowStep('report');
        } catch (error) {
            console.error("Analysis failed:", error);
            setError(error.message);
            setWorkflowStep('configure');
        } finally {
            setIsLoading(false);
        }
    };

    const handleBackToUpload = () => { setWorkflowStep('upload'); setAnalysisResults(null); setDataSet([]) };
    const handleBackToConfig = () => { setWorkflowStep('configure'); setAnalysisResults(null); };
    const handleDownloadReport = (results) => { /* Download logic */ };

    const renderPage = () => {
        if (isLoading) {
            return <div className="w-full p-6 flex flex-col items-center justify-center bg-gray-900/50 backdrop-blur-lg border border-gray-700/50 rounded-lg mt-8 shadow-2xl"><div className="animate-pulse rounded-full h-16 w-16 bg-teal-500/50"></div><p className="mt-4 text-gray-300">Synthesizing insights...</p></div>
        }
        switch (workflowStep) {
            case 'configure':
                return <ConfigurationPage dataSet={dataSet} setDataSet={setDataSet} onAnalyze={handleAnalysis} onBack={handleBackToUpload} error={error} />;
            case 'report':
                return <AnalysisReportPage dataSet={dataSet} results={analysisResults} onBack={handleBackToConfig} onDownload={handleDownloadReport} />;
            case 'upload':
            default:
                return <FileUploadPage dataSet={dataSet} setDataSet={setDataSet} onNext={handleNextStep} onDashboardNavigate={() => onNavigate('dashboard')} />;
        }
    };
    
    return renderPage();
};

// --- Main App Component (acts as a router) ---

export default function App() {
    const [user, setUser] = useState(null);
    const [page, setPage] = useState('home');

    useEffect(() => {
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
          const currentUser = session?.user ?? null;
          setUser(currentUser);
          if (!currentUser && (page === 'app' || page === 'dashboard')) {
              setPage('home');
          }
        });
        return () => subscription.unsubscribe();
    }, [page]);

    const handleLogin = (loggedInUser) => {
        setUser(loggedInUser);
        setPage('dashboard');
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
        setUser(null);
        setPage('home');
    };
    
    const handleNavigate = (destination) => {
        if (!user && (destination === 'app' || destination === 'dashboard')) {
            setPage('login');
        } else {
            setPage(destination);
        }
    };

    const renderContent = () => {
        if (user) {
            switch (page) {
                case 'app':
                    return <AnalysisToolPage onNavigate={handleNavigate} />;
                case 'dashboard':
                default:
                    return <DashboardPage user={user} onNavigate={handleNavigate} />;
            }
        }
        
        switch (page) {
            case 'login':
                return <LoginPage onLogin={handleLogin} onNavigate={handleNavigate} />;
            case 'home':
            default:
                return <HomePage onNavigate={handleNavigate} />;
        }
    };

    return (
        <div className="min-h-screen bg-black font-sans text-white relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-gray-900 via-black to-[#3C4142] -z-10"></div>
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-900/40 rounded-full filter blur-3xl opacity-50 animate-aurora-1 -z-10"></div>
            <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-teal-900/40 rounded-full filter blur-3xl opacity-50 animate-aurora-2 -z-10"></div>
            <Header user={user} onLogout={handleLogout} onNavigate={handleNavigate} />
            <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
                {renderContent()}
            </main>
            <Footer />
        </div>
    );
}
