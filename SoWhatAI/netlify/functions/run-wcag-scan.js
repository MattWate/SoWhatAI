const { getJob, updateJob, completeJob, failJob } = require('./jobStore.js');

const HEARTBEAT_INTERVAL_MS = 4000;
const PSI_TIMEOUT_MS = 12000;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  };
}

function sanitizeText(value, fallback = '') {
  return String(value || fallback).replace(/\s+/g, ' ').trim().slice(0, 280);
}

function clampScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function normalizeProgress(percent, message) {
  return {
    percent: Math.max(0, Math.min(100, Math.round(Number(percent) || 0))),
    message: sanitizeText(message)
  };
}

function normalizeHttpUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function dedupeMessages(messages, limit = 12) {
  const seen = new Set();
  const output = [];
  for (const entry of Array.isArray(messages) ? messages : []) {
    const text = sanitizeText(entry);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
    if (output.length >= limit) break;
  }
  return output;
}

function computeAccessibilityScore(pages) {
  const list = Array.isArray(pages) ? pages : [];
  if (!list.length) return 0;
  let passed = 0;
  for (const page of list) {
    if (page?.status === 'ok' && Number(page?.issueCount || 0) === 0) {
      passed += 1;
    }
  }
  return clampScore((passed / list.length) * 100);
}

function buildUnavailableEngine(engine, reason, message) {
  return {
    status: 'unavailable',
    reason,
    engine,
    source: 'google-pagespeed-insights',
    score: null,
    issueCount: 0,
    issues: [],
    error: sanitizeText(message)
  };
}

function toAccessibilityEnvelope(rawResult, payload) {
  const result = rawResult && typeof rawResult === 'object' ? rawResult : {};
  const metadata = result.metadata && typeof result.metadata === 'object' ? result.metadata : {};
  const pages = Array.isArray(result.pages) ? result.pages : [];
  const issues = Array.isArray(result.issues) ? result.issues : [];
  const screenshots = Array.isArray(result.screenshots) ? result.screenshots : [];
  const needsReview = Array.isArray(result.needsReview) ? result.needsReview : [];
  const errorsSummary = metadata.errorsSummary && typeof metadata.errorsSummary === 'object'
    ? metadata.errorsSummary
    : { totalErrors: 0, totalTimeouts: 0, messages: [] };

  const pagesScanned = Number.isFinite(Number(metadata.pagesScanned))
    ? Math.max(0, Math.floor(Number(metadata.pagesScanned)))
    : pages.filter((page) => page?.status === 'ok').length;
  const hasTimeout = Number(errorsSummary.totalTimeouts || 0) > 0;
  const truncated = Boolean(result.truncated || metadata.truncated || result.status === 'partial');

  let status = 'available';
  if (result.status === 'partial') {
    status = pagesScanned > 0 ? 'partial' : 'unavailable';
  } else if (pagesScanned <= 0) {
    status = 'unavailable';
  }

  let reason = null;
  if (status === 'partial') {
    reason = hasTimeout ? 'timeout' : 'partial';
  } else if (status === 'unavailable') {
    reason = hasTimeout ? 'timeout' : 'scan_failed';
  }

  return {
    status,
    reason,
    truncated,
    engine: 'accessibility',
    source: 'axe-core',
    scanner: {
      name: 'axe-core',
      version: null,
      executionMode: 'playwright-axe'
    },
    pageUrl: payload.startUrl,
    analyzedUrl: payload.startUrl,
    mode: payload.mode,
    maxPages: payload.maxPages,
    includeScreenshots: payload.includeScreenshots,
    score: computeAccessibilityScore(pages),
    issueCount: issues.length,
    issues,
    pages,
    performanceIssues: [],
    screenshots,
    needsReview,
    durationMs: Number(result.durationMs || metadata.durationMs || 0) || 0,
    startedAt: result.startedAt || null,
    finishedAt: result.finishedAt || null,
    message: sanitizeText(result.message || ''),
    metadata,
    error:
      status === 'unavailable'
        ? sanitizeText(result.message || errorsSummary.messages?.[0] || 'Accessibility scan unavailable.')
        : null
  };
}

function resolveBaseUrl(event) {
  const headers = (event && event.headers) || {};
  const forwardedProto = headers['x-forwarded-proto'] || headers['X-Forwarded-Proto'];
  const forwardedHost = headers['x-forwarded-host'] || headers['X-Forwarded-Host'];
  const host = forwardedHost || headers.host || headers.Host || '';

  if (host) {
    const forwarded = String(forwardedProto || '').toLowerCase();
    const looksLocal = /^localhost(?::\d+)?$/i.test(host) || /^127\.0\.0\.1(?::\d+)?$/i.test(host);
    const protocol = forwarded === 'http' ? 'http' : forwarded === 'https' ? 'https' : looksLocal ? 'http' : 'https';
    return `${protocol}://${host}`;
  }

  const fromEnv =
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    process.env.DEPLOY_URL ||
    '';
  if (fromEnv) {
    return String(fromEnv).replace(/\/+$/, '');
  }

  return '';
}

async function postJsonWithTimeout(url, payload, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    return { response, data };
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildErrorsSummary(engineErrors, accessibility) {
  const messages = [];
  for (const [engine, message] of Object.entries(engineErrors || {})) {
    messages.push(`${engine}: ${message}`);
  }
  const accessibilityMessages = accessibility?.metadata?.errorsSummary?.messages || [];
  for (const item of accessibilityMessages) {
    messages.push(`accessibility: ${item}`);
  }
  const deduped = dedupeMessages(messages, 12);
  return {
    totalErrors: deduped.length,
    totalTimeouts: deduped.filter((entry) => entry.toLowerCase().includes('timeout')).length,
    messages: deduped
  };
}

function composeFinalResult({ payload, accessibility, psiResult }) {
  const runPsi = Boolean(payload.runPsi);

  let performance = buildUnavailableEngine('performance', runPsi ? 'unavailable' : 'disabled', 'PSI not requested.');
  let seo = buildUnavailableEngine('seo', runPsi ? 'unavailable' : 'disabled', 'PSI not requested.');
  let bestPractices = buildUnavailableEngine(
    'bestPractices',
    runPsi ? 'unavailable' : 'disabled',
    'PSI not requested.'
  );
  let psiCallsMade = 0;
  let psiCacheHits = 0;

  if (runPsi) {
    if (psiResult && psiResult.status === 'success') {
      performance = psiResult.performance || performance;
      seo = psiResult.seo || seo;
      bestPractices = psiResult.bestPractices || bestPractices;
      psiCallsMade = Number(psiResult.psiCallsMade) || 0;
      psiCacheHits = Number(psiResult.psiCacheHits) || 0;
    } else if (psiResult && psiResult.reason === 'missing_api_key') {
      performance = buildUnavailableEngine('performance', 'missing_api_key', 'PAGESPEED_API_KEY is not configured.');
      seo = buildUnavailableEngine('seo', 'missing_api_key', 'PAGESPEED_API_KEY is not configured.');
      bestPractices = buildUnavailableEngine('bestPractices', 'missing_api_key', 'PAGESPEED_API_KEY is not configured.');
    } else if (psiResult && psiResult.reason === 'quota_exceeded') {
      performance = buildUnavailableEngine('performance', 'quota_exceeded', 'Google PageSpeed Insights quota exceeded.');
      seo = buildUnavailableEngine('seo', 'quota_exceeded', 'Google PageSpeed Insights quota exceeded.');
      bestPractices = buildUnavailableEngine('bestPractices', 'quota_exceeded', 'Google PageSpeed Insights quota exceeded.');
    } else {
      performance = buildUnavailableEngine('performance', 'unavailable', 'PSI unavailable for this scan.');
      seo = buildUnavailableEngine('seo', 'unavailable', 'PSI unavailable for this scan.');
      bestPractices = buildUnavailableEngine('bestPractices', 'unavailable', 'PSI unavailable for this scan.');
    }
  }

  const accessibilityScore = clampScore(accessibility.score);
  const performanceScore = clampScore(performance.score);
  const seoScore = clampScore(seo.score);
  const bestPracticesScore = clampScore(bestPractices.score);

  const allScores = [accessibilityScore];
  if (performance.status === 'available') allScores.push(performanceScore);
  if (seo.status === 'available') allScores.push(seoScore);
  if (bestPractices.status === 'available') allScores.push(bestPracticesScore);
  const overallScore = clampScore(
    allScores.reduce((sum, item) => sum + item, 0) / Math.max(1, allScores.length)
  );

  const enginesRun = ['accessibility'];
  if (runPsi) {
    enginesRun.push('performance', 'seo', 'bestPractices');
  }

  const enginesFailed = [];
  const engineErrors = {};

  if (accessibility.status !== 'available') {
    enginesFailed.push('accessibility');
    engineErrors.accessibility = sanitizeText(
      accessibility.error || accessibility.message || accessibility.reason || 'Accessibility scan partial.'
    );
  }
  if (runPsi && performance.status !== 'available') {
    enginesFailed.push('performance');
    engineErrors.performance = sanitizeText(performance.reason || performance.error || 'PSI unavailable');
  }
  if (runPsi && seo.status !== 'available') {
    enginesFailed.push('seo');
    engineErrors.seo = sanitizeText(seo.reason || seo.error || 'PSI unavailable');
  }
  if (runPsi && bestPractices.status !== 'available') {
    enginesFailed.push('bestPractices');
    engineErrors.bestPractices = sanitizeText(bestPractices.reason || bestPractices.error || 'PSI unavailable');
  }

  const metadata = accessibility.metadata && typeof accessibility.metadata === 'object'
    ? accessibility.metadata
    : {};

  const errorsSummary = buildErrorsSummary(engineErrors, accessibility);

  const status = enginesFailed.length > 0 || accessibility.status === 'partial' ? 'partial' : 'complete';
  const durationMs = Number(accessibility.durationMs || metadata.durationMs || 0) || 0;

  return {
    status,
    message: sanitizeText(accessibility.message || ''),
    mode: payload.mode,
    startedAt: accessibility.startedAt || null,
    finishedAt: accessibility.finishedAt || null,
    durationMs,
    elapsedMs: durationMs,
    truncated: Boolean(accessibility.truncated || metadata.truncated || status === 'partial'),
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
      ...metadata,
      durationMs,
      truncated: Boolean(accessibility.truncated || metadata.truncated || status === 'partial'),
      enginesRun,
      enginesFailed,
      psiCallsMade,
      psiCacheHits,
      engineErrors,
      errorsSummary,
      request: {
        startUrl: payload.startUrl,
        mode: payload.mode,
        maxPages: payload.maxPages,
        includeScreenshots: payload.includeScreenshots,
        timeoutMs: payload.timeoutMs,
        runPsi: payload.runPsi
      }
    },
    pages: Array.isArray(accessibility.pages) ? accessibility.pages : [],
    issues: Array.isArray(accessibility.issues) ? accessibility.issues : [],
    performanceIssues: [],
    screenshots: Array.isArray(accessibility.screenshots) ? accessibility.screenshots : [],
    needsReview: Array.isArray(accessibility.needsReview) ? accessibility.needsReview : []
  };
}

async function maybeFetchPsiSummary(payload, event, jobId) {
  if (!payload.runPsi) {
    return { status: 'skipped', reason: 'disabled' };
  }
  if (!process.env.PAGESPEED_API_KEY) {
    return { status: 'skipped', reason: 'missing_api_key' };
  }

  const baseUrl = resolveBaseUrl(event);
  if (!baseUrl) {
    return { status: 'skipped', reason: 'base_url_unavailable' };
  }

  await updateJob(jobId, {
    status: 'running',
    progress: normalizeProgress(92, 'Fetching PageSpeed summary...')
  });

  try {
    const { response, data } = await postJsonWithTimeout(
      `${baseUrl}/.netlify/functions/pagespeed-scan`,
      {
        startUrl: payload.startUrl,
        psiStrategy: payload.psiStrategy || 'mobile'
      },
      PSI_TIMEOUT_MS
    );
    if (!response.ok || !data || typeof data !== 'object') {
      return { status: 'failed', reason: 'psi_request_failed' };
    }
    return {
      status: 'success',
      performance: data.performance,
      seo: data.seo,
      bestPractices: data.bestPractices,
      psiCallsMade: Number(data?.metadata?.psiCallsMade) || 0,
      psiCacheHits: Number(data?.metadata?.psiCacheHits) || 0
    };
  } catch (error) {
    const message = sanitizeText(error?.message || String(error));
    if (message.toLowerCase().includes('quota exceeded')) {
      return { status: 'failed', reason: 'quota_exceeded' };
    }
    return { status: 'failed', reason: 'psi_unavailable' };
  }
}

function startProgressHeartbeat(jobId) {
  let percent = 32;
  let tick = 0;
  const timer = setInterval(() => {
    tick += 1;
    percent = Math.min(82, percent + 4);
    const message =
      tick === 1
        ? 'Page fetch stage complete. Running axe-core checks...'
        : 'Running axe-core checks on discovered pages...';
    updateJob(jobId, {
      status: 'running',
      progress: normalizeProgress(percent, message)
    }).catch(() => {});
  }, HEARTBEAT_INTERVAL_MS);

  return () => clearInterval(timer);
}

async function runScanJob(jobId, payload, event) {
  const normalizedStartUrl = normalizeHttpUrl(payload.startUrl);
  if (!normalizedStartUrl) {
    throw new Error('Invalid startUrl in job payload.');
  }

  const mode = String(payload.mode || '').toLowerCase() === 'crawl' ? 'crawl' : 'single';
  const maxPages = mode === 'crawl'
    ? Math.max(1, Math.min(10, Math.floor(Number(payload.maxPages) || 3)))
    : 1;

  const scanPayload = {
    startUrl: normalizedStartUrl,
    mode,
    maxPages,
    includeScreenshots: payload.includeScreenshots !== false,
    runPsi: Boolean(payload.runPsi),
    psiStrategy: String(payload.psiStrategy || '').toLowerCase() === 'desktop' ? 'desktop' : 'mobile',
    includePerformanceAudit: Boolean(payload.includePerformanceAudit),
    timeoutMs: Math.max(10000, Math.min(180000, Math.floor(Number(payload.timeoutMs) || (mode === 'crawl' ? 90000 : 60000))))
  };

  await updateJob(jobId, {
    status: 'running',
    progress: normalizeProgress(10, 'Launching browser context...')
  });

  await updateJob(jobId, {
    status: 'running',
    progress: normalizeProgress(26, 'Preparing page crawl and accessibility engine...')
  });

  const stopHeartbeat = startProgressHeartbeat(jobId);

  let rawScanResult = null;
  try {
    const scannerModule = await import('../lib/wcagScannerCore.js');
    if (!scannerModule || typeof scannerModule.runWcagScan !== 'function') {
      throw new Error('runWcagScan export not found.');
    }

    rawScanResult = await scannerModule.runWcagScan(scanPayload);
  } finally {
    stopHeartbeat();
  }

  await updateJob(jobId, {
    status: 'running',
    progress: normalizeProgress(86, 'Axe analysis complete. Aggregating accessibility findings...')
  });

  const accessibility = toAccessibilityEnvelope(rawScanResult, scanPayload);
  const psiResult = await maybeFetchPsiSummary(scanPayload, event, jobId);
  const finalResult = composeFinalResult({
    payload: scanPayload,
    accessibility,
    psiResult
  });

  await completeJob(jobId, finalResult);
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

  const jobId = sanitizeText(body.jobId);
  if (!jobId) {
    return json(400, { error: 'jobId is required.' });
  }

  const job = await getJob(jobId, { includePayload: true });
  if (!job) {
    return json(200, {
      accepted: false,
      jobId,
      status: 'failed',
      message: 'Job not found or expired.'
    });
  }

  if (job.status === 'complete') {
    return json(200, {
      accepted: true,
      jobId,
      status: 'complete',
      message: 'Job already completed.'
    });
  }

  if (job.status === 'running') {
    return json(200, {
      accepted: true,
      jobId,
      status: 'running',
      message: 'Job already in progress.'
    });
  }

  try {
    await runScanJob(jobId, job.payload || {}, event);
    return json(200, {
      accepted: true,
      jobId,
      status: 'complete'
    });
  } catch (error) {
    const message = sanitizeText(error?.message || String(error), 'WCAG background scan failed.');
    await failJob(jobId, {
      code: 'scan_failed',
      message
    }).catch(() => {});

    return json(200, {
      accepted: false,
      jobId,
      status: 'failed',
      error: {
        code: 'scan_failed',
        message
      }
    });
  }
};
