import React, { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from './supabaseClient'; // <-- IMPORT THE REAL SUPABASE CLIENT

// --- UI Components ---

const Header = ({ user, onLogout, onNavigate }) => (
  <header className="bg-transparent sticky top-0 z-50">
    <div className="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8 flex justify-between items-center">
      <h1 className="text-2xl font-bold leading-tight text-white">So What <span className="text-[#EDC8FF]">AI</span></h1>
      <nav className="hidden md:flex items-center space-x-8 text-sm font-medium text-gray-300">
        <a href="#" className="hover:text-white">Features</a>
        <a href="#" className="hover:text-white">Solutions</a>
        <a href="#" className="hover:text-white">Pricing</a>
        <a href="#" className="hover:text-white">Resources</a>
      </nav>
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
    <div className="text-center py-24 sm:py-32">
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
            <button className="flex items-center gap-x-2 text-base font-semibold text-white hover:text-gray-300">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm14.024-.983a1.125 1.125 0 0 1 0 1.966l-5.603 3.113A1.125 1.125 0 0 1 9 15.113V8.887c0-.857.921-1.4 1.671-.983l5.603 3.113Z" clipRule="evenodd" /></svg>
                Watch Demo
            </button>
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
            // In a real app, you might want to show a "Check your email to confirm" message here
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

// --- Page 3: The Main Application ---
const AnalysisToolPage = () => {
    // This component now only contains the logic for the analysis tool itself.
    // All sub-components are defined below it.
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
        setWorkflowStep('report');
        setIsLoading(false);
    };

    const handleBackToUpload = () => { setWorkflowStep('upload'); setAnalysisResults(null); };
    const handleBackToConfig = () => { setWorkflowStep('configure'); setAnalysisResults(null); };
    const handleDownloadReport = () => {};

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
                return <FileUploadPage dataSet={dataSet} setDataSet={setDataSet} onNext={handleNextStep} />;
        }
    };
    
    return renderPage();
};

// --- Sub-components for the AnalysisToolPage ---

const FileUploadPage = ({ dataSet, setDataSet, onNext }) => {
    const fileInputRef = useRef(null);
    return (<div className="bg-gray-900/50 backdrop-blur-lg border border-gray-700/50 rounded-lg shadow-2xl p-6 space-y-6"><div className="flex justify-between items-center"><div><h2 className="text-2xl font-semibold text-white">Step 1: Build Your Data Set</h2><p className="text-sm text-gray-400">Add all your project files (.txt, .docx, .csv, .xlsx).</p></div>{dataSet.length > 0 && (<button onClick={() => setDataSet([])} className="inline-flex items-center px-3 py-2 border border-red-500/50 shadow-sm text-sm font-medium rounded-md text-red-400 bg-gray-800 hover:bg-gray-700">Clear Data Set</button>)}</div><div className="bg-gray-800/50 border-2 border-dashed border-gray-600 rounded-lg p-8 text-center"><input type="file" ref={fileInputRef} onChange={() => {}} accept=".txt,.csv,.xlsx,.doc,.docx" className="hidden" multiple /><button onClick={() => fileInputRef.current.click()} className="inline-flex items-center px-4 py-2 border border-gray-600 shadow-sm text-sm font-medium rounded-md text-gray-300 bg-gray-700 hover:bg-gray-600 transition-colors"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>Add File(s)</button></div><div><h3 className="font-semibold text-lg text-white">Files in Your Data Set:</h3><div className="mt-2 space-y-2">{dataSet.map(file => <p key={file.id} className="p-2 bg-gray-800/70 text-gray-300 rounded-md truncate">{file.name}</p>)}{dataSet.length === 0 && <p className="text-gray-500">No files uploaded.</p>}</div></div><div className="pt-5"><div className="flex justify-end"><button onClick={onNext} disabled={dataSet.length === 0} className="w-full md:w-auto inline-flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-gradient-to-r from-[#13BBAF] to-teal-500 hover:from-teal-500 hover:to-teal-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500 disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed transition-all duration-300 transform hover:scale-105">Next: Configure Data</button></div></div></div>);
};

const MappingModal = ({ file, onClose, onSave }) => {
    const [columnMappings, setColumnMappings] = useState(file.mappings || {});
    return (<div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50 p-4"><div className="bg-gray-800 text-white rounded-lg shadow-xl p-6 space-y-4 w-full max-w-lg"><h3 className="text-lg font-semibold">Map Columns for: {file.name}</h3><div className="space-y-2 max-h-96 overflow-y-auto p-1">{file.headers.map(header => (<div key={header} className="grid grid-cols-2 gap-4 items-center"><label className="font-medium truncate">{header}</label><select value={columnMappings[header]} onChange={(e) => setColumnMappings(prev => ({...prev, [header]: e.target.value}))} className="rounded-md border-gray-600 bg-gray-700 text-white"><option value="ignore">Ignore</option><option value="text">Analyse for Themes</option><option value="stats">Calculate Statistics</option><option value="category">Categorise</option></select></div>))}</div><div className="flex justify-end space-x-3 pt-4"><button onClick={onClose} className="px-4 py-2 bg-gray-600 rounded-md">Cancel</button><button onClick={() => onSave(file.id, columnMappings)} className="px-4 py-2 bg-[#13BBAF] text-white rounded-md">Save Mappings</button></div></div></div>);
};

const ConfigurationPage = ({ dataSet, setDataSet, onAnalyze, onBack, error }) => {
    const [modalFileId, setModalFileId] = useState(null);
    const [researchQuestion, setResearchQuestion] = useState('');
    const handleMappingsUpdate = (fileId, newMappings) => { setDataSet(prevDataSet => prevDataSet.map(file => file.id === fileId ? { ...file, mappings: newMappings } : file)); };
    const modalFile = dataSet.find(f => f.id === modalFileId);
    return (<div className="bg-gray-900/50 backdrop-blur-lg border border-gray-700/50 rounded-lg shadow-2xl p-6 space-y-6"><button onClick={onBack} className="text-sm font-medium text-[#13BBAF] hover:text-teal-400">&larr; Back to upload</button><div><h2 className="text-2xl font-semibold text-white">Step 2: Configure Your Data Set</h2><p className="text-sm text-gray-400">Map columns for each spreadsheet and provide your research question.</p></div><div className="space-y-3"><h3 className="font-semibold text-lg text-white">Files:</h3>{dataSet.map(file => (<div key={file.id} className="flex items-center justify-between p-3 bg-gray-800/70 rounded-md"><span className="font-medium text-gray-300 truncate">{file.name}</span>{file.type === 'spreadsheet' && (<button onClick={() => setModalFileId(file.id)} className="inline-flex items-center px-3 py-1 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-[#13BBAF] hover:bg-teal-600 transition-colors">Map Columns</button>)}{file.type === 'text' && (<span className="text-sm text-green-400">Ready to Analyse</span>)}</div>))}</div><div><label htmlFor="research-question" className="block text-lg font-semibold text-white">Research Question</label><div className="mt-1"><textarea id="research-question" rows={3} className="shadow-sm focus:ring-[#13BBAF] focus:border-[#13BBAF] block w-full sm:text-sm border-gray-600 bg-gray-800 text-white rounded-md p-2" placeholder="e.g., How do our power-users feel about the new interface performance?" value={researchQuestion} onChange={(e) => setResearchQuestion(e.target.value)} /></div></div><div className="pt-5"><div className="flex justify-end"><button onClick={() => onAnalyze(researchQuestion)} className="w-full md:w-auto inline-flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 transition-colors transform hover:scale-105">Analyse Full Data Set</button></div>{error && <p className="text-red-400 text-sm mt-4 text-right">{error}</p>}</div>{modalFile && (<MappingModal file={modalFile} onClose={() => setModalFileId(null)} onSave={handleMappingsUpdate} />)}</div>);
};

const AnalysisReportPage = ({ dataSet, onBack, results, onDownload }) => {
    return <div className="text-white">Analysis Report Page</div>; // Placeholder
};


// --- Main App Component (acts as a router) ---

export default function App() {
    const [user, setUser] = useState(null);
    const [page, setPage] = useState('home');

    useEffect(() => {
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
          const currentUser = session?.user ?? null;
          setUser(currentUser);
          if (!currentUser && page === 'app') {
              setPage('home');
          }
        });
        return () => subscription.unsubscribe();
    }, [page]);

    const handleLogin = (loggedInUser) => {
        setUser(loggedInUser);
        setPage('app');
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
        setUser(null);
        setPage('home');
    };
    
    const handleNavigate = (destination) => {
        if (destination === 'app' && !user) {
            setPage('login');
        } else {
            setPage('app'); // Go directly to the app if logged in
        }
    };

    const renderContent = () => {
        if (user) {
            return <AnalysisToolPage />;
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
