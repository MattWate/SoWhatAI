(() => {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'RUN_SCAN') {
      axe.run({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })
        .then(results => {
          sendResponse({
            violations: results.violations,
            passes: results.passes,
            incomplete: results.incomplete,
            timestamp: new Date().toISOString(),
            pageUrl: window.location.href,
          });
        })
        .catch(err => sendResponse({ error: err.message }));
      return true; // keep channel open for async response
    }

    if (message.type === 'HIGHLIGHT_ELEMENT') {
      const el = document.querySelector(message.selector);
      const existing = document.getElementById('__redflag_highlight__');
      if (existing) existing.remove();
      if (!el) { sendResponse({ ok: false }); return; }

      el.scrollIntoView({ behavior: 'smooth', block: 'center' });

      const rect = el.getBoundingClientRect();
      const highlight = document.createElement('div');
      highlight.id = '__redflag_highlight__';
      Object.assign(highlight.style, {
        position: 'fixed',
        top: `${rect.top}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        border: '2px solid #ef4444',
        background: 'rgba(239,68,68,0.15)',
        zIndex: '2147483647',
        pointerEvents: 'none',
        boxSizing: 'border-box',
      });
      document.body.appendChild(highlight);
      sendResponse({ ok: true });
      return;
    }

    if (message.type === 'CLEAR_HIGHLIGHT') {
      const existing = document.getElementById('__redflag_highlight__');
      if (existing) existing.remove();
      sendResponse({ ok: true });
      return;
    }

    if (message.type === 'CHECK_PAGE_ISSUES') {
      chrome.storage.local.get(['SUPABASE_URL', 'SUPABASE_ANON_KEY'], ({ SUPABASE_URL, SUPABASE_ANON_KEY }) => {
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) { sendResponse({ count: 0 }); return; }
        const url = `${SUPABASE_URL}/rest/v1/redflag_violations?select=id&status=eq.open&page_url=eq.${encodeURIComponent(message.pageUrl)}`;
        fetch(url, {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Prefer': 'count=exact',
          },
        })
          .then(res => {
            const count = parseInt(res.headers.get('content-range')?.split('/')[1] ?? '0', 10);
            sendResponse({ count });
          })
          .catch(() => sendResponse({ count: 0 }));
      });
      return true;
    }
  });
})();
