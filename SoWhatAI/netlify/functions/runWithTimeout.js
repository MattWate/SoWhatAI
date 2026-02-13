const DEFAULT_TIMEOUT_MS = 10000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 60000;

function clampTimeout(timeoutMs, fallbackMs = DEFAULT_TIMEOUT_MS) {
  const fallback = Number.isFinite(Number(fallbackMs))
    ? Math.floor(Number(fallbackMs))
    : DEFAULT_TIMEOUT_MS;
  const numeric = Number(timeoutMs);
  const value = Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, value));
}

function sanitizeErrorMessage(error) {
  const text = error?.message || String(error || 'Unknown error');
  return String(text).replace(/\s+/g, ' ').trim().slice(0, 260);
}

async function runWithTimeout(promise, timeoutMs, label = 'operation') {
  const safeTimeoutMs = clampTimeout(timeoutMs, DEFAULT_TIMEOUT_MS);
  const safeLabel = String(label || 'operation');

  let timeoutId;
  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      resolve({
        status: 'timeout',
        timedOut: true,
        error: 'timeout',
        label: safeLabel,
        timeoutMs: safeTimeoutMs,
        message: `${safeLabel} timed out after ${safeTimeoutMs}ms.`
      });
    }, safeTimeoutMs);
  });

  const taskPromise = Promise.resolve(promise)
    .then((value) => ({
      status: 'success',
      timedOut: false,
      value
    }))
    .catch((error) => ({
      status: 'error',
      timedOut: false,
      error,
      label: safeLabel,
      message: sanitizeErrorMessage(error)
    }))
    .finally(() => {
      clearTimeout(timeoutId);
    });

  return Promise.race([taskPromise, timeoutPromise]);
}

export { runWithTimeout };
