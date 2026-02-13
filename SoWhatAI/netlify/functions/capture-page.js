const crypto = require('crypto');
const { saveSnapshot, updateStatus } = require('./snapshotStore.js');

const DEFAULT_TIMEOUT_MS = 8000;
const MIN_TIMEOUT_MS = 1500;
const MAX_TIMEOUT_MS = 15000;
const MAX_HTML_BYTES = 2.5 * 1024 * 1024;
const BACKGROUND_TRIGGER_TIMEOUT_MS = 1200;

const RESPONSE_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};

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

function clampTimeout(timeoutMs) {
  const numeric = Number(timeoutMs);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.floor(numeric)));
}

function generateSnapshotId() {
  if (typeof crypto.randomUUID === 'function') {
    return `snap_${crypto.randomUUID()}`;
  }
  return `snap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
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

function isHtmlContentType(contentType) {
  const value = String(contentType || '').toLowerCase();
  return value.includes('text/html') || value.includes('application/xhtml+xml');
}

function pickHeadersSubset(headers) {
  if (!headers || typeof headers.get !== 'function') return {};
  return {
    contentType: sanitizeText(headers.get('content-type') || ''),
    contentLanguage: sanitizeText(headers.get('content-language') || ''),
    cacheControl: sanitizeText(headers.get('cache-control') || ''),
    contentEncoding: sanitizeText(headers.get('content-encoding') || '')
  };
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

async function triggerBackgroundAnalyze(url, payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BACKGROUND_TRIGGER_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (!response.ok) {
      const message = sanitizeText(body?.error || body?.message || `Analyze trigger failed (${response.status}).`);
      throw new Error(message);
    }

    return body || null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchHtmlSnapshot(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'SoWhatAI-Snapshot/1.0 (+https://sowhatai.app)'
      }
    });

    const finalUrl = normalizeHttpUrl(response.url) || url;
    const contentType = String(response.headers.get('content-type') || '');
    const headersSubset = pickHeadersSubset(response.headers);

    if (!response.ok) {
      return {
        ok: false,
        code: 'http_error',
        message: `Capture failed with HTTP ${response.status}.`,
        details: {
          finalUrl,
          statusCode: response.status,
          contentType
        }
      };
    }

    if (!isHtmlContentType(contentType)) {
      return {
        ok: false,
        code: 'non_html_content',
        message: `Captured content is not HTML (content-type: ${contentType || 'unknown'}).`,
        details: {
          finalUrl,
          statusCode: response.status,
          contentType
        }
      };
    }

    const html = await response.text();
    if (!html || !html.trim()) {
      return {
        ok: false,
        code: 'empty_html',
        message: 'Captured HTML was empty.',
        details: {
          finalUrl,
          statusCode: response.status,
          contentType
        }
      };
    }

    if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
      return {
        ok: false,
        code: 'snapshot_too_large',
        message: `Captured HTML exceeds ${Math.round(MAX_HTML_BYTES / 1024)}KB limit.`,
        details: {
          finalUrl,
          statusCode: response.status,
          contentType
        }
      };
    }

    return {
      ok: true,
      finalUrl,
      statusCode: response.status,
      contentType,
      headersSubset,
      html
    };
  } catch (error) {
    const isTimeout = error && error.name === 'AbortError';
    return {
      ok: false,
      code: isTimeout ? 'capture_timeout' : 'capture_network_error',
      message: isTimeout
        ? `Capture timed out after ${timeoutMs}ms.`
        : sanitizeText(error?.message || String(error), 'Failed to fetch page for capture.')
    };
  } finally {
    clearTimeout(timeoutId);
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

  const url = normalizeHttpUrl(body.url || body.startUrl);
  if (!url) {
    return json(400, { error: 'url must be a valid http/https URL.' });
  }

  const timeoutMs = clampTimeout(body.timeoutMs);
  const includeBestPracticeHints = body?.options?.includeBestPracticeHints !== false;

  try {
    const capturedAt = new Date().toISOString();
    const snapshotId = generateSnapshotId();

    const captured = await fetchHtmlSnapshot(url, timeoutMs);
    if (!captured.ok) {
      return json(200, {
        status: 'failed',
        error: {
          code: captured.code || 'capture_failed',
          message: sanitizeText(captured.message || 'Unable to capture page snapshot.')
        }
      });
    }

    await saveSnapshot({
      snapshotId,
      url,
      finalUrl: captured.finalUrl,
      html: captured.html,
      capturedAt,
      statusCode: captured.statusCode,
      contentType: captured.contentType,
      headersSubset: captured.headersSubset,
      status: 'captured',
      progress: { percent: 12, message: 'Snapshot captured.' }
    });

    let analysisQueued = false;
    let queueWarning = null;
    const baseUrl = resolveBaseUrl(event);

    if (baseUrl) {
      try {
        await triggerBackgroundAnalyze(`${baseUrl}/.netlify/functions/analyze-snapshot-background`, {
          snapshotId,
          options: {
            includeBestPracticeHints
          }
        });
        analysisQueued = true;
      } catch (queueError) {
        queueWarning = sanitizeText(
          queueError?.message || String(queueError),
          'Snapshot captured, but automatic analysis queueing was delayed.'
        );
        console.warn('[capture-page] analyze queue trigger failed', { snapshotId, message: queueWarning });
      }
    } else {
      queueWarning = 'Snapshot captured, but automatic analysis queueing was delayed.';
      console.warn('[capture-page] unable to resolve base URL for analyze queue', { snapshotId });
    }

    await updateStatus(snapshotId, {
      status: 'captured',
      progress: {
        percent: analysisQueued ? 16 : 12,
        message: analysisQueued
          ? 'Snapshot captured. Analysis queued.'
          : 'Snapshot captured. Awaiting analysis queue.'
      },
      error: null
    }).catch(() => {});

    return json(200, {
      snapshotId,
      status: 'captured',
      capturedAt,
      analysisQueued,
      queueWarning
    });
  } catch (error) {
    return json(200, {
      status: 'failed',
      error: {
        code: 'capture_failed',
        message: sanitizeText(error?.message || String(error), 'Unable to capture page snapshot.')
      }
    });
  }
};
