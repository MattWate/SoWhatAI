export async function runWcagScan(payload, { signal } = {}) {
  const response = await fetch('/.netlify/functions/wcag-scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = data?.error || `WCAG scan failed (${response.status})`;
    throw new Error(message);
  }

  return data;
}
