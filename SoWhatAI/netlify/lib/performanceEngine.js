import {
  buildPerformanceReportFromPsi,
  createEmptyPerformanceReport,
  fetchPerformanceReport
} from './pageSpeedInsights.js';
import { sanitizeErrorMessage } from './psiClient.js';

async function runPerformanceEngine({
  startUrl,
  strategy = 'desktop',
  timeoutMs = 12000,
  psiPayload = null,
  psiFetchDurationMs = 0,
  psiStrategy = '',
  sharedPsiError = '',
  sharedPsiAttempted = false
} = {}) {
  try {
    if (sharedPsiAttempted && sharedPsiError) {
      const message = sanitizeErrorMessage(sharedPsiError);
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

    if (psiPayload && typeof psiPayload === 'object') {
      const report = buildPerformanceReportFromPsi(psiPayload, {
        startUrl,
        strategy: psiStrategy || strategy,
        fetchDurationMs: Number(psiFetchDurationMs) || 0,
        fetchedAt: new Date().toISOString()
      });
      return {
        status: 'success',
        data: report
      };
    }

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
