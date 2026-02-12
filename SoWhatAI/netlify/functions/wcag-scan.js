import { runAccessibilityEngine } from '../lib/accessibilityEngine.js';
import { runPerformanceEngine } from '../lib/performanceEngine.js';
import { runSeoEngine } from '../lib/seoEngine.js';
import { runBestPracticesEngine } from '../lib/bestPracticesEngine.js';
import { fetchPsiPayload } from '../lib/psiClient.js';

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  };
}

const TOTAL_SCAN_BUDGET_MS = 20000;
const DEFAULT_ENGINE_TIMEOUT_MS = 10000;
const MIN_ENGINE_TIMEOUT_MS = 2500;
const MAX_ENGINE_TIMEOUT_MS = 15000;
const MIN_REMAINING_TO_START_PAGE_MS = 2500;
const MIN_REMAINING_TO_START_ENGINE_MS = 1200;
const CRAWL_FETCH_TIMEOUT_MS = 2500;
const MAX_CRAWL_QUEUE = 120;
const MAX_LINKS_PER_PAGE = 24;
const MAX_ISSUES_PER_ENGINE = 220;
const SHARED_PSI_CATEGORIES = ['accessibility', 'performance', 'seo', 'best-practices'];
const TRACKING_PARAMS = new Set(['fbclid', 'gclid', 'yclid', 'mc_eid']);
const SKIP_FILE_EXT = /\.(pdf|zip|docx?|xlsx?|pptx?|csv|mp4|mp3|avi|mov|exe|dmg|rar)$/i;

const ENGINE_REGISTRY = [
  {
    key: 'accessibility',
    runner: runAccessibilityEngine,
    timeoutMs: DEFAULT_ENGINE_TIMEOUT_MS
  },
  {
    key: 'performance',
    runner: runPerformanceEngine,
    timeoutMs: DEFAULT_ENGINE_TIMEOUT_MS
  },
  {
    key: 'seo',
    runner: runSeoEngine,
    timeoutMs: DEFAULT_ENGINE_TIMEOUT_MS
  },
  {
    key: 'bestPractices',
    runner: runBestPracticesEngine,
    timeoutMs: DEFAULT_ENGINE_TIMEOUT_MS
  }
];

function normalizeMode(mode) {
  return String(mode || '').toLowerCase() === 'crawl' ? 'crawl' : 'single';
}

function normalizeMaxPages(mode, maxPages) {
  if (mode !== 'crawl') return 1;
  const numeric = Number(maxPages);
  if (!Number.isFinite(numeric) || numeric <= 0) return 5;
  return Math.min(10, Math.max(1, Math.floor(numeric)));
}

function normalizeIncludeScreenshots(includeScreenshots) {
  if (includeScreenshots == null) return true;
  return Boolean(includeScreenshots);
}

function sanitizeError(error) {
  const raw = error?.message || String(error || 'Unknown error');
  return String(raw).replace(/\s+/g, ' ').trim().slice(0, 260);
}

function clampScore(score) {
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function createTimeBudget(totalMs) {
  const budgetMs = Math.max(4000, Math.floor(Number(totalMs) || TOTAL_SCAN_BUDGET_MS));
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
    },
    isExceeded() {
      return Date.now() >= deadlineAtMs;
    }
  };
}

function runWithTimeout(promise, timeoutMs) {
  const safeTimeoutMs = Math.max(
    MIN_ENGINE_TIMEOUT_MS,
    Math.min(MAX_ENGINE_TIMEOUT_MS, Math.floor(Number(timeoutMs) || DEFAULT_ENGINE_TIMEOUT_MS))
  );

  let timeoutId;
  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      resolve({
        status: 'timeout',
        timedOut: true,
        error: new Error(`Timed out after ${safeTimeoutMs}ms.`)
      });
    }, safeTimeoutMs);
  });

  const workPromise = Promise.resolve(promise)
    .then((value) => {
      clearTimeout(timeoutId);
      return {
        status: 'success',
        timedOut: false,
        value
      };
    })
    .catch((error) => {
      clearTimeout(timeoutId);
      return {
        status: 'error',
        timedOut: false,
        error
      };
    });

  return Promise.race([workPromise, timeoutPromise]);
}

function normalizeHttpUrl(rawUrl, baseUrl) {
  try {
    const parsed = baseUrl ? new URL(rawUrl, baseUrl) : new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    parsed.hash = '';
    const toDelete = [];
    parsed.searchParams.forEach((_, key) => {
      const lower = key.toLowerCase();
      if (lower.startsWith('utm_') || TRACKING_PARAMS.has(lower)) {
        toDelete.push(key);
      }
    });
    toDelete.forEach((key) => parsed.searchParams.delete(key));
    if (parsed.pathname.length > 1) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
      if (!parsed.pathname) parsed.pathname = '/';
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function shouldSkipCrawlUrl(urlString, startOrigin) {
  try {
    const parsed = new URL(urlString);
    if (parsed.origin !== startOrigin) return true;
    if (SKIP_FILE_EXT.test(parsed.pathname)) return true;
    return false;
  } catch {
    return true;
  }
}

function extractInternalLinks(html, pageUrl, startOrigin) {
  if (typeof html !== 'string' || !html) return [];
  const hrefRegex = /<a\s[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^'"<>\s]+))/gi;
  const output = new Set();
  let match = hrefRegex.exec(html);

  while (match) {
    const rawHref = match[1] || match[2] || match[3] || '';
    const href = String(rawHref || '').trim();
    if (!href || /^(mailto:|tel:|javascript:)/i.test(href)) {
      match = hrefRegex.exec(html);
      continue;
    }
    const normalized = normalizeHttpUrl(href, pageUrl);
    if (!normalized || shouldSkipCrawlUrl(normalized, startOrigin)) {
      match = hrefRegex.exec(html);
      continue;
    }
    output.add(normalized);
    if (output.size >= MAX_LINKS_PER_PAGE) break;
    match = hrefRegex.exec(html);
  }

  return Array.from(output).sort((a, b) => a.localeCompare(b));
}

async function fetchPageHtml(pageUrl, timeoutMs) {
  const timeout = Math.max(700, Math.floor(Number(timeoutMs) || CRAWL_FETCH_TIMEOUT_MS));
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(pageUrl, {
      method: 'GET',
      headers: { Accept: 'text/html,*/*;q=0.9' },
      signal: controller.signal
    });
    if (!response.ok) {
      return { html: '', timeoutOccurred: false, error: `HTTP ${response.status}` };
    }
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      return { html: '', timeoutOccurred: false, error: 'non_html_content' };
    }
    const html = await response.text();
    return { html, timeoutOccurred: false, error: null };
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { html: '', timeoutOccurred: true, error: `crawl_fetch_timeout_after_${timeout}ms` };
    }
    return { html: '', timeoutOccurred: false, error: sanitizeError(error) };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function buildCrawlTargets({ startUrl, maxPages, timeBudget }) {
  const normalizedStart = normalizeHttpUrl(startUrl);
  if (!normalizedStart) {
    return {
      targets: [],
      truncated: true,
      stopReason: 'invalid_start_url',
      timeoutOccurred: false,
      errors: ['Invalid start URL']
    };
  }

  const startOrigin = new URL(normalizedStart).origin;
  const queue = [normalizedStart];
  const queued = new Set([normalizedStart]);
  const visited = new Set();
  const targets = [];
  const errors = [];
  let truncated = false;
  let stopReason = 'completed';
  let timeoutOccurred = false;

  while (queue.length > 0 && targets.length < maxPages) {
    if (timeBudget.remainingMs() < MIN_REMAINING_TO_START_PAGE_MS) {
      truncated = true;
      timeoutOccurred = true;
      stopReason = 'time_budget_exceeded';
      break;
    }

    const current = queue.shift();
    if (!current) continue;
    queued.delete(current);
    if (visited.has(current)) continue;
    visited.add(current);
    targets.push(current);

    if (targets.length >= maxPages) {
      truncated = true;
      stopReason = 'max_pages_reached';
      break;
    }

    const remainingForFetch = timeBudget.remainingMs() - 200;
    const fetchTimeout = Math.max(700, Math.min(CRAWL_FETCH_TIMEOUT_MS, remainingForFetch));
    if (fetchTimeout < 700) {
      truncated = true;
      timeoutOccurred = true;
      stopReason = 'time_budget_exceeded';
      break;
    }

    const fetched = await fetchPageHtml(current, fetchTimeout);
    if (fetched.timeoutOccurred) {
      timeoutOccurred = true;
    }
    if (fetched.error) {
      errors.push(`${current}: ${fetched.error}`);
    }
    if (!fetched.html) {
      continue;
    }

    const links = extractInternalLinks(fetched.html, current, startOrigin);
    for (const link of links) {
      if (visited.has(link) || queued.has(link)) continue;
      queue.push(link);
      queued.add(link);
      if (queue.length >= MAX_CRAWL_QUEUE) break;
    }
  }

  if (timeBudget.isExceeded()) {
    truncated = true;
    timeoutOccurred = true;
    stopReason = 'time_budget_exceeded';
  }

  if (targets.length === 0 && normalizedStart) {
    targets.push(normalizedStart);
  }

  return {
    targets,
    truncated,
    stopReason,
    timeoutOccurred,
    errors
  };
}

function createEmptyEngineData(engineKey, requestInput, error = null) {
  const base = {
    engine: engineKey,
    pageUrl: requestInput.startUrl,
    analyzedUrl: requestInput.startUrl,
    score: null,
    issueCount: 0,
    issues: [],
    fetchedAt: new Date().toISOString(),
    fetchDurationMs: 0,
    error
  };

  if (engineKey === 'accessibility') {
    return {
      ...base,
      source: 'google-pagespeed-insights',
      category: 'accessibility',
      scanner: {
        name: 'axe-core',
        version: null,
        executionMode: 'psi-lighthouse'
      }
    };
  }

  if (engineKey === 'performance') {
    return {
      ...base,
      source: 'google-pagespeed-insights',
      strategy: 'desktop',
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
      summary: {
        issueCount: 0,
        impactSummary: { critical: 0, serious: 0, moderate: 0, minor: 0 },
        topRules: []
      }
    };
  }

  if (engineKey === 'seo') {
    return {
      ...base,
      source: 'google-pagespeed-insights',
      category: 'seo'
    };
  }

  if (engineKey === 'bestPractices') {
    return {
      ...base,
      source: 'google-pagespeed-insights',
      category: 'best-practices'
    };
  }

  return base;
}

async function runEngine(definition, engineInput, timeBudget) {
  const remaining = timeBudget.remainingMs();
  if (remaining < MIN_REMAINING_TO_START_ENGINE_MS) {
    const error = 'Global scan budget exhausted before engine start.';
    return {
      key: definition.key,
      status: 'failed',
      timedOut: true,
      data: createEmptyEngineData(definition.key, engineInput, error),
      error
    };
  }

  const availableTimeout = Math.max(
    MIN_ENGINE_TIMEOUT_MS,
    Math.min(definition.timeoutMs, Math.max(MIN_ENGINE_TIMEOUT_MS, remaining - 180))
  );

  try {
    const runFn = definition.runner;
    if (typeof runFn !== 'function') {
      const error = `${definition.key} engine runner is unavailable.`;
      return {
        key: definition.key,
        status: 'failed',
        timedOut: false,
        data: createEmptyEngineData(definition.key, engineInput, error),
        error
      };
    }

    const execution = await runWithTimeout(
      Promise.resolve(
        runFn({
          ...engineInput,
          timeoutMs: availableTimeout
        })
      ),
      availableTimeout
    );

    if (execution.status === 'timeout') {
      const error = `${definition.key} engine timed out after ${availableTimeout}ms.`;
      return {
        key: definition.key,
        status: 'failed',
        timedOut: true,
        data: createEmptyEngineData(definition.key, engineInput, error),
        error
      };
    }

    if (execution.status === 'error') {
      const error = sanitizeError(execution.error);
      return {
        key: definition.key,
        status: 'failed',
        timedOut: false,
        data: createEmptyEngineData(definition.key, engineInput, error),
        error
      };
    }

    const value = execution.value || {};
    const status = value.status === 'success' ? 'success' : 'failed';
    const data =
      value.data && typeof value.data === 'object'
        ? value.data
        : createEmptyEngineData(definition.key, engineInput, value.error || `${definition.key} engine failed.`);
    const error = status === 'failed' ? sanitizeError(value.error || data.error || `${definition.key} engine failed.`) : null;

    return {
      key: definition.key,
      status,
      timedOut: false,
      data,
      error
    };
  } catch (error) {
    const safeError = sanitizeError(error);
    console.error(`[wcag-scan] ${definition.key} engine threw: ${safeError}`);
    return {
      key: definition.key,
      status: 'failed',
      timedOut: false,
      data: createEmptyEngineData(definition.key, engineInput, safeError),
      error: safeError
    };
  }
}

function createEngineAccumulator(key) {
  return {
    key,
    pages: [],
    issues: [],
    issueCount: 0,
    scoreSamples: [],
    successfulPages: 0,
    failedPages: 0,
    timeoutOccurred: false,
    errors: [],
    primaryData: null
  };
}

function appendEngineResult(accumulator, pageUrl, engineResult, requestInput) {
  const status = engineResult?.status === 'success' ? 'success' : 'failed';
  const data =
    engineResult?.data && typeof engineResult.data === 'object'
      ? engineResult.data
      : createEmptyEngineData(accumulator.key, requestInput, engineResult?.error || 'Engine failed.');
  const error = status === 'failed' ? sanitizeError(engineResult?.error || data.error || 'Engine failed.') : null;

  if (status === 'success') {
    accumulator.successfulPages += 1;
    if (!accumulator.primaryData) {
      accumulator.primaryData = data;
    }
  } else {
    accumulator.failedPages += 1;
    if (error) {
      accumulator.errors.push(error);
    }
  }

  if (engineResult?.timedOut) {
    accumulator.timeoutOccurred = true;
  }

  const rawScore = Number(data?.score);
  const score = Number.isFinite(rawScore) ? clampScore(rawScore) : null;
  if (status === 'success' && score != null) {
    accumulator.scoreSamples.push(score);
  }

  const issuesList = Array.isArray(data?.issues) ? data.issues : [];
  const rawIssueCount = Number(data?.issueCount);
  const issueCount = Number.isFinite(rawIssueCount) ? Math.max(0, Math.floor(rawIssueCount)) : issuesList.length;
  accumulator.issueCount += issueCount;

  for (const issue of issuesList) {
    if (accumulator.issues.length >= MAX_ISSUES_PER_ENGINE) break;
    accumulator.issues.push({
      pageUrl,
      ...issue
    });
  }

  accumulator.pages.push({
    url: pageUrl,
    status,
    score,
    issueCount,
    error
  });
}

function finalizeEngineOutput(accumulator, requestInput) {
  const score =
    accumulator.scoreSamples.length > 0
      ? clampScore(
          accumulator.scoreSamples.reduce((sum, value) => sum + value, 0) / accumulator.scoreSamples.length
        )
      : null;

  const base =
    accumulator.primaryData && typeof accumulator.primaryData === 'object'
      ? accumulator.primaryData
      : createEmptyEngineData(accumulator.key, requestInput, accumulator.errors[0] || null);

  const engineStatus =
    accumulator.failedPages === 0
      ? 'success'
      : accumulator.successfulPages > 0
        ? 'partial'
        : 'failed';

  const output = {
    ...base,
    engine: accumulator.key,
    engineStatus,
    engineError: accumulator.errors[0] || null,
    timeoutOccurred: accumulator.timeoutOccurred,
    requestedPages: requestInput.maxPages,
    scannedPages: accumulator.pages.length,
    pageSummaries: accumulator.pages,
    score,
    issueCount: accumulator.issueCount,
    issues: accumulator.issues
  };

  if (accumulator.key === 'performance') {
    output.summary = {
      ...(base.summary && typeof base.summary === 'object' ? base.summary : {}),
      issueCount: accumulator.issueCount
    };
  }

  return output;
}

function buildPageSummary(pageUrl, pageResults, durationMs) {
  const engineErrors = [];
  for (const key of Object.keys(pageResults || {})) {
    const result = pageResults[key];
    if (!result || result.status === 'success') continue;
    if (result.error) engineErrors.push(`${key}: ${sanitizeError(result.error)}`);
  }

  const status = engineErrors.length === 0 ? 'ok' : engineErrors.length < ENGINE_REGISTRY.length ? 'partial' : 'failed';
  const issueCount = Number(pageResults?.accessibility?.data?.issueCount || 0);
  const performanceIssueCount = Number(pageResults?.performance?.data?.issueCount || 0);
  const seoIssueCount = Number(pageResults?.seo?.data?.issueCount || 0);
  const bestPracticesIssueCount = Number(pageResults?.bestPractices?.data?.issueCount || 0);

  return {
    url: pageUrl,
    status,
    issueCount,
    performanceIssueCount,
    seoIssueCount,
    bestPracticesIssueCount,
    durationMs: Math.max(0, Number(durationMs) || 0),
    error: engineErrors.length > 0 ? engineErrors.join(' | ') : null
  };
}

function buildFailureResponse({ requestInput, durationMs, errorMessage, timeoutOccurred, truncated }) {
  const engineErrors = {};
  for (const engine of ENGINE_REGISTRY) {
    engineErrors[engine.key] = errorMessage;
  }

  return {
    accessibility: {
      ...createEmptyEngineData('accessibility', requestInput, errorMessage),
      engineStatus: 'failed',
      engineError: errorMessage,
      timeoutOccurred: Boolean(timeoutOccurred),
      requestedPages: requestInput.maxPages,
      scannedPages: 0,
      pageSummaries: []
    },
    performance: {
      ...createEmptyEngineData('performance', requestInput, errorMessage),
      engineStatus: 'failed',
      engineError: errorMessage,
      timeoutOccurred: Boolean(timeoutOccurred),
      requestedPages: requestInput.maxPages,
      scannedPages: 0,
      pageSummaries: []
    },
    seo: {
      ...createEmptyEngineData('seo', requestInput, errorMessage),
      engineStatus: 'failed',
      engineError: errorMessage,
      timeoutOccurred: Boolean(timeoutOccurred),
      requestedPages: requestInput.maxPages,
      scannedPages: 0,
      pageSummaries: []
    },
    bestPractices: {
      ...createEmptyEngineData('bestPractices', requestInput, errorMessage),
      engineStatus: 'failed',
      engineError: errorMessage,
      timeoutOccurred: Boolean(timeoutOccurred),
      requestedPages: requestInput.maxPages,
      scannedPages: 0,
      pageSummaries: []
    },
    summary: {
      accessibilityScore: 0,
      performanceScore: 0,
      seoScore: 0,
      bestPracticesScore: 0,
      overallScore: 0
    },
    metadata: {
      durationMs: Math.max(0, Number(durationMs) || 0),
      truncated: Boolean(truncated),
      enginesRun: ENGINE_REGISTRY.map((engine) => engine.key),
      enginesFailed: ENGINE_REGISTRY.map((engine) => engine.key),
      timeoutOccurred: Boolean(timeoutOccurred),
      engineErrors,
      request: requestInput
    }
  };
}

exports.handler = async (event, context) => {
  void context;

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

  try {
    const parsed = new URL(startUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return json(400, { error: 'startUrl must use http or https.' });
    }
  } catch {
    return json(400, { error: 'startUrl must be a valid URL.' });
  }

  const requestInput = {
    startUrl,
    mode: normalizeMode(body.mode),
    maxPages: 1,
    includeScreenshots: normalizeIncludeScreenshots(body.includeScreenshots)
  };
  requestInput.maxPages = normalizeMaxPages(requestInput.mode, body.maxPages);

  const timeBudget = createTimeBudget(TOTAL_SCAN_BUDGET_MS);
  const enginesRunSet = new Set();
  let timeoutOccurred = false;
  let truncated = false;
  let crawlStopReason = 'completed';
  let crawlErrors = [];

  const accumulators = {};
  for (const definition of ENGINE_REGISTRY) {
    accumulators[definition.key] = createEngineAccumulator(definition.key);
  }

  try {
    let targets = [normalizeHttpUrl(startUrl) || startUrl];
    if (requestInput.mode === 'crawl') {
      const crawlPlan = await buildCrawlTargets({
        startUrl,
        maxPages: requestInput.maxPages,
        timeBudget
      });
      targets = crawlPlan.targets.length > 0 ? crawlPlan.targets : targets;
      if (crawlPlan.timeoutOccurred) timeoutOccurred = true;
      if (crawlPlan.truncated) truncated = true;
      crawlStopReason = crawlPlan.stopReason || crawlStopReason;
      crawlErrors = crawlPlan.errors || [];
    }

    const pageSummaries = [];
    let pagesScanned = 0;

    for (const targetUrl of targets) {
      if (timeBudget.remainingMs() < MIN_REMAINING_TO_START_PAGE_MS) {
        truncated = true;
        timeoutOccurred = true;
        crawlStopReason = 'time_budget_exceeded';
        break;
      }

      const pageStartedAt = Date.now();
      let sharedPsiPayload = null;
      let sharedPsiFetchDurationMs = 0;
      let sharedPsiStrategy = 'desktop';
      let sharedPsiError = '';
      const remainingForSharedPsi = timeBudget.remainingMs() - 240;

      if (remainingForSharedPsi >= MIN_REMAINING_TO_START_ENGINE_MS) {
        const sharedPsiTimeout = Math.max(
          MIN_ENGINE_TIMEOUT_MS,
          Math.min(DEFAULT_ENGINE_TIMEOUT_MS, remainingForSharedPsi)
        );
        const sharedPsiResult = await runWithTimeout(
          fetchPsiPayload({
            startUrl: targetUrl,
            categories: SHARED_PSI_CATEGORIES,
            strategy: 'desktop',
            timeoutMs: sharedPsiTimeout
          }),
          sharedPsiTimeout
        );

        if (sharedPsiResult.status === 'success' && sharedPsiResult.value?.payload) {
          sharedPsiPayload = sharedPsiResult.value.payload;
          sharedPsiFetchDurationMs = Number(sharedPsiResult.value.fetchDurationMs) || 0;
          sharedPsiStrategy = sharedPsiResult.value.strategy || 'desktop';
        } else if (sharedPsiResult.status === 'timeout') {
          timeoutOccurred = true;
          sharedPsiError = `PSI timed out after ${sharedPsiTimeout}ms.`;
        } else {
          sharedPsiError = sanitizeError(sharedPsiResult.error);
        }
      } else {
        sharedPsiError = 'Insufficient remaining scan budget for PSI request.';
      }

      const settled = await Promise.allSettled(
        ENGINE_REGISTRY.map((definition) => {
          enginesRunSet.add(definition.key);
          return runEngine(
            definition,
            {
              ...requestInput,
              startUrl: targetUrl,
              pageUrl: targetUrl,
              psiPayload: sharedPsiPayload,
              psiFetchDurationMs: sharedPsiFetchDurationMs,
              psiStrategy: sharedPsiStrategy,
              sharedPsiError,
              sharedPsiAttempted: true
            },
            timeBudget
          );
        })
      );

      const pageEngineResults = {};
      for (let index = 0; index < settled.length; index += 1) {
        const definition = ENGINE_REGISTRY[index];
        const settledEntry = settled[index];

        let result;
        if (settledEntry.status === 'rejected') {
          const errorMessage = sanitizeError(settledEntry.reason);
          result = {
            key: definition.key,
            status: 'failed',
            timedOut: false,
            data: createEmptyEngineData(definition.key, requestInput, errorMessage),
            error: errorMessage
          };
          console.error(`[wcag-scan] ${definition.key} engine rejected: ${errorMessage}`);
        } else {
          result = settledEntry.value;
        }

        if (result.timedOut) {
          timeoutOccurred = true;
        }
        pageEngineResults[definition.key] = result;
        appendEngineResult(accumulators[definition.key], targetUrl, result, requestInput);
      }

      pageSummaries.push(
        buildPageSummary(targetUrl, pageEngineResults, Date.now() - pageStartedAt)
      );
      pagesScanned += 1;

      if (timeBudget.isExceeded()) {
        truncated = true;
        timeoutOccurred = true;
        crawlStopReason = 'time_budget_exceeded';
        break;
      }
    }

    if (requestInput.mode === 'crawl') {
      if (pagesScanned >= requestInput.maxPages) {
        truncated = true;
        if (crawlStopReason === 'completed') {
          crawlStopReason = 'max_pages_reached';
        }
      }
      if (pagesScanned < targets.length) {
        truncated = true;
      }
    }

    const finalized = {};
    for (const definition of ENGINE_REGISTRY) {
      finalized[definition.key] = finalizeEngineOutput(accumulators[definition.key], requestInput);
    }

    const enginesFailed = ENGINE_REGISTRY.map((engine) => engine.key).filter(
      (key) => finalized[key].engineStatus !== 'success'
    );

    const engineErrors = {};
    for (const engineKey of enginesFailed) {
      if (finalized[engineKey].engineError) {
        engineErrors[engineKey] = finalized[engineKey].engineError;
      }
    }

    for (const crawlError of crawlErrors) {
      if (!engineErrors.crawl) {
        engineErrors.crawl = [];
      }
      engineErrors.crawl.push(crawlError);
    }

    const accessibilityScore = clampScore(finalized.accessibility.score);
    const performanceScore = clampScore(finalized.performance.score);
    const seoScore = clampScore(finalized.seo.score);
    const bestPracticesScore = clampScore(finalized.bestPractices.score);
    const overallScore = clampScore(
      (accessibilityScore + performanceScore + seoScore + bestPracticesScore) / 4
    );

    const durationMs = timeBudget.elapsedMs();

    const response = {
      accessibility: finalized.accessibility,
      performance: finalized.performance,
      seo: finalized.seo,
      bestPractices: finalized.bestPractices,
      summary: {
        accessibilityScore,
        performanceScore,
        seoScore,
        bestPracticesScore,
        overallScore
      },
      metadata: {
        durationMs,
        truncated: Boolean(truncated || timeoutOccurred),
        enginesRun: Array.from(enginesRunSet),
        enginesFailed,
        timeoutOccurred: Boolean(timeoutOccurred),
        engineErrors,
        crawl: {
          mode: requestInput.mode,
          requestedPages: requestInput.maxPages,
          pagesScanned,
          stopReason: crawlStopReason
        },
        request: requestInput,
        totalBudgetMs: TOTAL_SCAN_BUDGET_MS
      },
      pages: pageSummaries,
      issues: finalized.accessibility.issues || [],
      performanceIssues: finalized.performance.issues || []
    };

    return json(200, response);
  } catch (error) {
    const safeError = sanitizeError(error);
    console.error(`[wcag-scan] orchestrator failed: ${safeError}`);
    return json(
      200,
      buildFailureResponse({
        requestInput,
        durationMs: timeBudget.elapsedMs(),
        errorMessage: safeError,
        timeoutOccurred: timeoutOccurred || timeBudget.isExceeded(),
        truncated: true
      })
    );
  }
};
