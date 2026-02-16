let legacyStatusHandler = null;

try {
  const legacyModule = require('./wcag-scan-status.js');
  if (legacyModule && typeof legacyModule.handler === 'function') {
    legacyStatusHandler = legacyModule.handler;
  }
} catch (error) {
  console.error('[wcag-status] unable to load wcag-scan-status handler', {
    message: String(error && error.message ? error.message : error)
  });
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  };
}

async function handler(event, context) {
  if (typeof legacyStatusHandler === 'function') {
    return legacyStatusHandler(event, context);
  }

  return json(200, {
    jobId: String(event?.queryStringParameters?.jobId || '').trim(),
    status: 'failed',
    progress: {
      percent: 100,
      message: 'Status handler unavailable.'
    },
    result: null,
    error: {
      code: 'status_handler_unavailable',
      message: 'WCAG status handler is unavailable.'
    }
  });
}

exports.handler = handler;
module.exports.handler = handler;
