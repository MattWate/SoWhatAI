import axe from 'axe-core';
import {
  buildCategoryIssues,
  fetchPsiPayload,
  getCategoryScore,
  sanitizeErrorMessage
} from './psiClient.js';

const ENGINE_ID = 'accessibility';
const CATEGORY_KEY = 'accessibility';

function createEmptyAccessibilityData({
  startUrl,
  mode,
  maxPages,
  includeScreenshots,
  strategy = 'desktop',
  error = null
}) {
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
    mode,
    maxPages,
    includeScreenshots,
    scanner: {
      name: 'axe-core',
      version: axe?.version || null,
      executionMode: 'psi-lighthouse'
    },
    error
  };
}

async function runAccessibilityEngine({
  startUrl,
  mode = 'single',
  maxPages = 1,
  includeScreenshots = false,
  strategy = 'desktop',
  timeoutMs = 12000,
  psiPayload = null,
  psiFetchDurationMs = 0,
  psiStrategy = '',
  sharedPsiError = '',
  sharedPsiAttempted = false
} = {}) {
  try {
    if (sharedPsiAttempted && sharedPsiError) {
      const message = sanitizeErrorMessage(sharedPsiError);
      return {
        status: 'failed',
        data: createEmptyAccessibilityData({
          startUrl,
          mode,
          maxPages,
          includeScreenshots,
          strategy,
          error: message
        }),
        error: message
      };
    }

    let payload = psiPayload;
    let fetchDurationMs = Number(psiFetchDurationMs) || 0;
    let resolvedStrategy = psiStrategy || strategy;
    if (!payload || typeof payload !== 'object') {
      const fetched = await fetchPsiPayload({
        startUrl,
        categories: [CATEGORY_KEY],
        strategy,
        timeoutMs
      });
      payload = fetched.payload;
      fetchDurationMs = fetched.fetchDurationMs;
      resolvedStrategy = fetched.strategy;
    }
    const issues = buildCategoryIssues(payload, CATEGORY_KEY, { maxIssues: 40 });
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
        mode,
        maxPages,
        includeScreenshots,
        scanner: {
          name: 'axe-core',
          version: axe?.version || null,
          executionMode: 'psi-lighthouse'
        },
        error: null
      }
    };
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    return {
      status: 'failed',
      data: createEmptyAccessibilityData({
        startUrl,
        mode,
        maxPages,
        includeScreenshots,
        strategy,
        error: message
      }),
      error: message
    };
  }
}

export { runAccessibilityEngine };
