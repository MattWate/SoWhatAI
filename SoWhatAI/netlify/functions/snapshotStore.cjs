const SNAPSHOT_STORE_NAME = 'wcag-snapshot-store-v1';
const SNAPSHOT_KEY_PREFIX = 'snapshot:';
const SNAPSHOT_TTL_MS = 30 * 60 * 1000;
const MAX_TEXT = 320;

// Local development fallback only. In Netlify runtime, Blobs is required.
const memoryStore = (() => {
  const key = '__SOWHATAI_SNAPSHOT_STORE_V1__';
  if (!globalThis[key]) {
    globalThis[key] = new Map();
  }
  return globalThis[key];
})();

let blobStorePromise = null;
let fallbackWarningShown = false;

function sanitizeText(value, fallback = '') {
  return String(value || fallback).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

function toIso(value, fallbackMs) {
  if (!value) return new Date(fallbackMs).toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date(fallbackMs).toISOString();
  return parsed.toISOString();
}

function snapshotKey(snapshotId) {
  return `${SNAPSHOT_KEY_PREFIX}${String(snapshotId || '').trim()}`;
}

function isLocalDevelopmentRuntime() {
  const context = String(process.env.CONTEXT || '').toLowerCase();
  const netlifyDev = String(process.env.NETLIFY_DEV || '').toLowerCase() === 'true';
  const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
  return context === 'dev' || netlifyDev || nodeEnv === 'development';
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

function normalizeProgress(progress, previous) {
  const prior = previous && typeof previous === 'object' ? previous : {};
  const percentValue = Number(progress && progress.percent);
  const percent = Number.isFinite(percentValue)
    ? Math.max(0, Math.min(100, Math.round(percentValue)))
    : Number.isFinite(Number(prior.percent))
      ? Math.max(0, Math.min(100, Math.round(Number(prior.percent))))
      : 0;
  const message = sanitizeText(progress && progress.message, prior.message || '');
  return { percent, message };
}

function normalizeError(error) {
  if (!error) return null;
  if (typeof error === 'string') {
    return { message: sanitizeText(error, 'Unknown error.') };
  }
  const message = sanitizeText(error.message || error.error || 'Unknown error.');
  const code = sanitizeText(error.code || '', '');
  return code ? { code, message } : { message };
}

function normalizeRecord(snapshotId, input = {}) {
  const now = Date.now();
  const base = input && typeof input === 'object' ? input : {};
  const createdAt = toIso(base.createdAt, now);
  const updatedAt = toIso(base.updatedAt, now);
  const expiresAt = toIso(base.expiresAt, now + SNAPSHOT_TTL_MS);

  return {
    snapshotId,
    status: sanitizeText(base.status, 'captured') || 'captured',
    progress: normalizeProgress(base.progress, null),
    url: sanitizeText(base.url, ''),
    finalUrl: sanitizeText(base.finalUrl, ''),
    statusCode: Number.isFinite(Number(base.statusCode)) ? Number(base.statusCode) : null,
    contentType: sanitizeText(base.contentType, ''),
    headersSubset:
      base.headersSubset && typeof base.headersSubset === 'object'
        ? base.headersSubset
        : {},
    html: typeof base.html === 'string' ? base.html : '',
    capturedAt: toIso(base.capturedAt, now),
    createdAt,
    updatedAt,
    finishedAt: base.finishedAt ? toIso(base.finishedAt, now) : null,
    result: base.result ?? null,
    error: normalizeError(base.error),
    expiresAt
  };
}

function stripHtml(record) {
  if (!record) return null;
  const { html, ...rest } = record;
  return rest;
}

function isExpired(record) {
  if (!record || !record.expiresAt) return false;
  const expiresAtMs = new Date(record.expiresAt).getTime();
  if (!Number.isFinite(expiresAtMs)) return false;
  return Date.now() > expiresAtMs;
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
      return getStore(SNAPSHOT_STORE_NAME);
    } catch (error) {
      if (process.env.NETLIFY && !isLocalDevelopmentRuntime()) {
        throw new Error(
          `Netlify Blobs is required in production snapshotStore. ${sanitizeText(error && error.message)}`
        );
      }
      if (!fallbackWarningShown) {
        fallbackWarningShown = true;
        console.warn(
          '[snapshotStore] Netlify Blobs unavailable, using in-memory local dev fallback.',
          sanitizeText(error && error.message)
        );
      }
      return null;
    }
  })();

  return blobStorePromise;
}

async function writeRecord(snapshotId, record) {
  const normalized = normalizeRecord(snapshotId, record);
  const key = snapshotKey(snapshotId);
  const store = await getBlobStore();
  if (store) {
    await store.set(key, JSON.stringify(normalized));
  } else {
    memoryStore.set(key, normalized);
  }
  return normalized;
}

async function deleteRecord(snapshotId) {
  const key = snapshotKey(snapshotId);
  const store = await getBlobStore();
  if (store) {
    await store.delete(key);
  }
  memoryStore.delete(key);
}

async function readRecord(snapshotId) {
  const key = snapshotKey(snapshotId);
  const store = await getBlobStore();
  let raw = null;

  if (store) {
    try {
      raw = await store.get(key);
    } catch {
      raw = null;
    }
  }

  if (!raw) {
    const mem = memoryStore.get(key);
    if (!mem) return null;
    const normalizedMem = normalizeRecord(snapshotId, mem);
    if (isExpired(normalizedMem)) {
      memoryStore.delete(key);
      return null;
    }
    return normalizedMem;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(toRawText(raw));
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const normalized = normalizeRecord(snapshotId, parsed);
  if (isExpired(normalized)) {
    await deleteRecord(snapshotId);
    return null;
  }
  return normalized;
}

function ensureSnapshotId(snapshotId) {
  const id = String(snapshotId || '').trim();
  if (!id) {
    throw new Error('snapshotId is required.');
  }
  return id;
}

async function saveSnapshot(snapshot) {
  const input = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const snapshotId = ensureSnapshotId(input.snapshotId);
  const now = Date.now();

  const record = normalizeRecord(snapshotId, {
    ...input,
    status: 'captured',
    progress: normalizeProgress(
      input.progress || { percent: 12, message: 'Snapshot captured.' },
      null
    ),
    createdAt: input.createdAt || new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SNAPSHOT_TTL_MS).toISOString()
  });

  const saved = await writeRecord(snapshotId, record);
  return stripHtml(saved);
}

async function getSnapshot(snapshotId) {
  const id = ensureSnapshotId(snapshotId);
  return readRecord(id);
}

async function updateStatus(snapshotId, patch) {
  const id = ensureSnapshotId(snapshotId);
  const existing = await readRecord(id);
  if (!existing) return null;
  const next = {
    ...existing,
    status: patch?.status != null ? sanitizeText(patch.status, existing.status) : existing.status,
    progress: patch?.progress != null ? normalizeProgress(patch.progress, existing.progress) : existing.progress,
    error:
      Object.prototype.hasOwnProperty.call(patch || {}, 'error')
        ? normalizeError(patch.error)
        : existing.error,
    result:
      Object.prototype.hasOwnProperty.call(patch || {}, 'result')
        ? patch.result
        : existing.result,
    finishedAt:
      Object.prototype.hasOwnProperty.call(patch || {}, 'finishedAt') && patch.finishedAt
        ? toIso(patch.finishedAt, Date.now())
        : existing.finishedAt,
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SNAPSHOT_TTL_MS).toISOString()
  };

  const saved = await writeRecord(id, next);
  return stripHtml(saved);
}

async function saveAnalysis(snapshotId, analysis) {
  const id = ensureSnapshotId(snapshotId);
  const existing = await readRecord(id);
  if (!existing) return null;
  const finishedAt = new Date().toISOString();

  const next = {
    ...existing,
    status: 'complete',
    progress: { percent: 100, message: 'Snapshot analysis complete.' },
    result: analysis ?? null,
    error: null,
    finishedAt,
    updatedAt: finishedAt,
    expiresAt: new Date(Date.now() + SNAPSHOT_TTL_MS).toISOString()
  };

  const saved = await writeRecord(id, next);
  return stripHtml(saved);
}

async function getAnalysis(snapshotId) {
  const id = ensureSnapshotId(snapshotId);
  const record = await readRecord(id);
  if (!record) return null;

  return {
    snapshotId: record.snapshotId,
    status: record.status,
    progress: record.progress,
    result: record.status === 'complete' ? record.result : null,
    error: record.status === 'failed' ? record.error : null,
    capturedAt: record.capturedAt,
    finishedAt: record.finishedAt,
    updatedAt: record.updatedAt
  };
}

module.exports = {
  SNAPSHOT_TTL_MS,
  saveSnapshot,
  getSnapshot,
  saveAnalysis,
  getAnalysis,
  updateStatus
};
