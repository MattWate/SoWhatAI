import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './supabaseClient.js';

import Header from './components/Header.jsx';
import Footer from './components/Footer.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';

import HomePage from './pages/HomePage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import AnalysisToolPage from './pages/AnalysisToolPage.jsx';
import WcagScanPage from './pages/WcagScanPage.jsx';
import PageSpeedScanPage from './pages/PageSpeedScanPage.jsx';

export default function App() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleLogin = (loggedInUser) => setUser(loggedInUser);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-black font-sans text-white relative">
        <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
          <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-gray-900 via-black to-[#3C4142]"></div>
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-900/40 rounded-full filter blur-3xl opacity-50 animate-aurora-1"></div>
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-teal-900/40 rounded-full filter blur-3xl opacity-50 animate-aurora-2"></div>
        </div>

        <Header user={user} onLogout={handleLogout} />

        <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/login" element={<LoginPage onLogin={handleLogin} />} />
            <Route path="/wcag-scan" element={<WcagScanPage />} />
            <Route path="/pagespeed-scan" element={<PageSpeedScanPage />} />
            <Route path="/dashboard" element={
              <ProtectedRoute user={user}><DashboardPage user={user} /></ProtectedRoute>
            } />
            <Route path="/app" element={
              <ProtectedRoute user={user}><AnalysisToolPage /></ProtectedRoute>
            } />
            <Route path="/app/:projectId" element={
              <ProtectedRoute user={user}><AnalysisToolPage /></ProtectedRoute>
            } />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>

        <Footer />
      </div>
    </BrowserRouter>
  );
}
