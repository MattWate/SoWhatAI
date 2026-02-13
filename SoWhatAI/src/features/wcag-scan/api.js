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

export async function capturePage(payload, { signal } = {}) {
  const response = await fetch('/.netlify/functions/capture-page', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal
  });

  const data = await parseJsonSafe(response);

  if (!response.ok) {
    const message = data?.error || `Capture request failed (${response.status})`;
    throw new Error(sanitizeErrorMessage(message));
  }

  if (String(data?.status || '').toLowerCase() === 'failed') {
    throw new Error(
      sanitizeErrorMessage(
        data?.error?.message || data?.message || 'Unable to capture page snapshot.'
      )
    );
  }

  if (!data?.snapshotId) {
    throw new Error('Capture did not return snapshotId.');
  }

  return data;
}

export async function triggerSnapshotAnalysis(snapshotId, options = {}, { signal } = {}) {
  const response = await fetch('/.netlify/functions/analyze-snapshot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ snapshotId, options }),
    signal
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) {
    const message = data?.error || `Analyze request failed (${response.status})`;
    throw new Error(sanitizeErrorMessage(message));
  }

  if (String(data?.status || '').toLowerCase() === 'failed') {
    throw new Error(
      sanitizeErrorMessage(
        data?.error?.message || data?.message || 'Unable to queue snapshot analysis.'
      )
    );
  }

  return data;
}

export async function getSnapshotStatus(snapshotId, { signal } = {}) {
  const response = await fetch(
    `/.netlify/functions/snapshot-status?snapshotId=${encodeURIComponent(snapshotId)}`,
    { method: 'GET', signal }
  );
  const data = await parseJsonSafe(response);

  if (!response.ok) {
    const message = data?.error || `Snapshot status failed (${response.status})`;
    throw new Error(sanitizeErrorMessage(message));
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Invalid snapshot-status payload.');
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
  const capturePayload = {
    url: payload?.startUrl || payload?.url || '',
    timeoutMs: payload?.timeoutMs,
    options: {
      includeBestPracticeHints: payload?.includeBestPracticeHints !== false
    }
  };
  const started = await capturePage(capturePayload, { signal });
  const snapshotId = started.snapshotId;
  const interval = Math.max(750, Math.floor(Number(pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS));
  let enqueueRetryAttempted = false;

  if (typeof onProgress === 'function') {
    onProgress({
      jobId: snapshotId,
      snapshotId,
      status: started.status || 'captured',
      progress: {
        percent: 12,
        message: 'Snapshot captured.'
      }
    });
  }

  // Ensure analysis is queued even if capture endpoint auto-dispatch was delayed.
  await triggerSnapshotAnalysis(snapshotId, capturePayload.options, { signal }).catch(() => {});

  while (true) {
    if (signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }

    await delay(interval, signal);
    const statusPayload = await getSnapshotStatus(snapshotId, { signal });
    const status = String(statusPayload?.status || 'captured').toLowerCase();

    if (typeof onProgress === 'function') {
      onProgress({
        ...statusPayload,
        jobId: snapshotId
      });
    }

    if (status === 'complete') {
      if (!statusPayload.result) {
        throw new Error('Snapshot analysis completed but no result payload was returned.');
      }
      return statusPayload.result;
    }

    if (status === 'failed') {
      const message = sanitizeErrorMessage(
        statusPayload?.error?.message || statusPayload?.progress?.message || 'Snapshot analysis failed.'
      );
      throw new Error(message);
    }

    if (status === 'captured' && !enqueueRetryAttempted) {
      enqueueRetryAttempted = true;
      // Defensive: if capture completed but background queueing was delayed, retry enqueue once.
      await triggerSnapshotAnalysis(snapshotId, capturePayload.options, { signal }).catch(() => {});
    }
  }
}
