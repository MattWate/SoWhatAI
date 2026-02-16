const DEFAULT_POLL_INTERVAL_MS = 1500;

function sanitizeErrorMessage(value, fallback = 'WCAG scan failed.') {
  return String(value || fallback).replace(/\s+/g, ' ').trim();
}

function parseJsonSafe(response) {
  return response
    .json()
    .then((value) => value)
    .catch(() => null);
}

function toAbortError() {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(toAbortError());
      return;
    }

    const timeoutId = setTimeout(() => {
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve();
    }, ms);

    let onAbort = null;
    if (!signal) return;

    onAbort = () => {
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', onAbort);
      reject(toAbortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function extractErrorMessage(payload, fallback) {
  return sanitizeErrorMessage(
    payload?.error?.message ||
      payload?.error ||
      payload?.message ||
      fallback
  );
}

export async function startWcagScan(payload, { signal } = {}) {
  const response = await fetch('/.netlify/functions/wcag-start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
    signal
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(extractErrorMessage(data, `Failed to start WCAG scan (${response.status}).`));
  }
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid wcag-start response payload.');
  }
  if (!data.jobId) {
    throw new Error('wcag-start did not return a jobId.');
  }

  return {
    jobId: String(data.jobId),
    status: String(data.status || 'queued').toLowerCase(),
    pollUrl: String(data.pollUrl || `/.netlify/functions/wcag-status?jobId=${encodeURIComponent(data.jobId)}`)
  };
}

export async function getWcagStatus(jobId, { signal } = {}) {
  const safeJobId = String(jobId || '').trim();
  if (!safeJobId) {
    throw new Error('jobId is required.');
  }

  const response = await fetch(`/.netlify/functions/wcag-status?jobId=${encodeURIComponent(safeJobId)}`, {
    method: 'GET',
    signal
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(extractErrorMessage(data, `Failed to fetch WCAG status (${response.status}).`));
  }
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid wcag-status response payload.');
  }

  return {
    jobId: String(data.jobId || safeJobId),
    status: String(data.status || 'queued').toLowerCase(),
    progress: data.progress && typeof data.progress === 'object'
      ? {
          percent: Number.isFinite(Number(data.progress.percent))
            ? Number(data.progress.percent)
            : 0,
          message: String(data.progress.message || '')
        }
      : { percent: 0, message: '' },
    result: data.result ?? null,
    error: data.error ?? null
  };
}

export async function runWcagScan(
  payload,
  {
    onProgress,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    signal
  } = {}
) {
  const intervalMs = Math.max(500, Math.floor(Number(pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS));
  const started = await startWcagScan(payload, { signal });

  if (typeof onProgress === 'function') {
    onProgress({
      jobId: started.jobId,
      status: started.status,
      progress: {
        percent: 0,
        message: 'Queued'
      },
      result: null,
      error: null
    });
  }

  while (true) {
    if (signal && signal.aborted) {
      throw toAbortError();
    }

    await delay(intervalMs, signal);
    const statusPayload = await getWcagStatus(started.jobId, { signal });
    const status = String(statusPayload.status || 'queued').toLowerCase();

    if (typeof onProgress === 'function') {
      onProgress(statusPayload);
    }

    if (status === 'complete') {
      return statusPayload.result || {};
    }

    if (status === 'failed') {
      const message = extractErrorMessage(
        statusPayload,
        statusPayload?.progress?.message || 'WCAG scan failed.'
      );
      throw new Error(message);
    }
  }
}
