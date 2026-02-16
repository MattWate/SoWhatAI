const { handler: wcagStartHandler } = require('./wcag-start.js');

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  };
}

function getHeader(headers, key) {
  if (!headers || typeof headers !== 'object') return '';
  return String(headers[key] || headers[key.toLowerCase()] || headers[key.toUpperCase()] || '').trim();
}

function isBrowserRequest(event) {
  const headers = (event && event.headers) || {};
  const secFetchMode = getHeader(headers, 'sec-fetch-mode');
  const secFetchSite = getHeader(headers, 'sec-fetch-site');
  const origin = getHeader(headers, 'origin');
  const referer = getHeader(headers, 'referer');
  const userAgent = getHeader(headers, 'user-agent');

  if (secFetchMode || secFetchSite || origin || referer) return true;
  if (/\bmozilla\/\d/i.test(userAgent)) return true;
  return false;
}

exports.handler = async (event, context) => {
  if (isBrowserRequest(event)) {
    return json(410, {
      error: 'deprecated',
      message: 'Use wcag-start + wcag-status instead'
    });
  }
  return wcagStartHandler(event, context);
};
