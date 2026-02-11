import { runWcagScan } from '../lib/wcagScannerCore.js';

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  };
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }

  const {
    startUrl,
    mode = 'single',
    maxPages,
    includeScreenshots = false,
    timeoutMs,
    debug = false,
    resourceBlocking,
    blockImages,
    maxViolationsPerPage,
    maxNodesPerViolation,
    maxTotalIssuesOverall,
    ruleset,
    includeBestPractices,
    includeExperimental,
    includeSelectors,
    excludeSelectors
  } = body;

  if (!startUrl || typeof startUrl !== 'string') {
    return json(400, { error: 'startUrl is required.' });
  }

  try {
    const parsed = new URL(startUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return json(400, { error: 'startUrl must use http or https.' });
    }
  } catch {
    return json(400, { error: 'startUrl must be a valid URL.' });
  }

  if (mode !== 'single' && mode !== 'crawl') {
    return json(400, { error: "mode must be 'single' or 'crawl'." });
  }

  try {
    const result = await runWcagScan({
      startUrl,
      mode,
      maxPages,
      includeScreenshots: Boolean(includeScreenshots),
      timeoutMs,
      debug: Boolean(debug),
      resourceBlocking,
      blockImages,
      maxViolationsPerPage,
      maxNodesPerViolation,
      maxTotalIssuesOverall,
      ruleset,
      includeBestPractices,
      includeExperimental,
      includeSelectors,
      excludeSelectors
    });

    return json(200, result);

  } catch (error) {
    const now = new Date().toISOString();

    return json(200, {
      status: 'partial',
      message: 'Unexpected runtime error. Returning empty partial result.',
      service: 'LumenScan',
      mode,
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      elapsedMs: 0,
      pages: [],
      issues: [],
      screenshots: [],
      needsReview: [],
      truncated: true,
      metadata: {
        durationMs: 0,
        pagesAttempted: 0,
        pagesScanned: 0,
        truncated: true,
        truncation: {
          timeBudget: false,
          maxPages: false,
          maxTotalIssues: false
        },
        errorsSummary: {
          totalErrors: 1,
          totalTimeouts: 0,
          messages: [error.message || String(error)]
        },
        standards: {
          ruleset: ruleset || 'wcag22aa',
          tags: [],
          includeBestPractices: Boolean(includeBestPractices),
          includeExperimental: Boolean(includeExperimental)
        },
        scope: {
          includeSelectors: Array.isArray(includeSelectors) ? includeSelectors : [],
          excludeSelectors: Array.isArray(excludeSelectors) ? excludeSelectors : []
        }
      }
    });
  }
};
