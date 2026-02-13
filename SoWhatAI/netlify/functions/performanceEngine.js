import { buildCategoryIssues, getCategoryScore, sanitizeErrorMessage } from './psiClient.js';

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

function summarizeIssues(issues) {
  const list = Array.isArray(issues) ? issues : [];
  const impactSummary = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const countsByRule = new Map();

  for (const issue of list) {
    const impact = String(issue?.impact || '').toLowerCase();
    if (impactSummary[impact] != null) {
      impactSummary[impact] += 1;
    }
    const ruleId = String(issue?.ruleId || '').trim();
    if (ruleId) {
      countsByRule.set(ruleId, (countsByRule.get(ruleId) || 0) + 1);
    }
  }

  const topRules = Array.from(countsByRule.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .slice(0, 10)
    .map(([ruleId, count]) => ({ ruleId, count }));

  return {
    issueCount: list.length,
    impactSummary,
    topRules
  };
}

function parseCoreWebVitals(payload) {
  const field = payload?.loadingExperience?.metrics || {};
  const audits = payload?.lighthouseResult?.audits || {};

  const readFieldMetric = (key) => {
    const metric = field?.[key];
    if (!metric) return { value: null, category: '', source: '' };
    return {
      value: toNumber(metric.percentile),
      category: String(metric.category || '').toLowerCase(),
      source: 'field'
    };
  };

  const readAuditMetric = (key, precision = 0) => {
    const numericValue = toNumber(audits?.[key]?.numericValue);
    if (numericValue == null) return { value: null, category: '', source: '' };
    const multiplier = 10 ** precision;
    return {
      value: Math.round(numericValue * multiplier) / multiplier,
      category: '',
      source: 'lighthouse'
    };
  };

  const lcp = readFieldMetric('LARGEST_CONTENTFUL_PAINT_MS');
  const inp = readFieldMetric('INTERACTION_TO_NEXT_PAINT');
  const cls = readFieldMetric('CUMULATIVE_LAYOUT_SHIFT_SCORE');
  const fcp = readFieldMetric('FIRST_CONTENTFUL_PAINT_MS');
  const ttfb = readFieldMetric('EXPERIMENTAL_TIME_TO_FIRST_BYTE');

  return {
    lcpMs: lcp.value == null ? readAuditMetric('largest-contentful-paint') : lcp,
    inpMs: inp.value == null ? readAuditMetric('interaction-to-next-paint') : inp,
    cls: cls.value == null ? readAuditMetric('cumulative-layout-shift', 3) : cls,
    fcpMs: fcp.value == null ? readAuditMetric('first-contentful-paint') : fcp,
    ttfbMs: ttfb.value == null ? readAuditMetric('server-response-time') : ttfb,
    speedIndexMs: readAuditMetric('speed-index'),
    tbtMs: readAuditMetric('total-blocking-time')
  };
}

function parseLighthouseMetrics(payload) {
  const audits = payload?.lighthouseResult?.audits || {};
  const read = (key, precision = 0) => {
    const numeric = toNumber(audits?.[key]?.numericValue);
    if (numeric == null) return null;
    const multiplier = 10 ** precision;
    return Math.round(numeric * multiplier) / multiplier;
  };

  return {
    fcpMs: read('first-contentful-paint'),
    lcpMs: read('largest-contentful-paint'),
    speedIndexMs: read('speed-index'),
    tbtMs: read('total-blocking-time'),
    ttiMs: read('interactive'),
    cls: read('cumulative-layout-shift', 3),
    ttfbMs: read('server-response-time'),
    inpMs: read('interaction-to-next-paint')
  };
}

function createUnavailableData({ startUrl, strategy, reason, message }) {
  return {
    status: 'unavailable',
    reason: reason || 'unknown',
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
    error: message || ''
  };
}

async function runPerformanceEngine({ startUrl, strategy = 'mobile', psiResult = null } = {}) {
  try {
    if (!psiResult || psiResult.status !== 'success' || !psiResult.data) {
      const reason = psiResult?.error || 'unknown';
      const message = sanitizeErrorMessage(psiResult?.message || 'PSI performance data unavailable.');
      return {
        status: 'failed',
        data: createUnavailableData({
          startUrl,
          strategy,
          reason,
          message
        }),
        error: reason
      };
    }

    const payload = psiResult.data;
    const score = normalizeScore(getCategoryScore(payload, 'performance'));
    const issues = buildCategoryIssues(payload, 'performance', { maxIssues: 40 });
    const analyzedUrl = String(payload?.lighthouseResult?.finalDisplayedUrl || payload?.id || startUrl);
    const summary = summarizeIssues(issues);

    return {
      status: 'success',
      data: {
        status: 'available',
        reason: null,
        source: 'google-pagespeed-insights',
        strategy: psiResult.strategy || strategy,
        pageUrl: startUrl,
        analyzedUrl,
        score,
        coreWebVitals: parseCoreWebVitals(payload),
        lighthouseMetrics: parseLighthouseMetrics(payload),
        opportunities: [],
        diagnostics: [],
        issues,
        issueCount: issues.length,
        summary,
        fetchedAt: new Date().toISOString(),
        fetchDurationMs: Number(psiResult.fetchDurationMs) || 0,
        psiCacheHit: Boolean(psiResult.cacheHit || psiResult.fromCache),
        error: null
      }
    };
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    return {
      status: 'failed',
      data: createUnavailableData({
        startUrl,
        strategy,
        reason: 'unknown',
        message
      }),
      error: 'unknown'
    };
  }
}

export { runPerformanceEngine };
