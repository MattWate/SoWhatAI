function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  };
}

export const handler = async () => {
  return json(404, {
    error: "Use '/.netlify/functions/wcag-scan' to run WCAG scans."
  });
};
