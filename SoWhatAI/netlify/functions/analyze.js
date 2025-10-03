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
      // optional personalization payload from the UI; safe default
      options = {}
    } = body;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable not set.');
    }

    // Prefer a stable model path to avoid 404
    const MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

    // Build prompt
    let prompt;
    let responseMimeType = 'application/json'; // default for initial analysis

    if (conversationHistory && newQuestion) {
      // FOLLOW-UP QUESTION flow
      responseMimeType = 'text/plain';
      const historyText = Array.isArray(conversationHistory)
        ? conversationHistory.map(turn => `${turn.role}: ${turn.content}`).join('\n')
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

Provide a concise, direct answer to the new question. Do not re-summarize the entire dataset. Base your answer strictly on the original data and context.
      `.trim();
    } else {
      // INITIAL ANALYSIS
      // Use personalization toggles and focus themes if present
      const {
        includeSentiment = true,
        includeQuant = true,
        includeSoWhat = true,
        includeVerbatim = true,
        focusThemes = []
      } = options || {};

      const sections = [
        `"narrativeOverview": A synthesized narrative that directly answers the research question.`
      ];
      if (includeSentiment) {
        sections.push(`"sentiment": The overall sentiment of the text data (Positive, Negative, or Neutral).`);
        sections.push(`"sentimentDistribution": An object with "positive", "negative", and "neutral" percentage values.`);
      }
      sections.push(`"themes": An array of the top 3–5 recurring themes. Each theme is an object with "theme", "evidence" (array of direct quotes), "emoji", and "prominence" (1–10).`);
      if (includeVerbatim) {
        sections.push(`"verbatimQuotes": An array of 3 impactful, verbatim quotes.`);
      }
      if (includeSoWhat) {
        sections.push(`"soWhatActions": An array of 3 concrete, actionable recommendations.`);
      }
      if (includeQuant) {
        // Quantitative results are appended server-side from structured input;
        // we still document the field so the shape is predictable.
        sections.push(`"quantitativeResults": Provided separately from structured numeric inputs; return an array (can be empty).`);
      }

      const focusText = Array.isArray(focusThemes) && focusThemes.length
        ? `Prioritize identifying and evidencing these focus themes/categories if present: ${focusThemes.join(', ')}.`
        : '';

      prompt = `
As a qualitative and quantitative data analyst, synthesize the following data to answer a specific research question.

Research Question: "${researchQuestion}"

Provided Data:
${textData || ''}

${focusText}

Your task: Based ONLY on the provided data, generate a comprehensive analysis report in strict JSON format with exactly these fields:
- ${sections.join('\n- ')}

Return ONLY valid JSON. Do not include markdown fences or commentary.
      `.trim();
    }

    // REST payload (snake_case for generationConfig)
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { response_mime_type: responseMimeType }
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      console.error('Gemini API Error:', response.status, errorBody);
      // Common 404 reasons: invalid model path/name. Suggest in error.
      const msg = response.status === 404
        ? `Gemini API failed with status: 404. Check model name/path ("${MODEL}") and API enablement.`
        : `Gemini API failed with status: ${response.status}`;
      throw new Error(msg);
    }

    const result = await response.json().catch(() => ({}));
    const aiResponseText =
      result?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    if (!aiResponseText) {
      throw new Error('Empty response from Gemini.');
    }

    // FOLLOW-UP: return plain text answer
    if (conversationHistory && newQuestion) {
      return {
        statusCode: 200,
        body: JSON.stringify({ answer: aiResponseText })
      };
    }

    // INITIAL ANALYSIS: parse JSON
    let aiJson;
    try {
      aiJson = JSON.parse(aiResponseText);
    } catch (e) {
      console.error('Model did not return valid JSON:', aiResponseText);
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Model did not return valid JSON' })
      };
    }

    // Rebuild quantitative results from structured inputs
    let quantitativeResults = [];
    if (Array.isArray(quantitativeData) && quantitativeData.length > 0) {
      const resultsByFile = {};
      quantitativeData.forEach(({ title, values, mapping, sourceFile }) => {
        if (!resultsByFile[sourceFile]) {
          resultsByFile[sourceFile] = { sourceFile, stats: [], categories: [] };
        }
        if (mapping === 'stats' && Array.isArray(values) && values.length > 0) {
          const numbers = values.map(Number).filter(n => Number.isFinite(n));
          if (numbers.length > 0) {
            const sum = numbers.reduce((a, b) => a + b, 0);
            const mean = Number((sum / numbers.length).toFixed(2));
            const sorted = [...numbers].sort((a, b) => a - b);
            const median =
              sorted.length % 2 === 0
                ? Number(((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2).toFixed(2))
                : sorted[Math.floor(sorted.length / 2)];
            // quick mode calc (optional)
            const freq = new Map();
            let mode = null, best = 0;
            for (const n of numbers) {
              const c = (freq.get(n) || 0) + 1;
              freq.set(n, c);
              if (c > best) { best = c; mode = n; }
            }
            resultsByFile[sourceFile].stats.push({ title, mean, median, mode });
          }
        } else if (mapping === 'category' && Array.isArray(values) && values.length > 0) {
          const counts = values.reduce((acc, val) => { acc[val] = (acc[val] || 0) + 1; return acc; }, {});
          const categoryData = Object.entries(counts).map(([name, count]) => ({ name, count }));
          resultsByFile[sourceFile].categories.push({ title, data: categoryData });
        }
      });
      quantitativeResults = Object.values(resultsByFile);
    }

    const finalReport = {
      ...aiJson,
      quantitativeResults,
      researchQuestion,
      options
    };

    return { statusCode: 200, body: JSON.stringify(finalReport) };

  } catch (error) {
    console.error('Error in analyze function:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
