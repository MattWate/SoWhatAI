const { getAnalysis } = require('./snapshotStore.js');

const RESPONSE_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS'
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

function normalizeStatus(value) {
  const status = String(value || '').toLowerCase();
  if (status === 'captured' || status === 'running' || status === 'complete' || status === 'failed') {
    return status;
  }
  return 'captured';
}

function normalizeProgress(progress) {
  const source = progress && typeof progress === 'object' ? progress : {};
  const percentValue = Number(source.percent);
  return {
    percent: Number.isFinite(percentValue) ? Math.max(0, Math.min(100, Math.round(percentValue))) : 0,
    message: sanitizeText(source.message, 'Snapshot captured.')
  };
}

function normalizeError(error) {
  if (!error) return null;
  if (typeof error === 'string') {
    return { message: sanitizeText(error) };
  }
  const message = sanitizeText(error.message || error.error || 'Unknown error.');
  const code = sanitizeText(error.code || '', '');
  return code ? { code, message } : { message };
}

exports.handler = async (event, context) => {
  if (context && typeof context === 'object') {
    context.callbackWaitsForEmptyEventLoop = false;
  }

  if (event.httpMethod === 'OPTIONS') {
    return json(200, { ok: true });
  }

  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method Not Allowed' });
  }

  const query = event.queryStringParameters || {};
  const snapshotId = String(query.snapshotId || '').trim();
  if (!snapshotId) {
    return json(400, { error: 'snapshotId is required.' });
  }

  try {
    const analysis = await getAnalysis(snapshotId);
    if (!analysis) {
      return json(200, {
        snapshotId,
        status: 'failed',
        progress: {
          percent: 100,
          message: 'Snapshot not found or expired.'
        },
        result: null,
        error: {
          code: 'snapshot_not_found',
          message: 'Snapshot not found or expired.'
        }
      });
    }

    const status = normalizeStatus(analysis.status);
    const progress = normalizeProgress(analysis.progress);
    const result = status === 'complete' ? (analysis.result ?? null) : null;
    const error = status === 'failed' ? normalizeError(analysis.error) : null;

    return json(200, {
      snapshotId,
      status,
      progress,
      result,
      error
    });
  } catch (error) {
    return json(200, {
      snapshotId,
      status: 'failed',
      progress: {
        percent: 100,
        message: 'Unable to load snapshot status.'
      },
      result: null,
      error: {
        code: 'status_lookup_failed',
        message: sanitizeText(error?.message || String(error), 'Unable to load snapshot status.')
      }
    });
  }
};
