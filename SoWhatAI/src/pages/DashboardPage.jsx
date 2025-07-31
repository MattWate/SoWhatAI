import React, { useState } from 'react';

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

export default DashboardPage;
