const crypto = require('crypto');
const fetch = global.fetch;

const DEFAULT_SINGLE_TIMEOUT_MS = 60000;
const DEFAULT_CRAWL_TIMEOUT_MS = 90000;
const MIN_TIMEOUT_MS = 10000;
const MAX_TIMEOUT_MS = 180000;
const DEFAULT_CRAWL_MAX_PAGES = 3;
const MAX_CRAWL_MAX_PAGES = 10;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  };
}

function sanitizeText(value, fallback = '') {
  return String(value || fallback).replace(/\s+/g, ' ').trim().slice(0, 260);
}

function normalizeMode(value) {
  return String(value || '').toLowerCase() === 'crawl' ? 'crawl' : 'single';
}

function normalizeBoolean(value, fallback = false) {
  if (value == null) return fallback;
  return Boolean(value);
}

function normalizeHttpUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeMaxPages(mode, value) {
  if (mode !== 'crawl') return 1;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_CRAWL_MAX_PAGES;
  return Math.max(1, Math.min(MAX_CRAWL_MAX_PAGES, Math.floor(numeric)));
}

function normalizeTimeout(mode, value) {
  const fallback = mode === 'crawl' ? DEFAULT_CRAWL_TIMEOUT_MS : DEFAULT_SINGLE_TIMEOUT_MS;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.floor(numeric)));
}

function buildJobId() {
  if (typeof crypto.randomUUID === 'function') {
    return `wcag_${crypto.randomUUID()}`;
  }
  return `wcag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function handler(event, context) {
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

  const mode = normalizeMode(body.mode);
  const startUrl = normalizeHttpUrl(body.startUrl);
  if (!startUrl) {
    return json(400, { error: 'startUrl must be a valid http/https URL.' });
  }

  const payload = {
    startUrl,
    mode,
    maxPages: normalizeMaxPages(mode, body.maxPages),
    includeScreenshots: normalizeBoolean(body.includeScreenshots, true),
    timeoutMs: normalizeTimeout(mode, body.timeoutMs),
    runPsi: normalizeBoolean(body.runPsi, false),
    psiStrategy: String(body.psiStrategy || '').toLowerCase() === 'desktop' ? 'desktop' : 'mobile',
    includePerformanceAudit: normalizeBoolean(body.includePerformanceAudit, false)
  };

  const jobId = buildJobId();
  const now = new Date().toISOString();
  const pollUrl = `/.netlify/functions/wcag-status?jobId=${encodeURIComponent(jobId)}`;

  let createJob = null;
  let failJob = async () => null;
  try {
    const store = require('./jobStore.js');
    createJob = store && typeof store.createJob === 'function' ? store.createJob : null;
    failJob = store && typeof store.failJob === 'function' ? store.failJob : failJob;
  } catch (error) {
    return json(200, {
      jobId,
      status: 'failed',
      pollUrl,
      error: {
        code: 'job_store_unavailable',
        message: sanitizeText(error?.message || String(error), 'Job store unavailable.')
      }
    });
  }

  if (typeof createJob !== 'function') {
    return json(200, {
      jobId,
      status: 'failed',
      pollUrl,
      error: {
        code: 'job_store_unavailable',
        message: 'Job store unavailable.'
      }
    });
  }

  try {
    await createJob({
      jobId,
      status: 'queued',
      createdAt: now,
      payload,
      progress: {
        percent: 0,
        message: 'Queued'
      }
    });

    fetch('/.netlify/functions/wcag-run-background', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId })
    }).catch(() => {});

    return json(202, {
      jobId,
      status: 'queued',
      pollUrl
    });
  } catch (error) {
    const message = sanitizeText(error?.message || String(error), 'Failed to start WCAG scan job.');
    await failJob(jobId, { message, code: 'job_start_failed' }).catch(() => {});
    return json(200, {
      jobId,
      status: 'failed',
      pollUrl,
      error: {
        code: 'job_start_failed',
        message
      }
    });
  }
};
