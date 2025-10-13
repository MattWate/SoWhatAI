// netlify/functions/analyze.js
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const {
      textData,
      quantitativeData,
      researchQuestion,
      reportConfig = { components: {} }
    } = body;

    // Accept either env var name to match your other project
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'GOOGLE_API_KEY or GEMINI_API_KEY must be set in Netlify environment variables.' })
      };
    }

    // Default to a stable, known-good model; override via env if you want.
    const MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash'; // 'gemini-1.5-flash' also fine
    // Gemini 2.0 models generally need v1beta on REST; 1.5 works on v1.
    const apiVersion = MODEL.startsWith('gemini-2.0') ? 'v1beta' : 'v1';
    const apiUrl = `https://generativelanguage.googleapis.com/${apiVersion}/models/${MODEL}:generateContent?key=${apiKey}`;

    // ---- Build instructions ----
    const instructions = [];
    if (reportConfig.focus) {
      instructions.push(`Pay special attention to the following context or focus areas: "${reportConfig.focus}".`);
    }
    if (!reportConfig?.components?.sentiment) {
      instructions.push("Do not include 'sentiment' or 'sentimentDistribution' fields in your response.");
    }
    if (!reportConfig?.components?.quotes) {
      instructions.push("Do not include the 'verbatimQuotes' field in your response.");
    }
    if (!reportConfig?.components?.soWhat) {
      instructions.push("Do not include the 'soWhatActions' field in your response.");
    }

    const instructionText =
      instructions.length > 0 ? `\nInstructions:\n- ${instructions.join('\n- ')}` : '';

    const prompt =
      `As a qualitative data analyst, synthesize the following data to answer the research question.` +
      ` ${instructionText}\n\n` +
      `Research Question: "${researchQuestion || ''}"\n\n` +
      `Data:\n"""\n${textData || ''}\n"""\n\n` +
      `Return ONLY a valid JSON object matching the schema.`;

    // ---- Dynamic response schema ----
    const properties = {
      narrativeOverview: { type: "STRING" },
      themes: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            theme: { type: "STRING" },
            evidence: { type: "ARRAY", items: { type: "STRING" } },
            emoji: { type: "STRING" },
            prominence: { type: "NUMBER" }
          },
          required: ["theme", "evidence"]
        }
      },
    };
    if (reportConfig?.components?.sentiment) {
      properties.sentiment = { type: "STRING" };
      properties.sentimentDistribution = {
        type: "OBJECT",
        properties: {
          positive: { type: "NUMBER" },
          negative: { type: "NUMBER" },
          neutral: { type: "NUMBER" }
        }
      };
    }
    if (reportConfig?.components?.quotes) {
      properties.verbatimQuotes = { type: "ARRAY", items: { type: "STRING" } };
    }
    if (reportConfig?.components?.soWhat) {
      properties.soWhatActions = { type: "ARRAY", items: { type: "STRING" } };
    }

    // REST expects snake_case for generationConfig keys
    const generationConfig = {
      response_mime_type: 'application/json',
      response_schema: { type: "OBJECT", properties, required: ["narrativeOverview", "themes"] }
    };

    const payload = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig
    };

    const r = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const rawText = await r.text().catch(() => '');
    if (!r.ok) {
      let details = rawText;
      try {
        const maybeJson = JSON.parse(rawText);
        details = JSON.stringify(maybeJson, null, 2);
      } catch {}
      console.error('Google AI API Error:', r.status, details);
      return {
        statusCode: r.status,
        body: JSON.stringify({
          error: `Google AI API Error ${r.status}`,
          details: (details || '').slice(0, 2000),
          url: apiUrl,
          model: MODEL,
          version: apiVersion
        })
      };
    }

    // Parse JSON envelope from API
    let result;
    try {
      result = JSON.parse(rawText);
    } catch {
      console.error('Non-JSON response from API:', rawText.slice(0, 1000));
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Unexpected non-JSON response from Gemini.' })
      };
    }

    const aiResponseText =
      result?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';

    // Strip occasional code fences
    const cleaned = aiResponseText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();

    let aiJson;
    try {
      aiJson = JSON.parse(cleaned);
    } catch (e) {
      console.error('Failed to parse AI response as JSON:', cleaned.slice(0, 1500));
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'The AI returned an invalid response that could not be parsed.' })
      };
    }

    // ---- Quantitative aggregation (unchanged) ----
    let quantitativeResults = [];
    if (reportConfig?.components?.quantitative && Array.isArray(quantitativeData) && quantitativeData.length > 0) {
      const byFile = {};
      quantitativeData.forEach(({ title, values, mapping, sourceFile }) => {
        if (!byFile[sourceFile]) byFile[sourceFile] = { sourceFile, stats: [], categories: [] };
        if (mapping === 'stats' && values?.length > 0) {
          const numbers = values.map(Number).filter(Number.isFinite);
          if (numbers.length > 0) {
            const sum = numbers.reduce((a, b) => a + b, 0);
            const mean = Number((sum / numbers.length).toFixed(2));
            const sorted = [...numbers].sort((a, b) => a - b);
            const median = sorted.length % 2 === 0
              ? Number(((sorted[sorted.length/2 - 1] + sorted[sorted.length/2]) / 2).toFixed(2))
              : sorted[Math.floor(sorted.length / 2)];
            const freq = numbers.reduce((acc, n) => (acc[n] = (acc[n] || 0) + 1, acc), {});
            const mode = Number(Object.keys(freq).reduce((a, b) => (freq[a] > freq[b] ? a : b)));
            byFile[sourceFile].stats.push({ title, mean, median, mode });
          }
        } else if (mapping === 'category' && values?.length > 0) {
          const counts = values.reduce((acc, val) => { acc[val] = (acc[val] || 0) + 1; return acc; }, {});
          const data = Object.entries(counts).map(([name, count]) => ({ name, count }));
          byFile[sourceFile].categories.push({ title, data });
        }
      });
      quantitativeResults = Object.values(byFile);
    }

    const finalReport = {
      ...aiJson,
      quantitativeResults,
      researchQuestion
    };

    return { statusCode: 200, body: JSON.stringify(finalReport) };

  } catch (error) {
    console.error('Analyze function error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message || String(error) }) };
  }
};
