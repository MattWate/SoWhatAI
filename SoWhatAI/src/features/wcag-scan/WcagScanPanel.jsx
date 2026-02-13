import React, { useEffect, useMemo, useState } from 'react';
import { runWcagScan } from './api.js';
import { getStorageItem, setStorageItem } from '../../utils/safeStorage.js';

const IMPACT_ORDER = ['critical', 'serious', 'moderate', 'minor'];
const ISSUE_STATUSES = ['open', 'in_progress', 'resolved', 'accepted_risk'];
const INITIAL_VISIBLE_ISSUES = 30;
const ISSUE_PAGE_SIZE = 30;
const RUN_HISTORY_STORAGE_KEY = 'wcagScan.runHistory.v1';
const ISSUE_STATUS_STORAGE_KEY = 'wcagScan.issueStatus.v1';

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

function formatDuration(ms) {
  const numeric = Number(ms);
  if (!Number.isFinite(numeric) || numeric < 0) return 'n/a';
  return `${numeric} ms`;
}

function loadJsonStorage(key, fallback) {
  try {
    const raw = getStorageItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function getIssueKey(issue) {
  const selector = Array.isArray(issue?.targetSelectors) && issue.targetSelectors.length > 0
    ? issue.targetSelectors[0]
    : 'no-selector';
  return `${issue?.pageUrl || 'unknown'}|${issue?.ruleId || 'unknown'}|${selector}`;
}

function formatStatusLabel(status) {
  return status.replace(/_/g, ' ');
}

function summarizeRun(scanResult, scanUrl) {
  const issues = scanResult?.issues || scanResult?.accessibility?.issues || [];
  const performanceIssues = scanResult?.performance?.issues || scanResult?.performanceIssues || [];
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: new Date().toISOString(),
    scanUrl,
    mode: scanResult?.mode || scanResult?.metadata?.request?.mode || 'single',
    ruleset: scanResult?.metadata?.standards?.ruleset || 'wcag22aa',
    status: scanResult?.status || (scanResult?.metadata?.enginesFailed?.length ? 'partial' : 'complete'),
    pagesCount: (scanResult?.pages || scanResult?.accessibility?.pages || []).length,
    issuesCount: issues.length,
    performanceIssuesCount: performanceIssues.length,
    durationMs: scanResult?.durationMs ?? scanResult?.elapsedMs ?? scanResult?.metadata?.durationMs ?? null,
    impactCounts: {
      critical: getImpactCount(issues, 'critical'),
      serious: getImpactCount(issues, 'serious'),
      moderate: getImpactCount(issues, 'moderate'),
      minor: getImpactCount(issues, 'minor')
    }
  };
}

function buildCoverageSnapshot(scanResult) {
  const pages = scanResult?.pages || [];
  const issues = scanResult?.issues || [];
  const pageIssueMap = new Map();
  const wcagRefCounts = new Map();

  pages.forEach((page) => pageIssueMap.set(page.url, 0));
  issues.forEach((issue) => {
    const pageUrl = issue.pageUrl || 'unknown';
    pageIssueMap.set(pageUrl, (pageIssueMap.get(pageUrl) || 0) + 1);
    (issue.wcagRefs || []).forEach((ref) => {
      wcagRefCounts.set(ref, (wcagRefCounts.get(ref) || 0) + 1);
    });
  });

  const pageRows = Array.from(pageIssueMap.entries()).map(([url, issueCount]) => ({
    url,
    issueCount,
    pass: issueCount === 0
  }));

  const passCount = pageRows.filter((row) => row.pass).length;
  return {
    passRate: pageRows.length ? Math.round((passCount / pageRows.length) * 100) : 0,
    pageRows: pageRows.sort((a, b) => b.issueCount - a.issueCount),
    uniqueRules: new Set(issues.map((issue) => issue.ruleId).filter(Boolean)).size,
    uniqueRefs: wcagRefCounts.size,
    topRefs: Array.from(wcagRefCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10)
  };
}

function dedupeIssueList(issues) {
  const seen = new Set();
  const output = [];
  for (const issue of issues) {
    const selector = Array.isArray(issue?.targetSelectors) && issue.targetSelectors.length > 0
      ? issue.targetSelectors[0]
      : 'no-selector';
    const key = `${issue?.pageUrl || ''}|${issue?.ruleId || ''}|${selector}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(issue);
  }
  return output;
}

function IssueCard({ issue, screenshot, status, onStatusChange }) {
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [expanded, setExpanded] = useState(false);
  const wcagGuidanceUrl = issue?.ruleId ? 'https://www.w3.org/WAI/standards-guidelines/wcag/' : '';
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
          <span className="text-xs font-medium capitalize rounded bg-gray-800 border border-gray-600 px-2 py-1 text-gray-200">
            {formatStatusLabel(status)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={status}
            onChange={(event) => onStatusChange(event.target.value)}
            className="text-xs px-2 py-1 rounded border border-gray-600 bg-gray-900 text-gray-300"
          >
            {ISSUE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {formatStatusLabel(value)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="text-xs px-2 py-1 rounded border border-gray-600 text-gray-300 hover:bg-gray-800"
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
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
          {wcagGuidanceUrl ? (
            <p className="text-xs">
              <a
                href={wcagGuidanceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-teal-300 hover:text-teal-200 underline"
              >
                Open WCAG guidance
              </a>
            </p>
          ) : null}
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
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [selectedPageUrl, setSelectedPageUrl] = useState('');
  const [visibleIssueCount, setVisibleIssueCount] = useState(INITIAL_VISIBLE_ISSUES);
  const [impactFilter, setImpactFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [ruleFilter, setRuleFilter] = useState('');
  const [dedupeIssuesEnabled, setDedupeIssuesEnabled] = useState(false);
  const [runHistory, setRunHistory] = useState(() => loadJsonStorage(RUN_HISTORY_STORAGE_KEY, []));
  const [issueStatusMap, setIssueStatusMap] = useState(() => loadJsonStorage(ISSUE_STATUS_STORAGE_KEY, {}));

  useEffect(() => {
    setStorageItem(RUN_HISTORY_STORAGE_KEY, JSON.stringify(runHistory.slice(0, 20)));
  }, [runHistory]);

  useEffect(() => {
    setStorageItem(ISSUE_STATUS_STORAGE_KEY, JSON.stringify(issueStatusMap));
  }, [issueStatusMap]);

  const urlError = useMemo(() => {
    if (!startUrl.trim()) return 'A URL is required.';
    if (!isValidHttpUrl(startUrl.trim())) return 'Enter a valid http/https URL.';
    return '';
  }, [startUrl]);

  const pages = result?.pages || result?.accessibility?.pages || [];
  const allIssues = result?.issues || result?.accessibility?.issues || [];
  const performancePayload = result?.performance || null;
  const performanceIssues = performancePayload?.issues || result?.performanceIssues || [];
  const metadata = result?.metadata || {};
  const runtimeErrorMeta = metadata.runtimeError || null;
  const engineErrors = metadata?.engineErrors && typeof metadata.engineErrors === 'object'
    ? metadata.engineErrors
    : {};
  const errorsSummary = metadata.errorsSummary || {
    totalErrors: Object.keys(engineErrors).length,
    totalTimeouts: 0,
    messages: Object.entries(engineErrors).map(([engine, message]) => `${engine}: ${message}`)
  };
  const performanceSummary = performancePayload?.summary || metadata?.performance || {
    issueCount: 0,
    impactSummary: { critical: 0, serious: 0, moderate: 0, minor: 0 },
    topRules: [],
    pages: []
  };
  const performanceScore = Number.isFinite(Number(performancePayload?.score))
    ? Math.round(Number(performancePayload.score))
    : null;

  const pageIssues = useMemo(() => {
    if (!selectedPageUrl) return allIssues;
    return allIssues.filter((issue) => issue.pageUrl === selectedPageUrl);
  }, [allIssues, selectedPageUrl]);

  const normalizedPageIssues = useMemo(() => {
    return dedupeIssuesEnabled ? dedupeIssueList(pageIssues) : pageIssues;
  }, [pageIssues, dedupeIssuesEnabled]);

  const filteredIssues = useMemo(() => {
    return normalizedPageIssues.filter((issue) => {
      if (impactFilter !== 'all' && issue.impact !== impactFilter) return false;
      const status = issueStatusMap[getIssueKey(issue)] || 'open';
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (ruleFilter.trim()) {
        const query = ruleFilter.trim().toLowerCase();
        if (!String(issue.ruleId || '').toLowerCase().includes(query)) return false;
      }
      return true;
    });
  }, [normalizedPageIssues, impactFilter, statusFilter, ruleFilter, issueStatusMap]);

  const pagePerformanceIssues = useMemo(() => {
    if (!selectedPageUrl) return performanceIssues;
    return performanceIssues.filter((issue) => issue.pageUrl === selectedPageUrl);
  }, [performanceIssues, selectedPageUrl]);

  useEffect(() => {
    setVisibleIssueCount(INITIAL_VISIBLE_ISSUES);
  }, [selectedPageUrl, result, impactFilter, statusFilter, ruleFilter]);

  const visibleIssues = useMemo(() => {
    return filteredIssues.slice(0, visibleIssueCount);
  }, [filteredIssues, visibleIssueCount]);

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
        startUrl: startUrl.trim()
      };

      const scanResult = await runWcagScan(payload);
      setResult(scanResult);
      if (scanResult?.pages?.length) {
        setSelectedPageUrl(scanResult.pages[0].url);
      }
      setRunHistory((prev) => [summarizeRun(scanResult, startUrl.trim()), ...prev].slice(0, 20));
    } catch (scanError) {
      setError(scanError.message || 'Unable to run WCAG scan.');
    } finally {
      setRunning(false);
    }
  };

  const handleIssueStatusChange = (issue, nextStatus) => {
    setIssueStatusMap((prev) => ({
      ...prev,
      [getIssueKey(issue)]: nextStatus
    }));
  };

  const exportLatestRun = () => {
    if (!result || typeof window === 'undefined') return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `wcag-scan-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    anchor.click();
    window.URL.revokeObjectURL(url);
  };

  const exportIssuesCsv = () => {
    if (!filteredIssues.length || typeof window === 'undefined') return;
    const header = [
      'pageUrl',
      'ruleId',
      'impact',
      'status',
      'wcagRefs',
      'targetSelectors',
      'failureSummary'
    ];
    const rows = filteredIssues.map((issue) => [
      issue.pageUrl || '',
      issue.ruleId || '',
      issue.impact || '',
      issueStatusMap[getIssueKey(issue)] || 'open',
      Array.isArray(issue.wcagRefs) ? issue.wcagRefs.join('|') : '',
      Array.isArray(issue.targetSelectors) ? issue.targetSelectors.join('|') : '',
      String(issue.failureSummary || '').replace(/\s+/g, ' ').trim()
    ]);

    const escapeCsv = (value) => `"${String(value || '').replace(/\"/g, '""')}"`;
    const csv = [header, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `wcag-issues-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    anchor.click();
    window.URL.revokeObjectURL(url);
  };

  const selectedPage = pages.find((page) => page.url === selectedPageUrl);
  const durationText = formatDuration(result?.durationMs ?? metadata.durationMs ?? result?.elapsedMs);
  const coverage = useMemo(() => buildCoverageSnapshot(result), [result]);
  const standards = metadata?.standards || {};
  const engineInsights = metadata?.engine?.insights || null;

  const issueStatusCounts = useMemo(() => {
    const counts = { open: 0, in_progress: 0, resolved: 0, accepted_risk: 0 };
    allIssues.forEach((issue) => {
      const status = issueStatusMap[getIssueKey(issue)] || 'open';
      if (counts[status] == null) {
        counts.open += 1;
      } else {
        counts[status] += 1;
      }
    });
    return counts;
  }, [allIssues, issueStatusMap]);

  const latestRun = runHistory[0] || null;
  const previousRun = runHistory[1] || null;
  const issuesDelta = latestRun && previousRun ? latestRun.issuesCount - previousRun.issuesCount : null;

  return (
    <div className="space-y-6">
      <div className="bg-gray-900/50 backdrop-blur-lg border border-gray-700/50 rounded-lg shadow-2xl p-6 space-y-6">
        <h2 className="text-2xl font-semibold text-white">WCAG QA Command Center</h2>
        <p className="text-sm text-gray-400">
          Run automated accessibility checks, triage findings, and track QA coverage over time.
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

          <p className="text-xs text-gray-400">
            Fixed profile: single-page WCAG 2.2 AA scan with best-practice and advanced rules, experimental off,
            screenshots with markers, and full-page selector coverage. Accessibility testing powered by axe-core.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
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
            <p className="text-sm text-gray-300">
              Standards profile: {standards.ruleset || 'wcag22aa'} | Tags:{' '}
              {Array.isArray(standards.tags) ? standards.tags.join(', ') : 'n/a'}
            </p>
            <p className="text-sm text-gray-300">
              Scope: Full page (all selectors)
            </p>
            {result.message ? <p className="text-sm text-yellow-300">{result.message}</p> : null}
            {runtimeErrorMeta?.hint ? <p className="text-sm text-orange-300">{runtimeErrorMeta.hint}</p> : null}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="rounded border border-gray-700 p-3">
                <p className="text-xs text-gray-400">Pages returned</p>
                <p className="text-xl font-semibold text-white">{pages.length}</p>
              </div>
              <div className="rounded border border-gray-700 p-3">
                <p className="text-xs text-gray-400">Total issues</p>
                <p className="text-xl font-semibold text-white">{allIssues.length}</p>
              </div>
              <div className="rounded border border-gray-700 p-3">
                <p className="text-xs text-gray-400">Performance issues</p>
                <p className="text-xl font-semibold text-white">
                  {performanceSummary.issueCount ?? performanceIssues.length}
                </p>
              </div>
              {IMPACT_ORDER.map((impact) => (
                <div key={impact} className="rounded border border-gray-700 p-3">
                  <p className="text-xs text-gray-400 capitalize">{impact}</p>
                  <p className="text-xl font-semibold text-white">{getImpactCount(allIssues, impact)}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {ISSUE_STATUSES.map((status) => (
                <div key={status} className="rounded border border-gray-700 p-3">
                  <p className="text-xs text-gray-400 capitalize">{formatStatusLabel(status)}</p>
                  <p className="text-xl font-semibold text-white">{issueStatusCounts[status] || 0}</p>
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
            {engineInsights ? (
              <div className="rounded border border-cyan-700 bg-cyan-950/30 p-3">
                <p className="text-sm text-cyan-200 font-medium">Axe insights</p>
                <p className="text-xs text-cyan-100 mt-1">
                  Reported issues: {engineInsights.issueCount ?? allIssues.length} | Incomplete/manual review rules:{' '}
                  {engineInsights.incompleteRuleCount ?? 0}
                </p>
                {Array.isArray(engineInsights.topRules) && engineInsights.topRules.length > 0 ? (
                  <p className="text-xs text-cyan-100 mt-2">
                    Top rules:{' '}
                    {engineInsights.topRules
                      .slice(0, 5)
                      .map((item) => `${item.ruleId} (${item.count})`)
                      .join(', ')}
                  </p>
                ) : null}
                {Array.isArray(engineInsights.incompleteTopRules) && engineInsights.incompleteTopRules.length > 0 ? (
                  <p className="text-xs text-cyan-100 mt-1">
                    Top incomplete checks:{' '}
                    {engineInsights.incompleteTopRules
                      .slice(0, 5)
                      .map((item) => `${item.ruleId} (${item.count})`)
                      .join(', ')}
                  </p>
                ) : null}
              </div>
            ) : null}
            {performanceIssues.length > 0 ? (
              <div className="rounded border border-indigo-700 bg-indigo-950/30 p-3 space-y-2">
                <p className="text-sm text-indigo-200 font-medium">Performance issues</p>
                <p className="text-xs text-indigo-100">
                  Total: {performanceSummary.issueCount ?? performanceIssues.length}
                  {selectedPageUrl ? ` | Selected page: ${pagePerformanceIssues.length}` : ''}
                  {performanceScore != null ? ` | PSI score: ${performanceScore}` : ''}
                </p>
                {Array.isArray(performanceSummary.topRules) && performanceSummary.topRules.length > 0 ? (
                  <p className="text-xs text-indigo-100">
                    Top performance rules:{' '}
                    {performanceSummary.topRules
                      .slice(0, 5)
                      .map((item) => `${item.ruleId} (${item.count})`)
                      .join(', ')}
                  </p>
                ) : null}
                <ul className="mt-1 text-xs text-indigo-100 list-disc list-inside space-y-1">
                  {pagePerformanceIssues.slice(0, 10).map((issue, idx) => (
                    <li key={`${issue.ruleId}-${issue.pageUrl}-${idx}`}>
                      [{issue.impact || 'moderate'}] {issue.ruleId}: {issue.failureSummary}
                      {issue.value ? ` (value: ${issue.value})` : ''}
                    </li>
                  ))}
                </ul>
                {pagePerformanceIssues.length > 10 ? (
                  <p className="text-xs text-indigo-200">
                    Showing 10 of {pagePerformanceIssues.length} performance issues.
                  </p>
                ) : null}
              </div>
            ) : null}
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
                    <p className="text-xs text-gray-400">Performance issues: {page.performanceIssueCount ?? 0}</p>
                    <p className="text-xs text-gray-500">Truncated: {page.truncated ? 'Yes' : 'No'}</p>
                  </button>
                ))}
                {!pages.length ? <p className="text-sm text-gray-400">No pages returned.</p> : null}
              </div>
            </div>

            <div className="lg:col-span-2 bg-gray-900/50 backdrop-blur-lg border border-gray-700/50 rounded-lg shadow-2xl p-4 space-y-4">
              <h4 className="text-lg font-semibold text-white">Issue details</h4>
              <div className="flex flex-wrap gap-3">
                <select
                  value={impactFilter}
                  onChange={(event) => setImpactFilter(event.target.value)}
                  className="px-3 py-2 text-sm rounded-md border border-gray-600 bg-gray-900 text-gray-200"
                >
                  <option value="all">All impacts</option>
                  {IMPACT_ORDER.map((impact) => (
                    <option key={impact} value={impact}>
                      {impact}
                    </option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="px-3 py-2 text-sm rounded-md border border-gray-600 bg-gray-900 text-gray-200"
                >
                  <option value="all">All statuses</option>
                  {ISSUE_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {formatStatusLabel(status)}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={ruleFilter}
                  onChange={(event) => setRuleFilter(event.target.value)}
                  placeholder="Filter by rule id"
                  className="flex-1 min-w-[180px] px-3 py-2 text-sm rounded-md border border-gray-600 bg-gray-900 text-gray-200"
                />
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={dedupeIssuesEnabled}
                    onChange={(event) => setDedupeIssuesEnabled(event.target.checked)}
                    className="h-4 w-4 rounded border-gray-500 bg-gray-800 text-[#13BBAF] focus:ring-[#13BBAF]"
                  />
                  Deduplicate issues
                </label>
                <button
                  type="button"
                  onClick={exportIssuesCsv}
                  disabled={!filteredIssues.length}
                  className="px-3 py-2 text-sm rounded-md border border-gray-600 text-gray-200 hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Export CSV
                </button>
              </div>
              {selectedPage ? (
                <p className="text-xs text-gray-400 break-all">Selected page: {selectedPage.url}</p>
              ) : null}
              {filteredIssues.length ? (
                <>
                  <p className="text-xs text-gray-400">
                    Showing {Math.min(visibleIssueCount, filteredIssues.length)} of {filteredIssues.length} issues
                  </p>
                  <div className="space-y-3">
                    {visibleIssues.map((issue, idx) => (
                      <IssueCard
                        key={`${issue.pageUrl}-${issue.ruleId}-${idx}`}
                        issue={issue}
                        screenshot={screenshotsByPage.get(issue.pageUrl)}
                        status={issueStatusMap[getIssueKey(issue)] || 'open'}
                        onStatusChange={(nextStatus) => handleIssueStatusChange(issue, nextStatus)}
                      />
                    ))}
                  </div>
                  {visibleIssueCount < filteredIssues.length ? (
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

          <div className="bg-gray-900/50 backdrop-blur-lg border border-gray-700/50 rounded-lg shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h3 className="text-xl font-semibold text-white">Traceability & Coverage</h3>
              <button
                type="button"
                onClick={exportLatestRun}
                className="px-3 py-2 text-sm rounded-md border border-gray-600 text-gray-200 hover:bg-gray-800"
              >
                Export latest JSON
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded border border-gray-700 p-3">
                <p className="text-xs text-gray-400">Pass rate</p>
                <p className="text-xl font-semibold text-white">{coverage.passRate}%</p>
              </div>
              <div className="rounded border border-gray-700 p-3">
                <p className="text-xs text-gray-400">Pages in run</p>
                <p className="text-xl font-semibold text-white">{coverage.pageRows.length}</p>
              </div>
              <div className="rounded border border-gray-700 p-3">
                <p className="text-xs text-gray-400">Unique rules</p>
                <p className="text-xl font-semibold text-white">{coverage.uniqueRules}</p>
              </div>
              <div className="rounded border border-gray-700 p-3">
                <p className="text-xs text-gray-400">Unique WCAG refs</p>
                <p className="text-xl font-semibold text-white">{coverage.uniqueRefs}</p>
              </div>
            </div>
            <div className="rounded border border-gray-700 bg-gray-950/40 p-3 overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-gray-300">
                  <tr>
                    <th className="py-2 pr-3">Page</th>
                    <th className="py-2 pr-3">Issues</th>
                    <th className="py-2 pr-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {coverage.pageRows.map((row) => (
                    <tr key={row.url} className="border-t border-gray-800">
                      <td className="py-2 pr-3 text-gray-300 break-all">{row.url}</td>
                      <td className="py-2 pr-3 text-white">{row.issueCount}</td>
                      <td className="py-2 pr-3">
                        <span
                          className={`text-xs rounded border px-2 py-1 ${
                            row.pass
                              ? 'border-emerald-700 bg-emerald-900/40 text-emerald-200'
                              : 'border-red-700 bg-red-900/40 text-red-200'
                          }`}
                        >
                          {row.pass ? 'pass' : 'fail'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rounded border border-gray-700 bg-gray-950/40 p-3">
              <p className="text-sm text-gray-200 font-medium">Top impacted WCAG criteria</p>
              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                {coverage.topRefs.map(([ref, count]) => (
                  <div key={ref} className="text-xs rounded border border-gray-800 px-2 py-1 text-gray-300">
                    {ref}: {count}
                  </div>
                ))}
                {!coverage.topRefs.length ? (
                  <p className="text-xs text-gray-400">No WCAG references tagged in this run.</p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="bg-gray-900/50 backdrop-blur-lg border border-gray-700/50 rounded-lg shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h3 className="text-xl font-semibold text-white">Analytics</h3>
              <button
                type="button"
                disabled={!runHistory.length}
                onClick={() => setRunHistory([])}
                className="px-3 py-2 text-sm rounded-md border border-gray-600 text-gray-200 hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Clear history
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded border border-gray-700 p-3">
                <p className="text-xs text-gray-400">Tracked runs</p>
                <p className="text-xl font-semibold text-white">{runHistory.length}</p>
              </div>
              <div className="rounded border border-gray-700 p-3">
                <p className="text-xs text-gray-400">Latest run issues</p>
                <p className="text-xl font-semibold text-white">{latestRun?.issuesCount ?? 'n/a'}</p>
              </div>
              <div className="rounded border border-gray-700 p-3">
                <p className="text-xs text-gray-400">Issue delta vs previous</p>
                <p className="text-xl font-semibold text-white">
                  {issuesDelta == null ? 'n/a' : issuesDelta > 0 ? `+${issuesDelta}` : String(issuesDelta)}
                </p>
              </div>
            </div>
            <div className="rounded border border-gray-700 bg-gray-950/40 p-3 overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-gray-300">
                  <tr>
                    <th className="py-2 pr-3">Run</th>
                    <th className="py-2 pr-3">URL</th>
                    <th className="py-2 pr-3">Mode</th>
                    <th className="py-2 pr-3">Ruleset</th>
                    <th className="py-2 pr-3">Issues</th>
                    <th className="py-2 pr-3">Perf</th>
                    <th className="py-2 pr-3">Critical</th>
                  </tr>
                </thead>
                <tbody>
                  {runHistory.map((run) => (
                    <tr key={run.id} className="border-t border-gray-800">
                      <td className="py-2 pr-3 text-gray-300">{new Date(run.createdAt).toLocaleString()}</td>
                      <td className="py-2 pr-3 text-gray-300 break-all">{run.scanUrl}</td>
                      <td className="py-2 pr-3 text-white">{run.mode}</td>
                      <td className="py-2 pr-3 text-white">{run.ruleset || 'n/a'}</td>
                      <td className="py-2 pr-3 text-white">{run.issuesCount}</td>
                      <td className="py-2 pr-3 text-white">{run.performanceIssuesCount ?? 0}</td>
                      <td className="py-2 pr-3 text-white">{run.impactCounts?.critical || 0}</td>
                    </tr>
                  ))}
                  {!runHistory.length ? (
                    <tr>
                      <td className="py-2 pr-3 text-gray-400" colSpan={7}>
                        No historical runs yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
