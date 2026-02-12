import { createEmptyPerformanceReport, fetchPerformanceReport } from './pageSpeedInsights.js';
import { sanitizeErrorMessage } from './psiClient.js';

async function runPerformanceEngine({
  startUrl,
  strategy = 'desktop',
  timeoutMs = 12000
} = {}) {
  try {
    const report = await fetchPerformanceReport({
      startUrl,
      strategy,
      timeoutMs
    });

    if (report?.status === 'complete') {
      return {
        status: 'success',
        data: report
      };
    }

    const message = sanitizeErrorMessage(report?.error || 'Performance engine returned partial data.');
    return {
      status: 'failed',
      data: {
        ...report,
        error: message
      },
      error: message
    };
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    return {
      status: 'failed',
      data: createEmptyPerformanceReport({
        startUrl,
        strategy,
        error: message
      }),
      error: message
    };
  }
}

export { runPerformanceEngine };
