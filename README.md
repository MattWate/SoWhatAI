# SoWhatAI
AI Powered Research Tool

## WCAG Scan

The app now includes a WCAG scanning page at `/wcag-scan`.

1. Open the home page and click `WCAG Scan`.
2. Enter a public URL.
3. Run the single-page scan to view summary, per-page issues, and rule-level details.

The scan runs through `POST /.netlify/functions/wcag-scan` as a serverless multi-engine audit endpoint (no headless browser runtime in the function path).
The fixed profile targets WCAG 2.2 AA accessibility signals, with PSI performance/SEO/best-practices extraction.
The same endpoint now uses a parallel multi-engine pipeline (all engines run with `Promise.allSettled` and per-engine timeouts) and merges Google PageSpeed Insights data into the final report under:

- `accessibility` (axe-core attribution + Lighthouse accessibility signals)
- `performance` (score, Core Web Vitals, Lighthouse metrics, opportunities, diagnostics, performance issues)
- `seo` (Lighthouse SEO signals)
- `bestPractices` (Lighthouse best-practices signals)
- `summary` (`accessibilityScore`, `performanceScore`, `seoScore`, `bestPracticesScore`, `overallScore`)
- `metadata.engineErrors` (partial-failure messages when any engine fails)
- `metadata.timeoutOccurred` + `metadata.truncated` for serverless time-budget cutoffs (`TOTAL_SCAN_BUDGET_MS = 20000`)

Set `PAGESPEED_API_KEY` in Netlify environment variables to use a dedicated PSI key (optional, but recommended for higher quota).
The orchestrator fetches PSI once per scanned page and shares that payload across accessibility/performance/SEO/best-practices engines to reduce quota usage.

Accessibility testing powered by axe-core.
Third-party license notice: `SoWhatAI/licenses/axe-core-LICENSE.txt`.

### Limitations and Manual Verification

- Automated checks do not cover all WCAG 2.2 AA requirements and can produce false positives/false negatives.
- `needsReview` items in the WCAG Scan results require human validation.
- `metadata.engine.insights` includes top failing rules and incomplete/manual-review rule signals for faster triage.
- Final accessibility sign-off should always include manual testing (keyboard-only flows, focus behavior, screen reader checks, and task-based QA).
