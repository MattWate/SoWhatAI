const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const DEFAULT_TIMEOUT_MS = 12000;
const MIN_TIMEOUT_MS = 4000;
const MAX_TIMEOUT_MS = 20000;
const MAX_ERROR_MESSAGE = 260;

function clampTimeout(timeoutMs) {
  const numeric = Number(timeoutMs);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.floor(numeric)));
}

function sanitizeErrorMessage(error) {
  const raw = error?.message || String(error || 'Unknown error');
  return String(raw).replace(/\s+/g, ' ').trim().slice(0, MAX_ERROR_MESSAGE);
}

function toScore(rawScore) {
  const numeric = Number(rawScore);
  if (!Number.isFinite(numeric)) return null;
  if (numeric <= 1) return Math.max(0, Math.min(100, Math.round(numeric * 100)));
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function getCategoryScore(payload, categoryKey) {
  return toScore(payload?.lighthouseResult?.categories?.[categoryKey]?.score);
}

function getCategoryAuditRefs(payload, categoryKey) {
  const refs = payload?.lighthouseResult?.categories?.[categoryKey]?.auditRefs;
  return Array.isArray(refs) ? refs : [];
}

function getAuditById(payload, auditId) {
  return payload?.lighthouseResult?.audits?.[auditId] || null;
}

function buildCategoryIssues(payload, categoryKey, { maxIssues = 25 } = {}) {
  const refs = getCategoryAuditRefs(payload, categoryKey);
  const issues = [];

  for (const ref of refs) {
    const ruleId = String(ref?.id || '').trim();
    if (!ruleId) continue;
    const audit = getAuditById(payload, ruleId);
    if (!audit) continue;

    const displayMode = String(audit.scoreDisplayMode || '');
    if (displayMode === 'notApplicable' || displayMode === 'manual' || displayMode === 'informative') continue;

    const score = Number(audit.score);
    if (!Number.isFinite(score) || score >= 1) continue;

    let impact = 'minor';
    if (score <= 0.2) impact = 'serious';
    else if (score <= 0.5) impact = 'moderate';

    issues.push({
      ruleId,
      impact,
      title: String(audit.title || ruleId),
      score: Math.max(0, Math.min(1, score)),
      failureSummary: String(audit.displayValue || '').trim() || stripHtml(audit.description),
      recommendation: stripHtml(audit.description),
      detailsType: String(audit?.details?.type || '')
    });
  }

  return issues
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a.ruleId.localeCompare(b.ruleId);
    })
    .slice(0, Math.max(1, Math.floor(maxIssues)));
}

async function fetchPsiPayload({
  startUrl,
  categories,
  strategy = 'desktop',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  apiKey = process.env.PAGESPEED_API_KEY || ''
}) {
  const timeout = clampTimeout(timeoutMs);
  const normalizedStrategy = String(strategy || '').toLowerCase() === 'mobile' ? 'mobile' : 'desktop';
  const list = Array.isArray(categories) ? categories.filter(Boolean) : [];
  if (!list.length) {
    throw new Error('At least one PSI category is required.');
  }

  const params = new URLSearchParams({
    url: String(startUrl || ''),
    strategy: normalizedStrategy
  });
  for (const category of list) {
    params.append('category', String(category));
  }
  if (apiKey) {
    params.set('key', apiKey);
  }

  const url = `${PSI_ENDPOINT}?${params.toString()}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeout);

  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    const text = await response.text();

    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = {};
      }
    }

    if (!response.ok) {
      const apiMessage =
        payload?.error?.message || `PSI request failed with status ${response.status}.`;
      throw new Error(apiMessage);
    }

    return {
      payload,
      fetchDurationMs: Date.now() - startedAt,
      strategy: normalizedStrategy
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`PSI request timed out after ${timeout}ms.`);
    }
    throw new Error(sanitizeErrorMessage(error));
  } finally {
    clearTimeout(timeoutId);
  }
}

export {
  buildCategoryIssues,
  fetchPsiPayload,
  getCategoryScore,
  sanitizeErrorMessage,
  stripHtml
};
