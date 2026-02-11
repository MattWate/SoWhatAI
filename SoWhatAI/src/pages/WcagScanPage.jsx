import React from 'react';
import WcagScanPanel from '../features/wcag-scan/WcagScanPanel.jsx';

export default function WcagScanPage({ onNavigate }) {
  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => onNavigate('home')}
        className="text-sm font-medium text-[#13BBAF] hover:text-teal-400"
      >
        &larr; Back to home
      </button>
      <WcagScanPanel />
    </div>
  );
}
