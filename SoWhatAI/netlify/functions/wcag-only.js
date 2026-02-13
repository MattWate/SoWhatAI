const { handler: capturePageHandler } = require('./capture-page.js');

// Backward compatibility: wcag-only now starts snapshot capture instead of synchronous live-site scanning.
exports.handler = capturePageHandler;
