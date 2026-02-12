import {
  buildCategoryIssues,
  fetchPsiPayload,
  getCategoryScore,
  sanitizeErrorMessage
} from './psiClient.js';

const ENGINE_ID = 'seo';
const CATEGORY_KEY = 'seo';

function createEmptySeoData({ startUrl, strategy = 'desktop', error = null }) {
  return {
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
    strategy,
    error
  };
}

async function runSeoEngine({
  startUrl,
  strategy = 'desktop',
  timeoutMs = 12000
} = {}) {
  try {
    const { payload, fetchDurationMs, strategy: resolvedStrategy } = await fetchPsiPayload({
      startUrl,
      categories: [CATEGORY_KEY],
      strategy,
      timeoutMs
    });
    const issues = buildCategoryIssues(payload, CATEGORY_KEY, { maxIssues: 30 });
    const score = getCategoryScore(payload, CATEGORY_KEY);
    const analyzedUrl = String(payload?.lighthouseResult?.finalDisplayedUrl || payload?.id || startUrl);
    const auditCount = Array.isArray(payload?.lighthouseResult?.categories?.[CATEGORY_KEY]?.auditRefs)
      ? payload.lighthouseResult.categories[CATEGORY_KEY].auditRefs.length
      : 0;

    return {
      status: 'success',
      data: {
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
        fetchDurationMs,
        strategy: resolvedStrategy,
        error: null
      }
    };
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    return {
      status: 'failed',
      data: createEmptySeoData({
        startUrl,
        strategy,
        error: message
      }),
      error: message
    };
  }
}

export { runSeoEngine };
