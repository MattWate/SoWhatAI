const LARGE_BYTES_MB = 1024 * 1024;

function toRounded(value, precision = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const p = 10 ** precision;
  return Math.round(num * p) / p;
}

function bytesToKb(bytes) {
  return toRounded(Number(bytes || 0) / 1024, 1);
}

function impactFromThreshold(value, moderateThreshold, seriousThreshold) {
  if (!Number.isFinite(value)) return '';
  if (value >= seriousThreshold) return 'serious';
  if (value >= moderateThreshold) return 'moderate';
  return '';
}

function createIssue({
  pageUrl,
  ruleId,
  impact,
  title,
  failureSummary,
  recommendation,
  metric,
  value,
  threshold,
  sample
}) {
  return {
    pageUrl,
    ruleId,
    impact,
    category: 'performance',
    title,
    failureSummary,
    recommendation,
    metric: metric || '',
    value: value == null ? '' : String(value),
    threshold: threshold || '',
    sample: sample || ''
  };
}

function ruleTotals(issues) {
  const map = new Map();
  for (const issue of Array.isArray(issues) ? issues : []) {
    const id = String(issue?.ruleId || '').trim();
    if (!id) continue;
    map.set(id, (map.get(id) || 0) + 1);
  }
  return Array.from(map.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .slice(0, 10)
    .map(([ruleId, count]) => ({ ruleId, count }));
}

function impactTotals(issues) {
  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const issue of Array.isArray(issues) ? issues : []) {
    const impact = String(issue?.impact || '').toLowerCase();
    if (counts[impact] != null) counts[impact] += 1;
  }
  return counts;
}

function summarizePerformanceIssues(issues) {
  const list = Array.isArray(issues) ? issues : [];
  return {
    issueCount: list.length,
    impactSummary: impactTotals(list),
    topRules: ruleTotals(list)
  };
}

async function collectPerformanceAudit(page, pageUrl) {
  try {
    const metrics = await page.evaluate(() => {
      const safeUrl = (input) => {
        try {
          return new URL(input, window.location.href);
        } catch {
          return null;
        }
      };

      const resources = performance.getEntriesByType('resource').map((entry) => {
        const transfer = Number(entry.transferSize || 0);
        const encoded = Number(entry.encodedBodySize || 0);
        const decoded = Number(entry.decodedBodySize || 0);
        const size = Math.max(transfer, encoded, decoded, 0);
        return {
          name: String(entry.name || ''),
          initiatorType: String(entry.initiatorType || ''),
          duration: Number(entry.duration || 0),
          size
        };
      });

      const nav = performance.getEntriesByType('navigation')[0] || null;
      const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
      const clsEntries = performance.getEntriesByType('layout-shift');
      const longTasks = performance.getEntriesByType('longtask');

      const locationOrigin = window.location.origin;
      const thirdParty = resources.filter((resource) => {
        const parsed = safeUrl(resource.name);
        return parsed && parsed.origin !== locationOrigin;
      });

      const jsResources = resources.filter(
        (resource) =>
          resource.initiatorType === 'script' ||
          /\.m?js(\?|$)/i.test(resource.name)
      );
      const imageResources = resources.filter(
        (resource) =>
          resource.initiatorType === 'img' ||
          /\.(avif|webp|png|jpe?g|gif|svg)(\?|$)/i.test(resource.name)
      );

      const largestImages = [...imageResources]
        .sort((a, b) => b.size - a.size)
        .slice(0, 5)
        .map((resource) => ({
          name: resource.name,
          size: resource.size
        }));

      const offscreenWithoutLazy = Array.from(document.images).filter((img) => {
        const rect = img.getBoundingClientRect();
        const farBelowFold = rect.top > window.innerHeight * 1.5;
        const loading = String(img.getAttribute('loading') || '').toLowerCase();
        return farBelowFold && loading !== 'lazy';
      }).length;

      const cls = clsEntries
        .filter((entry) => !entry.hadRecentInput)
        .reduce((sum, entry) => sum + Number(entry.value || 0), 0);

      const lcp = lcpEntries.length
        ? Number(lcpEntries[lcpEntries.length - 1].startTime || 0)
        : 0;

      const longTaskTotal = longTasks.reduce((sum, task) => sum + Number(task.duration || 0), 0);

      return {
        requestCount: resources.length,
        totalBytes: resources.reduce((sum, resource) => sum + resource.size, 0),
        jsBytes: jsResources.reduce((sum, resource) => sum + resource.size, 0),
        imageBytes: imageResources.reduce((sum, resource) => sum + resource.size, 0),
        thirdPartyRequests: thirdParty.length,
        domNodeCount: document.getElementsByTagName('*').length,
        renderBlockingStylesheets: document.querySelectorAll(
          'head link[rel="stylesheet"]:not([media="print"])'
        ).length,
        renderBlockingScripts: document.querySelectorAll(
          'head script[src]:not([async]):not([defer])'
        ).length,
        offscreenWithoutLazy,
        ttfbMs: nav ? Number(nav.responseStart || 0) : 0,
        lcpMs: lcp,
        cls,
        longTaskCount: longTasks.length,
        longTaskTotalMs: longTaskTotal,
        largestImages
      };
    });

    const issues = [];

    const totalByteImpact = impactFromThreshold(metrics.totalBytes, 3 * LARGE_BYTES_MB, 5 * LARGE_BYTES_MB);
    if (totalByteImpact) {
      issues.push(
        createIssue({
          pageUrl,
          ruleId: 'total-byte-weight',
          impact: totalByteImpact,
          title: 'Total page weight is high',
          failureSummary: `Transferred resource weight is ${bytesToKb(metrics.totalBytes)} KB across network requests.`,
          recommendation: 'Compress heavy assets, defer non-critical bundles, and optimize image formats.',
          metric: 'totalBytes',
          value: `${bytesToKb(metrics.totalBytes)} KB`,
          threshold: '>= 3072 KB (moderate), >= 5120 KB (serious)'
        })
      );
    }

    const requestImpact = impactFromThreshold(metrics.requestCount, 100, 160);
    if (requestImpact) {
      issues.push(
        createIssue({
          pageUrl,
          ruleId: 'network-requests',
          impact: requestImpact,
          title: 'High number of network requests',
          failureSummary: `Page initiated ${metrics.requestCount} resource requests.`,
          recommendation: 'Reduce request count via bundling, inlining critical assets, and removing unused resources.',
          metric: 'requestCount',
          value: metrics.requestCount,
          threshold: '>= 100 (moderate), >= 160 (serious)'
        })
      );
    }

    const thirdPartyImpact = impactFromThreshold(metrics.thirdPartyRequests, 30, 60);
    if (thirdPartyImpact) {
      issues.push(
        createIssue({
          pageUrl,
          ruleId: 'third-party-summary',
          impact: thirdPartyImpact,
          title: 'Third-party request pressure is high',
          failureSummary: `${metrics.thirdPartyRequests} requests were loaded from third-party origins.`,
          recommendation: 'Audit third-party scripts/widgets and remove or defer non-essential vendors.',
          metric: 'thirdPartyRequests',
          value: metrics.thirdPartyRequests,
          threshold: '>= 30 (moderate), >= 60 (serious)'
        })
      );
    }

    const jsImpact = impactFromThreshold(metrics.jsBytes, 900 * 1024, 1500 * 1024);
    if (jsImpact) {
      issues.push(
        createIssue({
          pageUrl,
          ruleId: 'javascript-payload',
          impact: jsImpact,
          title: 'JavaScript payload is heavy',
          failureSummary: `JavaScript resources total ${bytesToKb(metrics.jsBytes)} KB.`,
          recommendation: 'Code split aggressively and remove unused libraries/routes from initial bundles.',
          metric: 'jsBytes',
          value: `${bytesToKb(metrics.jsBytes)} KB`,
          threshold: '>= 900 KB (moderate), >= 1500 KB (serious)'
        })
      );
    }

    const blockingCount = Number(metrics.renderBlockingScripts || 0) + Number(metrics.renderBlockingStylesheets || 0);
    const blockingImpact = impactFromThreshold(blockingCount, 4, 8);
    if (blockingImpact) {
      issues.push(
        createIssue({
          pageUrl,
          ruleId: 'render-blocking-resources',
          impact: blockingImpact,
          title: 'Render-blocking resources detected',
          failureSummary: `${blockingCount} blocking resources found in <head> (${metrics.renderBlockingStylesheets} stylesheet(s), ${metrics.renderBlockingScripts} script(s)).`,
          recommendation: 'Inline critical CSS and defer non-critical scripts/stylesheets.',
          metric: 'blockingResources',
          value: blockingCount,
          threshold: '>= 4 (moderate), >= 8 (serious)'
        })
      );
    }

    const domImpact = impactFromThreshold(metrics.domNodeCount, 1500, 3000);
    if (domImpact) {
      issues.push(
        createIssue({
          pageUrl,
          ruleId: 'dom-size',
          impact: domImpact,
          title: 'DOM size is large',
          failureSummary: `DOM contains ${metrics.domNodeCount} nodes.`,
          recommendation: 'Simplify nested structures and reduce duplicated/hidden markup.',
          metric: 'domNodeCount',
          value: metrics.domNodeCount,
          threshold: '>= 1500 (moderate), >= 3000 (serious)'
        })
      );
    }

    const ttfbImpact = impactFromThreshold(metrics.ttfbMs, 800, 1800);
    if (ttfbImpact) {
      issues.push(
        createIssue({
          pageUrl,
          ruleId: 'server-response-time',
          impact: ttfbImpact,
          title: 'Server response time is slow',
          failureSummary: `Estimated TTFB is ${toRounded(metrics.ttfbMs, 0)} ms.`,
          recommendation: 'Improve caching and server processing performance on first response.',
          metric: 'ttfbMs',
          value: `${toRounded(metrics.ttfbMs, 0)} ms`,
          threshold: '>= 800ms (moderate), >= 1800ms (serious)'
        })
      );
    }

    const lcpImpact = impactFromThreshold(metrics.lcpMs, 2500, 4000);
    if (lcpImpact) {
      issues.push(
        createIssue({
          pageUrl,
          ruleId: 'largest-contentful-paint',
          impact: lcpImpact,
          title: 'Largest Contentful Paint is high',
          failureSummary: `Estimated LCP is ${toRounded(metrics.lcpMs, 0)} ms.`,
          recommendation: 'Prioritize above-the-fold assets and reduce render-blocking work.',
          metric: 'lcpMs',
          value: `${toRounded(metrics.lcpMs, 0)} ms`,
          threshold: '>= 2500ms (moderate), >= 4000ms (serious)'
        })
      );
    }

    const clsImpact = impactFromThreshold(metrics.cls, 0.1, 0.25);
    if (clsImpact) {
      issues.push(
        createIssue({
          pageUrl,
          ruleId: 'cumulative-layout-shift',
          impact: clsImpact,
          title: 'Layout instability detected',
          failureSummary: `Estimated CLS is ${toRounded(metrics.cls, 3)}.`,
          recommendation: 'Reserve explicit width/height for media and avoid layout-shifting late inserts.',
          metric: 'cls',
          value: toRounded(metrics.cls, 3),
          threshold: '>= 0.1 (moderate), >= 0.25 (serious)'
        })
      );
    }

    const longTaskImpact = impactFromThreshold(metrics.longTaskTotalMs, 300, 1000);
    if (longTaskImpact) {
      issues.push(
        createIssue({
          pageUrl,
          ruleId: 'long-main-thread-tasks',
          impact: longTaskImpact,
          title: 'Long main-thread work detected',
          failureSummary: `${metrics.longTaskCount} long task(s), total ${toRounded(metrics.longTaskTotalMs, 0)} ms.`,
          recommendation: 'Break up long tasks and defer non-critical script execution.',
          metric: 'longTaskTotalMs',
          value: `${toRounded(metrics.longTaskTotalMs, 0)} ms`,
          threshold: '>= 300ms (moderate), >= 1000ms (serious)'
        })
      );
    }

    if (Number(metrics.offscreenWithoutLazy) > 0) {
      const impact = metrics.offscreenWithoutLazy >= 8 ? 'serious' : 'moderate';
      issues.push(
        createIssue({
          pageUrl,
          ruleId: 'offscreen-images-lazy-loading',
          impact,
          title: 'Offscreen images are not lazy-loaded',
          failureSummary: `${metrics.offscreenWithoutLazy} offscreen image(s) missing loading=\"lazy\".`,
          recommendation: 'Apply lazy loading to below-the-fold images.',
          metric: 'offscreenWithoutLazy',
          value: metrics.offscreenWithoutLazy,
          threshold: '>= 1'
        })
      );
    }

    for (const image of Array.isArray(metrics.largestImages) ? metrics.largestImages : []) {
      const size = Number(image?.size || 0);
      if (!Number.isFinite(size) || size < 300 * 1024) continue;
      const impact = size >= 900 * 1024 ? 'serious' : 'moderate';
      issues.push(
        createIssue({
          pageUrl,
          ruleId: 'large-image-resource',
          impact,
          title: 'Large image resource detected',
          failureSummary: `Image transfer size is ${bytesToKb(size)} KB.`,
          recommendation: 'Compress image and serve modern formats sized to display dimensions.',
          metric: 'imageBytes',
          value: `${bytesToKb(size)} KB`,
          threshold: '>= 300 KB',
          sample: String(image?.name || '')
        })
      );
    }

    return {
      issues: issues.slice(0, 60),
      summary: summarizePerformanceIssues(issues),
      metrics
    };
  } catch (error) {
    return {
      issues: [
        createIssue({
          pageUrl,
          ruleId: 'performance-audit-runtime',
          impact: 'minor',
          title: 'Performance audit did not fully complete',
          failureSummary: error?.message || String(error),
          recommendation: 'Rerun the scan to retry performance analysis.'
        })
      ],
      summary: summarizePerformanceIssues([]),
      metrics: {}
    };
  }
}

export { collectPerformanceAudit, summarizePerformanceIssues };
