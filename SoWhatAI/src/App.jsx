import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient.js';

// --- Page & Component Imports ---
// Make sure your file structure matches these paths.
// You might have these in a /pages or /components subdirectory.
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import AnalysisToolPage from './pages/AnalysisToolPage';
import ReportViewerPage from './pages/ReportViewerPage';

// --- UI Components ---
// You can keep these here or move them to their own files (e.g., /components/Header.jsx)
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


// --- Main App Component (acts as a router) ---

export default function App() {
    const [user, setUser] = useState(null);
    const [page, setPage] = useState('home');
    const [selectedProjectId, setSelectedProjectId] = useState(null);

    useEffect(() => {
        // First, check if there's an active session when the app loads
        supabase.auth.getSession().then(({ data: { session } }) => {
          const currentUser = session?.user ?? null;
          setUser(currentUser);
          // If a user is found, send them to the dashboard
          if (currentUser) {
              setPage('dashboard');
          }
        });

        // Then, listen for any changes in authentication state (login/logout)
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
          const currentUser = session?.user ?? null;
          setUser(currentUser);
          // If the user logs out, and they are on a protected page, send them home
          if (!currentUser && (page === 'app' || page === 'dashboard' || page === 'report')) {
              setPage('home');
          }
        });

        // Cleanup the subscription when the component unmounts
        return () => subscription.unsubscribe();
    }, []); // The empty array ensures this runs only once on initial mount

    const handleLogin = (loggedInUser) => {
        setUser(loggedInUser);
        setPage('dashboard');
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
        setUser(null);
        setSelectedProjectId(null); // Clear selected project on logout
        setPage('home');
    };
    
    const handleNavigate = (destination, projectId = null) => {
        // If a user is not logged in and tries to access a protected page
        if (!user && (destination === 'app' || destination === 'dashboard' || destination === 'report')) {
            setPage('login'); // Redirect to login
        } else {
            setSelectedProjectId(projectId); // Set the project ID for the report page
            setPage(destination);
        }
    };

    const renderContent = () => {
        // If a user is logged in, show them the protected pages
        if (user) {
            switch (page) {
                case 'app':
                    // Pass the user object to AnalysisToolPage so it can be used when saving
                    return <AnalysisToolPage user={user} onNavigate={handleNavigate} />;
                case 'report':
                    // The ReportViewerPage will use the projectId to fetch its own data
                    return <ReportViewerPage projectId={selectedProjectId} onNavigate={handleNavigate} />;
                case 'dashboard':
                default: // Default to dashboard if logged in
                    return <DashboardPage user={user} onNavigate={handleNavigate} />;
            }
        }
        
        // If no user is logged in, show the public pages
        switch (page) {
            case 'login':
                return <LoginPage onLogin={handleLogin} onNavigate={handleNavigate} />;
            case 'home':
            default: // Default to home page
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

