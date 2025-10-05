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
      conversationHistory,
      newQuestion,
      options = {}
    } = body;

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'GOOGLE_API_KEY not set' }) };
    }

    const MODEL = process.env.GOOGLE_MODEL || 'gemini-2.5-flash-preview-05-20';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

    // ---- Build prompt & config ----
    const {
      includeSentiment = true,
      includeQuant = true,
      includeSoWhat = true,
      includeVerbatim = true,
      focusThemes = []
    } = options;

    let prompt;
    let generationConfig = { responseMimeType: 'application/json' };

    if (conversationHistory && newQuestion) {
      // FOLLOW-UP: plain text answer is fine
      const historyText = Array.isArray(conversationHistory)
        ? conversationHistory.map(t => `${t.role}: ${t.content}`).join('\n')
        : '';

      prompt = `
You are a data analyst who has already provided an initial report. Answer a follow-up question based ONLY on the original data and the conversation history.

Original Research Question: "${researchQuestion}"

Original Data Provided:
"""
${textData || ''}
"""

Conversation History:
${historyText}

New Follow-up Question: "${newQuestion}"

Provide a concise, direct answer. Do not re-summarize the entire dataset.
      `.trim();

      generationConfig = { responseMimeType: 'text/plain' };

    } else {
      const focusText = Array.isArray(focusThemes) && focusThemes.length
        ? `Prioritize these focus themes/categories when present: ${focusThemes.join(', ')}.`
        : '';

      // We’ll enforce a JSON schema so the model returns parseable JSON.
      prompt = `
As a qualitative and quantitative data analyst, synthesize the following data to answer a specific research question.

Research Question: "${researchQuestion}"

Provided Data:
${textData || ''}

${focusText}

Return ONLY a JSON object that matches the provided schema exactly. No markdown fences or commentary.
      `.trim();

      generationConfig = {
        responseMimeType: 'application/json',
        responseSchema: {
          type: "OBJECT",
          properties: {
            narrativeOverview: { type: "STRING" },
            // Optional sentiment fields
            sentiment: { type: "STRING" },
            sentimentDistribution: {
              type: "OBJECT",
              properties: {
                positive: { type: "NUMBER" },
                negative: { type: "NUMBER" },
                neutral:  { type: "NUMBER" }
              }
            },
            // Themes
            themes: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  theme: { type: "STRING" },
                  evidence: {
                    type: "ARRAY",
                    items: { type: "STRING" }
                  },
                  emoji: { type: "STRING" },
                  prominence: { type: "NUMBER" }
                },
                required: ["theme", "evidence"]
              }
            },
            // Verbatim quotes
            verbatimQuotes: {
              type: "ARRAY",
              items: { type: "STRING" }
            },
            // So what
            soWhatActions: {
              type: "ARRAY",
              items: { type: "STRING" }
            }
          },
          required: ["narrativeOverview", "themes"]
        }
      };

      // If user toggled sections off, it's okay if model omits them.
      // Schema does not force them as required.
    }

    const payload = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig
    };

    const r = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!r.ok) {
      const errorBody = await r.text().catch(() => '');
      console.error('Google AI API Error:', r.status, errorBody);
      return {
        statusCode: r.status,
        body: JSON.stringify({ error: `Google AI API Error ${r.status}`, details: errorBody.slice(0, 500) })
      };
    }

    const result = await r.json().catch(() => ({}));
    const aiResponseText = result?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    if (conversationHistory && newQuestion) {
      // FOLLOW-UP: return plain text answer
      return { statusCode: 200, body: JSON.stringify({ answer: aiResponseText }) };
    }

    // Try strict parse first
    let aiJson;
    try {
      aiJson = JSON.parse(aiResponseText);
    } catch (e) {
      // Fallback: try to extract first JSON object from the text (very forgiving)
      const firstBrace = aiResponseText.indexOf('{');
      const lastBrace = aiResponseText.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        const candidate = aiResponseText.slice(firstBrace, lastBrace + 1);
        try {
          aiJson = JSON.parse(candidate);
        } catch (e2) {
          console.error('JSON parse failed. Raw text:', aiResponseText.slice(0, 800));
          return { statusCode: 502, body: JSON.stringify({ error: 'Model did not return valid JSON' }) };
        }
      } else {
        console.error('No JSON-looking content. Raw text:', aiResponseText.slice(0, 800));
        return { statusCode: 502, body: JSON.stringify({ error: 'Model did not return valid JSON' }) };
      }
    }

    // ---- Quantitative aggregation (unchanged) ----
    let quantitativeResults = [];
    if (Array.isArray(quantitativeData) && quantitativeData.length > 0) {
      const byFile = {};
      quantitativeData.forEach(({ title, values, mapping, sourceFile }) => {
        if (!byFile[sourceFile]) byFile[sourceFile] = { sourceFile, stats: [], categories: [] };
        if (mapping === 'stats' && Array.isArray(values) && values.length > 0) {
          const numbers = values.map(Number).filter(Number.isFinite);
          if (numbers.length > 0) {
            const sum = numbers.reduce((a, b) => a + b, 0);
            const mean = Number((sum / numbers.length).toFixed(2));
            const sorted = [...numbers].sort((a, b) => a - b);
            const median = sorted.length % 2 === 0
              ? Number(((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2).toFixed(2))
              : sorted[Math.floor(sorted.length / 2)];
            const freq = new Map();
            let mode = null, best = 0;
            for (const n of numbers) {
              const c = (freq.get(n) || 0) + 1;
              freq.set(n, c);
              if (c > best) { best = c; mode = n; }
            }
            byFile[sourceFile].stats.push({ title, mean, median, mode });
          }
        } else if (mapping === 'category' && Array.isArray(values) && values.length > 0) {
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
      researchQuestion,
      options
    };

    return { statusCode: 200, body: JSON.stringify(finalReport) };

  } catch (error) {
    console.error('Analyze function error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message || String(error) }) };
  }
};
