const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const DEFAULT_TIMEOUT_MS = 12000;
const MAX_TIMEOUT_MS = 20000;
const MIN_TIMEOUT_MS = 4000;
const MAX_OPPORTUNITIES = 12;
const MAX_DIAGNOSTICS = 12;
const MAX_ISSUES = 40;

const IMPACT_ORDER = ['critical', 'serious', 'moderate', 'minor'];

const METRIC_CONFIG = {
  lcpMs: {
    title: 'Largest Contentful Paint is above target',
    metricLabel: 'LCP',
    thresholdGood: 2500,
    thresholdNeedsImprovement: 4000,
    unit: 'ms',
    recommendation: 'Prioritize the largest above-the-fold element and reduce render-blocking resources.'
  },
  inpMs: {
    title: 'Interaction to Next Paint is above target',
    metricLabel: 'INP',
    thresholdGood: 200,
    thresholdNeedsImprovement: 500,
    unit: 'ms',
    recommendation: 'Reduce long main-thread tasks and defer non-critical JavaScript.'
  },
  cls: {
    title: 'Cumulative Layout Shift is above target',
    metricLabel: 'CLS',
    thresholdGood: 0.1,
    thresholdNeedsImprovement: 0.25,
    unit: '',
    recommendation: 'Reserve space for media/ads and avoid injecting late-loading UI without dimensions.'
  },
  fcpMs: {
    title: 'First Contentful Paint is above target',
    metricLabel: 'FCP',
    thresholdGood: 1800,
    thresholdNeedsImprovement: 3000,
    unit: 'ms',
    recommendation: 'Ship critical CSS early and reduce render-blocking dependencies.'
  },
  ttfbMs: {
    title: 'Time to First Byte is above target',
    metricLabel: 'TTFB',
    thresholdGood: 800,
    thresholdNeedsImprovement: 1800,
    unit: 'ms',
    recommendation: 'Improve backend latency with caching, CDN tuning, and faster origin response.'
  },
  speedIndexMs: {
    title: 'Speed Index is above target',
    metricLabel: 'Speed Index',
    thresholdGood: 3400,
    thresholdNeedsImprovement: 5800,
    unit: 'ms',
    recommendation: 'Reduce critical rendering work and optimize above-the-fold assets.'
  },
  tbtMs: {
    title: 'Total Blocking Time is above target',
    metricLabel: 'TBT',
    thresholdGood: 200,
    thresholdNeedsImprovement: 600,
    unit: 'ms',
    recommendation: 'Break up long JavaScript tasks and defer non-critical scripts.'
  }
};

function clampTimeout(timeoutMs) {
  const numeric = Number(timeoutMs);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.floor(numeric)));
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function round(value, precision = 0) {
  const numeric = toNumber(value);
  if (numeric == null) return null;
  const p = 10 ** precision;
  return Math.round(numeric * p) / p;
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function trimText(value, maxLength = 260) {
  const text = String(value || '');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function createEmptySummary() {
  return {
    issueCount: 0,
    impactSummary: { critical: 0, serious: 0, moderate: 0, minor: 0 },
    topRules: []
  };
}

function summarizePerformanceIssues(issues) {
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

function createIssue({
  pageUrl,
  ruleId,
  impact,
  title,
  failureSummary,
  recommendation,
  metric,
  value,
  threshold,
  source = 'psi'
}) {
  return {
    pageUrl,
    ruleId,
    impact,
    category: 'performance',
    source,
    title: trimText(title, 160),
    failureSummary: trimText(failureSummary, 400),
    recommendation: trimText(recommendation, 320),
    metric: metric || '',
    value: value == null ? '' : String(value),
    threshold: threshold || ''
  };
}

function normalizeFieldCategory(category) {
  const raw = String(category || '').trim().toUpperCase();
  if (raw === 'FAST' || raw === 'GOOD') return 'good';
  if (raw === 'AVERAGE' || raw === 'NEEDS_IMPROVEMENT') return 'needs-improvement';
  if (raw === 'SLOW' || raw === 'POOR') return 'poor';
  return '';
}

function metricRatingLowerIsBetter(value, goodMax, needsImprovementMax) {
  const numeric = toNumber(value);
  if (numeric == null) return '';
  if (numeric <= goodMax) return 'good';
  if (numeric <= needsImprovementMax) return 'needs-improvement';
  return 'poor';
}

function impactFromRating(rating) {
  if (rating === 'poor') return 'serious';
  if (rating === 'needs-improvement') return 'moderate';
  return '';
}

function formatMetricValue(value, unit, precision = 0) {
  const numeric = round(value, precision);
  if (numeric == null) return '';
  return unit ? `${numeric} ${unit}` : String(numeric);
}

function extractScore(lighthouseResult) {
  const rawScore = toNumber(lighthouseResult?.categories?.performance?.score);
  if (rawScore == null) return null;
  if (rawScore <= 1) return Math.max(0, Math.min(100, Math.round(rawScore * 100)));
  return Math.max(0, Math.min(100, Math.round(rawScore)));
}

function parseFieldMetric(source, key, precision = 0) {
  const metric = source?.metrics?.[key];
  if (!metric) {
    return { value: null, category: '' };
  }
  return {
    value: round(metric.percentile, precision),
    category: normalizeFieldCategory(metric.category)
  };
}

function extractFieldMetrics(payload) {
  const field = payload?.loadingExperience || null;
  const originField = payload?.originLoadingExperience || null;
  const source = field?.metrics ? field : originField;
  const sourceType = source === field ? 'url' : source === originField ? 'origin' : 'none';

  return {
    source: sourceType,
    lcpMs: parseFieldMetric(source, 'LARGEST_CONTENTFUL_PAINT_MS', 0),
    inpMs: parseFieldMetric(source, 'INTERACTION_TO_NEXT_PAINT', 0),
    cls: parseFieldMetric(source, 'CUMULATIVE_LAYOUT_SHIFT_SCORE', 3),
    fcpMs: parseFieldMetric(source, 'FIRST_CONTENTFUL_PAINT_MS', 0),
    ttfbMs: parseFieldMetric(source, 'EXPERIMENTAL_TIME_TO_FIRST_BYTE', 0)
  };
}

function extractLighthouseMetrics(audits) {
  const lookup = (id, precision = 0) => round(audits?.[id]?.numericValue, precision);
  return {
    fcpMs: lookup('first-contentful-paint', 0),
    lcpMs: lookup('largest-contentful-paint', 0),
    speedIndexMs: lookup('speed-index', 0),
    tbtMs: lookup('total-blocking-time', 0),
    ttiMs: lookup('interactive', 0),
    cls: lookup('cumulative-layout-shift', 3),
    ttfbMs: lookup('server-response-time', 0),
    inpMs: lookup('interaction-to-next-paint', 0)
  };
}

function selectMetricValue(fieldMetric, lighthouseValue) {
  if (toNumber(fieldMetric?.value) != null) {
    return {
      value: fieldMetric.value,
      category: fieldMetric.category || '',
      source: 'field'
    };
  }
  if (toNumber(lighthouseValue) != null) {
    return {
      value: lighthouseValue,
      category: '',
      source: 'lighthouse'
    };
  }
  return {
    value: null,
    category: '',
    source: ''
  };
}

function extractOpportunities(audits) {
  const opportunities = [];
  const entries = Object.entries(audits || {});
  for (const [id, audit] of entries) {
    if (!audit || audit.details?.type !== 'opportunity') continue;
    const savingsMs = round(audit.details?.overallSavingsMs, 0) || 0;
    const savingsBytes = round(audit.details?.overallSavingsBytes, 0) || 0;
    if (savingsMs <= 0 && savingsBytes <= 0) continue;
    opportunities.push({
      id,
      title: String(audit.title || id),
      description: stripHtml(audit.description || ''),
      displayValue: String(audit.displayValue || ''),
      score: toNumber(audit.score),
      savingsMs,
      savingsBytes
    });
  }
  return opportunities
    .sort((a, b) => {
      if (b.savingsMs !== a.savingsMs) return b.savingsMs - a.savingsMs;
      if (b.savingsBytes !== a.savingsBytes) return b.savingsBytes - a.savingsBytes;
      return a.id.localeCompare(b.id);
    })
    .slice(0, MAX_OPPORTUNITIES);
}

function extractDiagnostics(audits) {
  const diagnostics = [];
  for (const [id, audit] of Object.entries(audits || {})) {
    if (!audit) continue;
    const displayMode = String(audit.scoreDisplayMode || '');
    if (!['binary', 'numeric'].includes(displayMode)) continue;
    const score = toNumber(audit.score);
    if (score == null || score >= 0.9) continue;
    diagnostics.push({
      id,
      title: String(audit.title || id),
      score: round(score, 2),
      displayValue: String(audit.displayValue || ''),
      description: stripHtml(audit.description || '')
    });
  }
  return diagnostics
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a.id.localeCompare(b.id);
    })
    .slice(0, MAX_DIAGNOSTICS);
}

function metricThresholdText(config) {
  const good = config.unit ? `${config.thresholdGood} ${config.unit}` : String(config.thresholdGood);
  const needsImprovement = config.unit
    ? `${config.thresholdNeedsImprovement} ${config.unit}`
    : String(config.thresholdNeedsImprovement);
  return `<= ${good} good, <= ${needsImprovement} needs improvement`;
}

function addMetricIssue(issues, pageUrl, metricKey, metricRecord, config) {
  if (toNumber(metricRecord?.value) == null) return;
  const rating =
    metricRecord?.category ||
    metricRatingLowerIsBetter(metricRecord.value, config.thresholdGood, config.thresholdNeedsImprovement);
  const impact = impactFromRating(rating);
  if (!impact) return;
  const valuePrecision = metricKey === 'cls' ? 3 : 0;
  const value = formatMetricValue(metricRecord.value, config.unit, valuePrecision);
  issues.push(
    createIssue({
      pageUrl,
      ruleId: `psi-${metricKey}`,
      impact,
      title: config.title,
      failureSummary: `${config.metricLabel} is ${value}${metricRecord.source ? ` (${metricRecord.source})` : ''}.`,
      recommendation: config.recommendation,
      metric: metricKey,
      value,
      threshold: metricThresholdText(config)
    })
  );
}

function buildPerformanceIssues({ pageUrl, score, coreWebVitals, lighthouseMetrics, opportunities, diagnostics }) {
  const issues = [];

  if (toNumber(score) != null && score < 90) {
    const impact = score < 35 ? 'critical' : score < 50 ? 'serious' : 'moderate';
    issues.push(
      createIssue({
        pageUrl,
        ruleId: 'psi-performance-score',
        impact,
        title: 'Overall Lighthouse performance score is below target',
        failureSummary: `Performance score is ${Math.round(score)}.`,
        recommendation:
          'Focus on Core Web Vitals and high-savings opportunities to improve load and responsiveness.',
        metric: 'performanceScore',
        value: Math.round(score),
        threshold: '>= 90 target'
      })
    );
  }

  addMetricIssue(issues, pageUrl, 'lcpMs', coreWebVitals.lcpMs, METRIC_CONFIG.lcpMs);
  addMetricIssue(issues, pageUrl, 'inpMs', coreWebVitals.inpMs, METRIC_CONFIG.inpMs);
  addMetricIssue(issues, pageUrl, 'cls', coreWebVitals.cls, METRIC_CONFIG.cls);
  addMetricIssue(issues, pageUrl, 'fcpMs', coreWebVitals.fcpMs, METRIC_CONFIG.fcpMs);
  addMetricIssue(issues, pageUrl, 'ttfbMs', coreWebVitals.ttfbMs, METRIC_CONFIG.ttfbMs);
  addMetricIssue(issues, pageUrl, 'speedIndexMs', coreWebVitals.speedIndexMs, METRIC_CONFIG.speedIndexMs);
  addMetricIssue(issues, pageUrl, 'tbtMs', coreWebVitals.tbtMs, METRIC_CONFIG.tbtMs);

  for (const item of opportunities.slice(0, 8)) {
    const impact =
      item.savingsMs >= 600 || item.savingsBytes >= 750000
        ? 'serious'
        : item.savingsMs >= 180 || item.savingsBytes >= 250000
          ? 'moderate'
          : 'minor';
    issues.push(
      createIssue({
        pageUrl,
        ruleId: `psi-opportunity-${item.id}`,
        impact,
        title: item.title,
        failureSummary: item.displayValue || item.description || 'Lighthouse opportunity identified.',
        recommendation:
          item.description || 'Address this Lighthouse opportunity to reduce load and rendering cost.',
        metric: item.id,
        value:
          item.savingsMs > 0 && item.savingsBytes > 0
            ? `${item.savingsMs} ms, ${item.savingsBytes} bytes`
            : item.savingsMs > 0
              ? `${item.savingsMs} ms`
              : `${item.savingsBytes} bytes`,
        threshold: 'High-savings opportunities should be prioritized'
      })
    );
  }

  for (const item of diagnostics.slice(0, 6)) {
    const impact = item.score <= 0.3 ? 'moderate' : 'minor';
    issues.push(
      createIssue({
        pageUrl,
        ruleId: `psi-diagnostic-${item.id}`,
        impact,
        title: item.title,
        failureSummary: item.displayValue || item.description || 'Lighthouse diagnostic flagged.',
        recommendation: item.description || 'Review and remediate this diagnostic where practical.',
        metric: item.id,
        value: item.score,
        threshold: 'Target score >= 0.9'
      })
    );
  }

  const ordered = issues
    .slice(0, MAX_ISSUES)
    .sort((a, b) => {
      const impactDelta = IMPACT_ORDER.indexOf(a.impact) - IMPACT_ORDER.indexOf(b.impact);
      if (impactDelta !== 0) return impactDelta;
      return String(a.ruleId || '').localeCompare(String(b.ruleId || ''));
    });

  return ordered;
}

function createEmptyPerformanceReport({ startUrl, strategy, error, fetchedAt = new Date().toISOString() }) {
  return {
    status: 'partial',
    source: 'google-pagespeed-insights',
    strategy,
    pageUrl: startUrl,
    analyzedUrl: startUrl,
    fetchedAt,
    fetchDurationMs: 0,
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
    summary: createEmptySummary(),
    lighthouseVersion: null,
    psiVersion: 'v5',
    error: error || 'PageSpeed Insights did not return data.'
  };
}

function buildPerformanceReportFromPsi(payload, { startUrl, strategy, fetchDurationMs, fetchedAt }) {
  const lighthouseResult = payload?.lighthouseResult || {};
  const audits = lighthouseResult?.audits || {};
  const fieldMetrics = extractFieldMetrics(payload);
  const lighthouseMetrics = extractLighthouseMetrics(audits);

  const coreWebVitals = {
    lcpMs: selectMetricValue(fieldMetrics.lcpMs, lighthouseMetrics.lcpMs),
    inpMs: selectMetricValue(fieldMetrics.inpMs, lighthouseMetrics.inpMs),
    cls: selectMetricValue(fieldMetrics.cls, lighthouseMetrics.cls),
    fcpMs: selectMetricValue(fieldMetrics.fcpMs, lighthouseMetrics.fcpMs),
    ttfbMs: selectMetricValue(fieldMetrics.ttfbMs, lighthouseMetrics.ttfbMs),
    speedIndexMs: selectMetricValue({ value: null, category: '' }, lighthouseMetrics.speedIndexMs),
    tbtMs: selectMetricValue({ value: null, category: '' }, lighthouseMetrics.tbtMs),
    fieldDataSource: fieldMetrics.source
  };

  const opportunities = extractOpportunities(audits);
  const diagnostics = extractDiagnostics(audits);
  const score = extractScore(lighthouseResult);
  const analyzedUrl = String(lighthouseResult?.finalDisplayedUrl || payload?.id || startUrl);
  const issues = buildPerformanceIssues({
    pageUrl: analyzedUrl,
    score,
    coreWebVitals,
    lighthouseMetrics,
    opportunities,
    diagnostics
  });

  return {
    status: 'complete',
    source: 'google-pagespeed-insights',
    strategy,
    pageUrl: startUrl,
    analyzedUrl,
    fetchedAt,
    fetchDurationMs,
    score,
    coreWebVitals,
    lighthouseMetrics,
    opportunities,
    diagnostics,
    issues,
    summary: summarizePerformanceIssues(issues),
    lighthouseVersion: lighthouseResult?.lighthouseVersion || null,
    psiVersion: 'v5',
    error: null
  };
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: trimText(text, 500) };
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      payload
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchPerformanceReport({
  startUrl,
  strategy = 'desktop',
  apiKey = process.env.PAGESPEED_API_KEY || '',
  timeoutMs = process.env.PSI_TIMEOUT_MS
} = {}) {
  const fetchedAt = new Date().toISOString();
  const timeout = clampTimeout(timeoutMs);
  const normalizedStrategy = String(strategy || 'desktop').toLowerCase() === 'mobile' ? 'mobile' : 'desktop';
  const params = new URLSearchParams({
    url: String(startUrl || ''),
    strategy: normalizedStrategy,
    category: 'performance'
  });
  if (apiKey) {
    params.set('key', apiKey);
  }

  const endpoint = `${PSI_ENDPOINT}?${params.toString()}`;
  const started = Date.now();

  try {
    const response = await fetchJsonWithTimeout(endpoint, timeout);
    const durationMs = Date.now() - started;

    if (!response.ok) {
      const message =
        response?.payload?.error?.message ||
        response?.payload?.raw ||
        `PageSpeed request failed with status ${response.status}.`;
      return createEmptyPerformanceReport({
        startUrl,
        strategy: normalizedStrategy,
        fetchedAt,
        error: trimText(message, 260)
      });
    }

    return buildPerformanceReportFromPsi(response.payload || {}, {
      startUrl,
      strategy: normalizedStrategy,
      fetchDurationMs: durationMs,
      fetchedAt
    });
  } catch (error) {
    const message =
      error?.name === 'AbortError'
        ? `PageSpeed request timed out after ${timeout}ms.`
        : error?.message || String(error);
    return createEmptyPerformanceReport({
      startUrl,
      strategy: normalizedStrategy,
      fetchedAt,
      error: trimText(message, 260)
    });
  }
}

export {
  buildPerformanceReportFromPsi,
  createEmptyPerformanceReport,
  fetchPerformanceReport,
  summarizePerformanceIssues
};
