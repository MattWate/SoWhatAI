const playwright = require('playwright-core');
const axeCore = require('axe-core');

let chromium = null;
try {
  chromium = require('@sparticuz/chromium');
} catch {
  chromium = null;
}

const NAVIGATION_TIMEOUT_MS = 12000;
const AXE_TIMEOUT_MS = 8000;
const MAX_NODE_SAMPLES = 20;
const MAX_TEXT_LENGTH = 280;

function sanitizeText(value, fallback = '') {
  return String(value ?? fallback).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
}

function truncateText(value, maxLength = MAX_TEXT_LENGTH) {
  const clean = sanitizeText(value, '');
  if (!clean) return '';
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 3))}...`;
}

function normalizeImpact(value) {
  const impact = String(value || '').toLowerCase();
  if (impact === 'critical' || impact === 'serious' || impact === 'moderate' || impact === 'minor') {
    return impact;
  }
  return 'unknown';
}

function normalizeMode(value) {
  return String(value || '').toLowerCase() === 'crawl' ? 'crawl' : 'single';
}

function normalizeInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.trunc(numeric);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('startUrl is required.');
  let parsed = null;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('startUrl must be a valid URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('startUrl must use http:// or https://.');
  }
  return parsed.toString();
}

function toIssueNode(node) {
  const target = Array.isArray(node && node.target)
    ? node.target.map((item) => sanitizeText(item, '')).filter(Boolean)
    : [];
  return {
    target,
    snippet: truncateText(node && node.html, 240),
    failureSummary: truncateText(node && node.failureSummary, 240)
  };
}

function normalizeViolations(violations, pageUrl) {
  if (!Array.isArray(violations)) return [];

  return violations.map((violation) => {
    const nodes = Array.isArray(violation && violation.nodes) ? violation.nodes : [];
    const normalizedNodes = nodes.slice(0, MAX_NODE_SAMPLES).map((node) => toIssueNode(node));
    const firstNode = normalizedNodes[0] || { target: [], snippet: '', failureSummary: '' };

    return {
      id: sanitizeText(violation && violation.id, 'unknown_rule'),
      description: sanitizeText(violation && violation.description, 'No description provided.'),
      help: sanitizeText(violation && violation.help, 'No guidance provided.'),
      helpUrl: sanitizeText(violation && violation.helpUrl, ''),
      impact: normalizeImpact(violation && violation.impact),
      pageUrl,
      nodeCount: nodes.length,
      firstNode: {
        selector: firstNode.target[0] || '',
        snippet: firstNode.snippet || '',
        failureSummary: firstNode.failureSummary || ''
      },
      nodes: normalizedNodes
    };
  });
}

function normalizeNeedsReview(incomplete, pageUrl) {
  if (!Array.isArray(incomplete)) return [];
  return incomplete.slice(0, 25).map((item) => {
    const nodes = Array.isArray(item && item.nodes) ? item.nodes : [];
    return {
      id: sanitizeText(item && item.id, 'manual_review'),
      impact: normalizeImpact(item && item.impact),
      description: sanitizeText(item && item.description, 'Manual review recommended.'),
      help: sanitizeText(item && item.help, ''),
      pageUrl,
      nodeCount: nodes.length
    };
  });
}

function calculateAccessibilityScore(issues) {
  if (!Array.isArray(issues)) return null;
  const weights = {
    critical: 10,
    serious: 6,
    moderate: 3,
    minor: 1,
    unknown: 2
  };

  const weightedTotal = issues.reduce((total, issue) => {
    const impact = normalizeImpact(issue && issue.impact);
    const nodeCount = Math.max(1, Number(issue && issue.nodeCount) || 0);
    return total + (weights[impact] || 2) * nodeCount;
  }, 0);

  const score = 100 - Math.min(100, weightedTotal);
  return Math.max(0, Math.round(score));
}

function withTimeout(fn, timeoutMs, timeoutMessage) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    Promise.resolve()
      .then(fn)
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function launchBrowser() {
  if (chromium && typeof chromium.executablePath === 'function') {
    const executablePath = await chromium.executablePath();
    return playwright.chromium.launch({
      headless: chromium.headless !== false,
      executablePath,
      args: Array.isArray(chromium.args) ? chromium.args : []
    });
  }

  return playwright.chromium.launch({
    headless: true
  });
}

async function runWcagScan(payload = {}, options = {}) {
  const onProgress = options && typeof options.onProgress === 'function' ? options.onProgress : null;
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();

  const startUrl = normalizeUrl(payload.startUrl);
  const mode = normalizeMode(payload.mode);
  const maxPagesRequested = clamp(normalizeInteger(payload.maxPages, 1) || 1, 1, 10);
  const maxPages = Math.min(1, maxPagesRequested);
  const includeScreenshots = Boolean(payload.includeScreenshots);

  let browser = null;
  let context = null;
  let page = null;
  let finalUrl = startUrl;
  let pageStatus = 'ok';
  let violations = [];
  let incomplete = [];

  try {
    if (onProgress) {
      await onProgress({ percent: 10, message: 'Fetching page' });
    }

    browser = await launchBrowser();
    context = await browser.newContext({ ignoreHTTPSErrors: true });

    await context.route('**/*', async (route) => {
      const resourceType = route.request().resourceType();
      if (resourceType === 'image' || resourceType === 'media' || resourceType === 'font') {
        await route.abort().catch(() => {});
        return;
      }
      await route.continue().catch(() => {});
    });

    page = await context.newPage();
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    page.setDefaultTimeout(NAVIGATION_TIMEOUT_MS);

    const response = await withTimeout(
      () => page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS }),
      NAVIGATION_TIMEOUT_MS + 1000,
      'Navigation timed out.'
    );

    finalUrl = sanitizeText(page.url() || startUrl, startUrl);
    const responseStatus =
      response && typeof response.status === 'function' ? Number(response.status()) : null;
    pageStatus = Number.isFinite(responseStatus) ? String(responseStatus) : 'ok';

    if (onProgress) {
      await onProgress({ percent: 40, message: 'Running axe' });
    }

    await page.addScriptTag({ content: axeCore.source });

    const axeResults = await withTimeout(
      () => page.evaluate(async () => window.axe.run(document)),
      AXE_TIMEOUT_MS,
      'Axe run timed out.'
    );

    violations = Array.isArray(axeResults && axeResults.violations) ? axeResults.violations : [];
    incomplete = Array.isArray(axeResults && axeResults.incomplete) ? axeResults.incomplete : [];

    if (onProgress) {
      await onProgress({ percent: 80, message: 'Formatting report' });
    }

    const issues = normalizeViolations(violations, finalUrl);
    const issueCount = issues.reduce((total, issue) => total + (Number(issue.nodeCount) || 0), 0);
    const needsReview = normalizeNeedsReview(incomplete, finalUrl);

    const result = {
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      pages: [
        {
          url: finalUrl,
          status: pageStatus,
          issueCount
        }
      ],
      issues,
      summary: {
        accessibilityScore: calculateAccessibilityScore(issues)
      },
      needsReview,
      metadata: {
        mode,
        maxPages,
        includeScreenshots
      }
    };

    if (includeScreenshots) {
      try {
        const screenshot = await page.screenshot({
          type: 'jpeg',
          quality: 65,
          fullPage: false
        });
        result.screenshots = [
          {
            pageUrl: finalUrl,
            dataUrl: `data:image/jpeg;base64,${screenshot.toString('base64')}`
          }
        ];
      } catch {
        result.screenshots = [];
      }
    }

    return result;
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
    if (context) {
      await context.close().catch(() => {});
    }
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

module.exports = {
  runWcagScan
};
