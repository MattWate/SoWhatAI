import {
  buildCategoryIssues,
  getCategoryScore,
  sanitizeErrorMessage
} from './psiClient.js';

const ENGINE_ID = 'seo';
const CATEGORY_KEY = 'seo';

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeScore(value) {
  const numeric = toNumber(value);
  if (numeric == null) return null;
  if (numeric <= 1) return Math.max(0, Math.min(100, Math.round(numeric * 100)));
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function createUnavailableSeoData({ startUrl, strategy = 'mobile', reason = 'unknown', message = '' }) {
  return {
    status: 'unavailable',
    reason,
    engine: ENGINE_ID,
    source: 'google-pagespeed-insights',
    category: CATEGORY_KEY,
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
    error: message
  };
}

async function runSeoEngine({
  startUrl,
  strategy = 'mobile',
  psiResult = null
} = {}) {
  try {
    if (!psiResult || psiResult.status !== 'success' || !psiResult.data) {
      const reason = psiResult?.error || 'unknown';
      const message = sanitizeErrorMessage(psiResult?.message || 'PSI SEO data unavailable.');
      return {
        status: 'failed',
        data: createUnavailableSeoData({
          startUrl,
          strategy,
          reason,
          message
        }),
        error: reason
      };
    }

    const payload = psiResult.data;
    const issues = buildCategoryIssues(payload, CATEGORY_KEY, { maxIssues: 30 });
    const score = normalizeScore(getCategoryScore(payload, CATEGORY_KEY));
    const analyzedUrl = String(payload?.lighthouseResult?.finalDisplayedUrl || payload?.id || startUrl);
    const auditCount = Array.isArray(payload?.lighthouseResult?.categories?.[CATEGORY_KEY]?.auditRefs)
      ? payload.lighthouseResult.categories[CATEGORY_KEY].auditRefs.length
      : 0;

    return {
      status: 'success',
      data: {
        status: 'available',
        reason: null,
        engine: ENGINE_ID,
        source: 'google-pagespeed-insights',
        category: CATEGORY_KEY,
        pageUrl: startUrl,
        analyzedUrl,
        score,
        issueCount: issues.length,
        issues,
        auditCount,
        failedAuditCount: issues.length,
        fetchedAt: new Date().toISOString(),
        fetchDurationMs: Number(psiResult.fetchDurationMs) || 0,
        psiCacheHit: Boolean(psiResult.fromCache),
        strategy: psiResult.strategy || strategy,
        error: null
      }
    };
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    return {
      status: 'failed',
      data: createUnavailableSeoData({
        startUrl,
        strategy,
        reason: 'unknown',
        message
      }),
      error: 'unknown'
    };
  }
}

export { runSeoEngine };
