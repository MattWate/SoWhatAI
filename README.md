# SoWhatAI
AI Powered Research Tool

## WCAG Scan

The app now includes a WCAG scanning page at `/wcag-scan`.

1. Open the home page and click `WCAG Scan`.
2. Enter a public URL.
3. Run the single-page scan to view summary, per-page issues, and rule-level details.

The scan runs through `POST /.netlify/functions/wcag-scan` using Playwright + `axe-core`, and captures screenshots with markers for issue pinpointing.
The fixed profile runs WCAG 2.2 AA with best-practice/advanced checks enabled and experimental checks disabled.

Accessibility testing powered by axe-core.
Third-party license notice: `SoWhatAI/licenses/axe-core-LICENSE.txt`.

### Limitations and Manual Verification

- Automated checks do not cover all WCAG 2.2 AA requirements and can produce false positives/false negatives.
- `needsReview` items in the WCAG Scan results require human validation.
- `metadata.engine.insights` includes top failing rules and incomplete/manual-review rule signals for faster triage.
- Final accessibility sign-off should always include manual testing (keyboard-only flows, focus behavior, screen reader checks, and task-based QA).
