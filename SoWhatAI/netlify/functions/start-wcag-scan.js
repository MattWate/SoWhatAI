const crypto = require('crypto');
const { createJob, failJob } = require('./jobStore.js');

const DEFAULT_SINGLE_TIMEOUT_MS = 60000;
const DEFAULT_CRAWL_TIMEOUT_MS = 90000;
const MIN_TIMEOUT_MS = 10000;
const MAX_TIMEOUT_MS = 180000;
const DEFAULT_CRAWL_MAX_PAGES = 3;
const MAX_CRAWL_MAX_PAGES = 10;
const BACKGROUND_TRIGGER_TIMEOUT_MS = 1200;

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

function resolveBaseUrl(event) {
  const headers = (event && event.headers) || {};
  const forwardedProto = headers['x-forwarded-proto'] || headers['X-Forwarded-Proto'];
  const forwardedHost = headers['x-forwarded-host'] || headers['X-Forwarded-Host'];
  const host = forwardedHost || headers.host || headers.Host || '';

  if (host) {
    const forwarded = String(forwardedProto || '').toLowerCase();
    const looksLocal = /^localhost(?::\d+)?$/i.test(host) || /^127\.0\.0\.1(?::\d+)?$/i.test(host);
    const protocol = forwarded === 'http' ? 'http' : forwarded === 'https' ? 'https' : looksLocal ? 'http' : 'https';
    return `${protocol}://${host}`;
  }

  const fromEnv =
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    process.env.DEPLOY_URL ||
    '';
  if (fromEnv) {
    return String(fromEnv).replace(/\/+$/, '');
  }

  return '';
}

async function triggerBackground(url, payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BACKGROUND_TRIGGER_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      let message = `Background trigger failed (${response.status}).`;
      try {
        const body = await response.json();
        message = sanitizeText(body?.error || body?.message || message, message);
      } catch {}
      throw new Error(message);
    }
  } finally {
    clearTimeout(timeoutId);
  }
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
  const pollUrl = `/.netlify/functions/wcag-scan-status?jobId=${encodeURIComponent(jobId)}`;

  try {
    await createJob(jobId, payload);

    const baseUrl = resolveBaseUrl(event);
    if (!baseUrl) {
      throw new Error('Unable to resolve base URL for background dispatch.');
    }
    const backgroundPath = '/.netlify/functions/run-wcag-scan-background';
    const backgroundUrl = `${baseUrl}${backgroundPath}`;

    await triggerBackground(backgroundUrl, { jobId });

    return json(200, {
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
