const { handler: runWcagScanHandler } = require('./run-wcag-scan.js');

// The background endpoint reuses the existing WCAG scan orchestration logic.
exports.handler = runWcagScanHandler;
