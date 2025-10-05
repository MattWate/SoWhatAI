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

    // Use the same env var your working function uses
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_API_KEY environment variable not set.');
    }

    // Use the same model family that worked for you; allow override
    const MODEL = process.env.GOOGLE_MODEL || 'gemini-2.5-flash-preview-05-20';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

    // ---------- Build prompt ----------
    let prompt;
    let responseMimeType = 'application/json';

    if (conversationHistory && newQuestion) {
      // FOLLOW-UP
      responseMimeType = 'text/plain';
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

    } else {
      // INITIAL ANALYSIS
      const {
        includeSentiment = true,
        includeQuant = true,
        includeSoWhat = true,
        includeVerbatim = true,
        focusThemes = []
      } = options;

      const sections = [
        `"narrativeOverview": A synthesized narrative that directly answers the research question.`
      ];
      if (includeSentiment) {
        sections.push(`"sentiment": Overall sentiment (Positive, Negative, or Neutral).`);
        sections.push(`"sentimentDistribution": {"positive": %, "negative": %, "neutral": %}.`);
      }
      sections.push(`"themes": Top 3–5 recurring themes as objects with "theme", "evidence" (array of quotes), "emoji", "prominence" (1–10).`);
      if (includeVerbatim) {
        sections.push(`"verbatimQuotes": 3 impactful verbatim quotes.`);
      }
      if (includeSoWhat) {
        sections.push(`"soWhatActions": 3 concrete, actionable recommendations.`);
      }
      if (includeQuant) {
        sections.push(`"quantitativeResults": Leave as an array; server will populate from structured inputs.`);
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

Your task: Based ONLY on the provided data, return a strictly valid JSON object with exactly these fields:
- ${sections.join('\n- ')}

Return ONLY JSON. No markdown fences or commentary.
      `.trim();
    }

    // ---------- Call Gemini ----------
    const payload = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        // You’ve proven this casing works in your environment; keep it consistent
        responseMimeType: responseMimeType
      }
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      console.error('Google AI API Error:', response.status, errorBody);
      const msg = response.status === 404
        ? `Gemini API failed with status: 404. Check model name/path ("${MODEL}") and API enablement.`
        : `Gemini API failed with status: ${response.status}`;
      throw new Error(msg);
    }

    const result = await response.json().catch(() => ({}));
    const aiResponseText = result?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    if (!aiResponseText) {
      throw new Error('Empty response from Gemini.');
    }

    // FOLLOW-UP: return plain text answer (wrapped in JSON)
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

    // ---------- Quantitative aggregation ----------
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
            const freq = new Map();
            let mode = null, best = 0;
            for (const n of numbers) {
              const c = (freq.get(n) || 0) + 1;
              freq.set(n, c);
              if
