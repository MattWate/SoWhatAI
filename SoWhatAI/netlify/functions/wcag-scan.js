import axe from 'axe-core';
import { runWcagScan } from '../lib/wcagScannerCore.js';
import { getPsiResult, sanitizeErrorMessage } from './psiClient.js';
import { runPerformanceEngine } from './performanceEngine.js';
import { runSeoEngine } from './seoEngine.js';
import { runBestPracticesEngine } from './bestPracticesEngine.js';
import { runWithTimeout } from './runWithTimeout.js';

const TOTAL_SCAN_BUDGET_SINGLE_MS = 30000;
const TOTAL_SCAN_BUDGET_CRAWL_MS = 45000;
const DEFAULT_ACCESSIBILITY_TIMEOUT_SINGLE_MS = 30000;
const DEFAULT_ACCESSIBILITY_TIMEOUT_CRAWL_MS = 15000;
const DEFAULT_PSI_TIMEOUT_MS = 10000;
const DEFAULT_ENGINE_TIMEOUT_MS = 9000;
const DEFAULT_PSI_STRATEGY = 'mobile';
const DEFAULT_CRAWL_MAX_PAGES = 3;
const CRAWL_SAFETY_THRESHOLD_MS = 3500;
const MIN_TIMEOUT_MS = 2500;
const MAX_TIMEOUT_MS = 60000;
const MAX_ERROR_LENGTH = 260;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  };
}

function sanitizeError(error) {
  const text = sanitizeErrorMessage(error?.message || String(error || 'Unknown error'));
  return String(text).replace(/\s+/g, ' ').trim().slice(0, MAX_ERROR_LENGTH);
}

function clampScore(score) {
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function clampTimeout(timeoutMs, fallbackMs) {
  const fallback = Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.floor(Number(fallbackMs) || 0))) ||
    DEFAULT_ENGINE_TIMEOUT_MS;
  const numeric = Number(timeoutMs);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.floor(numeric)));
}

function normalizeMode(mode) {
  return String(mode || '').toLowerCase() === 'crawl' ? 'crawl' : 'single';
}

function getTotalScanBudgetForMode(mode) {
  return mode === 'crawl' ? TOTAL_SCAN_BUDGET_CRAWL_MS : TOTAL_SCAN_BUDGET_SINGLE_MS;
}

function getAccessibilityTimeoutForMode(mode) {
  return mode === 'crawl'
    ? DEFAULT_ACCESSIBILITY_TIMEOUT_CRAWL_MS
    : DEFAULT_ACCESSIBILITY_TIMEOUT_SINGLE_MS;
}

function normalizeMaxPages(mode, maxPages) {
  if (mode !== 'crawl') return 1;
  const numeric = Number(maxPages);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_CRAWL_MAX_PAGES;
  return Math.min(10, Math.max(1, Math.floor(numeric)));
}

function normalizeIncludeScreenshots(includeScreenshots) {
  if (includeScreenshots == null) return true;
  return Boolean(includeScreenshots);
}

function normalizePsiStrategy(value) {
  return String(value || '').toLowerCase() === 'desktop' ? 'desktop' : DEFAULT_PSI_STRATEGY;
}

function normalizeHttpUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function createTimeBudget(totalMs, fallbackMs) {
  const budgetMs = clampTimeout(totalMs, fallbackMs);
  const startedAtMs = Date.now();
  const deadlineAtMs = startedAtMs + budgetMs;
  return {
    totalMs: budgetMs,
    startedAtMs,
    deadlineAtMs,
    elapsedMs() {
      return Math.max(0, Date.now() - startedAtMs);
    },
    remainingMs() {
      return Math.max(0, deadlineAtMs - Date.now());
    }
  };
}

function remainingTimeout(timeBudget, fallbackMs) {
  const remaining = Math.max(MIN_TIMEOUT_MS, timeBudget.remainingMs() - 200);
  return clampTimeout(Math.min(remaining, fallbackMs), fallbackMs);
}

function computeAccessibilityScore(pages) {
  const list = Array.isArray(pages) ? pages : [];
  if (!list.length) return null;
  let passedPages = 0;
  for (const page of list) {
    const issueCount = Number(page?.issueCount);
    const isPass = page?.status === 'ok' && Number.isFinite(issueCount) && issueCount === 0;
    if (isPass) {
      passedPages += 1;
    }
  }
  return clampScore((passedPages / list.length) * 100);
}

function createUnavailableAccessibilityData(requestInput, { reason = 'unknown', message = '' } = {}) {
  const sanitizedMessage = sanitizeError(message || 'Accessibility scan unavailable.');
  return {
    status: 'unavailable',
    reason,
    engine: 'accessibility',
    source: 'axe-core',
    scanner: {
      name: 'axe-core',
      version: axe?.version || null,
      executionMode: 'playwright-axe'
    },
    pageUrl: requestInput.startUrl,
    analyzedUrl: requestInput.startUrl,
    mode: requestInput.mode,
    maxPages: requestInput.maxPages,
    includeScreenshots: requestInput.includeScreenshots,
    score: null,
    issueCount: 0,
    issues: [],
    pages: [],
    performanceIssues: [],
    screenshots: [],
    needsReview: [],
    durationMs: 0,
    message: sanitizedMessage,
    metadata: {
      durationMs: 0,
      pagesAttempted: 0,
      pagesScanned: 0,
      truncated: true,
      errorsSummary: {
        totalErrors: 1,
        totalTimeouts: reason === 'timeout' ? 1 : 0,
        messages: [sanitizedMessage]
      }
    },
    error: sanitizedMessage
  };
}

function createPartialAccessibilityData(requestInput, { reason = 'timeout', message = '', durationMs = 0 } = {}) {
  const sanitizedMessage = sanitizeError(message || 'Accessibility scan partial.');
  return {
    status: 'partial',
    reason,
    truncated: true,
    engine: 'accessibility',
    source: 'axe-core',
    scanner: {
      name: 'axe-core',
      version: axe?.version || null,
      executionMode: 'playwright-axe'
    },
    pageUrl: requestInput.startUrl,
    analyzedUrl: requestInput.startUrl,
    mode: requestInput.mode,
    maxPages: requestInput.maxPages,
    includeScreenshots: requestInput.includeScreenshots,
    score: null,
    issueCount: 0,
    issues: [],
    pages: [],
    performanceIssues: [],
    screenshots: [],
    needsReview: [],
    durationMs,
    message: sanitizedMessage,
    metadata: {
      durationMs,
      pagesAttempted: 0,
      pagesScanned: 0,
      truncated: true,
      errorsSummary: {
        totalErrors: 1,
        totalTimeouts: reason === 'timeout' ? 1 : 0,
        messages: [sanitizedMessage]
      }
    },
    error: sanitizedMessage
  };
}

function mapAccessibilityData(scanResult, requestInput) {
  const payload = scanResult && typeof scanResult === 'object' ? scanResult : {};
  const pages = Array.isArray(payload.pages) ? payload.pages : [];
  const issues = Array.isArray(payload.issues) ? payload.issues : [];
  const performanceIssues = Array.isArray(payload.performanceIssues) ? payload.performanceIssues : [];
  const screenshots = Array.isArray(payload.screenshots) ? payload.screenshots : [];
  const needsReview = Array.isArray(payload.needsReview) ? payload.needsReview : [];
  const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};

  const rawPagesScanned = Number(metadata.pagesScanned);
  const pagesScanned = Number.isFinite(rawPagesScanned)
    ? Math.max(0, Math.floor(rawPagesScanned))
    : pages.filter((page) => page?.status === 'ok').length;

  const payloadStatus = String(payload.status || '').toLowerCase();
  const payloadMessage = String(payload.message || '');
  const hasTimeoutSignal =
    payloadMessage.toLowerCase().includes('time') ||
    Number(metadata?.errorsSummary?.totalTimeouts) > 0;
  const truncated = Boolean(payload.truncated || metadata.truncated);

  let status = 'available';
  if (payloadStatus === 'partial') {
    status = 'partial';
  } else if (pagesScanned <= 0) {
    status = 'unavailable';
  }

  let reason = null;
  if (status === 'partial') {
    reason = hasTimeoutSignal ? 'timeout' : 'partial';
  } else if (status === 'unavailable') {
    reason = hasTimeoutSignal ? 'timeout' : 'scan_failed';
  }

  return {
    status,
    reason,
    truncated,
    engine: 'accessibility',
    source: 'axe-core',
    scanner: {
      name: 'axe-core',
      version: axe?.version || null,
      executionMode: 'playwright-axe'
    },
    pageUrl: requestInput.startUrl,
    analyzedUrl: requestInput.startUrl,
    mode: requestInput.mode,
    maxPages: requestInput.maxPages,
    includeScreenshots: requestInput.includeScreenshots,
    score: computeAccessibilityScore(pages),
    issueCount: issues.length,
    issues,
    pages,
    performanceIssues,
    screenshots,
    needsReview,
    durationMs: Number(payload.durationMs) || 0,
    startedAt: payload.startedAt || null,
    finishedAt: payload.finishedAt || null,
    message: String(payload.message || ''),
    metadata,
    error:
      status === 'unavailable'
        ? sanitizeError(payload.message || metadata?.errorsSummary?.messages?.[0] || 'Accessibility scan failed.')
        : null
  };
}

async function runAccessibilityTask({ requestInput, timeBudget }) {
  if (requestInput.mode === 'crawl' && timeBudget.remainingMs() < CRAWL_SAFETY_THRESHOLD_MS) {
    const message = `Accessibility crawl skipped because remaining time is below ${CRAWL_SAFETY_THRESHOLD_MS}ms safety threshold.`;
    return {
      status: 'partial',
      data: createPartialAccessibilityData(requestInput, {
        reason: 'timeout',
        message
      }),
      error: message,
      raw: null
    };
  }

  const scanTimeoutFallback =
    requestInput.mode === 'crawl'
      ? requestInput.totalBudgetMs
      : requestInput.accessibilityTimeoutMs;
  const timeoutMs = remainingTimeout(timeBudget, scanTimeoutFallback);
  const execution = await runWithTimeout(
    runWcagScan({
      startUrl: requestInput.startUrl,
      mode: requestInput.mode,
      maxPages: requestInput.maxPages,
      includeScreenshots: requestInput.includeScreenshots,
      timeoutMs: requestInput.totalBudgetMs,
      pageScanBudgetMs: requestInput.mode === 'crawl' ? requestInput.accessibilityTimeoutMs : undefined
    }),
    timeoutMs,
    'Accessibility scan'
  );

  if (execution.status === 'timeout') {
    const message = sanitizeError(execution.message || `Accessibility scan timed out after ${timeoutMs}ms.`);
    return {
      status: 'partial',
      data: createPartialAccessibilityData(requestInput, {
        reason: 'timeout',
        message,
        durationMs: timeBudget.elapsedMs()
      }),
      error: message,
      raw: null
    };
  }

  if (execution.status === 'error') {
    const message = sanitizeError(execution.error);
    return {
      status: 'failed',
      data: createUnavailableAccessibilityData(requestInput, {
        reason: 'unknown',
        message
      }),
      error: message,
      raw: null
    };
  }

  const data = mapAccessibilityData(execution.value, requestInput);
  const status =
    data.status === 'unavailable' ? 'failed' : data.status === 'partial' ? 'partial' : 'success';
  return {
    status,
    data,
    error: data.status === 'unavailable' ? data.error : null,
    raw: execution.value
  };
}

function createUnavailablePerformanceData(startUrl, strategy, reason, message) {
  const safeMessage = sanitizeError(message || 'PSI performance data unavailable.');
  return {
    status: 'unavailable',
    reason,
    source: 'google-pagespeed-insights',
    strategy,
    pageUrl: startUrl,
    analyzedUrl: startUrl,
    score: null,
    coreWebVitals: {
      lcpMs: { value: null, category: '', source: '' },
      inpMs: { value: null, category: '', source: '' },
      cls: { value: null, category: '', source: '' },
      fcpMs: { value: null, category: '', source: '' },
      ttfbMs: { value: null, category: '', source: '' },
      speedIndexMs: { value: null, category: '', source: '' },
      tbtMs: { value: null, category: '', source: '' }
    },
    lighthouseMetrics: {
      fcpMs: null,
      lcpMs: null,
      speedIndexMs: null,
      tbtMs: null,
      ttiMs: null,
      cls: null,
      ttfbMs: null,
      inpMs: null
    },
    opportunities: [],
    diagnostics: [],
    issues: [],
    issueCount: 0,
    summary: {
      issueCount: 0,
      impactSummary: { critical: 0, serious: 0, moderate: 0, minor: 0 },
      topRules: []
    },
    fetchedAt: new Date().toISOString(),
    fetchDurationMs: 0,
    psiCacheHit: false,
    error: safeMessage
  };
}

function createUnavailableSeoData(startUrl, strategy, reason, message) {
  const safeMessage = sanitizeError(message || 'PSI SEO data unavailable.');
  return {
    status: 'unavailable',
    reason,
    engine: 'seo',
    source: 'google-pagespeed-insights',
    category: 'seo',
    pageUrl: startUrl,
    analyzedUrl: startUrl,
    score: null,
    issueCount: 0,
    issues: [],
    auditCount: 0,
    failedAuditCount: 0,
    fetchedAt: new Date().toISOString(),
    fetchDurationMs: 0,
    psiCacheHit: false,
    strategy,
    error: safeMessage
  };
}

function createUnavailableBestPracticesData(startUrl, strategy, reason, message) {
  const safeMessage = sanitizeError(message || 'PSI best-practices data unavailable.');
  return {
    status: 'unavailable',
    reason,
    engine: 'bestPractices',
    source: 'google-pagespeed-insights',
    category: 'best-practices',
    pageUrl: startUrl,
    analyzedUrl: startUrl,
    score: null,
    issueCount: 0,
    issues: [],
    auditCount: 0,
    failedAuditCount: 0,
    fetchedAt: new Date().toISOString(),
    fetchDurationMs: 0,
    psiCacheHit: false,
    strategy,
    error: safeMessage
  };
}

async function runDerivedEngineTask({ engineKey, runner, timeoutMs, fallbackBuilder }) {
  const execution = await runWithTimeout(runner(), timeoutMs, `${engineKey} engine`);
  if (execution.status === 'timeout') {
    const message = sanitizeError(execution.message || `${engineKey} engine timed out after ${timeoutMs}ms.`);
    return {
      status: 'failed',
      data: fallbackBuilder('timeout', message),
      error: message
    };
  }
  if (execution.status === 'error') {
    const message = sanitizeError(execution.error);
    return {
      status: 'failed',
      data: fallbackBuilder('unknown', message),
      error: message
    };
  }

  const value = execution.value && typeof execution.value === 'object' ? execution.value : {};
  const data =
    value.data && typeof value.data === 'object'
      ? value.data
      : fallbackBuilder('unknown', value.error || `${engineKey} engine failed.`);
  const status = value.status === 'success' ? 'success' : 'failed';
  return {
    status,
    data,
    error: status === 'failed' ? sanitizeError(value.error || data.error || `${engineKey} failed.`) : null
  };
}

async function runPsiTask({ startUrl, strategy, timeBudget }) {
  const timeoutMs = remainingTimeout(timeBudget, DEFAULT_PSI_TIMEOUT_MS);
  const execution = await runWithTimeout(
    getPsiResult({
      url: startUrl,
      strategy,
      timeoutMs
    }),
    timeoutMs + 400,
    'PSI request'
  );

  if (execution.status === 'timeout') {
    return {
      status: 'failed',
      error: 'timeout',
      message: sanitizeError(execution.message || `PSI request timed out after ${timeoutMs}ms.`),
      cacheHit: false,
      fromCache: false,
      psiCallsMade: 0,
      psiCacheHits: 0,
      fetchDurationMs: 0,
      strategy
    };
  }

  if (execution.status === 'error') {
    return {
      status: 'failed',
      error: 'unknown',
      message: sanitizeError(execution.error),
      cacheHit: false,
      fromCache: false,
      psiCallsMade: 0,
      psiCacheHits: 0,
      fetchDurationMs: 0,
      strategy
    };
  }

  const value = execution.value;
  if (!value || typeof value !== 'object') {
    return {
      status: 'failed',
      error: 'unknown',
      message: 'PSI response was empty.',
      cacheHit: false,
      fromCache: false,
      psiCallsMade: 0,
      psiCacheHits: 0,
      fetchDurationMs: 0,
      strategy
    };
  }
  return value;
}

function buildErrorsSummary(engineErrors, accessibilityData) {
  const messages = [];
  const seen = new Set();
  let totalTimeouts = 0;
  const pushMessage = (value) => {
    const text = sanitizeError(value);
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    messages.push(text);
    if (key.includes('timeout')) {
      totalTimeouts += 1;
    }
  };

  for (const [engineKey, message] of Object.entries(engineErrors || {})) {
    pushMessage(`${engineKey}: ${message}`);
    if (messages.length >= 12) break;
  }

  const accessibilityMessages = accessibilityData?.metadata?.errorsSummary?.messages;
  if (Array.isArray(accessibilityMessages) && messages.length < 12) {
    for (const entry of accessibilityMessages) {
      if (!entry) continue;
      pushMessage(`accessibility: ${entry}`);
      if (messages.length >= 12) break;
    }
  }

  return {
    totalErrors: messages.length,
    totalTimeouts,
    messages: messages.slice(0, 12)
  };
}

function buildFailureResponse(requestInput, durationMs, errorMessage) {
  const message = sanitizeError(errorMessage || 'Scan orchestration failed.');
  return {
    status: 'partial',
    message,
    mode: requestInput.mode,
    durationMs,
    elapsedMs: durationMs,
    accessibility: createUnavailableAccessibilityData(requestInput, {
      reason: 'unknown',
      message
    }),
    performance: createUnavailablePerformanceData(
      requestInput.startUrl,
      DEFAULT_PSI_STRATEGY,
      'unknown',
      message
    ),
    seo: createUnavailableSeoData(requestInput.startUrl, DEFAULT_PSI_STRATEGY, 'unknown', message),
    bestPractices: createUnavailableBestPracticesData(
      requestInput.startUrl,
      DEFAULT_PSI_STRATEGY,
      'unknown',
      message
    ),
    summary: {
      accessibilityScore: 0,
      performanceScore: 0,
      seoScore: 0,
      bestPracticesScore: 0,
      overallScore: 0
    },
    metadata: {
      durationMs,
      truncated: true,
      enginesRun: ['accessibility', 'performance', 'seo', 'bestPractices'],
      enginesFailed: ['accessibility', 'performance', 'seo', 'bestPractices'],
      psiCallsMade: 0,
      psiCacheHits: 0,
      engineErrors: {
        accessibility: message,
        performance: message,
        seo: message,
        bestPractices: message
      },
      errorsSummary: {
        totalErrors: 4,
        totalTimeouts: message.toLowerCase().includes('timeout') ? 1 : 0,
        messages: [
          `accessibility: ${message}`,
          `performance: ${message}`,
          `seo: ${message}`,
          `bestPractices: ${message}`
        ]
      },
      request: requestInput,
      totalBudgetMs: requestInput.totalBudgetMs || getTotalScanBudgetForMode(requestInput.mode)
    },
    pages: [],
    issues: [],
    performanceIssues: [],
    screenshots: [],
    needsReview: []
  };
}

exports.handler = async (event, context) => {
  if (context && typeof context === 'object') {
    context.callbackWaitsForEmptyEventLoop = false;
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }

  const startUrl = typeof body.startUrl === 'string' ? body.startUrl.trim() : '';
  if (!startUrl) {
    return json(400, { error: 'startUrl is required.' });
  }

  const normalizedStartUrl = normalizeHttpUrl(startUrl);
  if (!normalizedStartUrl) {
    return json(400, { error: 'startUrl must be a valid http/https URL.' });
  }

  const mode = normalizeMode(body.mode);
  const requestInput = {
    startUrl: normalizedStartUrl,
    mode,
    maxPages: normalizeMaxPages(mode, body.maxPages),
    includeScreenshots: normalizeIncludeScreenshots(body.includeScreenshots),
    totalBudgetMs: clampTimeout(body.totalBudgetMs, getTotalScanBudgetForMode(mode)),
    accessibilityTimeoutMs: clampTimeout(body.accessibilityTimeoutMs, getAccessibilityTimeoutForMode(mode))
  };

  const psiStrategy = normalizePsiStrategy(body.psiStrategy);
  const timeBudget = createTimeBudget(requestInput.totalBudgetMs, getTotalScanBudgetForMode(mode));

  try {
    const accessibilityPromise = runAccessibilityTask({ requestInput, timeBudget });
    const psiPromise = runPsiTask({
      startUrl: requestInput.startUrl,
      strategy: psiStrategy,
      timeBudget
    });

    const performancePromise = runDerivedEngineTask({
      engineKey: 'performance',
      timeoutMs: remainingTimeout(timeBudget, DEFAULT_ENGINE_TIMEOUT_MS),
      runner: async () => {
        const psiResult = await psiPromise;
        return runPerformanceEngine({
          startUrl: requestInput.startUrl,
          strategy: psiStrategy,
          psiResult
        });
      },
      fallbackBuilder: (reason, message) =>
        createUnavailablePerformanceData(requestInput.startUrl, psiStrategy, reason, message)
    });

    const seoPromise = runDerivedEngineTask({
      engineKey: 'seo',
      timeoutMs: remainingTimeout(timeBudget, DEFAULT_ENGINE_TIMEOUT_MS),
      runner: async () => {
        const psiResult = await psiPromise;
        return runSeoEngine({
          startUrl: requestInput.startUrl,
          strategy: psiStrategy,
          psiResult
        });
      },
      fallbackBuilder: (reason, message) =>
        createUnavailableSeoData(requestInput.startUrl, psiStrategy, reason, message)
    });

    const bestPracticesPromise = runDerivedEngineTask({
      engineKey: 'bestPractices',
      timeoutMs: remainingTimeout(timeBudget, DEFAULT_ENGINE_TIMEOUT_MS),
      runner: async () => {
        const psiResult = await psiPromise;
        return runBestPracticesEngine({
          startUrl: requestInput.startUrl,
          strategy: psiStrategy,
          psiResult
        });
      },
      fallbackBuilder: (reason, message) =>
        createUnavailableBestPracticesData(requestInput.startUrl, psiStrategy, reason, message)
    });

    const settled = await Promise.allSettled([
      accessibilityPromise,
      performancePromise,
      seoPromise,
      bestPracticesPromise,
      psiPromise
    ]);

    const accessibilityOutcome =
      settled[0].status === 'fulfilled'
        ? settled[0].value
        : {
            status: 'failed',
            data: createUnavailableAccessibilityData(requestInput, {
              reason: 'unknown',
              message: sanitizeError(settled[0].reason)
            }),
            error: sanitizeError(settled[0].reason),
            raw: null
          };

    const performanceOutcome =
      settled[1].status === 'fulfilled'
        ? settled[1].value
        : {
            status: 'failed',
            data: createUnavailablePerformanceData(
              requestInput.startUrl,
              psiStrategy,
              'unknown',
              sanitizeError(settled[1].reason)
            ),
            error: sanitizeError(settled[1].reason)
          };

    const seoOutcome =
      settled[2].status === 'fulfilled'
        ? settled[2].value
        : {
            status: 'failed',
            data: createUnavailableSeoData(
              requestInput.startUrl,
              psiStrategy,
              'unknown',
              sanitizeError(settled[2].reason)
            ),
            error: sanitizeError(settled[2].reason)
          };

    const bestPracticesOutcome =
      settled[3].status === 'fulfilled'
        ? settled[3].value
        : {
            status: 'failed',
            data: createUnavailableBestPracticesData(
              requestInput.startUrl,
              psiStrategy,
              'unknown',
              sanitizeError(settled[3].reason)
            ),
            error: sanitizeError(settled[3].reason)
          };

    const psiResult =
      settled[4].status === 'fulfilled'
        ? settled[4].value
        : {
            status: 'failed',
            error: 'unknown',
            message: sanitizeError(settled[4].reason),
            cacheHit: false,
            fromCache: false,
            psiCallsMade: 0,
            psiCacheHits: 0,
            fetchDurationMs: 0,
            strategy: psiStrategy
          };

    const accessibility = accessibilityOutcome.data;
    const performance = performanceOutcome.data;
    const seo = seoOutcome.data;
    const bestPractices = bestPracticesOutcome.data;

    const enginesRun = ['accessibility', 'performance', 'seo', 'bestPractices'];
    const enginesFailed = [];
    const engineErrors = {};

    if (accessibility.status === 'unavailable' || accessibility.status === 'partial') {
      enginesFailed.push('accessibility');
      engineErrors.accessibility =
        accessibilityOutcome.error ||
        accessibility.error ||
        accessibility.message ||
        accessibility.reason ||
        'failed';
    }
    if (performance.status === 'unavailable') {
      enginesFailed.push('performance');
      engineErrors.performance = performance.reason || performance.error || performanceOutcome.error || 'failed';
    }
    if (seo.status === 'unavailable') {
      enginesFailed.push('seo');
      engineErrors.seo = seo.reason || seo.error || seoOutcome.error || 'failed';
    }
    if (bestPractices.status === 'unavailable') {
      enginesFailed.push('bestPractices');
      engineErrors.bestPractices =
        bestPractices.reason || bestPractices.error || bestPracticesOutcome.error || 'failed';
    }

    const accessibilityScore = clampScore(accessibility.score);
    const performanceScore = clampScore(performance.score);
    const seoScore = clampScore(seo.score);
    const bestPracticesScore = clampScore(bestPractices.score);
    const overallScore = clampScore(
      (accessibilityScore + performanceScore + seoScore + bestPracticesScore) / 4
    );

    const durationMs = timeBudget.elapsedMs();
    const errorsSummary = buildErrorsSummary(engineErrors, accessibility);

    const pages = Array.isArray(accessibility.pages) ? accessibility.pages : [];
    const issues = Array.isArray(accessibility.issues) ? accessibility.issues : [];
    const performanceIssues = Array.isArray(performance.issues) && performance.issues.length > 0
      ? performance.issues
      : Array.isArray(accessibility.performanceIssues)
        ? accessibility.performanceIssues
        : [];

    const psiQuotaExceeded =
      performance.reason === 'quota_exceeded' ||
      seo.reason === 'quota_exceeded' ||
      bestPractices.reason === 'quota_exceeded';

    const status =
      enginesFailed.length > 0 || accessibility.status === 'partial'
        ? 'partial'
        : 'complete';

    const message = psiQuotaExceeded
      ? 'Google PageSpeed Insights quota exceeded. Returning accessibility results and marking PSI engines unavailable.'
      : accessibility.message || '';

    const accessibilityMeta = accessibility.metadata && typeof accessibility.metadata === 'object'
      ? accessibility.metadata
      : {};

    const response = {
      status,
      message,
      mode: requestInput.mode,
      startedAt: accessibility.startedAt || new Date(timeBudget.startedAtMs).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs,
      elapsedMs: durationMs,
      accessibility,
      performance,
      seo,
      bestPractices,
      summary: {
        accessibilityScore,
        performanceScore,
        seoScore,
        bestPracticesScore,
        overallScore
      },
      metadata: {
        durationMs,
        truncated: Boolean(
          status === 'partial' ||
          accessibility.truncated ||
          accessibilityMeta.truncated ||
          timeBudget.remainingMs() <= 0
        ),
        enginesRun,
        enginesFailed,
        psiCallsMade: Number(psiResult.psiCallsMade) || 0,
        psiCacheHits: Number(psiResult.psiCacheHits) || 0,
        engineErrors,
        errorsSummary,
        pagesAttempted: Number(accessibilityMeta.pagesAttempted) || pages.length,
        pagesScanned: Number(accessibilityMeta.pagesScanned) || pages.filter((page) => page?.status === 'ok').length,
        standards: accessibilityMeta.standards || {
          ruleset: 'wcag22aa',
          tags: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'],
          includeBestPractices: true,
          includeExperimental: false
        },
        scope: accessibilityMeta.scope || {
          includeSelectors: [],
          excludeSelectors: []
        },
        performance:
          performance.summary && typeof performance.summary === 'object'
            ? performance.summary
            : accessibilityMeta.performance || null,
        request: requestInput,
        totalBudgetMs: requestInput.totalBudgetMs
      },
      pages,
      issues,
      performanceIssues,
      screenshots: Array.isArray(accessibility.screenshots) ? accessibility.screenshots : [],
      needsReview: Array.isArray(accessibility.needsReview) ? accessibility.needsReview : []
    };

    return json(200, response);
  } catch (error) {
    const durationMs = timeBudget.elapsedMs();
    console.error(`[wcag-scan] orchestrator failed: ${sanitizeError(error)}`);
    return json(200, buildFailureResponse(requestInput, durationMs, sanitizeError(error)));
  }
};
