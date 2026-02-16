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
  return String(value ?? fallback).replace(/\s+/g, ' ').trim().slice(0, 320);
}

function normalizeStatus(value) {
  const status = String(value || '').toLowerCase();
  if (status === 'queued' || status === 'running' || status === 'complete' || status === 'failed') {
    return status;
  }
  return 'queued';
}

function normalizeProgress(progress) {
  const source = progress && typeof progress === 'object' ? progress : {};
  const percent = Number.isFinite(Number(source.percent))
    ? Math.max(0, Math.min(100, Math.round(Number(source.percent))))
    : 0;
  const message = sanitizeText(source.message, 'Queued');
  return { percent, message };
}

function normalizeError(error) {
  if (!error) return null;
  if (typeof error === 'string') {
    return { message: sanitizeText(error, 'Unknown error.') };
  }
  const message = sanitizeText(error.message || error.error, 'Unknown error.');
  const code = sanitizeText(error.code, '');
  return code ? { code, message } : { message };
}

function notFoundPayload(jobId) {
  return {
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
  };
}

exports.handler = async (event, context) => {
  if (context && typeof context === 'object') {
    context.callbackWaitsForEmptyEventLoop = false;
  }

  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'method_not_allowed', message: 'GET is required.' });
  }

  const query = event.queryStringParameters || {};
  const jobId = sanitizeText(query.jobId, '');
  if (!jobId) {
    return json(400, { error: 'validation_error', message: 'jobId is required.' });
  }

  try {
    const job = await getJob(jobId);
    if (!job) {
      return json(200, notFoundPayload(jobId));
    }

    const status = normalizeStatus(job.status);
    return json(200, {
      jobId,
      status,
      progress: normalizeProgress(job.progress),
      result: status === 'complete' ? (job.result ?? null) : null,
      error: status === 'failed' ? normalizeError(job.error) : null
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
        message: sanitizeText(error && error.message, 'Unable to load job status.')
      }
    });
  }
};
