const DEFAULT_TIMEOUT_MS = 35000;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  };
}

function sanitizeMessage(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 260);
}

function clampScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function buildUnavailableEngine(engine) {
  return {
    status: 'unavailable',
    reason: 'disabled',
    engine,
    source: 'disabled',
    score: null,
    issueCount: 0,
    issues: [],
    error: `${engine} disabled in wcag-only mode.`
  };
}

function dedupeMessages(messages) {
  const output = [];
  const seen = new Set();
  for (const entry of Array.isArray(messages) ? messages : []) {
    const text = sanitizeMessage(entry);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
    if (output.length >= 12) break;
  }
  return output;
}

function toWcagOnlyResponse(scanResult, requestMeta) {
  const result = scanResult && typeof scanResult === 'object' ? scanResult : {};
  const accessibility =
    result.accessibility && typeof result.accessibility === 'object'
      ? result.accessibility
      : {};
  const accessibilityMeta =
    accessibility.metadata && typeof accessibility.metadata === 'object'
      ? accessibility.metadata
      : {};
  const rootMeta = result.metadata && typeof result.metadata === 'object' ? result.metadata : {};

  const pages = Array.isArray(accessibility.pages)
    ? accessibility.pages
    : Array.isArray(result.pages)
      ? result.pages
      : [];
  const issues = Array.isArray(accessibility.issues)
    ? accessibility.issues
    : Array.isArray(result.issues)
      ? result.issues
      : [];
  const screenshots = Array.isArray(accessibility.screenshots)
    ? accessibility.screenshots
    : Array.isArray(result.screenshots)
      ? result.screenshots
      : [];
  const needsReview = Array.isArray(accessibility.needsReview)
    ? accessibility.needsReview
    : Array.isArray(result.needsReview)
      ? result.needsReview
      : [];

  const rawStatus = String(accessibility.status || result.status || 'complete').toLowerCase();
  const accessibilityFailed = rawStatus === 'partial' || rawStatus === 'unavailable';
  const truncated = Boolean(
    accessibility.truncated ||
    accessibilityMeta.truncated ||
    result.truncated ||
    rootMeta.truncated ||
    accessibilityFailed
  );
  const status = accessibilityFailed || truncated ? 'partial' : 'complete';
  const durationMs = Number(result.durationMs || accessibility.durationMs || rootMeta.durationMs || 0) || 0;
  const accessibilityScore = clampScore(accessibility.score);

  const engineErrors = {};
  if (accessibilityFailed) {
    engineErrors.accessibility =
      sanitizeMessage(accessibility.error || accessibility.message || accessibility.reason || 'Accessibility scan partial.');
  }

  const accessibilityMessages = accessibilityMeta?.errorsSummary?.messages || [];
  const errorMessages = dedupeMessages([
    ...accessibilityMessages,
    engineErrors.accessibility ? `accessibility: ${engineErrors.accessibility}` : ''
  ]);

  const errorsSummary = {
    totalErrors: errorMessages.length,
    totalTimeouts: errorMessages.filter((msg) => msg.toLowerCase().includes('timeout')).length,
    messages: errorMessages
  };

  return {
    status,
    message: sanitizeMessage(accessibility.message || result.message || ''),
    mode: String(result.mode || requestMeta.mode || 'single'),
    startedAt: result.startedAt || null,
    finishedAt: result.finishedAt || null,
    durationMs,
    elapsedMs: durationMs,
    truncated,
    accessibility: {
      ...accessibility,
      status: accessibility.status || (accessibilityFailed ? 'partial' : 'available'),
      truncated
    },
    performance: buildUnavailableEngine('performance'),
    seo: buildUnavailableEngine('seo'),
    bestPractices: buildUnavailableEngine('bestPractices'),
    summary: {
      accessibilityScore,
      performanceScore: 0,
      seoScore: 0,
      bestPracticesScore: 0,
      overallScore: accessibilityScore
    },
    metadata: {
      ...rootMeta,
      durationMs,
      truncated,
      enginesRun: ['accessibility'],
      enginesFailed: accessibilityFailed ? ['accessibility'] : [],
      psiCallsMade: 0,
      psiCacheHits: 0,
      engineErrors,
      errorsSummary,
      request: requestMeta
    },
    pages,
    issues,
    performanceIssues: [],
    screenshots,
    needsReview
  };
}

function buildFallbackResponse(requestMeta, message) {
  const safeMessage = sanitizeMessage(message || 'WCAG-only scan failed.');
  return {
    status: 'partial',
    message: safeMessage,
    mode: requestMeta.mode || 'single',
    durationMs: 0,
    elapsedMs: 0,
    truncated: true,
    accessibility: {
      status: 'unavailable',
      reason: 'scan_failed',
      truncated: true,
      score: null,
      pages: [],
      issues: [],
      screenshots: [],
      needsReview: [],
      error: safeMessage,
      message: safeMessage
    },
    performance: buildUnavailableEngine('performance'),
    seo: buildUnavailableEngine('seo'),
    bestPractices: buildUnavailableEngine('bestPractices'),
    summary: {
      accessibilityScore: 0,
      performanceScore: 0,
      seoScore: 0,
      bestPracticesScore: 0,
      overallScore: 0
    },
    metadata: {
      durationMs: 0,
      truncated: true,
      enginesRun: ['accessibility'],
      enginesFailed: ['accessibility'],
      psiCallsMade: 0,
      psiCacheHits: 0,
      engineErrors: { accessibility: safeMessage },
      errorsSummary: {
        totalErrors: 1,
        totalTimeouts: safeMessage.toLowerCase().includes('timeout') ? 1 : 0,
        messages: [`accessibility: ${safeMessage}`]
      },
      request: requestMeta
    },
    pages: [],
    issues: [],
    performanceIssues: [],
    screenshots: [],
    needsReview: []
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

  const requestMeta = {
    startUrl: typeof body.startUrl === 'string' ? body.startUrl.trim() : '',
    mode: String(body.mode || '').toLowerCase() === 'crawl' ? 'crawl' : 'single',
    maxPages: body.maxPages,
    includeScreenshots: body.includeScreenshots,
    runPsi: false,
    includePerformanceAudit: false
  };

  if (!requestMeta.startUrl) {
    return json(400, { error: 'startUrl is required.' });
  }

  const baseUrl = resolveBaseUrl(event);
  if (!baseUrl) {
    return json(200, buildFallbackResponse(requestMeta, 'Unable to resolve base URL for wcag-only proxy.'));
  }

  const downstreamUrl = `${baseUrl}/.netlify/functions/wcag-scan`;
  const payload = {
    ...body,
    startUrl: requestMeta.startUrl,
    mode: requestMeta.mode,
    runPsi: false,
    includePerformanceAudit: false
  };

  try {
    const { response, data } = await postJsonWithTimeout(downstreamUrl, payload, DEFAULT_TIMEOUT_MS);
    if (!response.ok) {
      const downstreamMessage = sanitizeMessage(data?.error || `Downstream wcag-scan failed (${response.status}).`);
      return json(200, buildFallbackResponse(requestMeta, downstreamMessage));
    }

    return json(200, toWcagOnlyResponse(data, requestMeta));
  } catch (error) {
    const message =
      error && error.name === 'AbortError'
        ? `wcag-only proxy timed out after ${DEFAULT_TIMEOUT_MS}ms.`
        : sanitizeMessage(error && error.message ? error.message : String(error));
    return json(200, buildFallbackResponse(requestMeta, message));
  }
};
