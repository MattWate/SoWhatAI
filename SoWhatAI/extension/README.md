# RedFlag — Chrome Extension

Scan any webpage for WCAG 2.1 & 2.2 AA accessibility issues and sync results to your RedFlag dashboard.

---

## Setup

### 1. Download axe-core

The extension requires `axe.min.js` from [axe-core](https://github.com/dequelabs/axe-core/releases).

- Go to the latest release on GitHub
- Download `axe.min.js`
- Place it at `extension/lib/axe.min.js`

Or via npm (if you have Node installed):

```bash
npm install axe-core
cp node_modules/axe-core/axe.min.js extension/lib/axe.min.js
```

### 2. Add your Supabase anon key

Open `extension/popup.js` and replace `YOUR_ANON_KEY_HERE` on line 2 with your Supabase project's anon/public key. Find it in your Supabase dashboard under **Project Settings → API**.

The same key goes in `extension/background.js` — update `SUPABASE_ANON_KEY_STORAGE` or store it via `chrome.storage.local` at first run.

### 3. Add placeholder icons (optional for local dev)

Create or drop any PNG files at:

```
extension/icons/16.png
extension/icons/48.png
extension/icons/128.png
```

Chrome will show a broken icon badge until these exist. Any PNG of the correct size works during development.

### 4. Load the extension in Chrome

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right)
3. Click **Load unpacked**
4. Select the `extension/` folder
5. The RedFlag icon will appear in your toolbar

---

## Connecting to your dashboard

1. Click the RedFlag icon in Chrome
2. Sign in with your RedFlag account email and password
3. Navigate to any page and click **Scan This Page**
4. Review violations grouped by severity
5. Click **Save to Dashboard** to persist results to Supabase

Violations are saved to the `redflag_violations` table in your Supabase project and will appear in your RedFlag web dashboard.

---

## Supabase table

The extension writes to a `redflag_violations` table. Ensure it exists with at least these columns:

| Column | Type |
|---|---|
| `id` | uuid (default gen_random_uuid()) |
| `page_url` | text |
| `rule_id` | text |
| `impact` | text |
| `description` | text |
| `help_url` | text |
| `nodes` | jsonb |
| `status` | text (default 'open') |
| `project_id` | uuid (nullable, FK to your projects table) |
| `scanned_at` | timestamptz |

---

## Publishing to the Chrome Web Store

1. Zip the entire `extension/` folder (not the parent directory)
2. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
3. Pay the one-time $5 developer registration fee if you haven't already
4. Click **New Item** and upload the zip
5. Fill in store listing details, screenshots, and privacy policy
6. Submit for review — typically 1–3 business days

> Before publishing, replace `YOUR_ANON_KEY_HERE` with a restricted key or remove it and require users to enter their own Supabase credentials.
