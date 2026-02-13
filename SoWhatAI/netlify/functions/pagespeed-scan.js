import { getPsiResult, sanitizeErrorMessage } from './psiClient.js';
import { runPerformanceEngine } from './performanceEngine.js';
import { runSeoEngine } from './seoEngine.js';
import { runBestPracticesEngine } from './bestPracticesEngine.js';

const DEFAULT_STRATEGY = 'mobile';
const DEFAULT_TIMEOUT_MS = 12000;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  };
}

function sanitizeError(error) {
  return sanitizeErrorMessage(error?.message || String(error || 'Unknown error'));
}

function clampScore(score) {
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function normalizeStrategy(value) {
  return String(value || '').toLowerCase() === 'desktop' ? 'desktop' : DEFAULT_STRATEGY;
}

function normalizeHttpUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function buildUnavailableEngine(engine, startUrl, strategy, reason, message) {
  return {
    status: 'unavailable',
    reason,
    engine,
    source: 'google-pagespeed-insights',
    pageUrl: startUrl,
    analyzedUrl: startUrl,
    strategy,
    score: null,
    issueCount: 0,
    issues: [],
    error: sanitizeError(message || `${engine} unavailable.`)
  };
}

function buildErrorsSummary(engineErrors) {
  const messages = [];
  const seen = new Set();
  let totalTimeouts = 0;

  for (const [engine, message] of Object.entries(engineErrors || {})) {
    const text = sanitizeError(`${engine}: ${message}`);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    messages.push(text);
    if (key.includes('timeout')) {
      totalTimeouts += 1;
    }
    if (messages.length >= 10) break;
  }

  return {
    totalErrors: messages.length,
    totalTimeouts,
    messages
  };
}

function normalizeEngineResult(engine, rawResult, startUrl, strategy, fallbackReason) {
  const data = rawResult?.data && typeof rawResult.data === 'object'
    ? rawResult.data
    : buildUnavailableEngine(engine, startUrl, strategy, fallbackReason, rawResult?.error || 'Unknown error');

  if (!data.status) {
    data.status = 'unavailable';
  }
  if (!data.reason && data.status === 'unavailable') {
    data.reason = fallbackReason || rawResult?.error || 'unknown';
  }
  if (!data.source) {
    data.source = 'google-pagespeed-insights';
  }
  return data;
}

exports.handler = async (event, context) => {
  if (context && typeof context === 'object') {
    context.callbackWaitsForEmptyEventLoop = false;
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

  const rawStartUrl = typeof body.startUrl === 'string' ? body.startUrl.trim() : '';
  if (!rawStartUrl) {
    return json(400, { error: 'startUrl is required.' });
  }

  const startUrl = normalizeHttpUrl(rawStartUrl);
  if (!startUrl) {
    return json(400, { error: 'startUrl must be a valid http/https URL.' });
  }

  const strategy = normalizeStrategy(body.psiStrategy);
  const apiKey = String(process.env.PAGESPEED_API_KEY || '').trim();
  const startedAt = Date.now();

  try {
    const psiResult = await getPsiResult({
      url: startUrl,
      strategy,
      apiKey,
      timeoutMs: DEFAULT_TIMEOUT_MS
    });

    const [performanceRaw, seoRaw, bestPracticesRaw] = await Promise.all([
      runPerformanceEngine({ startUrl, strategy, psiResult }),
      runSeoEngine({ startUrl, strategy, psiResult }),
      runBestPracticesEngine({ startUrl, strategy, psiResult })
    ]);

    const performance = normalizeEngineResult('performance', performanceRaw, startUrl, strategy, psiResult?.error);
    const seo = normalizeEngineResult('seo', seoRaw, startUrl, strategy, psiResult?.error);
    const bestPractices = normalizeEngineResult(
      'bestPractices',
      bestPracticesRaw,
      startUrl,
      strategy,
      psiResult?.error
    );

    const enginesRun = ['performance', 'seo', 'bestPractices'];
    const enginesFailed = [];
    const engineErrors = {};

    for (const [engine, data] of [
      ['performance', performance],
      ['seo', seo],
      ['bestPractices', bestPractices]
    ]) {
      if (data.status === 'unavailable') {
        enginesFailed.push(engine);
        engineErrors[engine] = data.reason || data.error || 'unknown';
      }
    }

    const performanceScore = clampScore(performance.score);
    const seoScore = clampScore(seo.score);
    const bestPracticesScore = clampScore(bestPractices.score);
    const overallScore = clampScore((performanceScore + seoScore + bestPracticesScore) / 3);

    const durationMs = Date.now() - startedAt;
    const missingApiKey =
      performance.reason === 'missing_api_key' ||
      seo.reason === 'missing_api_key' ||
      bestPractices.reason === 'missing_api_key';
    const quotaExceeded =
      performance.reason === 'quota_exceeded' ||
      seo.reason === 'quota_exceeded' ||
      bestPractices.reason === 'quota_exceeded';

    let message = '';
    if (missingApiKey) {
      message = 'PageSpeed API key missing. PSI engines unavailable.';
    } else if (quotaExceeded) {
      message = 'Google PageSpeed Insights quota exceeded.';
    }

    return json(200, {
      status: enginesFailed.length > 0 ? 'partial' : 'complete',
      message,
      mode: 'pagespeed',
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs,
      elapsedMs: durationMs,
      performance,
      seo,
      bestPractices,
      summary: {
        performanceScore,
        seoScore,
        bestPracticesScore,
        overallScore
      },
      metadata: {
        durationMs,
        enginesRun,
        enginesFailed,
        psiCallsMade: Number(psiResult?.psiCallsMade) || 0,
        psiCacheHits: Number(psiResult?.psiCacheHits) || 0,
        engineErrors,
        errorsSummary: buildErrorsSummary(engineErrors),
        request: {
          startUrl,
          strategy
        }
      }
    });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = sanitizeError(error);
    return json(200, {
      status: 'partial',
      message,
      mode: 'pagespeed',
      durationMs,
      elapsedMs: durationMs,
      performance: buildUnavailableEngine('performance', startUrl, strategy, 'unknown', message),
      seo: buildUnavailableEngine('seo', startUrl, strategy, 'unknown', message),
      bestPractices: buildUnavailableEngine('bestPractices', startUrl, strategy, 'unknown', message),
      summary: {
        performanceScore: 0,
        seoScore: 0,
        bestPracticesScore: 0,
        overallScore: 0
      },
      metadata: {
        durationMs,
        enginesRun: ['performance', 'seo', 'bestPractices'],
        enginesFailed: ['performance', 'seo', 'bestPractices'],
        psiCallsMade: 0,
        psiCacheHits: 0,
        engineErrors: {
          performance: message,
          seo: message,
          bestPractices: message
        },
        errorsSummary: {
          totalErrors: 1,
          totalTimeouts: message.toLowerCase().includes('timeout') ? 1 : 0,
          messages: [message]
        },
        request: {
          startUrl,
          strategy
        }
      }
    });
  }
};
