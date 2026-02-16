const DEFAULT_POLL_INTERVAL_MS = 1500;

function sanitizeErrorMessage(value, fallback = 'WCAG scan failed.') {
  return String(value || fallback).replace(/\s+/g, ' ').trim();
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve();
    }, ms);

    let onAbort = null;
    if (!signal) return;
    if (signal.aborted) {
      clearTimeout(timeoutId);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }
    onAbort = () => {
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', onAbort);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function startWcagScan(payload, { signal } = {}) {
  const response = await fetch('/.netlify/functions/wcag-start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) {
    const message = data?.error?.message || data?.error || data?.message || `WCAG start failed (${response.status})`;
    throw new Error(sanitizeErrorMessage(message));
  }
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid wcag-start payload.');
  }
  if (String(data.status || '').toLowerCase() === 'failed') {
    const message = data?.error?.message || data?.message || 'Unable to queue WCAG scan.';
    throw new Error(sanitizeErrorMessage(message));
  }
  if (!data.jobId) {
    throw new Error('wcag-start did not return jobId.');
  }
  return data;
}

export async function getWcagStatus(jobId, { signal } = {}) {
  const response = await fetch(`/.netlify/functions/wcag-status?jobId=${encodeURIComponent(jobId)}`, {
    method: 'GET',
    signal
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    const message = data?.error?.message || data?.error || data?.message || `WCAG status failed (${response.status})`;
    throw new Error(sanitizeErrorMessage(message));
  }
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid wcag-status payload.');
  }
  return data;
}

export async function runWcagScan(
  payload,
  {
    signal,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    onProgress
  } = {}
) {
  const requestPayload = {
    startUrl: payload?.startUrl || payload?.url || '',
    mode: payload?.mode,
    maxPages: payload?.maxPages,
    includeScreenshots: payload?.includeScreenshots,
    timeoutMs: payload?.timeoutMs,
    runPsi: payload?.runPsi,
    psiStrategy: payload?.psiStrategy,
    includePerformanceAudit: payload?.includePerformanceAudit
  };

  const started = await startWcagScan(requestPayload, { signal });
  const jobId = String(started.jobId);
  const interval = Math.max(750, Math.floor(Number(pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS));

  if (typeof onProgress === 'function') {
    onProgress({
      jobId,
      status: String(started.status || 'queued').toLowerCase(),
      progress: {
        percent: 0,
        message: 'Queued'
      }
    });
  }

  while (true) {
    if (signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }

    await delay(interval, signal);
    const statusPayload = await getWcagStatus(jobId, { signal });
    const status = String(statusPayload?.status || 'queued').toLowerCase();

    if (typeof onProgress === 'function') {
      onProgress({
        ...statusPayload,
        jobId
      });
    }

    if (status === 'complete') {
      if (!statusPayload.result) {
        throw new Error('WCAG scan completed but no result payload was returned.');
      }
      return statusPayload.result;
    }

    if (status === 'failed') {
      const message = sanitizeErrorMessage(
        statusPayload?.error?.message || statusPayload?.progress?.message || 'WCAG scan failed.'
      );
      throw new Error(message);
    }
  }
}
