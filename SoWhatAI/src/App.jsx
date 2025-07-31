import React, { useState, useEffect } from 'react';
import { supabase } from './services/supabaseClient'; 

// Import your new page components
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import AnalysisToolPage from './pages/AnalysisToolPage';

// Import your main UI components
import Header from './components/Header';
import Footer from './components/Footer';

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
