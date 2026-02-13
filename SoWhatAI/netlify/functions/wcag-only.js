import { runWcagScan } from '../lib/wcagScannerCore.js';

const DEFAULT_TOTAL_BUDGET_SINGLE_MS = 30000;
const DEFAULT_TOTAL_BUDGET_CRAWL_MS = 45000;
const DEFAULT_PAGE_BUDGET_CRAWL_MS = 15000;
const DEFAULT_CRAWL_MAX_PAGES = 3;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  };
}

function clampTimeout(timeoutMs, fallbackMs) {
  const fallback = Number.isFinite(Number(fallbackMs)) ? Math.floor(Number(fallbackMs)) : 30000;
  const numeric = Number(timeoutMs);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.max(2500, Math.min(60000, Math.floor(numeric)));
}

function normalizeMode(mode) {
  return String(mode || '').toLowerCase() === 'crawl' ? 'crawl' : 'single';
}

function normalizeMaxPages(mode, maxPages) {
  if (mode !== 'crawl') return 1;
  const numeric = Number(maxPages);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_CRAWL_MAX_PAGES;
  return Math.max(1, Math.min(10, Math.floor(numeric)));
}

function normalizeIncludeScreenshots(includeScreenshots) {
  if (includeScreenshots == null) return true;
  return Boolean(includeScreenshots);
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

function buildFailureResponse(request, durationMs, message) {
  return {
    status: 'partial',
    message: String(message || 'WCAG scan failed.'),
    mode: request.mode,
    durationMs,
    elapsedMs: durationMs,
    pages: [],
    issues: [],
    performanceIssues: [],
    screenshots: [],
    needsReview: [],
    metadata: {
      durationMs,
      truncated: true,
      pagesAttempted: 0,
      pagesScanned: 0,
      errorsSummary: {
        totalErrors: 1,
        totalTimeouts: 0,
        messages: [String(message || 'WCAG scan failed.')]
      },
      request
    }
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

  const rawStartUrl = typeof body.startUrl === 'string' ? body.startUrl.trim() : '';
  if (!rawStartUrl) {
    return json(400, { error: 'startUrl is required.' });
  }

  const startUrl = normalizeHttpUrl(rawStartUrl);
  if (!startUrl) {
    return json(400, { error: 'startUrl must be a valid http/https URL.' });
  }

  const mode = normalizeMode(body.mode);
  const totalBudgetMs = clampTimeout(
    body.totalBudgetMs,
    mode === 'crawl' ? DEFAULT_TOTAL_BUDGET_CRAWL_MS : DEFAULT_TOTAL_BUDGET_SINGLE_MS
  );
  const pageScanBudgetMs = mode === 'crawl'
    ? clampTimeout(body.pageScanBudgetMs, DEFAULT_PAGE_BUDGET_CRAWL_MS)
    : undefined;

  const request = {
    startUrl,
    mode,
    maxPages: normalizeMaxPages(mode, body.maxPages),
    includeScreenshots: normalizeIncludeScreenshots(body.includeScreenshots),
    includePerformanceAudit: false,
    totalBudgetMs,
    pageScanBudgetMs
  };

  const startedAt = Date.now();
  try {
    const result = await runWcagScan({
      startUrl: request.startUrl,
      mode: request.mode,
      maxPages: request.maxPages,
      includeScreenshots: request.includeScreenshots,
      includePerformanceAudit: request.includePerformanceAudit,
      timeoutMs: request.totalBudgetMs,
      pageScanBudgetMs: request.pageScanBudgetMs
    });

    return json(200, {
      ...result,
      metadata: {
        ...(result?.metadata && typeof result.metadata === 'object' ? result.metadata : {}),
        request
      }
    });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    return json(200, buildFailureResponse(request, durationMs, error?.message || String(error)));
  }
};
