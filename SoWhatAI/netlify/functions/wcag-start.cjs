const { createJob, failJob } = require('./jobStore.cjs');

const BACKGROUND_PATH = '/.netlify/functions/run-wcag-scan-background';
const MIN_TIMEOUT_MS = 10000;
const MAX_TIMEOUT_MS = 25000;
const JOB_TTL_MS = 30 * 60 * 1000;

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
  return String(value ?? fallback).replace(/\s+/g, ' ').trim().slice(0, 320);
}

function normalizeInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.trunc(numeric);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseJsonBody(body) {
  if (!body) return {};
  if (typeof body === 'object') return body;
  if (typeof body !== 'string') return {};
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function getHeader(headers, key) {
  if (!headers || typeof headers !== 'object') return '';
  return String(headers[key] || headers[key.toLowerCase()] || headers[key.toUpperCase()] || '').trim();
}

function resolveRequestOrigin(event) {
  const headers = (event && event.headers) || {};
  const forwardedHost = getHeader(headers, 'x-forwarded-host');
  const host = forwardedHost || getHeader(headers, 'host');
  const proto = getHeader(headers, 'x-forwarded-proto') || 'https';
  if (host) return `${proto}://${host}`;
  const origin = getHeader(headers, 'origin');
  if (origin) {
    return origin.replace(/\/+$/, '');
  }
  const fromEnv = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL || '';
  return fromEnv.replace(/\/+$/, '');
}

function buildJobId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return `wcag_${globalThis.crypto.randomUUID()}`;
  }
  return `wcag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizePayload(input) {
  const startUrl = String(input.startUrl || '').trim();
  const mode = String(input.mode || 'single').toLowerCase() === 'crawl' ? 'crawl' : 'single';
  const requestedMaxPages = normalizeInteger(input.maxPages, 1);
  const maxPages = mode === 'crawl' ? clamp(requestedMaxPages || 1, 1, 10) : 1;
  const requestedTimeout = normalizeInteger(input.timeoutMs, MAX_TIMEOUT_MS);
  const timeoutMs = clamp(requestedTimeout || MAX_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const includeScreenshots = Boolean(input.includeScreenshots);

  return {
    startUrl,
    mode,
    maxPages,
    timeoutMs,
    includeScreenshots
  };
}

async function triggerBackground(jobId, event, onFailure) {
  const fetchImpl = global.fetch;
  if (typeof fetchImpl !== 'function') return;

  const origin = resolveRequestOrigin(event);
  const url = origin ? new URL(BACKGROUND_PATH, origin).toString() : null;
  if (!url) {
    console.warn('[wcag-start] could not resolve origin, background trigger skipped.');
    if (typeof onFailure === 'function') await onFailure().catch(() => {});
    return;
  }
  try {
    await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId })
    });
  } catch (error) {
    console.warn('[wcag-start] background trigger failed', sanitizeText(error && error.message, 'Unknown error.'));
    if (typeof onFailure === 'function') await onFailure().catch(() => {});
  }
}

async function handler(event, context) {
  if (context && typeof context === 'object') {
    context.callbackWaitsForEmptyEventLoop = false;
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'method_not_allowed', message: 'POST is required.' });
  }

  const body = parseJsonBody(event.body);
  const payload = normalizePayload(body);

  if (!payload.startUrl) {
    return json(400, { error: 'validation_error', message: 'startUrl is required.' });
  }
  if (!isValidHttpUrl(payload.startUrl)) {
    return json(400, { error: 'validation_error', message: 'startUrl must use http:// or https://.' });
  }

  const jobId = buildJobId();
  const now = Date.now();
  const pollUrl = `/.netlify/functions/wcag-status?jobId=${encodeURIComponent(jobId)}`;

  try {
    await createJob({
      jobId,
      status: 'queued',
      progress: { percent: 0, message: 'Queued' },
      payload,
      result: null,
      error: null,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      completedAt: null,
      expiresAt: new Date(now + JOB_TTL_MS).toISOString()
    });
  } catch (error) {
    return json(500, {
      error: 'job_create_failed',
      message: sanitizeText(error && error.message, 'Unable to create WCAG job.')
    });
  }

  await triggerBackground(jobId, event, async () => {
    if (typeof failJob === 'function') {
      await failJob(jobId, {
        code: 'background_trigger_failed',
        message: 'Background scan trigger failed.'
      });
    }
  });

  return json(202, {
    jobId,
    status: 'queued',
    pollUrl
  });
}

exports.handler = handler;
module.exports.handler = handler;
