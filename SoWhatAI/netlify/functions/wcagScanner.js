import { chromium } from 'playwright';
import AxePlaywright from '@axe-core/playwright';

const AxeBuilder = AxePlaywright.default ?? AxePlaywright;

// Ensure Playwright resolves browsers from the bundled local path in serverless runtime.
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
}

const MAX_TIMEOUT_MS = 45000;
const DEFAULT_SINGLE_TIMEOUT_MS = 28000;
const DEFAULT_CRAWL_TIMEOUT_MS = 35000;
const DEFAULT_MAX_PAGES = 5;
const MAX_PAGES = 10;
const MAX_DEPTH = 2;

const DEFAULT_MAX_VIOLATIONS_PER_PAGE = 50;
const DEFAULT_MAX_NODES_PER_VIOLATION = 5;
const DEFAULT_MAX_TOTAL_ISSUES_OVERALL = 300;
const MAX_VIOLATIONS_PER_PAGE = 100;
const MAX_NODES_PER_VIOLATION = 10;
const MAX_TOTAL_ISSUES_OVERALL = 1000;

const MAX_SCREENSHOTS = 3;
const MAX_SCREENSHOT_BYTES_PER_IMAGE = 600 * 1024;
const MAX_HTML_SNIPPET_LENGTH = 600;
const MAX_FAILURE_SUMMARY_LENGTH = 500;
const MAX_SELECTOR_COUNT = 6;
const MAX_SELECTOR_LENGTH = 220;

const DEFAULT_PAGE_SCAN_BUDGET_MS = 12000;
const MIN_TIME_TO_START_NEW_PAGE_MS = 2200;
const LOAD_STATE_CAP_MS = 5000;
const DEFAULT_AXE_TIMEOUT_MS = 8000;
const SCREENSHOT_CAPTURE_BUDGET_MS = 3500;

const DEFAULT_RULESET = 'wcag22aa';
const RULESET_TAGS = {
  wcag2a: ['wcag2a'],
  wcag2aa: ['wcag2a', 'wcag2aa'],
  wcag21aa: ['wcag2a', 'wcag2aa', 'wcag21aa'],
  wcag22aa: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'],
  section508: ['section508']
};
const MAX_SCOPE_SELECTORS = 8;
const TRACKING_PARAMS = new Set(['fbclid', 'gclid', 'yclid', 'mc_eid']);
const SKIP_FILE_EXT = /\.(pdf|zip|docx?|xlsx?|pptx?|csv|mp4|mp3|avi|mov|exe|dmg|rar)$/i;
const SKIP_PATH_PATTERNS = [/\/logout/i, /\/signout/i, /^\/account(?:\/|$)/i, /\/cart/i, /\/checkout/i];

function clampTimeout(timeoutMs, mode) {
  const fallback = mode === 'crawl' ? DEFAULT_CRAWL_TIMEOUT_MS : DEFAULT_SINGLE_TIMEOUT_MS;
  const numeric = Number(timeoutMs);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(MAX_TIMEOUT_MS, Math.max(5000, Math.floor(numeric)));
}

function clampMaxPages(maxPages) {
  const numeric = Number(maxPages);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_MAX_PAGES;
  return Math.min(MAX_PAGES, Math.max(1, Math.floor(numeric)));
}

function clampInt(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

function normalizeRuleset(value) {
  if (typeof value !== 'string') return DEFAULT_RULESET;
  const normalized = value.trim().toLowerCase();
  return RULESET_TAGS[normalized] ? normalized : DEFAULT_RULESET;
}

function buildAxeTags(ruleset, includeBestPractices, includeExperimental) {
  const base = RULESET_TAGS[ruleset] || RULESET_TAGS[DEFAULT_RULESET];
  const tags = [...base];
  if (includeBestPractices) tags.push('best-practice');
  if (includeExperimental) tags.push('experimental');
  return Array.from(new Set(tags));
}

function createTimeoutError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function withTimeout(promise, timeoutMs, code, message) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(createTimeoutError(code, message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

function normalizeUrl(rawUrl, { stripTrackingParams = true } = {}) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    parsed.hash = '';

    if (stripTrackingParams) {
      const toDelete = [];
      parsed.searchParams.forEach((_, key) => {
        if (key.toLowerCase().startsWith('utm_') || TRACKING_PARAMS.has(key.toLowerCase())) {
          toDelete.push(key);
        }
      });
      toDelete.forEach((key) => parsed.searchParams.delete(key));
    }

    if (parsed.pathname.length > 1) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
      if (!parsed.pathname) parsed.pathname = '/';
    }

    const sortedEntries = Array.from(parsed.searchParams.entries()).sort((a, b) => {
      if (a[0] === b[0]) return a[1].localeCompare(b[1]);
      return a[0].localeCompare(b[0]);
    });
    parsed.search = '';
    for (const [key, value] of sortedEntries) {
      parsed.searchParams.append(key, value);
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function shouldSkipUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
    if (SKIP_FILE_EXT.test(parsed.pathname)) return true;
    return SKIP_PATH_PATTERNS.some((pattern) => pattern.test(parsed.pathname));
  } catch {
    return true;
  }
}

function getImpactWeight(impact) {
  if (impact === 'critical') return 4;
  if (impact === 'serious') return 3;
  if (impact === 'moderate') return 2;
  return 1;
}

function compareViolations(a, b) {
  const impactDelta = getImpactWeight(b.impact) - getImpactWeight(a.impact);
  if (impactDelta !== 0) return impactDelta;
  return String(a.id).localeCompare(String(b.id));
}

function compareNodes(a, b) {
  const aTarget = Array.isArray(a.target) ? a.target.join('|') : '';
  const bTarget = Array.isArray(b.target) ? b.target.join('|') : '';
  if (aTarget !== bTarget) return aTarget.localeCompare(bTarget);
  return String(a.html || '').localeCompare(String(b.html || ''));
}

function trimText(value, maxLength) {
  if (typeof value !== 'string') return '';
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function trimSelectors(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_SELECTOR_COUNT)
    .map((item) => trimText(String(item || ''), MAX_SELECTOR_LENGTH))
    .filter(Boolean);
}

function sanitizeScopeSelectors(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => trimText(String(item || '').trim(), MAX_SELECTOR_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_SCOPE_SELECTORS);
}

function getWcagRefs(tags = []) {
  return tags.filter((tag) => /^wcag\d+/i.test(tag) || /^wcag2\d{2}$/i.test(tag)).slice(0, 8);
}

function createTimeBudget(timeoutMs, mode) {
  const totalBudgetMs = clampTimeout(timeoutMs, mode);
  const startedAtMs = Date.now();
  const deadlineAtMs = startedAtMs + totalBudgetMs;
  return {
    totalBudgetMs,
    startedAtMs,
    deadlineAtMs,
    minRemainingToStartPageMs: MIN_TIME_TO_START_NEW_PAGE_MS,
    remainingMs() {
      return Math.max(0, deadlineAtMs - Date.now());
    },
    elapsedMs() {
      return Date.now() - startedAtMs;
    },
    isLow() {
      return this.remainingMs() < this.minRemainingToStartPageMs;
    }
  };
}

function buildNeedsReviewFlags(mode, pageSummaries) {
  const flags = [
    {
      id: 'focus-not-obscured-minimum',
      title: 'Focus Not Obscured (Minimum)',
      reason: 'Heuristic/manual check required. Automated detection is limited.'
    },
    {
      id: 'target-size-minimum',
      title: 'Target Size (Minimum)',
      reason: 'Heuristic/manual check required. Exact pointer target sizing needs visual review.'
    },
    {
      id: 'redundant-entry',
      title: 'Redundant Entry',
      reason: 'Manual verification required to confirm users are not forced to re-enter data.'
    },
    {
      id: 'accessible-authentication',
      title: 'Accessible Authentication',
      reason: 'Manual verification required for cognitive function test exemptions and alternatives.'
    },
    {
      id: 'consistent-help',
      title: 'Consistent Help',
      reason: 'Manual verification required across user journeys and templates.'
    }
  ];

  if (mode === 'crawl' && pageSummaries.length < 2) {
    flags.push({
      id: 'crawl-coverage',
      title: 'Crawl Coverage',
      reason: 'Crawl visited too few pages for consistent-help assessment.'
    });
  }
  return flags;
}

function mergeNeedsReview(baseFlags, dynamicFlags) {
  const merged = [];
  const seen = new Set();
  for (const flag of [...baseFlags, ...dynamicFlags]) {
    if (!flag || !flag.id || !flag.reason) continue;
    const key = `${flag.id}:${flag.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(flag);
    if (merged.length >= 20) break;
  }
  return merged;
}

async function collectLinks(page, pageUrl, startOrigin) {
  let links = [];
  try {
    links = await page.$$eval('a[href]', (nodes) =>
      nodes.map((node) => node.getAttribute('href')).filter(Boolean)
    );
  } catch {
    return [];
  }

  const output = new Set();
  for (const href of links) {
    if (!href || /^(mailto:|tel:|javascript:)/i.test(href)) continue;
    try {
      const absolute = new URL(href, pageUrl);
      absolute.hash = '';
      if (absolute.origin !== startOrigin) continue;
      const normalized = normalizeUrl(absolute.toString(), { stripTrackingParams: true });
      if (!normalized) continue;
      if (shouldSkipUrl(normalized)) continue;
      output.add(normalized);
    } catch {
      continue;
    }
  }
  return Array.from(output).sort((a, b) => a.localeCompare(b));
}

async function resolveBbox(page, selectors) {
  if (!Array.isArray(selectors) || selectors.length === 0) return null;
  for (let i = 0; i < selectors.length; i += 1) {
    const selector = selectors[i];
    if (!selector || typeof selector !== 'string') continue;
    try {
      const loc = page.locator(selector).first();
      if ((await loc.count()) < 1) continue;
      const box = await loc.boundingBox();
      if (!box || box.width <= 0 || box.height <= 0) continue;
      return {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height)
      };
    } catch {
      continue;
    }
  }
  return null;
}

async function runHeuristics(page) {
  try {
    return await page.evaluate(() => {
      const makeSelector = (el) => {
        if (!el || !(el instanceof Element)) return '';
        if (el.id) return `#${el.id}`;
        const cls = (el.className || '').toString().trim().split(/\s+/).filter(Boolean).slice(0, 2);
        const classPart = cls.length ? `.${cls.join('.')}` : '';
        return `${el.tagName.toLowerCase()}${classPart}`;
      };

      const isVisible = (el) => {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const interactive = Array.from(
        document.querySelectorAll('a, button, input, select, textarea, [role="button"], [role="link"], [tabindex]')
      );
      const smallTargets = [];
      for (const element of interactive) {
        if (!isVisible(element)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width < 24 || rect.height < 24) {
          smallTargets.push(makeSelector(element));
        }
        if (smallTargets.length >= 8) break;
      }

      const overlays = Array.from(document.querySelectorAll('*'))
        .filter((el) => {
          if (!isVisible(el)) return false;
          const style = window.getComputedStyle(el);
          if (style.position !== 'fixed' && style.position !== 'sticky') return false;
          const z = Number(style.zIndex);
          if (!Number.isFinite(z) || z < 100) return false;
          const rect = el.getBoundingClientRect();
          return rect.height >= window.innerHeight * 0.2;
        })
        .slice(0, 5)
        .map((el) => makeSelector(el));

      return {
        smallTargets,
        smallTargetCount: smallTargets.length,
        focusObscuredRisk: overlays.length > 0,
        focusObscuredCandidates: overlays
      };
    });
  } catch {
    return null;
  }
}

function buildHeuristicFlags(pageUrl, heuristics) {
  const flags = [];
  if (!heuristics) return flags;

  if (heuristics.focusObscuredRisk) {
    flags.push({
      id: 'focus-not-obscured-minimum',
      title: 'Focus Not Obscured (Minimum)',
      reason: `Heuristic risk on ${pageUrl}: potential sticky/fixed overlays may obscure focused controls.`,
      samples: Array.isArray(heuristics.focusObscuredCandidates)
        ? heuristics.focusObscuredCandidates.slice(0, 5)
        : []
    });
  }
  if (Number(heuristics.smallTargetCount) > 0) {
    flags.push({
      id: 'target-size-minimum',
      title: 'Target Size (Minimum)',
      reason: `Heuristic on ${pageUrl}: found ${heuristics.smallTargetCount} potential targets smaller than 24x24 CSS px.`,
      samples: Array.isArray(heuristics.smallTargets) ? heuristics.smallTargets.slice(0, 8) : []
    });
  }
  return flags;
}

function buildErrorsSummary(pageSummaries, globalErrors) {
  const totalTimeouts = pageSummaries.filter((p) => p.status === 'timeout').length;
  const totalErrors = pageSummaries.filter((p) => p.status === 'error').length;
  const messages = [];
  for (const page of pageSummaries) {
    if (page.error) messages.push(`${page.url}: ${page.error}`);
    if (messages.length >= 8) break;
  }
  for (const err of globalErrors) {
    if (!err) continue;
    messages.push(String(err));
    if (messages.length >= 8) break;
  }
  return {
    totalErrors,
    totalTimeouts,
    messages
  };
}

function getRuntimeHint(errorText) {
  const text = String(errorText || '').toLowerCase();
  if (
    text.includes("executable doesn't exist") ||
    text.includes('failed to launch') ||
    text.includes('could not find browser') ||
    text.includes('browsertype.launch')
  ) {
    return 'Chromium launch failed. Verify Playwright Chromium is installed and bundled in Netlify build output.';
  }
  if (text.includes('target page, context or browser has been closed')) {
    return 'Browser session closed unexpectedly. Try reducing max pages/timeouts and rerun.';
  }
  return '';
}

function selectScreenshotTargets(startUrl, pageSummaries) {
  const startPage = pageSummaries.find((page) => page.url === startUrl && page.status === 'ok');
  const candidates = pageSummaries
    .filter((page) => page.status === 'ok' && page.url !== startUrl)
    .sort((a, b) => {
      if (b.issueCount !== a.issueCount) return b.issueCount - a.issueCount;
      return a.url.localeCompare(b.url);
    })
    .slice(0, MAX_SCREENSHOTS - (startPage ? 1 : 0));

  const list = [];
  if (startPage) list.push(startPage.url);
  for (const candidate of candidates) {
    if (!list.includes(candidate.url)) list.push(candidate.url);
    if (list.length >= MAX_SCREENSHOTS) break;
  }
  return list;
}

async function captureScreenshotForPage(context, pageUrl, timeBudget) {
  if (timeBudget.remainingMs() < 1200) {
    return { pageUrl, omitted: true, reason: 'time_budget_low' };
  }

  let page = null;
  try {
    page = await context.newPage();
    const navTimeout = Math.max(1000, Math.min(SCREENSHOT_CAPTURE_BUDGET_MS, timeBudget.remainingMs() - 300));
    if (navTimeout < 1000) {
      return { pageUrl, omitted: true, reason: 'time_budget_low' };
    }

    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: navTimeout });
    try {
      await page.waitForLoadState('networkidle', { timeout: Math.min(1500, navTimeout) });
    } catch {}

    const screenshot = await page.screenshot({
      fullPage: true,
      type: 'jpeg',
      quality: 45
    });

    if (screenshot.length > MAX_SCREENSHOT_BYTES_PER_IMAGE) {
      return {
        pageUrl,
        omitted: true,
        reason: `size_limit_exceeded:${screenshot.length}`
      };
    }

    return {
      pageUrl,
      omitted: false,
      dataUrl: `data:image/jpeg;base64,${screenshot.toString('base64')}`,
      bytes: screenshot.length
    };
  } catch (error) {
    return {
      pageUrl,
      omitted: true,
      reason: error.message || String(error)
    };
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
}

function buildOptions(input) {
  const mode = input.mode === 'crawl' ? 'crawl' : 'single';
  const ruleset = normalizeRuleset(input.ruleset);
  const includeBestPractices = Boolean(input.includeBestPractices);
  const includeExperimental = Boolean(input.includeExperimental);
  return {
    mode,
    ruleset,
    includeBestPractices,
    includeExperimental,
    axeTags: buildAxeTags(ruleset, includeBestPractices, includeExperimental),
    scope: {
      includeSelectors: sanitizeScopeSelectors(input.includeSelectors),
      excludeSelectors: sanitizeScopeSelectors(input.excludeSelectors)
    },
    includeScreenshots: Boolean(input.includeScreenshots ?? false),
    debug: Boolean(input.debug),
    resourceBlocking:
      typeof input.resourceBlocking === 'boolean' ? input.resourceBlocking : mode === 'crawl',
    blockImages: Boolean(input.blockImages ?? false),
    maxPages: mode === 'crawl' ? clampMaxPages(input.maxPages) : 1,
    caps: {
      maxViolationsPerPage: clampInt(
        input.maxViolationsPerPage,
        DEFAULT_MAX_VIOLATIONS_PER_PAGE,
        1,
        MAX_VIOLATIONS_PER_PAGE
      ),
      maxNodesPerViolation: clampInt(
        input.maxNodesPerViolation,
        DEFAULT_MAX_NODES_PER_VIOLATION,
        1,
        MAX_NODES_PER_VIOLATION
      ),
      maxTotalIssuesOverall: clampInt(
        input.maxTotalIssuesOverall,
        DEFAULT_MAX_TOTAL_ISSUES_OVERALL,
        20,
        MAX_TOTAL_ISSUES_OVERALL
      )
    }
  };
}

async function scanPage({
  context,
  pageUrl,
  mode,
  startOrigin,
  includeBbox,
  axeTags,
  scope,
  caps,
  timeBudget
}) {
  const pageStartedAt = Date.now();
  let page = null;
  const timings = {
    navigationMs: 0,
    axeMs: 0
  };

  try {
    page = await context.newPage();
    const remaining = timeBudget.remainingMs();
    const pageBudgetMs = Math.max(
      1200,
      Math.min(DEFAULT_PAGE_SCAN_BUDGET_MS, Math.max(1200, remaining - 700))
    );

    const work = async () => {
      const navStart = Date.now();
      const navTimeout = Math.max(1000, Math.min(10000, timeBudget.remainingMs() - 500));
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: navTimeout });
      try {
        await page.waitForLoadState('networkidle', {
          timeout: Math.min(LOAD_STATE_CAP_MS, Math.max(800, timeBudget.remainingMs() - 400))
        });
      } catch {}
      timings.navigationMs = Date.now() - navStart;

      const axeStart = Date.now();
      const axeTimeout = Math.max(1200, Math.min(DEFAULT_AXE_TIMEOUT_MS, timeBudget.remainingMs() - 300));
      let builder = new AxeBuilder({ page }).withTags(axeTags);
      for (const selector of scope.includeSelectors) {
        builder = builder.include(selector);
      }
      for (const selector of scope.excludeSelectors) {
        builder = builder.exclude(selector);
      }
      const axe = await withTimeout(
        builder.analyze(),
        axeTimeout,
        'AXE_TIMEOUT',
        `Axe analysis timed out after ${axeTimeout}ms`
      );
      timings.axeMs = Date.now() - axeStart;

      const heuristics = await runHeuristics(page);
      const violations = Array.isArray(axe.violations) ? [...axe.violations].sort(compareViolations) : [];

      const pageTruncatedBy = {
        violations: violations.length > caps.maxViolationsPerPage,
        nodes: false,
        totalIssues: false
      };

      const selectedViolations = violations.slice(0, caps.maxViolationsPerPage);
      const issues = [];
      for (const violation of selectedViolations) {
        const nodes = Array.isArray(violation.nodes) ? [...violation.nodes].sort(compareNodes) : [];
        if (nodes.length > caps.maxNodesPerViolation) {
          pageTruncatedBy.nodes = true;
        }
        const selectedNodes = nodes.slice(0, caps.maxNodesPerViolation);
        for (const node of selectedNodes) {
          const targetSelectors = trimSelectors(node.target);
          const bbox = includeBbox ? await resolveBbox(page, targetSelectors) : null;
          issues.push({
            pageUrl,
            ruleId: violation.id,
            wcagRefs: getWcagRefs(violation.tags),
            impact: node.impact || violation.impact || 'minor',
            targetSelectors,
            htmlSnippet: trimText(node.html || '', MAX_HTML_SNIPPET_LENGTH),
            failureSummary: trimText(node.failureSummary || '', MAX_FAILURE_SUMMARY_LENGTH),
            bbox: bbox || null
          });
        }
      }

      const discoveredLinks =
        mode === 'crawl' ? await collectLinks(page, pageUrl, startOrigin) : [];

      return {
        status: 'ok',
        issues,
        heuristics,
        discoveredLinks,
        pageTruncatedBy,
        detectedViolationCount: violations.length
      };
    };

    const result = await withTimeout(
      work(),
      pageBudgetMs,
      'PAGE_TIMEOUT',
      `Page scan exceeded ${pageBudgetMs}ms`
    );

    return {
      ...result,
      durationMs: Date.now() - pageStartedAt,
      timings
    };
  } catch (error) {
    const status =
      error?.code === 'PAGE_TIMEOUT' || error?.code === 'AXE_TIMEOUT' ? 'timeout' : 'error';
    return {
      status,
      issues: [],
      heuristics: null,
      discoveredLinks: [],
      pageTruncatedBy: { violations: false, nodes: false, totalIssues: false },
      detectedViolationCount: 0,
      error: error.message || String(error),
      durationMs: Date.now() - pageStartedAt,
      timings
    };
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
}

async function runWcagScan(input) {
  const options = buildOptions(input || {});
  const timeBudget = createTimeBudget(input.timeoutMs, options.mode);
  const startUrl = normalizeUrl(input.startUrl, { stripTrackingParams: true });

  if (!startUrl) {
    return {
      status: 'partial',
      message: 'Invalid start URL. Returning empty partial result.',
      mode: options.mode,
      startedAt: new Date(timeBudget.startedAtMs).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: timeBudget.elapsedMs(),
      elapsedMs: timeBudget.elapsedMs(),
      pages: [],
      issues: [],
      screenshots: [],
      needsReview: [],
      truncated: true,
      metadata: {
        durationMs: timeBudget.elapsedMs(),
        pagesAttempted: 0,
        pagesScanned: 0,
        truncated: true,
        truncation: { timeBudget: false, maxPages: false, maxTotalIssues: false },
        errorsSummary: { totalErrors: 1, totalTimeouts: 0, messages: ['Invalid start URL'] },
        caps: options.caps,
        standards: {
          ruleset: options.ruleset,
          tags: options.axeTags,
          includeBestPractices: options.includeBestPractices,
          includeExperimental: options.includeExperimental
        },
        scope: options.scope
      }
    };
  }

  let browser = null;
  let context = null;
  let breakReason = '';

  const pagesSummary = [];
  const issues = [];
  const screenshots = [];
  const heuristicFlags = [];
  const globalErrors = [];
  const debugPages = [];

  let pagesAttempted = 0;
  let pagesScanned = 0;
  let scanTruncated = false;
  let totalIssuesCapHit = false;
  let maxPagesCapHit = false;
  let timeBudgetHit = false;
  let runtimeErrorMessage = '';
  let runtimeHint = '';

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    context = await browser.newContext({
      viewport: { width: 1366, height: 900 }
    });

    if (options.resourceBlocking) {
      const blocked = new Set(['font', 'media']);
      if (options.blockImages) blocked.add('image');
      await context.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (blocked.has(type)) {
          route.abort().catch(() => {});
        } else {
          route.continue().catch(() => {});
        }
      });
    }

    const queue = [{ url: startUrl, depth: 0 }];
    const queued = new Set([startUrl]);
    const visited = new Set();
    const startOrigin = new URL(startUrl).origin;

    while (queue.length > 0) {
      if (pagesSummary.length >= options.maxPages) {
        maxPagesCapHit = true;
        breakReason = 'max_pages_reached';
        scanTruncated = true;
        break;
      }
      if (timeBudget.isLow()) {
        timeBudgetHit = true;
        breakReason = 'time_budget_low';
        break;
      }

      const current = queue.shift();
      if (!current) continue;
      queued.delete(current.url);
      if (visited.has(current.url)) continue;
      visited.add(current.url);

      pagesAttempted += 1;
      const pageResult = await scanPage({
        context,
        pageUrl: current.url,
        mode: options.mode,
        startOrigin,
        includeBbox: true,
        axeTags: options.axeTags,
        scope: options.scope,
        caps: options.caps,
        timeBudget
      });

      if (pageResult.status === 'ok') {
        pagesScanned += 1;
      }

      if (pageResult.status !== 'ok' && pageResult.error) {
        globalErrors.push(pageResult.error);
      }

      heuristicFlags.push(...buildHeuristicFlags(current.url, pageResult.heuristics));

      const remainingIssueBudget = Math.max(0, options.caps.maxTotalIssuesOverall - issues.length);
      let acceptedIssues = pageResult.issues.slice(0, remainingIssueBudget);
      const totalIssuesTruncated = acceptedIssues.length < pageResult.issues.length;
      if (totalIssuesTruncated) {
        totalIssuesCapHit = true;
        scanTruncated = true;
      }
      issues.push(...acceptedIssues);

      const pageTruncated =
        pageResult.pageTruncatedBy.violations ||
        pageResult.pageTruncatedBy.nodes ||
        totalIssuesTruncated;

      if (pageTruncated) {
        scanTruncated = true;
      }

      pagesSummary.push({
        url: current.url,
        status: pageResult.status,
        issueCount: acceptedIssues.length,
        detectedIssueCount: pageResult.issues.length,
        detectedViolationCount: pageResult.detectedViolationCount,
        error: pageResult.error || null,
        truncated: pageTruncated,
        truncatedBy: {
          violations: pageResult.pageTruncatedBy.violations,
          nodes: pageResult.pageTruncatedBy.nodes,
          totalIssues: totalIssuesTruncated
        },
        durationMs: pageResult.durationMs
      });

      if (options.debug) {
        debugPages.push({
          url: current.url,
          status: pageResult.status,
          durationMs: pageResult.durationMs,
          navigationMs: pageResult.timings.navigationMs,
          axeMs: pageResult.timings.axeMs,
          issueCount: acceptedIssues.length
        });
      }

      if (totalIssuesCapHit) {
        breakReason = 'max_total_issues_overall';
        break;
      }

      if (options.mode === 'crawl' && current.depth < MAX_DEPTH) {
        for (const nextUrl of pageResult.discoveredLinks) {
          if (visited.has(nextUrl) || queued.has(nextUrl)) continue;
          if (shouldSkipUrl(nextUrl)) continue;
          queue.push({ url: nextUrl, depth: current.depth + 1 });
          queued.add(nextUrl);
          if (queue.length > options.maxPages * 4) break;
        }
      }
    }

    if (options.includeScreenshots && pagesSummary.length > 0) {
      const targets = selectScreenshotTargets(startUrl, pagesSummary);
      const screenshotErrors = [];
      for (const target of targets) {
        const shot = await captureScreenshotForPage(context, target, timeBudget);
        if (shot.omitted) {
          screenshotErrors.push(`${target}: ${shot.reason}`);
          continue;
        }
        screenshots.push({
          pageUrl: shot.pageUrl,
          dataUrl: shot.dataUrl
        });
      }
      globalErrors.push(...screenshotErrors);
    }
  } catch (error) {
    runtimeErrorMessage = error?.message || String(error);
    runtimeHint = getRuntimeHint(runtimeErrorMessage);
    globalErrors.push(runtimeErrorMessage);
    if (runtimeHint) {
      globalErrors.push(runtimeHint);
    }
    breakReason = breakReason || 'runtime_error';
    scanTruncated = true;
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  if (timeBudget.remainingMs() <= 0) {
    timeBudgetHit = true;
    breakReason = breakReason || 'time_budget_low';
    scanTruncated = true;
  }

  const durationMs = timeBudget.elapsedMs();
  const finishedAt = new Date().toISOString();
  const startedAt = new Date(timeBudget.startedAtMs).toISOString();

  let status = 'complete';
  if (timeBudgetHit || breakReason === 'runtime_error' || breakReason === 'time_budget_low') {
    status = 'partial';
  }
  if (pagesSummary.some((page) => page.status !== 'ok')) {
    status = 'partial';
  }
  if (pagesAttempted === 0 && globalErrors.length > 0) {
    status = 'partial';
  }
  if (breakReason && breakReason !== 'max_pages_reached' && breakReason !== 'max_total_issues_overall') {
    status = 'partial';
  }

  let message = '';
  if (status === 'partial' && breakReason === 'time_budget_low') {
    message = `Time budget exceeded at ${timeBudget.totalBudgetMs}ms. Returning partial results.`;
  } else if (breakReason === 'max_total_issues_overall') {
    message = 'Issue cap reached. Additional issues were not returned.';
  } else if (breakReason === 'max_pages_reached') {
    message = 'Page cap reached. Crawl ended at configured max pages.';
  } else if (status === 'partial' && breakReason === 'runtime_error') {
    const reason = runtimeErrorMessage ? ` ${runtimeErrorMessage}` : '';
    const hint = runtimeHint ? ` ${runtimeHint}` : '';
    message = `Runtime error occurred.${reason}${hint}`.trim();
  }

  const errorsSummary = buildErrorsSummary(pagesSummary, globalErrors);
  const needsReview = mergeNeedsReview(
    buildNeedsReviewFlags(options.mode, pagesSummary),
    heuristicFlags
  );

  const response = {
    status,
    message,
    mode: options.mode,
    startedAt,
    finishedAt,
    durationMs,
    elapsedMs: durationMs,
    limits: {
      timeoutMs: timeBudget.totalBudgetMs,
      maxPages: options.maxPages,
      maxDepth: MAX_DEPTH,
      maxViolationsPerPage: options.caps.maxViolationsPerPage,
      maxNodesPerViolation: options.caps.maxNodesPerViolation,
      maxTotalIssuesOverall: options.caps.maxTotalIssuesOverall,
      screenshotMaxBytesPerImage: MAX_SCREENSHOT_BYTES_PER_IMAGE
    },
    truncated: scanTruncated,
    truncation: {
      timeBudget: timeBudgetHit,
      maxPages: maxPagesCapHit,
      maxTotalIssues: totalIssuesCapHit
    },
    pages: pagesSummary,
    issues,
    screenshots,
    needsReview,
    metadata: {
      durationMs,
      pagesAttempted,
      pagesScanned,
      truncated: scanTruncated,
      truncation: {
        timeBudget: timeBudgetHit,
        maxPages: maxPagesCapHit,
        maxTotalIssues: totalIssuesCapHit
      },
      errorsSummary,
      resourceBlocking: {
        enabled: options.resourceBlocking,
        blockImages: options.blockImages
      },
      screenshotSelection: {
        enabled: options.includeScreenshots,
        maxScreenshots: MAX_SCREENSHOTS
      },
      caps: options.caps,
      standards: {
        ruleset: options.ruleset,
        tags: options.axeTags,
        includeBestPractices: options.includeBestPractices,
        includeExperimental: options.includeExperimental
      },
      scope: options.scope,
      runtimeError:
        breakReason === 'runtime_error'
          ? {
              message: runtimeErrorMessage || null,
              hint: runtimeHint || null
            }
          : null
    }
  };

  if (options.debug) {
    response.debug = {
      timing: {
        startedAt,
        finishedAt,
        totalBudgetMs: timeBudget.totalBudgetMs,
        remainingMsAtFinish: timeBudget.remainingMs()
      },
      breakReason: breakReason || null,
      pageTimings: debugPages
    };
  }

  return response;
}

export { runWcagScan };
