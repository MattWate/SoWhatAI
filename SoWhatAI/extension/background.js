const SUPABASE_URL = 'https://wopdpporlylygxyvpene.supabase.co';
const SUPABASE_ANON_KEY_STORAGE = 'SUPABASE_ANON_KEY';

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToContentScript(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

async function getStoredAuth() {
  return new Promise(resolve => {
    chrome.storage.local.get(['authToken', 'anonKey', 'userId'], resolve);
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {

  // ── SCAN_ACTIVE_TAB ──────────────────────────────────────────────────────────
  if (message.type === 'SCAN_ACTIVE_TAB') {
    getActiveTab().then(tab => {
      if (!tab) { sendResponse({ error: 'No active tab' }); return; }
      chrome.tabs.sendMessage(tab.id, { type: 'RUN_SCAN' }, response => {
        if (chrome.runtime.lastError) {
          // Content script not ready — inject and retry
          chrome.scripting.executeScript(
            { target: { tabId: tab.id }, files: ['lib/axe.min.js', 'content.js'] },
            () => {
              if (chrome.runtime.lastError) {
                sendResponse({ error: chrome.runtime.lastError.message });
                return;
              }
              chrome.tabs.sendMessage(tab.id, { type: 'RUN_SCAN' }, retry => {
                sendResponse(retry ?? { error: 'Scan failed after inject' });
              });
            }
          );
        } else {
          sendResponse(response ?? { error: 'No response from content script' });
        }
      });
    });
    return true;
  }

  // ── HIGHLIGHT_ELEMENT ────────────────────────────────────────────────────────
  if (message.type === 'HIGHLIGHT_ELEMENT') {
    getActiveTab().then(tab => {
      if (!tab) { sendResponse({ ok: false }); return; }
      sendToContentScript(tab.id, message).then(sendResponse).catch(() => sendResponse({ ok: false }));
    });
    return true;
  }

  // ── CLEAR_HIGHLIGHT ──────────────────────────────────────────────────────────
  if (message.type === 'CLEAR_HIGHLIGHT') {
    getActiveTab().then(tab => {
      if (!tab) { sendResponse({ ok: false }); return; }
      sendToContentScript(tab.id, message).then(sendResponse).catch(() => sendResponse({ ok: false }));
    });
    return true;
  }

  // ── SAVE_TO_DASHBOARD ────────────────────────────────────────────────────────
  if (message.type === 'SAVE_TO_DASHBOARD') {
    const { violations, pageUrl, projectId } = message;
    getStoredAuth().then(async ({ authToken, anonKey }) => {
      if (!authToken) { sendResponse({ error: 'Not authenticated' }); return; }
      const key = anonKey || SUPABASE_ANON_KEY_STORAGE;

      const rows = violations.map(v => ({
        page_url: pageUrl,
        rule_id: v.id,
        impact: v.impact,
        description: v.description,
        help_url: v.helpUrl,
        nodes: v.nodes.map(n => ({ html: n.html, target: n.target })),
        status: 'open',
        project_id: projectId ?? null,
        scanned_at: new Date().toISOString(),
      }));

      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/redflag_violations`, {
          method: 'POST',
          headers: {
            'apikey': key,
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify(rows),
        });
        if (!res.ok) {
          const err = await res.text();
          sendResponse({ error: err });
        } else {
          const data = await res.json();
          sendResponse({ ok: true, saved: data.length });
        }
      } catch (err) {
        sendResponse({ error: err.message });
      }
    });
    return true;
  }

  // ── GET_PAGE_ISSUES ──────────────────────────────────────────────────────────
  if (message.type === 'GET_PAGE_ISSUES') {
    const { pageUrl } = message;
    getStoredAuth().then(async ({ authToken, anonKey }) => {
      if (!authToken) { sendResponse({ issues: [] }); return; }
      const key = anonKey || SUPABASE_ANON_KEY_STORAGE;
      try {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/redflag_violations?page_url=eq.${encodeURIComponent(pageUrl)}&status=eq.open&order=impact.asc`,
          {
            headers: {
              'apikey': key,
              'Authorization': `Bearer ${authToken}`,
            },
          }
        );
        const issues = res.ok ? await res.json() : [];
        sendResponse({ issues });
      } catch {
        sendResponse({ issues: [] });
      }
    });
    return true;
  }
});
