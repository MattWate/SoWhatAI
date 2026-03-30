import React, { useEffect, useMemo, useRef, useState } from 'react';
import { runWcagScan } from './api.js';

const IMPACT_ORDER = ['critical', 'serious', 'moderate', 'minor', 'unknown'];

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function sanitizeText(value, fallback = '') {
  return String(value ?? fallback).replace(/\s+/g, ' ').trim();
}

function truncateText(value, length = 220) {
  const clean = sanitizeText(value, '');
  if (!clean) return '';
  if (clean.length <= length) return clean;
  return `${clean.slice(0, Math.max(0, length - 3))}...`;
}

function normalizeInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.trunc(numeric);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeImpact(value) {
  const impact = String(value || '').toLowerCase();
  if (impact === 'critical' || impact === 'serious' || impact === 'moderate' || impact === 'minor') {
    return impact;
  }
  return 'unknown';
}

function getIssueNodeCount(issue) {
  if (Number.isFinite(Number(issue && issue.nodeCount))) {
    return Math.max(0, Math.round(Number(issue.nodeCount)));
  }
  const nodes = Array.isArray(issue && issue.nodes) ? issue.nodes : [];
  return nodes.length;
}

function getFirstNode(issue) {
  const firstNode = issue && issue.firstNode && typeof issue.firstNode === 'object'
    ? issue.firstNode
    : null;
  const firstFromList = Array.isArray(issue && issue.nodes) && issue.nodes.length > 0
    ? issue.nodes[0]
    : null;
  const source = firstNode || firstFromList || {};

  const sourceTarget = Array.isArray(source.target) && source.target.length > 0
    ? source.target
    : [];
  const selector = sanitizeText(source.selector || sourceTarget[0], 'n/a');
  const snippet = truncateText(source.snippet || source.html || '', 220) || 'n/a';

  return {
    selector,
    snippet,
    pageUrl: source.pageUrl || null,
    bbox: source.bbox || null
  };
}

function getScreenshotForNode(screenshots, node) {
  if (!Array.isArray(screenshots) || !node || !node.pageUrl) return null;
  return screenshots.find((s) => s && s.pageUrl === node.pageUrl) || null;
}

function groupIssuesByImpact(issues) {
  const groups = {
    critical: [],
    serious: [],
    moderate: [],
    minor: [],
    unknown: []
  };

  if (!Array.isArray(issues)) {
    return groups;
  }

  issues.forEach((issue) => {
    const impact = normalizeImpact(issue && issue.impact);
    groups[impact].push(issue || {});
  });

  return groups;
}

const IMPACT_COLORS = {
  critical: 'bg-red-900/60 text-red-300 border border-red-700',
  serious:  'bg-orange-900/60 text-orange-300 border border-orange-700',
  moderate: 'bg-yellow-900/60 text-yellow-300 border border-yellow-700',
  minor:    'bg-blue-900/60 text-blue-300 border border-blue-700',
  unknown:  'bg-gray-800 text-gray-400 border border-gray-600',
};

function ImpactBadge({ impact }) {
  const key = normalizeImpact(impact);
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold capitalize ${IMPACT_COLORS[key]}`}>
      {key}
    </span>
  );
}

function ScreenshotWithHighlight({ screenshot, bbox }) {
  if (!screenshot || !screenshot.dataUrl) return null;
  return (
    <div className="relative inline-block max-w-full mt-2">
      <img
        src={screenshot.dataUrl}
        alt="Page screenshot"
        className="w-full rounded border border-gray-700"
      />
      {bbox && Number.isFinite(bbox.x) && Number.isFinite(bbox.y) &&
       Number.isFinite(bbox.width) && Number.isFinite(bbox.height) && (
        <div
          style={{
            position: 'absolute',
            left: `${bbox.x}px`,
            top: `${bbox.y}px`,
            width: `${bbox.width}px`,
            height: `${bbox.height}px`,
            backgroundColor: 'rgba(220, 38, 38, 0.25)',
            border: '2px solid rgb(220, 38, 38)',
            pointerEvents: 'none'
          }}
        />
      )}
    </div>
  );
}

async function copyToClipboard(text) {
  if (!text) return;

  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

export default function WcagScanPanel() {
  const abortRef = useRef(null);

  const [startUrl, setStartUrl] = useState('');
  const [mode, setMode] = useState('single');
  const [maxPages, setMaxPages] = useState(1);
  const [includeScreenshots, setIncludeScreenshots] = useState(false);

  const [running, setRunning] = useState(false);
  const [jobId, setJobId] = useState('');
  const [progress, setProgress] = useState({ percent: 0, message: 'Idle' });
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [copyMessage, setCopyMessage] = useState('');
  const [expandedIssues, setExpandedIssues] = useState(new Set());
  const [nodeIndices, setNodeIndices] = useState({});

  const urlError = useMemo(() => {
    const value = String(startUrl || '').trim();
    if (!value) return 'A URL is required.';
    if (!isValidHttpUrl(value)) return 'Enter a valid http:// or https:// URL.';
    return '';
  }, [startUrl]);

  const pages = useMemo(() => (Array.isArray(result && result.pages) ? result.pages : []), [result]);
  const issues = useMemo(() => (Array.isArray(result && result.issues) ? result.issues : []), [result]);
  const needsReview = useMemo(
    () => (Array.isArray(result && result.needsReview) ? result.needsReview : []),
    [result]
  );
  const summary = useMemo(
    () => (result && typeof result.summary === 'object' ? result.summary : {}),
    [result]
  );

  const groupedIssues = useMemo(() => groupIssuesByImpact(issues), [issues]);
  const totalIssueCount = useMemo(
    () => issues.reduce((total, issue) => total + getIssueNodeCount(issue), 0),
    [issues]
  );
  const progressPercent = Math.max(0, Math.min(100, Math.round(Number(progress.percent) || 0)));
  const rawJson = useMemo(() => (result ? JSON.stringify(result, null, 2) : ''), [result]);

  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  async function handleRun() {
    setError('');
    setCopyMessage('');
    setResult(null);
    setJobId('');
    setExpandedIssues(new Set());

    if (urlError) {
      setError(urlError);
      return;
    }

    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setProgress({ percent: 0, message: 'Queued' });

    try {
      const payload = {
        startUrl: sanitizeText(startUrl),
        mode: mode === 'crawl' ? 'crawl' : 'single',
        maxPages: mode === 'crawl' ? clamp(normalizeInteger(maxPages, 1) || 1, 1, 10) : 1,
        timeoutMs: 25000,
        includeScreenshots
      };

      const scanResult = await runWcagScan(payload, {
        signal: controller.signal,
        pollIntervalMs: 1500,
        onProgress: (statusPayload) => {
          const currentProgress =
            statusPayload && statusPayload.progress && typeof statusPayload.progress === 'object'
              ? statusPayload.progress
              : {};

          setJobId(sanitizeText(statusPayload && statusPayload.jobId, ''));
          setProgress({
            percent: Number.isFinite(Number(currentProgress.percent)) ? Number(currentProgress.percent) : 0,
            message: sanitizeText(currentProgress.message, 'Queued')
          });
        }
      });

      setResult(scanResult || {});
      setProgress({ percent: 100, message: 'Complete' });
    } catch (scanError) {
      if (scanError && scanError.name === 'AbortError') {
        setError('Scan cancelled.');
      } else {
        setError(sanitizeText(scanError && scanError.message, 'Unable to run WCAG scan.'));
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setRunning(false);
    }
  }

  function handleCancel() {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }

  function toggleIssue(key) {
    setExpandedIssues((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  async function handleCopyJson() {
    if (!rawJson) return;
    try {
      await copyToClipboard(rawJson);
      setCopyMessage('Copied.');
    } catch {
      setCopyMessage('Copy failed.');
    }
  }

  function handleDownloadCsv() {
    if (!issues.length) return;
    const header = ['Impact', 'Rule ID', 'Description', 'Pages Affected', 'CSS Selector'];
    const rows = issues.map((issue) => [
      normalizeImpact(issue && issue.impact),
      sanitizeText(issue && issue.id, 'unknown_rule'),
      sanitizeText(issue && issue.description, ''),
      sanitizeText(issue && issue.pageUrl, ''),
      getFirstNode(issue).selector,
    ]);
    const escape = (val) => `"${String(val).replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((row) => row.map(escape).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'wcag-violations.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="bg-gray-900/50 backdrop-blur-lg border border-gray-700/50 rounded-lg shadow-2xl p-6 space-y-5">
        <h2 className="text-2xl font-semibold text-white">WCAG Scan</h2>
        <p className="text-sm text-gray-400">
          Start a scan job, poll progress, and review grouped accessibility issues.
        </p>

        <div className="space-y-4">
          <div>
            <label htmlFor="wcag-start-url" className="block text-sm font-medium text-gray-300 mb-1">
              URL
            </label>
            <input
              id="wcag-start-url"
              type="url"
              value={startUrl}
              onChange={(event) => setStartUrl(event.target.value)}
              placeholder="https://example.com"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-[#13BBAF] focus:border-[#13BBAF]"
            />
            {startUrl && urlError ? <p className="mt-1 text-xs text-red-400">{urlError}</p> : null}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label htmlFor="wcag-mode" className="block text-sm font-medium text-gray-300 mb-1">
                Mode
              </label>
              <select
                id="wcag-mode"
                value={mode}
                onChange={(event) => setMode(event.target.value === 'crawl' ? 'crawl' : 'single')}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-[#13BBAF] focus:border-[#13BBAF]"
              >
                <option value="single">Single page</option>
                <option value="crawl">Crawl</option>
              </select>
            </div>

            {mode === 'crawl' ? (
              <div>
                <label htmlFor="wcag-max-pages" className="block text-sm font-medium text-gray-300 mb-1">
                  Max pages
                </label>
                <input
                  id="wcag-max-pages"
                  type="number"
                  min="1"
                  max="10"
                  value={maxPages}
                  onChange={(event) => setMaxPages(clamp(normalizeInteger(event.target.value, 1) || 1, 1, 10))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-[#13BBAF] focus:border-[#13BBAF]"
                />
              </div>
            ) : (
              <div className="md:col-span-1" />
            )}

            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={includeScreenshots}
                  onChange={(event) => setIncludeScreenshots(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-500 bg-gray-800 text-[#13BBAF] focus:ring-[#13BBAF]"
                />
                Include screenshot
              </label>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleRun}
            disabled={running}
            className="inline-flex items-center justify-center px-6 py-3 rounded-md text-white bg-[#EDC8FF] hover:bg-purple-200 disabled:bg-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {running ? 'Running...' : 'Run scan'}
          </button>
          {running ? (
            <button
              type="button"
              onClick={handleCancel}
              className="inline-flex items-center justify-center px-4 py-3 rounded-md border border-gray-600 text-gray-200 hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
          ) : null}
        </div>

        {(running || progress.message) ? (
          <div className="space-y-2 rounded border border-teal-800 bg-teal-950/20 p-3">
            <div className="flex items-center justify-between gap-3 text-xs text-teal-200">
              <span>{sanitizeText(progress.message, 'Queued')}</span>
              <span>{progressPercent}%</span>
            </div>
            <div className="h-2 w-full rounded bg-gray-800 overflow-hidden">
              <div
                className="h-full bg-[#13BBAF] transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {jobId ? <p className="text-xs text-teal-300 break-all">Job: {jobId}</p> : null}
          </div>
        ) : null}

        {error ? (
          <div className="rounded border border-red-700 bg-red-950/20 p-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}
      </div>

      {result ? (
        <div className="space-y-6">
          <div className="bg-gray-900/50 backdrop-blur-lg border border-gray-700/50 rounded-lg shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h3 className="text-xl font-semibold text-white">Results</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDownloadCsv}
                  disabled={!issues.length}
                  className="px-3 py-2 text-sm rounded-md border border-gray-600 text-gray-200 hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Download CSV
                </button>
                <button
                  type="button"
                  onClick={handleCopyJson}
                  className="px-3 py-2 text-sm rounded-md border border-gray-600 text-gray-200 hover:bg-gray-800"
                >
                  Copy JSON
                </button>
              </div>
            </div>
            {copyMessage ? <p className="text-xs text-teal-300">{copyMessage}</p> : null}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {(() => {
                const score = Number.isFinite(Number(summary.accessibilityScore))
                  ? Math.round(Number(summary.accessibilityScore))
                  : null;
                const pass = score !== null && score >= 90;
                const fail = score !== null && score < 90;
                return (
                  <div className={`rounded border p-3 ${pass ? 'border-green-700 bg-green-950/20' : fail ? 'border-red-700 bg-red-950/20' : 'border-gray-700'}`}>
                    <p className="text-xs text-gray-400">Accessibility score</p>
                    <div className="flex items-baseline gap-2 mt-1">
                      <p className={`text-xl font-semibold ${pass ? 'text-green-300' : fail ? 'text-red-300' : 'text-white'}`}>
                        {score !== null ? score : 'n/a'}
                      </p>
                      {pass && <span className="text-xs font-semibold text-green-400 uppercase tracking-wide">Pass</span>}
                      {fail && <span className="text-xs font-semibold text-red-400 uppercase tracking-wide">Fail</span>}
                    </div>
                  </div>
                );
              })()}
              <div className="rounded border border-gray-700 p-3">
                <p className="text-xs text-gray-400">Pages scanned</p>
                <p className="text-xl font-semibold text-white">{pages.length}</p>
              </div>
              <div className="rounded border border-gray-700 p-3">
                <p className="text-xs text-gray-400">Issue count</p>
                <p className="text-xl font-semibold text-white">{totalIssueCount}</p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm text-gray-300 font-medium">Pages</p>
              {pages.length ? (
                <div className="space-y-2">
                  {pages.map((page, index) => (
                    <div key={`${sanitizeText(page && page.url, 'page')}-${index}`} className="rounded border border-gray-700 p-3 bg-gray-900/40">
                      <p className="text-xs text-gray-300 break-all">{sanitizeText(page && page.url, 'n/a')}</p>
                      <p className="text-xs text-gray-400">
                        Status: {sanitizeText(page && page.status, 'unknown')} | Issues:{' '}
                        {Number.isFinite(Number(page && page.issueCount))
                          ? Math.max(0, Math.round(Number(page.issueCount)))
                          : 0}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No page entries returned.</p>
              )}
            </div>
          </div>

          <div className="bg-gray-900/50 backdrop-blur-lg border border-gray-700/50 rounded-lg shadow-2xl p-6 space-y-4">
            <h3 className="text-xl font-semibold text-white">Issues by impact</h3>
            <div className="space-y-4">
              {IMPACT_ORDER.filter((impact) => (groupedIssues[impact] || []).length > 0).map((impact) => {
                const impactIssues = groupedIssues[impact] || [];
                return (
                  <div key={impact} className="rounded border border-gray-700 p-4 bg-gray-900/40 space-y-3">
                    <div className="flex items-center justify-between">
                      <ImpactBadge impact={impact} />
                      <span className="text-xs text-gray-400">{impactIssues.length} rules</span>
                    </div>

                    {impactIssues.length ? (
                      <div className="space-y-3">
                        {impactIssues.map((issue, index) => {
                          const issueId = sanitizeText(issue && issue.id, 'unknown_rule');
                          const description = sanitizeText(
                            issue && issue.description,
                            'No description provided.'
                          );
                          const help = sanitizeText(issue && issue.help, 'No guidance provided.');
                          const nodeCount = getIssueNodeCount(issue);

                          const issueKey = `${issueId}-${index}`;
                          const isExpanded = expandedIssues.has(issueKey);

                          const allNodes = Array.isArray(issue && issue.nodes) && issue.nodes.length > 0
                            ? issue.nodes
                            : [getFirstNode(issue)];
                          const totalNodes = allNodes.length;
                          const currentIdx = nodeIndices[issueKey] || 0;
                          const rawNode = allNodes[Math.min(currentIdx, totalNodes - 1)] || {};
                          const firstNode = {
                            selector: sanitizeText(rawNode.selector || (Array.isArray(rawNode.target) ? rawNode.target[0] : ''), 'n/a'),
                            snippet: truncateText(rawNode.snippet || rawNode.html || '', 220) || 'n/a',
                            pageUrl: rawNode.pageUrl || null,
                            bbox: rawNode.bbox || null,
                          };
                          return (
                            <div key={issueKey} className="rounded border border-gray-700 bg-gray-950/40">
                              <button
                                type="button"
                                onClick={() => toggleIssue(issueKey)}
                                className="w-full flex items-start justify-between gap-3 p-3 text-left hover:bg-gray-800/40 transition-colors"
                              >
                                <div className="space-y-1 min-w-0">
                                  <p className="text-sm text-white font-medium">{issueId}</p>
                                  <p className="text-xs text-gray-300">{description}</p>
                                  <div className="flex items-center gap-2">
                                    <ImpactBadge impact={issue && issue.impact} />
                                    <span className="text-xs text-gray-400">Nodes: {nodeCount}</span>
                                  </div>
                                </div>
                                <span className="text-gray-500 text-xs mt-1 shrink-0">
                                  {isExpanded ? '▲' : '▼'}
                                </span>
                              </button>
                              {isExpanded && (
                                <div className="px-3 pb-3 space-y-2 border-t border-gray-700/60 pt-2">
                                  {totalNodes > 1 && (
                                    <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
                                      <button
                                        type="button"
                                        onClick={() => setNodeIndices(prev => ({ ...prev, [issueKey]: Math.max(0, currentIdx - 1) }))}
                                        disabled={currentIdx === 0}
                                        className="px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-40"
                                      >‹</button>
                                      <span>Node {currentIdx + 1} of {totalNodes}</span>
                                      <button
                                        type="button"
                                        onClick={() => setNodeIndices(prev => ({ ...prev, [issueKey]: Math.min(totalNodes - 1, currentIdx + 1) }))}
                                        disabled={currentIdx === totalNodes - 1}
                                        className="px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-40"
                                      >›</button>
                                    </div>
                                  )}
                                  <p className="text-xs text-gray-400">Help: {help}</p>
                                  <p className="text-xs text-gray-400 break-all">Selector: {firstNode.selector}</p>
                                  <p className="text-xs text-gray-500 font-mono break-all">Snippet: {firstNode.snippet}</p>
                                  {sanitizeText(issue && issue.helpUrl) ? (
                                    <a
                                      href={sanitizeText(issue.helpUrl)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-block text-xs text-[#13BBAF] hover:underline"
                                    >
                                      axe rule docs ↗
                                    </a>
                                  ) : null}
                                  <ScreenshotWithHighlight
                                    screenshot={getScreenshotForNode(Array.isArray(result && result.screenshots) ? result.screenshots : [], firstNode)}
                                    bbox={firstNode.bbox}
                                  />
                                  <p className="text-xs text-yellow-400 mt-1">
                                    Debug — pageUrl: {firstNode.pageUrl || '(none)'} | screenshot: {getScreenshotForNode(Array.isArray(result && result.screenshots) ? result.screenshots : [], firstNode) ? 'FOUND' : 'NOT FOUND'} | bbox: {firstNode.bbox ? JSON.stringify(firstNode.bbox) : '(none)'}
                                  </p>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400">No {impact} issues.</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-gray-900/50 backdrop-blur-lg border border-gray-700/50 rounded-lg shadow-2xl p-6 space-y-2">
            <h3 className="text-xl font-semibold text-white">Needs review</h3>
            {needsReview.length ? (
              <ul className="list-disc list-inside text-sm text-gray-300 space-y-1">
                {needsReview.map((item, index) => (
                  <li key={`${sanitizeText(item && item.id, 'manual_review')}-${index}`}>
                    {sanitizeText(item && item.id, 'manual_review')} - {sanitizeText(item && item.description, 'Manual review recommended.')}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-400">No manual review flags returned.</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
