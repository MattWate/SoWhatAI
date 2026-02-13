const { getSnapshot, updateStatus } = require('./snapshotStore.js');

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
      const message = sanitizeText(body?.error || body?.message || `Background trigger failed (${response.status}).`);
      throw new Error(message);
    }

    return body || null;
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

    if (snapshot.status === 'complete') {
      return json(200, {
        snapshotId,
        status: 'complete',
        progress: snapshot.progress || { percent: 100, message: 'Snapshot analysis complete.' }
      });
    }

    await updateStatus(snapshotId, {
      status: 'captured',
      progress: { percent: 14, message: 'Queued for snapshot analysis.' },
      error: null
    });

    const baseUrl = resolveBaseUrl(event);
    if (!baseUrl) {
      await updateStatus(snapshotId, {
        status: 'captured',
        progress: { percent: 14, message: 'Snapshot captured. Awaiting analysis queue.' },
        error: null
      });
      return json(200, {
        snapshotId,
        status: 'captured',
        queueWarning: 'Unable to queue snapshot analysis right now. Retry shortly.'
      });
    }

    try {
      await triggerBackgroundAnalyze(`${baseUrl}/.netlify/functions/analyze-snapshot-background`, {
        snapshotId,
        options: body.options || {}
      });
    } catch (queueError) {
      const message = sanitizeText(
        queueError?.message || String(queueError),
        'Unable to queue snapshot analysis right now.'
      );
      await updateStatus(snapshotId, {
        status: 'captured',
        progress: { percent: 14, message: 'Snapshot captured. Awaiting analysis queue.' },
        error: null
      }).catch(() => {});

      return json(200, {
        snapshotId,
        status: 'captured',
        queueWarning: message
      });
    }

    return json(200, {
      snapshotId,
      status: 'queued'
    });
  } catch (error) {
    const message = sanitizeText(error?.message || String(error), 'Unable to queue snapshot analysis.');
    await updateStatus(snapshotId, {
      status: 'failed',
      progress: { percent: 100, message: 'Unable to queue snapshot analysis.' },
      error: {
        code: 'queue_failed',
        message
      }
    }).catch(() => {});

    return json(200, {
      snapshotId,
      status: 'failed',
      error: {
        code: 'queue_failed',
        message
      }
    });
  }
};
