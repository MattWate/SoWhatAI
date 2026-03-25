const BUCKET_NAME = 'wcag-jobs';
const JOB_PATH_PREFIX = 'jobs/';
const JOB_TTL_MS = 30 * 60 * 1000;
const MAX_TEXT_LENGTH = 320;

const memoryStore = (() => {
  const key = '__SOWHATAI_WCAG_JOB_STORE_V3__';
  if (!globalThis[key]) {
    globalThis[key] = new Map();
  }
  return globalThis[key];
})();

let supabaseClient = null;
let supabaseInitAttempted = false;
let fallbackWarningShown = false;

function nowIso() {
  return new Date().toISOString();
}

function sanitizeText(value, fallback = '') {
  return String(value ?? fallback).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
}

function normalizeJobId(value) {
  return sanitizeText(value, '').replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 120);
}

function normalizeStatus(value, fallback = 'queued') {
  const status = String(value || fallback).toLowerCase();
  if (status === 'queued' || status === 'running' || status === 'complete' || status === 'failed') {
    return status;
  }
  return fallback;
}

function normalizePercent(value, fallback = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.max(0, Math.min(100, Math.round(numeric)));
  }
  return Math.max(0, Math.min(100, Math.round(Number(fallback) || 0)));
}

function normalizeProgress(progress, previous) {
  const source = progress && typeof progress === 'object' ? progress : {};
  const prior = previous && typeof previous === 'object' ? previous : {};
  return {
    percent: normalizePercent(source.percent, prior.percent),
    message: sanitizeText(source.message, prior.message || 'Queued')
  };
}

function normalizeError(error) {
  if (!error) return null;
  if (typeof error === 'string') {
    return { message: sanitizeText(error, 'Unknown error.') };
  }
  if (typeof error !== 'object') {
    return { message: sanitizeText(String(error), 'Unknown error.') };
  }
  const code = sanitizeText(error.code, '');
  const message = sanitizeText(error.message || error.error, 'Unknown error.');
  return code ? { code, message } : { message };
}

function toIso(value, fallbackMs) {
  if (!value) return new Date(fallbackMs).toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date(fallbackMs).toISOString();
  return parsed.toISOString();
}

function isExpired(record) {
  if (!record || !record.expiresAt) return false;
  const ms = new Date(record.expiresAt).getTime();
  if (!Number.isFinite(ms)) return false;
  return Date.now() > ms;
}

function stripPayload(record, includePayload = false) {
  if (!record) return null;
  if (includePayload) return record;
  const { payload, ...rest } = record;
  return rest;
}

function jobPath(jobId) {
  return `${JOB_PATH_PREFIX}${jobId}.json`;
}

function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  if (supabaseInitAttempted) return null;
  supabaseInitAttempted = true;
  try {
    const url = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set.');
    }
    const { createClient } = require('@supabase/supabase-js');
    supabaseClient = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    return supabaseClient;
  } catch (error) {
    if (!fallbackWarningShown) {
      fallbackWarningShown = true;
      console.warn(
        '[jobStore] Supabase client init failed, using in-memory fallback.',
        sanitizeText(error && error.message, 'Unknown init error.')
      );
    }
    return null;
  }
}

function normalizeRecord(jobId, input = {}) {
  const now = Date.now();
  const record = input && typeof input === 'object' ? input : {};
  return {
    jobId,
    status: normalizeStatus(record.status, 'queued'),
    progress: normalizeProgress(record.progress, null),
    payload: Object.prototype.hasOwnProperty.call(record, 'payload') ? record.payload : null,
    result: Object.prototype.hasOwnProperty.call(record, 'result') ? record.result : null,
    error: normalizeError(record.error),
    createdAt: toIso(record.createdAt, now),
    updatedAt: toIso(record.updatedAt, now),
    completedAt: record.completedAt ? toIso(record.completedAt, now) : null,
    expiresAt: toIso(record.expiresAt, now + JOB_TTL_MS)
  };
}

async function writeRecord(jobId, record) {
  const normalized = normalizeRecord(jobId, record);
  const path = jobPath(jobId);
  const client = getSupabaseClient();

  if (client) {
    try {
      const { error } = await client.storage
        .from(BUCKET_NAME)
        .upload(path, JSON.stringify(normalized), {
          contentType: 'application/json',
          upsert: true
        });
      if (error) {
        console.warn('[jobStore] Supabase Storage write failed:', sanitizeText(error.message, 'unknown'));
      }
    } catch (err) {
      console.warn('[jobStore] Supabase Storage write threw:', sanitizeText(err && err.message, 'unknown'));
    }
  }

  memoryStore.set(path, normalized);
  return normalized;
}

async function deleteRecord(jobId) {
  const path = jobPath(jobId);
  const client = getSupabaseClient();
  if (client) {
    try {
      await client.storage.from(BUCKET_NAME).remove([path]);
    } catch {
      // best-effort delete
    }
  }
  memoryStore.delete(path);
}

async function readRecord(jobId) {
  const path = jobPath(jobId);
  const client = getSupabaseClient();
  let parsed = null;

  if (client) {
    try {
      const { data, error } = await client.storage.from(BUCKET_NAME).download(path);
      if (!error && data) {
        const text = await data.text();
        parsed = JSON.parse(text);
      }
    } catch {
      parsed = null;
    }
  }

  if (!parsed) {
    parsed = memoryStore.get(path) || null;
  }
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const normalized = normalizeRecord(jobId, parsed);
  if (isExpired(normalized)) {
    await deleteRecord(jobId);
    return null;
  }

  memoryStore.set(path, normalized);
  return normalized;
}

function mergeRecord(existing, patch = {}) {
  const source = patch && typeof patch === 'object' ? patch : {};
  const now = Date.now();
  const next = { ...existing };

  if (Object.prototype.hasOwnProperty.call(source, 'status')) {
    next.status = normalizeStatus(source.status, existing.status);
  }

  if (Object.prototype.hasOwnProperty.call(source, 'progress')) {
    next.progress = normalizeProgress(source.progress, existing.progress);
  }

  if (Object.prototype.hasOwnProperty.call(source, 'payload')) {
    next.payload = source.payload;
  }

  if (Object.prototype.hasOwnProperty.call(source, 'result')) {
    next.result = source.result;
  }

  if (Object.prototype.hasOwnProperty.call(source, 'error')) {
    next.error = normalizeError(source.error);
  }

  if (Object.prototype.hasOwnProperty.call(source, 'completedAt')) {
    next.completedAt = source.completedAt ? toIso(source.completedAt, now) : null;
  }

  next.updatedAt = new Date(now).toISOString();
  next.expiresAt = Object.prototype.hasOwnProperty.call(source, 'expiresAt')
    ? toIso(source.expiresAt, now + JOB_TTL_MS)
    : new Date(now + JOB_TTL_MS).toISOString();

  return normalizeRecord(existing.jobId, next);
}

function createSeedRecord(input, payloadOverride) {
  const now = Date.now();

  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const jobId = normalizeJobId(input.jobId);
    if (!jobId) throw new Error('jobId is required.');
    return normalizeRecord(jobId, {
      ...input,
      payload: Object.prototype.hasOwnProperty.call(input, 'payload') ? input.payload : payloadOverride,
      createdAt: input.createdAt || new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      expiresAt: input.expiresAt || new Date(now + JOB_TTL_MS).toISOString()
    });
  }

  const jobId = normalizeJobId(input);
  if (!jobId) throw new Error('jobId is required.');
  return normalizeRecord(jobId, {
    status: 'queued',
    progress: { percent: 0, message: 'Queued' },
    payload: payloadOverride ?? null,
    result: null,
    error: null,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    completedAt: null,
    expiresAt: new Date(now + JOB_TTL_MS).toISOString()
  });
}

async function createJob(jobOrRecord, payload) {
  const seed = createSeedRecord(jobOrRecord, payload);
  const saved = await writeRecord(seed.jobId, seed);
  return stripPayload(saved);
}

async function updateJob(jobIdValue, patch = {}) {
  const jobId = normalizeJobId(jobIdValue);
  if (!jobId) throw new Error('jobId is required.');

  const existing = await readRecord(jobId);
  if (!existing) return null;

  const merged = mergeRecord(existing, patch);
  const saved = await writeRecord(jobId, merged);
  return stripPayload(saved);
}

async function getJob(jobIdValue, options = {}) {
  const jobId = normalizeJobId(jobIdValue);
  if (!jobId) return null;

  const record = await readRecord(jobId);
  if (!record) return null;
  return stripPayload(record, Boolean(options && options.includePayload));
}

async function completeJob(jobIdValue, result) {
  const jobId = normalizeJobId(jobIdValue);
  if (!jobId) throw new Error('jobId is required.');

  const completedAt = nowIso();
  return updateJob(jobId, {
    status: 'complete',
    progress: { percent: 100, message: 'Complete' },
    result: result ?? null,
    error: null,
    completedAt
  });
}

async function failJob(jobIdValue, error) {
  const jobId = normalizeJobId(jobIdValue);
  if (!jobId) throw new Error('jobId is required.');

  const normalizedError = normalizeError(error) || { message: 'Scan failed.' };
  const completedAt = nowIso();
  return updateJob(jobId, {
    status: 'failed',
    progress: { percent: 100, message: normalizedError.message || 'Scan failed.' },
    error: normalizedError,
    completedAt
  });
}

module.exports = {
  JOB_TTL_MS,
  createJob,
  updateJob,
  getJob,
  completeJob,
  failJob
};
