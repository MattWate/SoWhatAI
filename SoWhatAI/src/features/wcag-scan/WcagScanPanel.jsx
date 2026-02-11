import React, { useEffect, useMemo, useState } from 'react';
import { runWcagScan } from './api.js';

const IMPACT_ORDER = ['critical', 'serious', 'moderate', 'minor'];
const INITIAL_VISIBLE_ISSUES = 30;
const ISSUE_PAGE_SIZE = 30;

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function getImpactCount(issues, impact) {
  return issues.filter((issue) => issue.impact === impact).length;
}

function clampMaxPages(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 5;
  return Math.max(1, Math.min(10, Math.floor(numeric)));
}

function formatDuration(ms) {
  const numeric = Number(ms);
  if (!Number.isFinite(numeric) || numeric < 0) return 'n/a';
  return `${numeric} ms`;
}

function IssueCard({ issue, screenshot }) {
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [expanded, setExpanded] = useState(false);
  const hasBox =
    issue?.bbox &&
    Number.isFinite(issue.bbox.x) &&
    Number.isFinite(issue.bbox.y) &&
    Number.isFinite(issue.bbox.width) &&
    Number.isFinite(issue.bbox.height);

  return (
    <div className="rounded-md border border-gray-700 bg-gray-900/60 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide rounded bg-red-900/40 border border-red-700 px-2 py-1">
            {issue.impact || 'unknown'}
          </span>
          <span className="text-sm font-semibold text-white">{issue.ruleId}</span>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="text-xs px-2 py-1 rounded border border-gray-600 text-gray-300 hover:bg-gray-800"
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      <div className="text-xs text-gray-300 break-all">
        Selectors: {issue.targetSelectors?.length ? issue.targetSelectors.join(' | ') : 'n/a'}
      </div>
      {expanded ? (
        <div className="space-y-3">
          <div className="text-xs text-gray-400 break-all">
            WCAG refs: {issue.wcagRefs?.length ? issue.wcagRefs.join(', ') : 'n/a'}
          </div>
          <pre className="text-xs text-teal-100 bg-gray-950 border border-gray-800 rounded p-2 overflow-auto">
            {issue.htmlSnippet || 'No HTML snippet provided.'}
          </pre>
          {issue.failureSummary ? <p className="text-xs text-gray-300">{issue.failureSummary}</p> : null}
          {screenshot?.dataUrl ? (
            <div className="space-y-2">
              <p className="text-xs text-gray-400">Screenshot marker</p>
              <div className="relative inline-block max-w-full border border-gray-700 rounded overflow-hidden">
                <img
                  src={screenshot.dataUrl}
                  alt={`Screenshot for ${issue.pageUrl}`}
                  className="max-w-full h-auto block"
                  onLoad={(event) => {
                    const img = event.currentTarget;
                    setImageSize({
                      width: img.naturalWidth || 0,
                      height: img.naturalHeight || 0
                    });
                  }}
                />
                {hasBox ? (
                  <div
                    className="absolute border-2 border-red-500 bg-red-400/20 pointer-events-none"
                    style={{
                      left:
                        imageSize.width > 0
                          ? `${(issue.bbox.x / imageSize.width) * 100}%`
                          : `${issue.bbox.x}px`,
                      top:
                        imageSize.height > 0
                          ? `${(issue.bbox.y / imageSize.height) * 100}%`
                          : `${issue.bbox.y}px`,
                      width:
                        imageSize.width > 0
                          ? `${(issue.bbox.width / imageSize.width) * 100}%`
                          : `${issue.bbox.width}px`,
                      height:
                        imageSize.height > 0
                          ? `${(issue.bbox.height / imageSize.height) * 100}%`
                          : `${issue.bbox.height}px`
                    }}
                    aria-label="Issue marker"
                  />
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function WcagScanPanel() {
  const [startUrl, setStartUrl] = useState('');
  const [mode, setMode] = useState('single');
  const [maxPages, setMaxPages] = useState(5);
  const [includeScreenshots, setIncludeScreenshots] = useState(false);
  const [timeoutMs, setTimeoutMs] = useState(30000);
  const [debug, setDebug] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [selectedPageUrl, setSelectedPageUrl] = useState('');
  const [visibleIssueCount, setVisibleIssueCount] = useState(INITIAL_VISIBLE_ISSUES);

  const urlError = useMemo(() => {
    if (!startUrl.trim()) return 'A URL is required.';
    if (!isValidHttpUrl(startUrl.trim())) return 'Enter a valid http/https URL.';
    return '';
  }, [startUrl]);

  const pages = result?.pages || [];
  const allIssues = result?.issues || [];
  const metadata = result?.metadata || {};
  const errorsSummary = metadata.errorsSummary || { totalErrors: 0, totalTimeouts: 0, messages: [] };

  const pageIssues = useMemo(() => {
    if (!selectedPageUrl) return allIssues;
    return allIssues.filter((issue) => issue.pageUrl === selectedPageUrl);
  }, [allIssues, selectedPageUrl]);

  useEffect(() => {
    setVisibleIssueCount(INITIAL_VISIBLE_ISSUES);
  }, [selectedPageUrl, result]);

  const visibleIssues = useMemo(() => {
    return pageIssues.slice(0, visibleIssueCount);
  }, [pageIssues, visibleIssueCount]);

  const screenshotsByPage = useMemo(() => {
    const map = new Map();
    (result?.screenshots || []).forEach((shot) => {
      if (shot?.pageUrl) {
        map.set(shot.pageUrl, shot);
      }
    });
    return map;
  }, [result]);

  const handleRun = async () => {
    setError('');
    setResult(null);
    setSelectedPageUrl('');

    if (urlError) {
      setError(urlError);
      return;
    }

    setRunning(true);
    try {
      const payload = {
        startUrl: startUrl.trim(),
        mode,
        includeScreenshots,
        timeoutMs: Number(timeoutMs),
        debug
      };
      if (mode === 'crawl') {
        payload.maxPages = clampMaxPages(maxPages);
      }

      const scanResult = await runWcagScan(payload);
      setResult(scanResult);
      if (scanResult?.pages?.length) {
        setSelectedPageUrl(scanResult.pages[0].url);
      }
    } catch (scanError) {
      setError(scanError.message || 'Unable to run WCAG scan.');
    } finally {
      setRunning(false);
    }
  };

  const selectedPage = pages.find((page) => page.url === selectedPageUrl);
  const durationText = formatDuration(result?.durationMs ?? metadata.durationMs ?? result?.elapsedMs);

  return (
    <div className="space-y-6">
      <div className="bg-gray-900/50 backdrop-blur-lg border border-gray-700/50 rounded-lg shadow-2xl p-6 space-y-6">
        <h2 className="text-2xl font-semibold text-white">WCAG Scan</h2>
        <p className="text-sm text-gray-400">
          Run automated accessibility checks (axe-core) with optional screenshot markers for pinpointing issues.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1" htmlFor="wcag-url-input">
              URL to scan
            </label>
            <input
              id="wcag-url-input"
              type="url"
              placeholder="https://example.com"
              value={startUrl}
              onChange={(event) => setStartUrl(event.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white shadow-sm focus:outline-none focus:ring-[#13BBAF] focus:border-[#13BBAF]"
            />
            {urlError && startUrl ? <p className="mt-1 text-xs text-red-400">{urlError}</p> : null}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1" htmlFor="wcag-mode-select">
                Scan mode
              </label>
              <select
                id="wcag-mode-select"
                value={mode}
                onChange={(event) => setMode(event.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white shadow-sm focus:outline-none focus:ring-[#13BBAF] focus:border-[#13BBAF]"
              >
                <option value="single">Single page</option>
                <option value="crawl">Crawl</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1" htmlFor="wcag-max-pages">
                Max pages
              </label>
              <input
                id="wcag-max-pages"
                type="number"
                min={1}
                max={10}
                value={maxPages}
                disabled={mode === 'single'}
                onChange={(event) => setMaxPages(event.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white shadow-sm disabled:opacity-50 focus:outline-none focus:ring-[#13BBAF] focus:border-[#13BBAF]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1" htmlFor="wcag-timeout">
                Timeout (ms, max 45000)
              </label>
              <input
                id="wcag-timeout"
                type="number"
                min={5000}
                max={45000}
                step={1000}
                value={timeoutMs}
                onChange={(event) => setTimeoutMs(event.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white shadow-sm focus:outline-none focus:ring-[#13BBAF] focus:border-[#13BBAF]"
              />
            </div>

            <div className="space-y-3 mt-7">
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={includeScreenshots}
                  onChange={(event) => setIncludeScreenshots(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-500 bg-gray-800 text-[#13BBAF] focus:ring-[#13BBAF]"
                />
                Include screenshots and markers
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={debug}
                  onChange={(event) => setDebug(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-500 bg-gray-800 text-[#13BBAF] focus:ring-[#13BBAF]"
                />
                Include debug timing metadata
              </label>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            type="button"
            disabled={running}
            onClick={handleRun}
            className="inline-flex items-center justify-center px-6 py-3 rounded-md text-black bg-[#EDC8FF] hover:bg-purple-200 disabled:bg-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {running ? 'Running scan...' : 'Run scan'}
          </button>
          {running ? <span className="text-sm text-teal-300 animate-pulse">Scanning in progress...</span> : null}
        </div>

        {error ? <p className="text-sm text-red-400">{error}</p> : null}
      </div>

      {result ? (
        <div className="space-y-6">
          <div className="bg-gray-900/50 backdrop-blur-lg border border-gray-700/50 rounded-lg shadow-2xl p-6 space-y-4">
            <h3 className="text-xl font-semibold text-white">Summary</h3>
            <p className="text-sm text-gray-300">Status: {result.status || 'complete'}</p>
            <p className="text-sm text-gray-300">Duration: {durationText}</p>
            <p className="text-sm text-gray-300">
              Pages attempted: {metadata.pagesAttempted ?? 'n/a'} | Pages scanned: {metadata.pagesScanned ?? 'n/a'}
            </p>
            <p className="text-sm text-gray-300">
              Truncated: {result.truncated ? 'Yes' : 'No'}
            </p>
            {result.message ? <p className="text-sm text-yellow-300">{result.message}</p> : null}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="rounded border border-gray-700 p-3">
                <p className="text-xs text-gray-400">Pages returned</p>
                <p className="text-xl font-semibold text-white">{pages.length}</p>
              </div>
              <div className="rounded border border-gray-700 p-3">
                <p className="text-xs text-gray-400">Total issues</p>
                <p className="text-xl font-semibold text-white">{allIssues.length}</p>
              </div>
              {IMPACT_ORDER.map((impact) => (
                <div key={impact} className="rounded border border-gray-700 p-3">
                  <p className="text-xs text-gray-400 capitalize">{impact}</p>
                  <p className="text-xl font-semibold text-white">{getImpactCount(allIssues, impact)}</p>
                </div>
              ))}
            </div>
            <div className="rounded border border-gray-700 bg-gray-950/50 p-3">
              <p className="text-sm text-gray-200 font-medium">Errors summary</p>
              <p className="text-xs text-gray-400 mt-1">
                Timeouts: {errorsSummary.totalTimeouts || 0} | Errors: {errorsSummary.totalErrors || 0}
              </p>
              {Array.isArray(errorsSummary.messages) && errorsSummary.messages.length > 0 ? (
                <ul className="mt-2 text-xs text-gray-300 list-disc list-inside space-y-1">
                  {errorsSummary.messages.map((message, idx) => (
                    <li key={`${message}-${idx}`}>{message}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="rounded border border-amber-700 bg-amber-950/40 p-3">
              <p className="text-sm text-amber-200 font-medium">Needs review</p>
              {(result.needsReview || []).length > 0 ? (
                <ul className="mt-2 text-sm text-amber-100 list-disc list-inside">
                  {result.needsReview.map((item, idx) => (
                    <li key={`${item.id}-${idx}`}>
                      {item.title}: {item.reason}
                      {Array.isArray(item.samples) && item.samples.length > 0
                        ? ` (samples: ${item.samples.join(', ')})`
                        : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-amber-100 mt-1">No manual review flags raised.</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 bg-gray-900/50 backdrop-blur-lg border border-gray-700/50 rounded-lg shadow-2xl p-4">
              <h4 className="text-lg font-semibold text-white mb-3">Pages</h4>
              <div className="space-y-2">
                {pages.map((page) => (
                  <button
                    key={page.url}
                    type="button"
                    onClick={() => setSelectedPageUrl(page.url)}
                    className={`w-full text-left rounded border p-3 transition-colors ${
                      selectedPageUrl === page.url
                        ? 'border-[#13BBAF] bg-teal-950/30'
                        : 'border-gray-700 bg-gray-900/60 hover:bg-gray-800/60'
                    }`}
                  >
                    <p className="text-xs text-gray-400 truncate">{page.url}</p>
                    <p className="text-sm text-white">Issues: {page.issueCount}</p>
                    <p className="text-xs text-gray-400">Status: {page.status}</p>
                    <p className="text-xs text-gray-500">Truncated: {page.truncated ? 'Yes' : 'No'}</p>
                  </button>
                ))}
                {!pages.length ? <p className="text-sm text-gray-400">No pages returned.</p> : null}
              </div>
            </div>

            <div className="lg:col-span-2 bg-gray-900/50 backdrop-blur-lg border border-gray-700/50 rounded-lg shadow-2xl p-4 space-y-4">
              <h4 className="text-lg font-semibold text-white">Issue details</h4>
              {selectedPage ? (
                <p className="text-xs text-gray-400 break-all">Selected page: {selectedPage.url}</p>
              ) : null}
              {pageIssues.length ? (
                <>
                  <p className="text-xs text-gray-400">
                    Showing {Math.min(visibleIssueCount, pageIssues.length)} of {pageIssues.length} issues
                  </p>
                  <div className="space-y-3">
                    {visibleIssues.map((issue, idx) => (
                      <IssueCard
                        key={`${issue.pageUrl}-${issue.ruleId}-${idx}`}
                        issue={issue}
                        screenshot={screenshotsByPage.get(issue.pageUrl)}
                      />
                    ))}
                  </div>
                  {visibleIssueCount < pageIssues.length ? (
                    <button
                      type="button"
                      onClick={() => setVisibleIssueCount((prev) => prev + ISSUE_PAGE_SIZE)}
                      className="px-4 py-2 text-sm rounded-md border border-gray-600 text-gray-200 hover:bg-gray-800"
                    >
                      Load more issues
                    </button>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-gray-400">No issues for this page.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
