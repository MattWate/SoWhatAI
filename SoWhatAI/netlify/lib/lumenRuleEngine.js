import axe from 'axe-core';

const SCAN_ENGINE_NAME = 'axe-core';
const AXE_SOURCE = axe?.source || axe?.default?.source || '';

const AXE_TAGS = new Set([
  'wcag2a',
  'wcag2aa',
  'wcag21aa',
  'wcag22aa',
  'section508',
  'best-practice',
  'experimental'
]);

function trimText(value, maxLength) {
  const text = String(value || '');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function normalizeTag(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function selectEngineRules(profileTags) {
  const tags = Array.from(
    new Set(
      (Array.isArray(profileTags) ? profileTags : [])
        .map(normalizeTag)
        .filter((tag) => AXE_TAGS.has(tag))
    )
  );

  const runOnlyTags = tags.length > 0 ? tags : ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];
  return runOnlyTags.map((tag) => ({
    id: `tag:${tag}`,
    impact: 'n/a',
    profileTags: [tag],
    wcagRefs: [],
    summary: `Axe run tag ${tag}`,
    tag
  }));
}

function buildAxeContext(includeSelectors, excludeSelectors) {
  const context = {};

  if (Array.isArray(includeSelectors) && includeSelectors.length > 0) {
    context.include = includeSelectors.filter(Boolean).map((selector) => [selector]);
  }

  if (Array.isArray(excludeSelectors) && excludeSelectors.length > 0) {
    context.exclude = excludeSelectors.filter(Boolean).map((selector) => [selector]);
  }

  return context;
}

function extractRunOnlyTags(engineRules) {
  const tags = Array.from(
    new Set(
      (Array.isArray(engineRules) ? engineRules : [])
        .map((rule) => normalizeTag(rule?.tag || String(rule?.id || '').replace(/^tag:/, '')))
        .filter((tag) => AXE_TAGS.has(tag))
    )
  );

  return tags.length > 0 ? tags : ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];
}

function summarizeByImpact(violations) {
  const summary = {
    critical: 0,
    serious: 0,
    moderate: 0,
    minor: 0
  };

  for (const violation of Array.isArray(violations) ? violations : []) {
    const impact = normalizeTag(violation?.impact);
    if (impact && summary[impact] != null) {
      summary[impact] += Array.isArray(violation.nodes) ? violation.nodes.length : 0;
    }
  }

  return summary;
}

function summarizeTopRules(violations, maxItems = 8) {
  const counts = new Map();

  for (const violation of Array.isArray(violations) ? violations : []) {
    const key = String(violation?.id || '').trim();
    if (!key) continue;
    const nodeCount = Array.isArray(violation.nodes) ? violation.nodes.length : 0;
    counts.set(key, (counts.get(key) || 0) + nodeCount);
  }

  return Array.from(counts.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .slice(0, maxItems)
    .map(([ruleId, nodeCount]) => ({ ruleId, nodeCount }));
}

function sanitizeViolation(
  violation,
  { maxNodeSamples, maxHtmlSnippetLength, maxFailureSummaryLength }
) {
  if (!violation || !Array.isArray(violation.nodes) || violation.nodes.length === 0) {
    return null;
  }

  const nodes = violation.nodes.slice(0, maxNodeSamples).map((node) => ({
    target: Array.isArray(node?.target) ? node.target.map((item) => String(item || '')).filter(Boolean) : [],
    html: trimText(String(node?.html || '').replace(/\s+/g, ' '), maxHtmlSnippetLength),
    failureSummary: trimText(String(node?.failureSummary || '').replace(/\s+/g, ' '), maxFailureSummaryLength),
    impact: normalizeTag(node?.impact) || normalizeTag(violation.impact) || 'minor'
  }));

  if (nodes.length === 0) return null;
  return {
    id: String(violation.id || ''),
    impact: normalizeTag(violation.impact) || nodes[0]?.impact || 'minor',
    tags: Array.isArray(violation.tags) ? violation.tags.map((tag) => String(tag || '')).filter(Boolean) : [],
    nodes
  };
}

function sanitizeIncompleteEntries(incompleteRules, maxItems = 12) {
  if (!Array.isArray(incompleteRules)) return [];
  return incompleteRules.slice(0, maxItems).map((rule) => ({
    ruleId: String(rule?.id || ''),
    impact: normalizeTag(rule?.impact) || 'moderate',
    help: trimText(String(rule?.help || ''), 180),
    description: trimText(String(rule?.description || ''), 220),
    nodeCount: Array.isArray(rule?.nodes) ? rule.nodes.length : 0,
    tags: Array.isArray(rule?.tags) ? rule.tags.map((tag) => String(tag || '')).filter(Boolean).slice(0, 8) : []
  }));
}

async function ensureAxeLoaded(page) {
  const alreadyLoaded = await page
    .evaluate(() => Boolean(window.axe && typeof window.axe.run === 'function'))
    .catch(() => false);

  if (alreadyLoaded) return;
  if (!AXE_SOURCE) {
    throw new Error('axe-core source is unavailable in the runtime bundle.');
  }
  await page.addScriptTag({ content: AXE_SOURCE });
}

async function collectEngineViolations(
  page,
  {
    engineRules,
    includeSelectors,
    excludeSelectors,
    maxNodeSamples,
    maxHtmlSnippetLength,
    maxFailureSummaryLength
  }
) {
  await ensureAxeLoaded(page);

  const runOnlyTags = extractRunOnlyTags(engineRules);
  const contextArg = buildAxeContext(includeSelectors, excludeSelectors);

  const rawResult = await page.evaluate(
    async ({ contextArg, runOnlyTags }) => {
      const context =
        contextArg && (Array.isArray(contextArg.include) || Array.isArray(contextArg.exclude))
          ? contextArg
          : document;

      return window.axe.run(context, {
        runOnly: {
          type: 'tag',
          values: runOnlyTags
        },
        resultTypes: ['violations', 'incomplete'],
        reporter: 'v2'
      });
    },
    {
      contextArg,
      runOnlyTags
    }
  );

  const violations = Array.isArray(rawResult?.violations)
    ? rawResult.violations
        .map((violation) =>
          sanitizeViolation(violation, {
            maxNodeSamples,
            maxHtmlSnippetLength,
            maxFailureSummaryLength
          })
        )
        .filter(Boolean)
    : [];

  const incomplete = sanitizeIncompleteEntries(rawResult?.incomplete);

  return {
    violations,
    insights: {
      runOnlyTags,
      violationRuleCount: violations.length,
      violationNodeCount: violations.reduce(
        (sum, violation) => sum + (Array.isArray(violation.nodes) ? violation.nodes.length : 0),
        0
      ),
      impactSummary: summarizeByImpact(violations),
      topViolationRules: summarizeTopRules(violations),
      incompleteRuleCount: Array.isArray(rawResult?.incomplete) ? rawResult.incomplete.length : 0,
      incomplete
    }
  };
}

export { SCAN_ENGINE_NAME, selectEngineRules, collectEngineViolations };
