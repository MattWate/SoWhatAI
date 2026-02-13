const JOB_STORE_NAME = 'wcag-scan-jobs-v1';
const JOB_KEY_PREFIX = 'job:';
const JOB_TTL_MS = 30 * 60 * 1000;
const MAX_ERROR_LENGTH = 280;

// Local-development fallback only. In Netlify runtime we require Blobs.
const memoryStore = (() => {
  const key = '__SOWHATAI_WCAG_JOB_STORE_V1__';
  if (!globalThis[key]) {
    globalThis[key] = new Map();
  }
  return globalThis[key];
})();

let blobStorePromise = null;
let fallbackWarningShown = false;

function nowIso() {
  return new Date().toISOString();
}

function toDateIso(value, fallbackMs) {
  if (!value) {
    return new Date(fallbackMs).toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(fallbackMs).toISOString();
  }
  return parsed.toISOString();
}

function sanitizeText(value, fallback = '') {
  const text = String(value || fallback).replace(/\s+/g, ' ').trim();
  return text.slice(0, MAX_ERROR_LENGTH);
}

function sanitizeProgress(progress, existing) {
  const previous = existing && typeof existing === 'object' ? existing : {};
  const percentValue = Number(progress && progress.percent);
  const percent = Number.isFinite(percentValue)
    ? Math.max(0, Math.min(100, Math.round(percentValue)))
    : Number.isFinite(Number(previous.percent))
      ? Math.max(0, Math.min(100, Math.round(Number(previous.percent))))
      : 0;
  const message = sanitizeText(progress && progress.message, previous.message || '');
  return { percent, message };
}

function sanitizeError(error) {
  if (!error) return null;
  if (typeof error === 'string') {
    return { message: sanitizeText(error, 'Unknown error.') };
  }
  const message = sanitizeText(error.message || error.error || 'Unknown error.');
  const code = sanitizeText(error.code || '', '');
  return code ? { code, message } : { message };
}

function withDefaults(jobId, record, fallbackPayload = null) {
  const nowMs = Date.now();
  const base = record && typeof record === 'object' ? record : {};
  const createdAt = toDateIso(base.createdAt, nowMs);
  const updatedAt = toDateIso(base.updatedAt, nowMs);
  const expiresAt = toDateIso(base.expiresAt, nowMs + JOB_TTL_MS);
  return {
    jobId,
    status: sanitizeText(base.status, 'queued') || 'queued',
    progress: sanitizeProgress(base.progress, null),
    payload: base.payload != null ? base.payload : fallbackPayload,
    result: base.result ?? null,
    error: sanitizeError(base.error),
    createdAt,
    updatedAt,
    completedAt: base.completedAt ? toDateIso(base.completedAt, nowMs) : null,
    expiresAt
  };
}

function stripPayload(job) {
  if (!job) return null;
  const { payload, ...rest } = job;
  return rest;
}

function isExpired(job) {
  if (!job || !job.expiresAt) return false;
  const expiry = new Date(job.expiresAt).getTime();
  if (!Number.isFinite(expiry)) return false;
  return Date.now() > expiry;
}

function jobKey(jobId) {
  return `${JOB_KEY_PREFIX}${String(jobId || '').trim()}`;
}

function toRawText(raw) {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw;
  if (raw instanceof Uint8Array) {
    try {
      return new TextDecoder().decode(raw);
    } catch {
      return '';
    }
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw)) {
    return raw.toString('utf8');
  }
  if (typeof raw === 'object' && typeof raw.toString === 'function') {
    const text = raw.toString();
    return typeof text === 'string' ? text : '';
  }
  return '';
}

async function getBlobStore() {
  if (blobStorePromise) return blobStorePromise;

  blobStorePromise = (async () => {
    try {
      const module = await import('@netlify/blobs');
      const getStore =
        (module && typeof module.getStore === 'function' && module.getStore) ||
        (module && module.default && typeof module.default.getStore === 'function' && module.default.getStore);
      if (typeof getStore !== 'function') {
        throw new Error('getStore not available from @netlify/blobs.');
      }
      return getStore(JOB_STORE_NAME);
    } catch (error) {
      if (process.env.NETLIFY) {
        throw new Error(
          `Netlify Blobs is required in production jobStore. ${sanitizeText(error && error.message)}`
        );
      }
      if (!fallbackWarningShown) {
        fallbackWarningShown = true;
        console.warn(
          '[jobStore] Netlify Blobs unavailable, using in-memory local dev fallback.',
          sanitizeText(error && error.message)
        );
      }
      return null;
    }
  })();

  return blobStorePromise;
}

async function writeRecord(jobId, record) {
  const key = jobKey(jobId);
  const normalized = withDefaults(jobId, record);
  const store = await getBlobStore();
  if (store) {
    await store.set(key, JSON.stringify(normalized));
  } else {
    memoryStore.set(key, normalized);
  }
  return normalized;
}

async function deleteRecord(jobId) {
  const key = jobKey(jobId);
  const store = await getBlobStore();
  if (store) {
    await store.delete(key);
  }
  memoryStore.delete(key);
}

async function readRecord(jobId) {
  const key = jobKey(jobId);
  let raw = null;
  const store = await getBlobStore();

  if (store) {
    try {
      raw = await store.get(key);
    } catch {
      raw = null;
    }
  }

  if (!raw) {
    const fromMemory = memoryStore.get(key);
    if (!fromMemory) return null;
    const memoryRecord = withDefaults(jobId, fromMemory);
    if (isExpired(memoryRecord)) {
      memoryStore.delete(key);
      return null;
    }
    return memoryRecord;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(toRawText(raw));
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = withDefaults(jobId, parsed);
  if (isExpired(record)) {
    await deleteRecord(jobId);
    return null;
  }
  return record;
}

function buildBaseJob(jobId, payload) {
  const now = Date.now();
  return {
    jobId,
    status: 'queued',
    progress: {
      percent: 0,
      message: 'Queued for processing.'
    },
    payload: payload || null,
    result: null,
    error: null,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    completedAt: null,
    expiresAt: new Date(now + JOB_TTL_MS).toISOString()
  };
}

function mergeJob(existing, patch) {
  const now = Date.now();
  const merged = withDefaults(existing.jobId, existing);

  if (patch && typeof patch === 'object') {
    if (patch.status != null) {
      merged.status = sanitizeText(patch.status, merged.status) || merged.status;
    }
    if (patch.progress != null) {
      merged.progress = sanitizeProgress(patch.progress, merged.progress);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'payload')) {
      merged.payload = patch.payload;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'result')) {
      merged.result = patch.result;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'error')) {
      merged.error = sanitizeError(patch.error);
    }
    if (patch.completedAt) {
      merged.completedAt = toDateIso(patch.completedAt, now);
    }
    if (patch.expiresAt) {
      merged.expiresAt = toDateIso(patch.expiresAt, now + JOB_TTL_MS);
    } else if (patch.extendTtl !== false) {
      merged.expiresAt = new Date(now + JOB_TTL_MS).toISOString();
    }
  }

  merged.updatedAt = new Date(now).toISOString();
  return merged;
}

async function createJob(jobId, payload) {
  const normalizedId = String(jobId || '').trim();
  if (!normalizedId) {
    throw new Error('jobId is required.');
  }
  const base = buildBaseJob(normalizedId, payload);
  const saved = await writeRecord(normalizedId, base);
  return stripPayload(saved);
}

async function updateJob(jobId, patch) {
  const normalizedId = String(jobId || '').trim();
  if (!normalizedId) {
    throw new Error('jobId is required.');
  }
  const existing = await readRecord(normalizedId);
  if (!existing) return null;
  const merged = mergeJob(existing, patch || {});
  const saved = await writeRecord(normalizedId, merged);
  return stripPayload(saved);
}

async function getJob(jobId, options = {}) {
  const normalizedId = String(jobId || '').trim();
  if (!normalizedId) return null;
  const job = await readRecord(normalizedId);
  if (!job) return null;
  return options.includePayload ? job : stripPayload(job);
}

async function completeJob(jobId, result) {
  const normalizedId = String(jobId || '').trim();
  if (!normalizedId) {
    throw new Error('jobId is required.');
  }
  const completedAt = nowIso();
  const updated = await updateJob(normalizedId, {
    status: 'complete',
    progress: { percent: 100, message: 'Scan completed.' },
    result,
    error: null,
    completedAt
  });
  return updated;
}

async function failJob(jobId, error) {
  const normalizedId = String(jobId || '').trim();
  if (!normalizedId) {
    throw new Error('jobId is required.');
  }
  const completedAt = nowIso();
  const updated = await updateJob(normalizedId, {
    status: 'failed',
    progress: { percent: 100, message: 'Scan failed.' },
    error: sanitizeError(error),
    completedAt
  });
  return updated;
}

module.exports = {
  JOB_TTL_MS,
  createJob,
  updateJob,
  getJob,
  completeJob,
  failJob
};
