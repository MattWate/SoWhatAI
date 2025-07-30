import React, { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from './supabaseClient'; // <-- IMPORT THE REAL SUPABASE CLIENT

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
                if (file.name.endsWith('.txt')) {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve({ id: Date.now() + file.name, name: file.name, type: 'text', content: e.target.result });
                    reader.readAsText(file);
                } else if (file.name.endsWith('.docx') || file.name.endsWith('.doc')) {
                    if (window.mammoth) {
                        const reader = new FileReader();
                        reader.onload = (e) => {
                            window.mammoth.extractRawText({ arrayBuffer: e.target.result })
                                .then(result => resolve({ id: Date.now() + file.name, name: file.name, type: 'text', content: result.value }))
                                .catch(() => resolve(null));
                        };
                        reader.readAsArrayBuffer(file);
                    } else {
                        resolve(null);
                    }
                } else if (file.name.endsWith('.csv') || file.name.endsWith('.xlsx')) {
                    resolve({ id: Date.now() + file.name, name: file.name, type: 'spreadsheet', fileObject: file, mappings: {}, rows: [], headers: [] });
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
    const handleMappingsUpdate = (fileId, newMappings, parsedData) => { setDataSet(prevDataSet => prevDataSet.map(file => file.id === fileId ? { ...file, mappings: newMappings, ...parsedData } : file)); };
    const modalFile = dataSet.find(f => f.id === modalFileId);
    return (<div className="bg-gray-900/50 backdrop-blur-lg border border-gray-700/50 rounded-lg shadow-2xl p-6 space-y-6"><button onClick={onBack} className="text-sm font-medium text-[#13BBAF] hover:text-teal-400">&larr; Back to upload</button><div><h2 className="text-2xl font-semibold text-white">Step 2: Configure Your Data Set</h2><p className="text-sm text-gray-400">Map columns for each spreadsheet and provide your research question.</p></div><div className="space-y-3"><h3 className="font-semibold text-lg text-white">Files:</h3>{dataSet.map(file => (<div key={file.id} className="flex items-center justify-between p-3 bg-gray-800/70 rounded-md"><span className="font-medium text-gray-300 truncate">{file.name}</span>{file.type === 'spreadsheet' && (<button onClick={() => setModalFileId(file.id)} className="inline-flex items-center px-3 py-1 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-[#13BBAF] hover:bg-teal-600 transition-colors">Map Columns</button>)}{file.type === 'text' && (<span className="text-sm text-green-400">Ready to Analyse</span>)}</div>))}</div><div><label htmlFor="research-question" className="block text-lg font-semibold text-white">Research Question</label><div className="mt-1"><textarea id="research-question" rows={3} className="shadow-sm focus:ring-[#13BBAF] focus:border-[#13BBAF] block w-full sm:text-sm border-gray-600 bg-gray-800 text-white rounded-md p-2" placeholder="e.g., How do our power-users feel about the new interface performance?" value={researchQuestion} onChange={(e) => setResearchQuestion(e.target.value)} /></div></div><div className="pt-5"><div className="flex justify-end"><button onClick={() => onAnalyze(researchQuestion)} className="w-full md:w-auto inline-flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 transition-colors transform hover:scale-105">Analyse Full Data Set</button></div>{error && <p className="text-red-400 text-sm mt-4 text-right">{error}</p>}</div>{modalFile && (<MappingModal file={modalFile} onClose={() => setModalFileId(null)} onSave={handleMappingsUpdate} />)}</div>);
};

const AnalysisReportPage = ({ dataSet, onBack, results, onDownload }) => {
    return <div className="text-white">Analysis Report Page</div>; // Placeholder
};

// --- Page 3: The Main Application ---
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
        // ... analysis logic
        const results = { researchQuestion, soWhatActions: ["Example action 1", "Example action 2"], themes: [], verbatimQuotes: [], quantitativeResults: [], sentiment: 'Neutral', sentimentDistribution: {positive: 0, negative: 0, neutral: 100} };
        setAnalysisResults(results);
        setWorkflowStep('report');
        setIsLoading(false);
    };

    const handleBackToUpload = () => { setWorkflowStep('upload'); setAnalysisResults(null); };
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
