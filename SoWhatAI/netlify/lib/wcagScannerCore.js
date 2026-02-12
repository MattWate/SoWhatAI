import chromium from '@sparticuz/chromium';
import { chromium as playwrightChromium } from 'playwright-core';
import { SCAN_ENGINE_NAME, collectEngineViolations, selectEngineRules } from './lumenRuleEngine.js';
import { collectPerformanceAudit, summarizePerformanceIssues } from './performanceAudit.js';

const MAX_TIMEOUT_MS = 45000;
const DEFAULT_SINGLE_TIMEOUT_MS = 28000;
const DEFAULT_CRAWL_TIMEOUT_MS = 35000;
const DEFAULT_MAX_PAGES = 5;
const MAX_PAGES = 10;
const MAX_DEPTH = 2;

const DEFAULT_MAX_VIOLATIONS_PER_PAGE = 50;
const DEFAULT_MAX_NODES_PER_VIOLATION = 20;
const DEFAULT_MAX_TOTAL_ISSUES_OVERALL = 300;
const MAX_VIOLATIONS_PER_PAGE = 100;
const MAX_NODES_PER_VIOLATION = 80;
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
const DEFAULT_ENGINE_TIMEOUT_MS = 12000;
const SCREENSHOT_CAPTURE_BUDGET_MS = 9000;
const FIXED_SCAN_TIMEOUT_MS = 45000;
const PAGE_PREP_SCROLL_STEP_PX = 900;
const PAGE_PREP_SCROLL_SETTLE_MS = 180;
const PAGE_PREP_MAX_SCROLL_STEPS = 50;
const PAGE_PREP_SCROLL_TIMEOUT_MS = 6000;
const PAGE_PREP_ASSET_WAIT_TIMEOUT_MS = 7000;

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

async function launchBrowser() {
  const isServerless = Boolean(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);
  if (isServerless) {
    const executablePath = await chromium.executablePath();
    return playwrightChromium.launch({
      headless: true,
      executablePath,
      args: [...chromium.args, '--disable-dev-shm-usage']
    });
  }

  return playwrightChromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
}

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

function buildProfileTags(ruleset, includeBestPractices, includeExperimental) {
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
  return tags
    .filter((tag) => /^wcag(?:\d{3,4}|2a|2aa|21aa|22aa)$/i.test(String(tag || '')))
    .slice(0, 8);
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

async function preparePageForChecks(page, availableMs) {
  const loadTimeout = Math.max(
    900,
    Math.min(LOAD_STATE_CAP_MS, Number.isFinite(availableMs) ? Math.max(900, availableMs - 250) : LOAD_STATE_CAP_MS)
  );
  try {
    await page.waitForLoadState('networkidle', { timeout: loadTimeout });
  } catch {}

  const scrollTimeout = Math.max(
    1200,
    Math.min(
      PAGE_PREP_SCROLL_TIMEOUT_MS,
      Number.isFinite(availableMs) ? Math.max(1200, availableMs - 250) : PAGE_PREP_SCROLL_TIMEOUT_MS
    )
  );
  try {
    await withTimeout(
      page.evaluate(async ({ stepPx, settleMs, maxSteps }) => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const documentHeight = () =>
          Math.max(
            document.documentElement ? document.documentElement.scrollHeight : 0,
            document.body ? document.body.scrollHeight : 0
          );
        const maxScrollY = () => Math.max(0, documentHeight() - window.innerHeight);

        // Walk the page progressively so IntersectionObserver/lazy-load content is actually triggered.
        for (let pass = 0; pass < 2; pass += 1) {
          let stepCount = 0;
          let y = 0;
          while (y < maxScrollY() && stepCount < maxSteps) {
            window.scrollTo(0, y);
            await wait(settleMs);
            y += stepPx;
            stepCount += 1;
          }
          window.scrollTo(0, maxScrollY());
          await wait(Math.max(settleMs, 260));
        }

        window.scrollTo(0, maxScrollY());
        await wait(Math.max(settleMs, 260));
        window.scrollTo(0, 0);
      }, {
        stepPx: PAGE_PREP_SCROLL_STEP_PX,
        settleMs: PAGE_PREP_SCROLL_SETTLE_MS,
        maxSteps: PAGE_PREP_MAX_SCROLL_STEPS
      }),
      scrollTimeout,
      'PAGE_PREP_TIMEOUT',
      `Page preparation exceeded ${scrollTimeout}ms`
    );
  } catch {}

  const assetWaitTimeout = Math.max(
    1400,
    Math.min(
      PAGE_PREP_ASSET_WAIT_TIMEOUT_MS,
      Number.isFinite(availableMs) ? Math.max(1400, availableMs - 200) : PAGE_PREP_ASSET_WAIT_TIMEOUT_MS
    )
  );
  try {
    await withTimeout(
      page.evaluate(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

        const mapAttribute = (el, attr, dataAttr) => {
          if (!el.hasAttribute(attr) && el.hasAttribute(dataAttr)) {
            el.setAttribute(attr, el.getAttribute(dataAttr) || '');
          }
        };

        const lazyCandidates = document.querySelectorAll(
          'img, source, iframe, video'
        );
        lazyCandidates.forEach((el) => {
          if (el.hasAttribute('loading')) {
            el.setAttribute('loading', 'eager');
          }
          mapAttribute(el, 'src', 'data-src');
          mapAttribute(el, 'srcset', 'data-srcset');
          mapAttribute(el, 'poster', 'data-poster');
        });

        const images = Array.from(document.images);
        await Promise.all(
          images.map(async (img) => {
            try {
              if (!img.complete) {
                await Promise.race([
                  new Promise((resolve) => img.addEventListener('load', resolve, { once: true })),
                  new Promise((resolve) => img.addEventListener('error', resolve, { once: true })),
                  wait(1800)
                ]);
              }
              if (typeof img.decode === 'function') {
                await img.decode().catch(() => {});
              }
            } catch {}
          })
        );

        if (document.fonts && typeof document.fonts.ready?.then === 'function') {
          await document.fonts.ready.catch(() => {});
        }
        await wait(160);
      }),
      assetWaitTimeout,
      'PAGE_ASSET_WAIT_TIMEOUT',
      `Page asset readiness exceeded ${assetWaitTimeout}ms`
    );
  } catch {}

  try {
    await page.waitForLoadState('networkidle', { timeout: Math.min(2000, loadTimeout) });
  } catch {}
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

function buildRuleTotals(issues) {
  const counts = new Map();
  for (const issue of Array.isArray(issues) ? issues : []) {
    const ruleId = String(issue?.ruleId || '').trim();
    if (!ruleId) continue;
    counts.set(ruleId, (counts.get(ruleId) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .slice(0, 10)
    .map(([ruleId, count]) => ({ ruleId, count }));
}

function buildImpactSummary(issues) {
  const summary = {
    critical: 0,
    serious: 0,
    moderate: 0,
    minor: 0
  };

  for (const issue of Array.isArray(issues) ? issues : []) {
    const impact = String(issue?.impact || '').toLowerCase();
    if (summary[impact] != null) summary[impact] += 1;
  }

  return summary;
}

function buildPerformanceIssueCountsByPage(performanceIssues) {
  const map = new Map();
  for (const issue of Array.isArray(performanceIssues) ? performanceIssues : []) {
    const pageUrl = String(issue?.pageUrl || '').trim();
    if (!pageUrl) continue;
    map.set(pageUrl, (map.get(pageUrl) || 0) + 1);
  }
  return map;
}

function aggregateEngineInsights(perPageInsights, issues) {
  const incompleteByRule = new Map();
  const incompleteSamples = [];

  for (const entry of Array.isArray(perPageInsights) ? perPageInsights : []) {
    if (!entry || !Array.isArray(entry.incomplete)) continue;
    for (const inc of entry.incomplete) {
      const ruleId = String(inc?.ruleId || '').trim();
      if (!ruleId) continue;
      incompleteByRule.set(ruleId, (incompleteByRule.get(ruleId) || 0) + 1);
      if (incompleteSamples.length < 10) {
        incompleteSamples.push({
          pageUrl: entry.pageUrl,
          ruleId,
          impact: inc.impact || 'moderate',
          help: inc.help || '',
          nodeCount: Number.isFinite(inc.nodeCount) ? inc.nodeCount : 0
        });
      }
    }
  }

  const incompleteTopRules = Array.from(incompleteByRule.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .slice(0, 8)
    .map(([ruleId, count]) => ({ ruleId, count }));

  return {
    issueCount: Array.isArray(issues) ? issues.length : 0,
    impactSummary: buildImpactSummary(issues),
    topRules: buildRuleTotals(issues),
    incompleteRuleCount: incompleteByRule.size,
    incompleteTopRules,
    incompleteSamples
  };
}

function buildIncompleteNeedsReviewFlags(perPageInsights) {
  const output = [];
  const seen = new Set();

  for (const entry of Array.isArray(perPageInsights) ? perPageInsights : []) {
    if (!entry || !Array.isArray(entry.incomplete)) continue;
    for (const inc of entry.incomplete) {
      const ruleId = String(inc?.ruleId || '').trim();
      if (!ruleId || seen.has(ruleId)) continue;
      seen.add(ruleId);
      output.push({
        id: `axe-incomplete-${ruleId}`,
        title: `Axe incomplete check: ${ruleId}`,
        reason: inc?.help || `Axe marked ${ruleId} as requiring manual verification.`,
        samples: [entry.pageUrl].filter(Boolean)
      });
      if (output.length >= 8) return output;
    }
  }

  return output;
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
    return 'Browser session closed unexpectedly. Rerun the scan.';
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
    await preparePageForChecks(
      page,
      Math.max(1400, Math.min(SCREENSHOT_CAPTURE_BUDGET_MS, timeBudget.remainingMs() - 300))
    );

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
  const mode = String(input.mode || '').toLowerCase() === 'crawl' ? 'crawl' : 'single';
  const ruleset = DEFAULT_RULESET;
  const includeBestPractices = true;
  const includeExperimental = false;
  const includeScreenshots = input.includeScreenshots == null ? true : Boolean(input.includeScreenshots);
  const maxPages = mode === 'crawl' ? clampMaxPages(input.maxPages) : 1;
  const profileTags = buildProfileTags(ruleset, includeBestPractices, includeExperimental);
  return {
    mode,
    ruleset,
    includeBestPractices,
    includeExperimental,
    profileTags,
    engineRules: selectEngineRules(profileTags),
    scope: {
      includeSelectors: [],
      excludeSelectors: []
    },
    includeScreenshots,
    debug: false,
    resourceBlocking: false,
    blockImages: false,
    timeoutMs: FIXED_SCAN_TIMEOUT_MS,
    maxPages,
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
  engineRules,
  scope,
  caps,
  timeBudget
}) {
  const pageStartedAt = Date.now();
  let page = null;
  const timings = {
    navigationMs: 0,
    engineMs: 0,
    performanceMs: 0
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
      await preparePageForChecks(
        page,
        Math.max(1600, Math.min(DEFAULT_PAGE_SCAN_BUDGET_MS, timeBudget.remainingMs() - 300))
      );
      timings.navigationMs = Date.now() - navStart;

      const engineStart = Date.now();
      const engineTimeout = Math.max(
        1200,
        Math.min(DEFAULT_ENGINE_TIMEOUT_MS, timeBudget.remainingMs() - 300)
      );
      const engineResult = await withTimeout(
        collectEngineViolations(page, {
          engineRules,
          includeSelectors: scope.includeSelectors,
          excludeSelectors: scope.excludeSelectors,
          maxNodeSamples: caps.maxNodesPerViolation,
          maxHtmlSnippetLength: MAX_HTML_SNIPPET_LENGTH,
          maxFailureSummaryLength: MAX_FAILURE_SUMMARY_LENGTH
        }),
        engineTimeout,
        'ENGINE_TIMEOUT',
        `${SCAN_ENGINE_NAME} analysis timed out after ${engineTimeout}ms`
      );
      timings.engineMs = Date.now() - engineStart;

      const heuristics = await runHeuristics(page);
      const performanceStart = Date.now();
      const performanceAudit = await collectPerformanceAudit(page, pageUrl);
      timings.performanceMs = Date.now() - performanceStart;
      const violations = Array.isArray(engineResult.violations)
        ? [...engineResult.violations].sort(compareViolations)
        : [];

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
        engineInsights: engineResult?.insights || null,
        performanceIssues: Array.isArray(performanceAudit?.issues) ? performanceAudit.issues : [],
        performanceSummary: performanceAudit?.summary || summarizePerformanceIssues([]),
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
      error?.code === 'PAGE_TIMEOUT' || error?.code === 'ENGINE_TIMEOUT' ? 'timeout' : 'error';
    return {
      status,
      issues: [],
      heuristics: null,
      engineInsights: null,
      performanceIssues: [],
      performanceSummary: summarizePerformanceIssues([]),
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
  const timeBudget = createTimeBudget(options.timeoutMs, options.mode);
  const startUrl = normalizeUrl(input.startUrl, { stripTrackingParams: true });

  if (!startUrl) {
    return {
      status: 'partial',
      message: 'Invalid start URL. Returning empty partial result.',
      service: SCAN_ENGINE_NAME,
      mode: options.mode,
      startedAt: new Date(timeBudget.startedAtMs).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: timeBudget.elapsedMs(),
      elapsedMs: timeBudget.elapsedMs(),
      pages: [],
      issues: [],
      performanceIssues: [],
      screenshots: [],
      needsReview: [],
      truncated: true,
      metadata: {
        durationMs: timeBudget.elapsedMs(),
        pagesAttempted: 0,
        pagesScanned: 0,
        truncated: true,
        truncation: { timeBudget: false, maxTotalIssues: false },
        errorsSummary: { totalErrors: 1, totalTimeouts: 0, messages: ['Invalid start URL'] },
        caps: options.caps,
        engine: {
          name: SCAN_ENGINE_NAME,
          activeRuleCount: options.engineRules.length,
          insights: aggregateEngineInsights([], [])
        },
        standards: {
          ruleset: options.ruleset,
          tags: options.profileTags,
          includeBestPractices: options.includeBestPractices,
          includeExperimental: options.includeExperimental
        },
        scope: options.scope,
        performance: summarizePerformanceIssues([])
      }
    };
  }

  let browser = null;
  let context = null;
  let breakReason = '';

  const pagesSummary = [];
  const issues = [];
  const performanceIssues = [];
  const screenshots = [];
  const heuristicFlags = [];
  const globalErrors = [];
  const debugPages = [];
  const engineInsightsByPage = [];

  let pagesAttempted = 0;
  let pagesScanned = 0;
  let scanTruncated = false;
  let totalIssuesCapHit = false;
  let maxPagesCapHit = false;
  let timeBudgetHit = false;
  let runtimeErrorMessage = '';
  let runtimeHint = '';

  try {
    browser = await launchBrowser();

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
        engineRules: options.engineRules,
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
      if (pageResult.engineInsights) {
        engineInsightsByPage.push({
          pageUrl: current.url,
          ...pageResult.engineInsights
        });
      }
      if (Array.isArray(pageResult.performanceIssues) && pageResult.performanceIssues.length > 0) {
        performanceIssues.push(...pageResult.performanceIssues);
      }

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
        performanceIssueCount: Array.isArray(pageResult.performanceIssues) ? pageResult.performanceIssues.length : 0,
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
          engineMs: pageResult.timings.engineMs,
          performanceMs: pageResult.timings.performanceMs,
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
  const performanceSummary = summarizePerformanceIssues(performanceIssues);
  const performanceIssuesByPage = buildPerformanceIssueCountsByPage(performanceIssues);
  const needsReview = mergeNeedsReview(
    buildNeedsReviewFlags(options.mode, pagesSummary),
    [...heuristicFlags, ...buildIncompleteNeedsReviewFlags(engineInsightsByPage)]
  );

  const response = {
    status,
    message,
    service: SCAN_ENGINE_NAME,
    mode: options.mode,
    startedAt,
    finishedAt,
    durationMs,
    elapsedMs: durationMs,
    limits: {
      timeoutMs: timeBudget.totalBudgetMs,
      maxDepth: MAX_DEPTH,
      maxViolationsPerPage: options.caps.maxViolationsPerPage,
      maxNodesPerViolation: options.caps.maxNodesPerViolation,
      maxTotalIssuesOverall: options.caps.maxTotalIssuesOverall,
      screenshotMaxBytesPerImage: MAX_SCREENSHOT_BYTES_PER_IMAGE
    },
    truncated: scanTruncated,
    truncation: {
      timeBudget: timeBudgetHit,
      maxTotalIssues: totalIssuesCapHit
    },
    pages: pagesSummary,
    issues,
    performanceIssues,
    screenshots,
    needsReview,
    metadata: {
      durationMs,
      pagesAttempted,
      pagesScanned,
      truncated: scanTruncated,
      truncation: {
        timeBudget: timeBudgetHit,
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
      engine: {
        name: SCAN_ENGINE_NAME,
        activeRuleCount: options.engineRules.length,
        insights: aggregateEngineInsights(engineInsightsByPage, issues)
      },
      standards: {
        ruleset: options.ruleset,
        tags: options.profileTags,
        includeBestPractices: options.includeBestPractices,
        includeExperimental: options.includeExperimental
      },
      scope: options.scope,
      performance: {
        ...performanceSummary,
        pages: pagesSummary.map((page) => ({
          url: page.url,
          issueCount: performanceIssuesByPage.get(page.url) || 0
        }))
      },
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
