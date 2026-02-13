import React, { useMemo, useState } from 'react';
import { runPageSpeedScan } from './api.js';

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function formatDuration(ms) {
  const numeric = Number(ms);
  if (!Number.isFinite(numeric) || numeric < 0) return 'n/a';
  return `${numeric} ms`;
}

function formatScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'n/a';
  return `${Math.max(0, Math.min(100, Math.round(numeric)))}`;
}

function statusStyles(status) {
  if (status === 'available') {
    return 'border-emerald-700 bg-emerald-900/30 text-emerald-200';
  }
  if (status === 'unavailable') {
    return 'border-amber-700 bg-amber-900/30 text-amber-200';
  }
  return 'border-gray-700 bg-gray-900/40 text-gray-200';
}

function EngineCard({ label, data }) {
  const issues = Array.isArray(data?.issues) ? data.issues : [];
  const status = String(data?.status || 'unknown');
  const reason = data?.reason || '';
  const score = formatScore(data?.score);
  const issueCount = Number.isFinite(Number(data?.issueCount))
    ? Number(data.issueCount)
    : issues.length;

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-lg font-semibold text-white">{label}</h4>
        <span className={`text-xs uppercase tracking-wide rounded border px-2 py-1 ${statusStyles(status)}`}>
          {status}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded border border-gray-700 p-2">
          <p className="text-xs text-gray-400">Score</p>
          <p className="text-xl font-semibold text-white">{score}</p>
        </div>
        <div className="rounded border border-gray-700 p-2">
          <p className="text-xs text-gray-400">Issues</p>
          <p className="text-xl font-semibold text-white">{issueCount}</p>
        </div>
      </div>
      {reason ? (
        <p className="text-xs text-amber-200 rounded border border-amber-700 bg-amber-950/40 p-2">
          Reason: {reason}
        </p>
      ) : null}
      {issues.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-300">Top findings</p>
          <ul className="text-xs text-gray-300 list-disc list-inside space-y-1">
            {issues.slice(0, 8).map((issue, idx) => (
              <li key={`${issue.ruleId || 'rule'}-${idx}`}>
                [{issue.impact || 'minor'}] {issue.ruleId || issue.title || 'Issue'}
                {issue.failureSummary ? `: ${issue.failureSummary}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-gray-400">No findings returned.</p>
      )}
    </div>
  );
}

export default function PageSpeedScanPanel() {
  const [startUrl, setStartUrl] = useState('');
  const [strategy, setStrategy] = useState('mobile');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const urlError = useMemo(() => {
    if (!startUrl.trim()) return 'A URL is required.';
    if (!isValidHttpUrl(startUrl.trim())) return 'Enter a valid http/https URL.';
    return '';
  }, [startUrl]);

  const handleRun = async () => {
    setError('');
    setResult(null);

    if (urlError) {
      setError(urlError);
      return;
    }

    setRunning(true);
    try {
      const scanResult = await runPageSpeedScan({
        startUrl: startUrl.trim(),
        psiStrategy: strategy
      });
      setResult(scanResult);
    } catch (scanError) {
      setError(scanError.message || 'Unable to run PageSpeed scan.');
    } finally {
      setRunning(false);
    }
  };

  const metadata = result?.metadata || {};
  const errorsSummary = metadata?.errorsSummary || { messages: [], totalErrors: 0, totalTimeouts: 0 };

  return (
    <div className="space-y-6">
      <div className="bg-gray-900/50 backdrop-blur-lg border border-gray-700/50 rounded-lg shadow-2xl p-6 space-y-6">
        <h2 className="text-2xl font-semibold text-white">PageSpeed QA Command Center</h2>
        <p className="text-sm text-gray-400">
          Run Google PageSpeed Insights and review performance, SEO, and best-practices in one scan.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-3">
            <label className="block text-sm font-medium text-gray-300 mb-1" htmlFor="pagespeed-url-input">
              URL to scan
            </label>
            <input
              id="pagespeed-url-input"
              type="url"
              placeholder="https://example.com"
              value={startUrl}
              onChange={(event) => setStartUrl(event.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white shadow-sm focus:outline-none focus:ring-[#13BBAF] focus:border-[#13BBAF]"
            />
            {urlError && startUrl ? <p className="mt-1 text-xs text-red-400">{urlError}</p> : null}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1" htmlFor="pagespeed-strategy-select">
              Strategy
            </label>
            <select
              id="pagespeed-strategy-select"
              value={strategy}
              onChange={(event) => setStrategy(event.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white shadow-sm focus:outline-none focus:ring-[#13BBAF] focus:border-[#13BBAF]"
            >
              <option value="mobile">mobile</option>
              <option value="desktop">desktop</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleRun}
            disabled={running}
            className="inline-flex items-center px-4 py-2 rounded-md text-white bg-[#13BBAF] hover:bg-teal-500 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {running ? 'Running PageSpeed scan...' : 'Run PageSpeed Scan'}
          </button>
          <p className="text-xs text-gray-500">This runs in a separate backend call from WCAG scans.</p>
        </div>
      </div>

      {error ? (
        <div className="rounded border border-red-700 bg-red-950/40 p-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="space-y-6">
          <div className="bg-gray-900/50 backdrop-blur-lg border border-gray-700/50 rounded-lg shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h3 className="text-xl font-semibold text-white">Summary</h3>
              <span className="text-xs text-gray-400">
                Duration: {formatDuration(result?.durationMs || metadata?.durationMs)}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded border border-gray-700 p-3">
                <p className="text-xs text-gray-400">Performance</p>
                <p className="text-xl font-semibold text-white">{formatScore(result?.summary?.performanceScore)}</p>
              </div>
              <div className="rounded border border-gray-700 p-3">
                <p className="text-xs text-gray-400">SEO</p>
                <p className="text-xl font-semibold text-white">{formatScore(result?.summary?.seoScore)}</p>
              </div>
              <div className="rounded border border-gray-700 p-3">
                <p className="text-xs text-gray-400">Best Practices</p>
                <p className="text-xl font-semibold text-white">{formatScore(result?.summary?.bestPracticesScore)}</p>
              </div>
              <div className="rounded border border-gray-700 p-3">
                <p className="text-xs text-gray-400">Overall</p>
                <p className="text-xl font-semibold text-white">{formatScore(result?.summary?.overallScore)}</p>
              </div>
            </div>
            <div className="rounded border border-gray-700 bg-gray-950/40 p-3 text-xs text-gray-300 space-y-1">
              <p>Status: {result?.status || 'unknown'}</p>
              {result?.message ? <p>Message: {result.message}</p> : null}
              <p>PSI calls made: {Number(metadata?.psiCallsMade) || 0}</p>
              <p>PSI cache hits: {Number(metadata?.psiCacheHits) || 0}</p>
              <p>
                Timeouts: {Number(errorsSummary?.totalTimeouts) || 0} | Errors:{' '}
                {Number(errorsSummary?.totalErrors) || 0}
              </p>
            </div>
            {Array.isArray(errorsSummary?.messages) && errorsSummary.messages.length > 0 ? (
              <ul className="text-xs text-gray-300 list-disc list-inside space-y-1">
                {errorsSummary.messages.map((message, idx) => (
                  <li key={`${message}-${idx}`}>{message}</li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <EngineCard label="Performance" data={result?.performance} />
            <EngineCard label="SEO" data={result?.seo} />
            <EngineCard label="Best Practices" data={result?.bestPractices} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
