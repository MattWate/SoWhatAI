const { getJob } = require('./jobStore.js');

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
  return String(value || fallback).replace(/\s+/g, ' ').trim().slice(0, 280);
}

function normalizeStatus(value) {
  const raw = String(value || '').toLowerCase();
  if (raw === 'running' || raw === 'complete' || raw === 'failed' || raw === 'queued') {
    return raw;
  }
  return 'queued';
}

function normalizeProgress(progress) {
  const source = progress && typeof progress === 'object' ? progress : {};
  const percentValue = Number(source.percent);
  const percent = Number.isFinite(percentValue) ? Math.max(0, Math.min(100, Math.round(percentValue))) : 0;
  const message = sanitizeText(source.message, 'Queued for processing.');
  return { percent, message };
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

  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method Not Allowed' });
  }

  const query = event.queryStringParameters || {};
  const jobId = String(query.jobId || '').trim();
  if (!jobId) {
    return json(400, { error: 'jobId is required.' });
  }

  try {
    const job = await getJob(jobId);
    if (!job) {
      return json(200, {
        jobId,
        status: 'failed',
        progress: {
          percent: 100,
          message: 'Job not found or expired.'
        },
        result: null,
        error: {
          code: 'job_not_found',
          message: 'Job not found or expired.'
        }
      });
    }

    const status = normalizeStatus(job.status);
    const progress = normalizeProgress(job.progress);
    const result = status === 'complete' ? (job.result ?? null) : null;
    const error = status === 'failed' ? normalizeError(job.error) : null;

    return json(200, {
      jobId,
      status,
      progress,
      result,
      error
    });
  } catch (error) {
    return json(200, {
      jobId,
      status: 'failed',
      progress: {
        percent: 100,
        message: 'Unable to load job status.'
      },
      result: null,
      error: {
        code: 'status_lookup_failed',
        message: sanitizeText(error?.message || String(error), 'Unable to load job status.')
      }
    });
  }
};
