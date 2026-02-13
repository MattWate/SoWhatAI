const DEFAULT_POLL_INTERVAL_MS = 1500;

function sanitizeErrorMessage(value, fallback = 'WCAG scan failed.') {
  return String(value || fallback).replace(/\s+/g, ' ').trim();
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(resolve, ms);
    if (!signal) return;
    if (signal.aborted) {
      clearTimeout(timeoutId);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', onAbort);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
    }, ms + 20);
  });
}

export async function startWcagScan(payload, { signal } = {}) {
  const response = await fetch('/.netlify/functions/start-wcag-scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = data?.error || `Failed to start WCAG scan (${response.status})`;
    throw new Error(sanitizeErrorMessage(message));
  }

  if (!data?.jobId) {
    throw new Error('Failed to start WCAG scan job.');
  }

  return data;
}

export async function getWcagScanStatus(jobId, { signal } = {}) {
  const response = await fetch(
    `/.netlify/functions/wcag-scan-status?jobId=${encodeURIComponent(jobId)}`,
    {
      method: 'GET',
      signal
    }
  );

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = data?.error || `Failed to read WCAG scan status (${response.status})`;
    throw new Error(sanitizeErrorMessage(message));
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Invalid status payload from wcag-scan-status.');
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
  const started = await startWcagScan(payload, { signal });
  const jobId = started.jobId;
  const interval = Math.max(750, Math.floor(Number(pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS));

  if (typeof onProgress === 'function') {
    onProgress({
      jobId,
      status: started.status || 'queued',
      progress: {
        percent: 0,
        message: 'Queued for processing.'
      }
    });
  }

  if (String(started.status || '').toLowerCase() === 'failed') {
    throw new Error(
      sanitizeErrorMessage(
        started?.error?.message || 'WCAG scan job failed to start.'
      )
    );
  }

  while (true) {
    if (signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }

    await delay(interval, signal);
    const statusPayload = await getWcagScanStatus(jobId, { signal });
    const status = String(statusPayload?.status || 'queued').toLowerCase();

    if (typeof onProgress === 'function') {
      onProgress(statusPayload);
    }

    if (status === 'complete') {
      if (!statusPayload.result) {
        throw new Error('Scan completed but no result payload was returned.');
      }
      return statusPayload.result;
    }

    if (status === 'failed') {
      const message = sanitizeErrorMessage(
        statusPayload?.error?.message || statusPayload?.progress?.message || 'WCAG scan job failed.'
      );
      throw new Error(message);
    }
  }
}
