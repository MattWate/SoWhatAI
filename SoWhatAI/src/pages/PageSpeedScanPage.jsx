import React from 'react';
import PageSpeedScanPanel from '../features/pagespeed-scan/PageSpeedScanPanel.jsx';

export default function PageSpeedScanPage({ onNavigate }) {
  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => onNavigate('home')}
        className="text-sm font-medium text-[#13BBAF] hover:text-teal-400"
      >
        &larr; Back to home
      </button>
      <PageSpeedScanPanel />
    </div>
  );
}
