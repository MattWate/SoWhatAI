# SoWhatAI
AI Powered Research Tool

## WCAG Scan

The app now includes a WCAG scanning page at `/wcag-scan`.

1. Open the home page and click `WCAG Scan`.
2. Enter a public URL.
3. Choose `Single page` or `Crawl` mode.
4. Run the scan to view summary, per-page issues, and rule-level details.

The scan runs through `POST /.netlify/functions/wcag-scan` using Playwright + the in-house `LumenScan` rules engine and supports optional screenshot markers for issue pinpointing.

### Limitations and Manual Verification

- Automated checks do not cover all WCAG 2.2 AA requirements and can produce false positives/false negatives.
- `needsReview` items in the WCAG Scan results require human validation.
- Final accessibility sign-off should always include manual testing (keyboard-only flows, focus behavior, screen reader checks, and task-based QA).
