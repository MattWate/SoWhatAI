exports.handler = async () => ({
statusCode: 200,
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ ok: true, fingerprint: "wcag-start-v1-2026-02-16" })
});
