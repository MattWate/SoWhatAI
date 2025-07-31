import React from 'react';

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

export default HomePage;
