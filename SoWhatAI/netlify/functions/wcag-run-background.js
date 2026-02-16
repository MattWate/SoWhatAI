const { handler: runWcagScanHandler } = require('./wcag-run.js');

exports.handler = async (event, context) => {
  if (context && typeof context === 'object') {
    context.callbackWaitsForEmptyEventLoop = false;
  }
  return runWcagScanHandler(event, context);
};
