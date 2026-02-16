const { getJob, updateJob, completeJob, failJob } = require('./jobStore.js');
const { runWcagScan } = require('./wcagRunner.js');

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

function buildErrorPayload(error) {
  const message = sanitizeText(error && error.message, 'WCAG scan failed.');
  return {
    code: 'scan_failed',
    message
  };
}

exports.handler = async (event, context) => {
  if (context && typeof context === 'object') {
    context.callbackWaitsForEmptyEventLoop = false;
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'method_not_allowed', message: 'POST is required.' });
  }

  const body = parseJsonBody(event.body);
  const jobId = sanitizeText(body.jobId, '');

  if (!jobId) {
    return json(400, { error: 'validation_error', message: 'jobId is required.' });
  }

  const job = await getJob(jobId, { includePayload: true });
  if (!job) {
    return json(404, { error: 'job_not_found', message: 'Job not found or expired.' });
  }

  if (!job.payload || !job.payload.startUrl) {
    await failJob(jobId, {
      code: 'invalid_payload',
      message: 'Job payload is missing startUrl.'
    }).catch(() => {});
    return json(200, { jobId, status: 'failed' });
  }

  try {
    await updateJob(jobId, {
      status: 'running',
      progress: { percent: 1, message: 'Starting scan' },
      error: null
    });

    const result = await runWcagScan(job.payload, {
      onProgress: async (progress) => {
        await updateJob(jobId, {
          status: 'running',
          progress
        });
      }
    });

    await completeJob(jobId, result);

    return json(200, {
      jobId,
      status: 'complete'
    });
  } catch (error) {
    await failJob(jobId, buildErrorPayload(error)).catch(() => {});
    return json(200, {
      jobId,
      status: 'failed'
    });
  }
};
