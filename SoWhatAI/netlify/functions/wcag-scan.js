import { runWcagScan } from '../lib/wcagScannerCore.js';
import { SCAN_ENGINE_NAME } from '../lib/lumenRuleEngine.js';

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  };
}

const FIXED_STANDARDS = {
  ruleset: 'wcag22aa',
  tags: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'],
  includeBestPractices: true,
  includeExperimental: false
};

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }

  const { startUrl } = body;

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

  try {
    const result = await runWcagScan({
      startUrl
    });

    return json(200, result);
  } catch (error) {
    const now = new Date().toISOString();

    return json(200, {
      status: 'partial',
      message: 'Unexpected runtime error. Returning empty partial result.',
      service: SCAN_ENGINE_NAME,
      mode: 'single',
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
          maxTotalIssues: false
        },
        errorsSummary: {
          totalErrors: 1,
          totalTimeouts: 0,
          messages: [error.message || String(error)]
        },
        standards: FIXED_STANDARDS,
        scope: {
          includeSelectors: [],
          excludeSelectors: []
        },
        screenshotSelection: {
          enabled: true
        }
      }
    });
  }
};
