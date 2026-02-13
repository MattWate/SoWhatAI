const { handler: startWcagScanHandler } = require('./start-wcag-scan.js');

// Backward-compatible alias: wcag-only now starts an async scan job and returns job metadata.
exports.handler = startWcagScanHandler;
