const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const DEFAULT_TIMEOUT_MS = 10000;
const MIN_TIMEOUT_MS = 3000;
const MAX_TIMEOUT_MS = 20000;
const MAX_ERROR_MESSAGE = 260;
const PSI_CACHE_TTL_MS = 30 * 60 * 1000;
const PSI_QUOTA_BLOCK_MAX_MS = 12 * 60 * 60 * 1000;
const PSI_CATEGORIES = ['performance', 'seo', 'best-practices'];

const psiCache = (() => {
  const key = '__SOWHATAI_PSI_CACHE_V2__';
  if (!globalThis[key]) {
    globalThis[key] = new Map();
  }
  return globalThis[key];
})();

const psiQuotaCircuit = (() => {
  const key = '__SOWHATAI_PSI_QUOTA_CIRCUIT_V1__';
  if (!globalThis[key]) {
    globalThis[key] = { blockedUntil: 0 };
  }
  return globalThis[key];
})();

function clampTimeout(timeoutMs) {
  const numeric = Number(timeoutMs);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.floor(numeric)));
}

function normalizeStrategy(strategy) {
  return String(strategy || '').toLowerCase() === 'desktop' ? 'desktop' : 'mobile';
}

function sanitizeErrorMessage(error) {
  const raw = error?.message || String(error || 'Unknown error');
  return String(raw).replace(/\s+/g, ' ').trim().slice(0, MAX_ERROR_MESSAGE);
}

function normalizeHttpUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function isQuotaExceededText(value) {
  const text = String(value || '').toLowerCase();
  return text.includes('quota exceeded');
}

function getNextUtcMidnightMs(nowMs) {
  const now = new Date(nowMs);
  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0
  );
}

function computeQuotaBlockedUntil(nowMs = Date.now()) {
  const nextMidnight = getNextUtcMidnightMs(nowMs);
  const maxByTtl = nowMs + PSI_QUOTA_BLOCK_MAX_MS;
  return Math.min(nextMidnight, maxByTtl);
}

function isQuotaBlocked(nowMs = Date.now()) {
  const blockedUntil = Number(psiQuotaCircuit.blockedUntil) || 0;
  if (blockedUntil <= nowMs) {
    psiQuotaCircuit.blockedUntil = 0;
    return false;
  }
  return true;
}

function setQuotaBlocked(nowMs = Date.now()) {
  const blockedUntil = computeQuotaBlockedUntil(nowMs);
  psiQuotaCircuit.blockedUntil = Math.max(Number(psiQuotaCircuit.blockedUntil) || 0, blockedUntil);
}

function classifyPsiError({ status = 0, responseText = '', apiMessage = '', caughtError = null } = {}) {
  const joined = `${responseText} ${apiMessage} ${caughtError?.message || ''}`.toLowerCase();
  if (status === 429 || isQuotaExceededText(joined)) {
    return 'quota_exceeded';
  }
  if (caughtError?.name === 'AbortError' || joined.includes('timed out')) {
    return 'timeout';
  }
  if (
    joined.includes('failed to fetch') ||
    joined.includes('networkerror') ||
    joined.includes('econn') ||
    joined.includes('enotfound')
  ) {
    return 'network';
  }
  return 'unknown';
}

function toScore(rawScore) {
  const numeric = Number(rawScore);
  if (!Number.isFinite(numeric)) return null;
  if (numeric <= 1) return Math.max(0, Math.min(100, Math.round(numeric * 100)));
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function getCategoryScore(payload, categoryKey) {
  return toScore(payload?.lighthouseResult?.categories?.[categoryKey]?.score);
}

function getCategoryAuditRefs(payload, categoryKey) {
  const refs = payload?.lighthouseResult?.categories?.[categoryKey]?.auditRefs;
  return Array.isArray(refs) ? refs : [];
}

function getAuditById(payload, auditId) {
  return payload?.lighthouseResult?.audits?.[auditId] || null;
}

function buildCategoryIssues(payload, categoryKey, { maxIssues = 25 } = {}) {
  const refs = getCategoryAuditRefs(payload, categoryKey);
  const issues = [];

  for (const ref of refs) {
    const ruleId = String(ref?.id || '').trim();
    if (!ruleId) continue;
    const audit = getAuditById(payload, ruleId);
    if (!audit) continue;

    const displayMode = String(audit.scoreDisplayMode || '');
    if (displayMode === 'notApplicable' || displayMode === 'manual' || displayMode === 'informative') continue;

    const score = Number(audit.score);
    if (!Number.isFinite(score) || score >= 1) continue;

    let impact = 'minor';
    if (score <= 0.2) impact = 'serious';
    else if (score <= 0.5) impact = 'moderate';

    issues.push({
      ruleId,
      impact,
      title: String(audit.title || ruleId),
      score: Math.max(0, Math.min(1, score)),
      failureSummary: String(audit.displayValue || '').trim() || stripHtml(audit.description),
      recommendation: stripHtml(audit.description),
      detailsType: String(audit?.details?.type || '')
    });
  }

  return issues
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a.ruleId.localeCompare(b.ruleId);
    })
    .slice(0, Math.max(1, Math.floor(maxIssues)));
}

async function getPsiResult({
  url,
  strategy = 'mobile',
  apiKey = process.env.PAGESPEED_API_KEY || '',
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  const normalizedUrl = normalizeHttpUrl(url);
  const normalizedStrategy = normalizeStrategy(strategy);
  if (!normalizedUrl) {
    return {
      status: 'failed',
      error: 'unknown',
      message: 'Invalid PSI URL input.',
      blocked: false,
      cacheHit: false,
      fromCache: false,
      psiCallsMade: 0,
      psiCacheHits: 0,
      strategy: normalizedStrategy,
      fetchDurationMs: 0
    };
  }

  const cacheKey = `${normalizedStrategy}:${normalizedUrl}`;
  const now = Date.now();
  if (isQuotaBlocked(now)) {
    return {
      status: 'failed',
      error: 'quota_exceeded',
      message: 'PSI quota circuit breaker active. Skipping network request.',
      blocked: true,
      cacheHit: false,
      fromCache: false,
      psiCallsMade: 0,
      psiCacheHits: 0,
      strategy: normalizedStrategy,
      fetchDurationMs: 0
    };
  }

  const cached = psiCache.get(cacheKey);
  if (cached && now - cached.ts < PSI_CACHE_TTL_MS && cached.data) {
    return {
      status: 'success',
      data: cached.data,
      message: 'PSI cache hit.',
      blocked: false,
      cacheHit: true,
      fromCache: true,
      psiCallsMade: 0,
      psiCacheHits: 1,
      strategy: normalizedStrategy,
      fetchDurationMs: 0
    };
  }

  const timeout = clampTimeout(timeoutMs);
  const params = new URLSearchParams({
    url: normalizedUrl,
    strategy: normalizedStrategy
  });
  for (const category of PSI_CATEGORIES) {
    params.append('category', category);
  }
  if (apiKey) {
    params.set('key', apiKey);
  }

  const endpoint = `${PSI_ENDPOINT}?${params.toString()}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeout);
  const startedAt = Date.now();

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    const responseText = await response.text();
    let payload = {};
    if (responseText) {
      try {
        payload = JSON.parse(responseText);
      } catch {
        payload = {};
      }
    }

    if (!response.ok) {
      const apiMessage = payload?.error?.message || `PSI request failed with status ${response.status}.`;
      const error = classifyPsiError({
        status: response.status,
        responseText,
        apiMessage
      });
      if (error === 'quota_exceeded') {
        setQuotaBlocked(Date.now());
      }
      return {
        status: 'failed',
        error,
        message: sanitizeErrorMessage(apiMessage),
        blocked: error === 'quota_exceeded',
        cacheHit: false,
        fromCache: false,
        psiCallsMade: 1,
        psiCacheHits: 0,
        strategy: normalizedStrategy,
        fetchDurationMs: Date.now() - startedAt
      };
    }

    psiCache.set(cacheKey, {
      ts: Date.now(),
      data: payload
    });

    return {
      status: 'success',
      data: payload,
      message: 'PSI request completed.',
      blocked: false,
      cacheHit: false,
      fromCache: false,
      psiCallsMade: 1,
      psiCacheHits: 0,
      strategy: normalizedStrategy,
      fetchDurationMs: Date.now() - startedAt
    };
  } catch (caughtError) {
    const error = classifyPsiError({ caughtError });
    if (error === 'quota_exceeded') {
      setQuotaBlocked(Date.now());
    }
    const message =
      error === 'timeout'
        ? `PSI request timed out after ${timeout}ms.`
        : sanitizeErrorMessage(caughtError);
    return {
      status: 'failed',
      error,
      message,
      blocked: error === 'quota_exceeded',
      cacheHit: false,
      fromCache: false,
      psiCallsMade: 1,
      psiCacheHits: 0,
      strategy: normalizedStrategy,
      fetchDurationMs: Date.now() - startedAt
    };
  } finally {
    if (psiQuotaCircuit.blockedUntil <= Date.now()) {
      psiQuotaCircuit.blockedUntil = 0;
    }
    clearTimeout(timeoutId);
  }
}

export { buildCategoryIssues, getCategoryScore, getPsiResult, sanitizeErrorMessage, stripHtml };
