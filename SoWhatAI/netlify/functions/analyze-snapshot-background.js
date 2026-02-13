const axeCore = require('axe-core');
const { JSDOM } = require('jsdom');
const { getSnapshot, saveAnalysis, updateStatus } = require('./snapshotStore.js');

const RESPONSE_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};

const MAX_SELECTOR_COUNT = 6;
const MAX_SELECTOR_LENGTH = 220;
const MAX_HTML_SNIPPET_LENGTH = 600;
const MAX_FAILURE_SUMMARY_LENGTH = 500;
const MAX_NEEDS_REVIEW = 20;

function json(statusCode, body) {
  return {
    statusCode,
    headers: RESPONSE_HEADERS,
    body: JSON.stringify(body)
  };
}

function sanitizeText(value, fallback = '') {
  return String(value || fallback).replace(/\s+/g, ' ').trim().slice(0, 320);
}

function trimText(value, maxLength) {
  const text = String(value || '');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function clampScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function dedupeMessages(messages, limit = 12) {
  const output = [];
  const seen = new Set();
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

function trimSelectors(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_SELECTOR_COUNT)
    .map((item) => trimText(String(item || ''), MAX_SELECTOR_LENGTH))
    .filter(Boolean);
}

function extractWcagRefs(tags) {
  const refs = [];
  for (const tag of Array.isArray(tags) ? tags : []) {
    const text = String(tag || '');
    if (/^wcag(?:\d{3,4}|2a|2aa|21aa|22aa)$/i.test(text)) {
      refs.push(text);
    }
    if (refs.length >= 8) break;
  }
  return refs;
}

function dedupeIssues(issues) {
  const output = [];
  const seen = new Set();
  for (const issue of Array.isArray(issues) ? issues : []) {
    const selector = Array.isArray(issue.targetSelectors) && issue.targetSelectors.length > 0
      ? issue.targetSelectors[0]
      : 'no-selector';
    const key = `${issue.pageUrl}|${issue.ruleId}|${selector}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(issue);
  }
  return output;
}

function toIssueList(violations, pageUrl) {
  const issues = [];

  for (const violation of Array.isArray(violations) ? violations : []) {
    const wcagRefs = extractWcagRefs(violation.tags);
    const ruleId = sanitizeText(violation.id, 'unknown-rule');

    for (const node of Array.isArray(violation.nodes) ? violation.nodes : []) {
      issues.push({
        pageUrl,
        ruleId,
        wcagRefs,
        impact: sanitizeText(node.impact || violation.impact || 'minor', 'minor'),
        targetSelectors: trimSelectors(node.target),
        htmlSnippet: trimText(node.html || '', MAX_HTML_SNIPPET_LENGTH),
        failureSummary: trimText(node.failureSummary || violation.help || '', MAX_FAILURE_SUMMARY_LENGTH),
        bbox: null
      });
    }
  }

  return dedupeIssues(issues);
}

function toNeedsReview(incompleteResults) {
  const output = [];
  for (const item of Array.isArray(incompleteResults) ? incompleteResults : []) {
    const samples = [];
    for (const node of Array.isArray(item.nodes) ? item.nodes : []) {
      for (const selector of trimSelectors(node.target)) {
        samples.push(selector);
        if (samples.length >= 4) break;
      }
      if (samples.length >= 4) break;
    }
    output.push({
      id: sanitizeText(item.id, 'incomplete-rule'),
      title: sanitizeText(item.help || item.id || 'Manual Review Rule'),
      reason: 'Manual review required. axe-core marked this check as incomplete.',
      samples: Array.from(new Set(samples)).slice(0, 4)
    });
    if (output.length >= MAX_NEEDS_REVIEW) break;
  }
  return output;
}

function summarizeImpact(issues) {
  const summary = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const issue of Array.isArray(issues) ? issues : []) {
    const key = String(issue.impact || '').toLowerCase();
    if (summary[key] != null) summary[key] += 1;
  }
  return summary;
}

function summarizeTopRules(issues, limit = 10) {
  const counts = new Map();
  for (const issue of Array.isArray(issues) ? issues : []) {
    const id = sanitizeText(issue.ruleId, '');
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .slice(0, limit)
    .map(([ruleId, count]) => ({ ruleId, count }));
}

function buildEngineInsights(issues, incompleteResults) {
  return {
    issueCount: issues.length,
    incompleteRuleCount: Array.isArray(incompleteResults) ? incompleteResults.length : 0,
    topRules: summarizeTopRules(issues, 10),
    incompleteTopRules: (Array.isArray(incompleteResults) ? incompleteResults : [])
      .slice(0, 10)
      .map((item) => ({
        ruleId: sanitizeText(item.id, 'incomplete-rule'),
        count: Array.isArray(item.nodes) ? item.nodes.length : 0
      }))
  };
}

function computeAccessibilityScore(issues) {
  return issues.length === 0 ? 100 : 0;
}

function buildResultFromAxe({
  snapshot,
  startedAt,
  finishedAt,
  durationMs,
  axeResults,
  includeBestPracticeHints
}) {
  const pageUrl = snapshot.finalUrl || snapshot.url;
  const issues = toIssueList(axeResults.violations, pageUrl);
  const needsReview = toNeedsReview(axeResults.incomplete);
  const impactSummary = summarizeImpact(issues);
  const topRules = summarizeTopRules(issues, 10);
  const errorsSummaryMessages = dedupeMessages([]);
  const accessibilityScore = computeAccessibilityScore(issues);
  const engineInsights = buildEngineInsights(issues, axeResults.incomplete);

  const pages = [
    {
      url: pageUrl,
      status: 'ok',
      issueCount: issues.length,
      performanceIssueCount: 0,
      detectedIssueCount: issues.length,
      error: null,
      truncated: false,
      truncatedBy: {
        timeout: false,
        violations: false,
        nodes: false,
        totalIssues: false
      },
      durationMs
    }
  ];

  const accessibilityPayload = {
    status: 'available',
    reason: null,
    truncated: false,
    engine: 'accessibility',
    source: 'axe-core',
    scanner: {
      name: 'axe-core',
      version: axeCore.version || null,
      executionMode: 'jsdom-snapshot'
    },
    pageUrl,
    analyzedUrl: pageUrl,
    mode: 'single',
    maxPages: 1,
    includeScreenshots: false,
    score: accessibilityScore,
    issueCount: issues.length,
    issues,
    pages,
    performanceIssues: [],
    screenshots: [],
    needsReview,
    durationMs,
    startedAt,
    finishedAt,
    message: '',
    metadata: {
      durationMs,
      pagesAttempted: 1,
      pagesScanned: 1,
      truncated: false,
      errorsSummary: {
        totalErrors: errorsSummaryMessages.length,
        totalTimeouts: 0,
        messages: errorsSummaryMessages
      },
      engine: {
        name: 'axe-core',
        activeRuleCount: Array.isArray(axeResults.passes)
          ? axeResults.passes.length + (Array.isArray(axeResults.violations) ? axeResults.violations.length : 0)
          : Array.isArray(axeResults.violations)
            ? axeResults.violations.length
            : 0,
        insights: engineInsights
      },
      standards: {
        ruleset: 'wcag22aa',
        tags: includeBestPracticeHints
          ? ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice']
          : ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'],
        includeBestPractices: includeBestPracticeHints,
        includeExperimental: false
      },
      scope: {
        includeSelectors: [],
        excludeSelectors: []
      },
      performance: {
        issueCount: 0,
        impactSummary: { critical: 0, serious: 0, moderate: 0, minor: 0 },
        topRules: [],
        pages: [{ url: pageUrl, issueCount: 0 }]
      },
      snapshot: {
        snapshotId: snapshot.snapshotId,
        capturedAt: snapshot.capturedAt
      }
    },
    error: null
  };

  return {
    status: 'complete',
    message: '',
    mode: 'single',
    startedAt,
    finishedAt,
    durationMs,
    elapsedMs: durationMs,
    truncated: false,
    accessibility: accessibilityPayload,
    performance: {
      status: 'unavailable',
      reason: 'disabled',
      engine: 'performance',
      source: 'google-pagespeed-insights',
      score: null,
      issueCount: 0,
      issues: []
    },
    seo: {
      status: 'unavailable',
      reason: 'disabled',
      engine: 'seo',
      source: 'google-pagespeed-insights',
      score: null,
      issueCount: 0,
      issues: []
    },
    bestPractices: {
      status: 'unavailable',
      reason: 'disabled',
      engine: 'bestPractices',
      source: 'google-pagespeed-insights',
      score: null,
      issueCount: 0,
      issues: []
    },
    summary: {
      accessibilityScore: clampScore(accessibilityScore),
      performanceScore: 0,
      seoScore: 0,
      bestPracticesScore: 0,
      overallScore: clampScore(accessibilityScore)
    },
    metadata: {
      ...accessibilityPayload.metadata,
      enginesRun: ['accessibility'],
      enginesFailed: [],
      psiCallsMade: 0,
      psiCacheHits: 0,
      engineErrors: {},
      errorsSummary: {
        totalErrors: errorsSummaryMessages.length,
        totalTimeouts: 0,
        messages: errorsSummaryMessages
      }
    },
    pages,
    issues,
    performanceIssues: [],
    screenshots: [],
    needsReview
  };
}

async function runSnapshotAnalysis(snapshot, options = {}) {
  const includeBestPracticeHints = options.includeBestPracticeHints !== false;
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();

  const dom = new JSDOM(snapshot.html || '', {
    url: snapshot.finalUrl || snapshot.url || 'https://snapshot.local/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });

  try {
    const { window } = dom;
    window.eval(axeCore.source);
    const runOptions = {
      runOnly: {
        type: 'tag',
        values: includeBestPracticeHints
          ? ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice']
          : ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']
      }
    };
    const axeResults = await window.axe.run(window.document, runOptions);
    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - startedAtMs;

    return buildResultFromAxe({
      snapshot,
      startedAt,
      finishedAt,
      durationMs,
      axeResults,
      includeBestPracticeHints
    });
  } finally {
    dom.window.close();
  }
}

exports.handler = async (event, context) => {
  if (context && typeof context === 'object') {
    context.callbackWaitsForEmptyEventLoop = false;
  }

  if (event.httpMethod === 'OPTIONS') {
    return json(200, { ok: true });
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

  const snapshotId = String(body.snapshotId || '').trim();
  if (!snapshotId) {
    return json(400, { error: 'snapshotId is required.' });
  }

  try {
    const snapshot = await getSnapshot(snapshotId);
    if (!snapshot) {
      return json(200, {
        snapshotId,
        status: 'failed',
        error: {
          code: 'snapshot_not_found',
          message: 'Snapshot not found or expired.'
        }
      });
    }

    await updateStatus(snapshotId, {
      status: 'running',
      progress: { percent: 22, message: 'Starting snapshot analysis...' },
      error: null
    });

    await updateStatus(snapshotId, {
      status: 'running',
      progress: { percent: 42, message: 'Loading snapshot DOM context...' }
    });

    await updateStatus(snapshotId, {
      status: 'running',
      progress: { percent: 62, message: 'Running axe-core checks on snapshot...' }
    });

    const result = await runSnapshotAnalysis(snapshot, body.options || {});

    await updateStatus(snapshotId, {
      status: 'running',
      progress: { percent: 84, message: 'Aggregating accessibility findings...' }
    });

    await saveAnalysis(snapshotId, result);

    return json(200, {
      snapshotId,
      status: 'complete'
    });
  } catch (error) {
    const message = sanitizeText(error?.message || String(error), 'Snapshot analysis failed.');
    await updateStatus(snapshotId, {
      status: 'failed',
      progress: { percent: 100, message: 'Snapshot analysis failed.' },
      error: {
        code: 'analysis_failed',
        message
      },
      finishedAt: new Date().toISOString()
    }).catch(() => {});

    return json(200, {
      snapshotId,
      status: 'failed',
      error: {
        code: 'analysis_failed',
        message
      }
    });
  }
};
