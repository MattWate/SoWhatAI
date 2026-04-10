const SUPABASE_URL = 'https://wopdpporlylygxyvpene.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndvcGRwcG9ybHlseWd4eXZwZW5lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTMwOTg0MjIsImV4cCI6MjA2ODY3NDQyMn0.ub5LP_93NcC6wkJbkQWkJ6oBLTKrUNJIiZJosgA9c6Q';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const authSection    = document.getElementById('auth-section');
const mainSection    = document.getElementById('main-section');
const mainFooter     = document.getElementById('main-footer');
const authError      = document.getElementById('auth-error');
const emailInput     = document.getElementById('auth-email');
const passwordInput  = document.getElementById('auth-password');
const btnSignin      = document.getElementById('btn-signin');
const btnScan        = document.getElementById('btn-scan');
const btnSave        = document.getElementById('btn-save');
const btnClear       = document.getElementById('btn-clear');
const btnLogout      = document.getElementById('btn-logout');
const spinner        = document.getElementById('spinner');
const resultsSection = document.getElementById('results-section');
const scanError      = document.getElementById('scan-error');
const pageUrlEl      = document.getElementById('page-url');
const issueList      = document.getElementById('issue-list');
const saveStatus     = document.getElementById('save-status');
const violationsLabel = document.getElementById('violations-label');

let currentResults = null;
let currentPageUrl = null;
let savedToDb = false;

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const { authToken } = await storageGet(['authToken']);
  if (authToken) {
    showMain();
  } else {
    showAuth();
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url) {
    currentPageUrl = tab.url;
    pageUrlEl.textContent = tab.url;
  }
});

// ── Auth ──────────────────────────────────────────────────────────────────────
btnSignin.addEventListener('click', async () => {
  const email    = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) { showAuthError('Please enter your email and password.'); return; }

  setAuthLoading(true);
  hideAuthError();

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.msg || 'Sign in failed');

    await chrome.storage.local.set({
      authToken: data.access_token,
      refreshToken: data.refresh_token,
      userId: data.user?.id,
      anonKey: SUPABASE_ANON_KEY,
    });
    showMain();
  } catch (err) {
    showAuthError(err.message);
  } finally {
    setAuthLoading(false);
  }
});

passwordInput.addEventListener('keydown', e => { if (e.key === 'Enter') btnSignin.click(); });

// ── Scan ──────────────────────────────────────────────────────────────────────
btnScan.addEventListener('click', async () => {
  setScanLoading(true);
  hideScanError();
  resultsSection.style.display = 'none';
  saveStatus.textContent = '';
  savedToDb = false;
  currentResults = null;

  try {
    const response = await chrome.runtime.sendMessage({ type: 'SCAN_ACTIVE_TAB' });
    if (!response || response.error) throw new Error(response?.error || 'No response from scanner');
    currentResults = response;
    renderResults(response);
  } catch (err) {
    showScanError(err.message);
  } finally {
    setScanLoading(false);
  }
});

// ── Render Results ────────────────────────────────────────────────────────────
function renderResults(results) {
  const violations = results.violations || [];

  // Group by impact
  const groups = { critical: [], serious: [], moderate: [], minor: [] };
  for (const v of violations) {
    const key = v.impact in groups ? v.impact : 'minor';
    groups[key].push(v);
  }

  document.getElementById('count-critical').textContent = groups.critical.length;
  document.getElementById('count-serious').textContent  = groups.serious.length;
  document.getElementById('count-moderate').textContent = groups.moderate.length;
  document.getElementById('count-minor').textContent    = groups.minor.length;

  const total = violations.length;
  violationsLabel.textContent = total === 0
    ? 'No violations found'
    : `${total} violation${total !== 1 ? 's' : ''} found`;

  issueList.innerHTML = '';

  const order = ['critical', 'serious', 'moderate', 'minor'];
  for (const impact of order) {
    for (const violation of groups[impact]) {
      issueList.appendChild(buildIssueItem(violation));
    }
  }

  resultsSection.style.display = 'block';
  btnSave.disabled = total === 0;
}

function buildIssueItem(violation) {
  const item = document.createElement('div');
  item.className = 'issue-item';

  const impactClass = `imp-${violation.impact || 'minor'}`;
  const desc = (violation.description || violation.help || '').slice(0, 80);
  const nodeCount = violation.nodes?.length ?? 0;

  item.innerHTML = `
    <div class="issue-header">
      <span class="impact-pill ${impactClass}">${violation.impact || 'minor'}</span>
      <span class="issue-desc" title="${escHtml(violation.description || '')}">${escHtml(desc)}${(violation.description || '').length > 80 ? '…' : ''}</span>
      <span class="issue-rule">${escHtml(violation.id)}</span>
      <span class="issue-node-count">${nodeCount} node${nodeCount !== 1 ? 's' : ''}</span>
      <span class="issue-arrow">▶</span>
    </div>
    <div class="issue-body">${buildNodes(violation)}</div>
  `;

  item.querySelector('.issue-header').addEventListener('click', () => {
    item.classList.toggle('expanded');
  });

  return item;
}

function buildNodes(violation) {
  if (!violation.nodes?.length) return '<div style="color:#475569;font-size:11px;padding-top:8px">No nodes</div>';
  return violation.nodes.map((node) => {
    const selector = Array.isArray(node.target) ? node.target.join(', ') : (node.target || '');
    const html = (node.html || '').slice(0, 200);
    return `
      <div class="node-item">
        <div class="node-selector">${escHtml(selector)}</div>
        <div class="node-html">${escHtml(html)}</div>
        <div class="node-actions">
          <button class="btn-highlight" data-selector="${escAttr(selector)}">Highlight on page</button>
          <button class="btn-fixed" disabled title="Save to dashboard first">Mark as Fixed</button>
        </div>
      </div>
    `;
  }).join('');
}

// Event delegation for highlight buttons
issueList.addEventListener('click', e => {
  const btn = e.target.closest('.btn-highlight');
  if (!btn) return;
  const selector = btn.dataset.selector;
  if (!selector) return;
  chrome.runtime.sendMessage({ type: 'HIGHLIGHT_ELEMENT', selector });
});

// ── Save to Dashboard ─────────────────────────────────────────────────────────
btnSave.addEventListener('click', async () => {
  if (!currentResults || !currentPageUrl) return;
  btnSave.disabled = true;
  saveStatus.textContent = 'Saving…';

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'SAVE_TO_DASHBOARD',
      violations: currentResults.violations || [],
      pageUrl: currentPageUrl,
    });
    if (response?.error) throw new Error(response.error);
    savedToDb = true;
    saveStatus.textContent = `✓ Saved ${response.saved} violation${response.saved !== 1 ? 's' : ''} to dashboard`;
    enableMarkAsFixed();
  } catch (err) {
    saveStatus.style.color = '#fca5a5';
    saveStatus.textContent = `Save failed: ${err.message}`;
    btnSave.disabled = false;
  }
});

function enableMarkAsFixed() {
  document.querySelectorAll('.btn-fixed').forEach(btn => {
    btn.disabled = false;
    btn.title = '';
    btn.addEventListener('click', handleMarkFixed, { once: true });
  });
}

async function handleMarkFixed(e) {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Marked';
  // Future: send message to background to update violation status in Supabase
}

// ── Clear Highlight ───────────────────────────────────────────────────────────
btnClear.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'CLEAR_HIGHLIGHT' });
});

// ── Logout ────────────────────────────────────────────────────────────────────
btnLogout.addEventListener('click', async () => {
  await chrome.storage.local.clear();
  currentResults = null;
  currentPageUrl = null;
  savedToDb = false;
  resultsSection.style.display = 'none';
  showAuth();
});

// ── UI helpers ────────────────────────────────────────────────────────────────
function showAuth() {
  authSection.style.display = 'none';
  mainSection.style.display = 'none';
  mainFooter.style.display  = 'none';
  authSection.style.display = 'block';
}

function showMain() {
  authSection.style.display = 'none';
  mainSection.style.display = 'block';
  mainFooter.style.display  = 'flex';
}

function setAuthLoading(loading) {
  btnSignin.disabled    = loading;
  btnSignin.textContent = loading ? 'Signing in…' : 'Sign In';
}

function setScanLoading(loading) {
  btnScan.disabled    = loading;
  btnScan.textContent = loading ? 'Scanning…' : 'Scan This Page';
  spinner.style.display = loading ? 'flex' : 'none';
}

function showAuthError(msg) {
  authError.textContent    = msg;
  authError.style.display  = 'block';
}
function hideAuthError() { authError.style.display = 'none'; }

function showScanError(msg) {
  scanError.textContent   = msg;
  scanError.style.display = 'block';
}
function hideScanError() { scanError.style.display = 'none'; }

function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}
