// netlify/functions/analyze.js

/**
 * Performs the AI analysis by building a prompt and calling the Gemini API.
 */
async function getAiAnalysis(
  dataForPrompt,
  researchQuestion,
  reportConfig,
  instructionText,
  sentimentPrompt,
  soWhatPrompt,
  apiUrl
) {
  // === STEP 3: Update prompt for new structure ===
  const prompt =
    `You are a senior insights analyst. Return a valid JSON object with the following top-level fields:\n` +
    `- narrativeOverview: A high-level summary of all findings.\n` +
    `- analysisBySource: An array where each object represents an analysis for a specific data type (e.g., 'interview', 'survey').\n` +
    `${sentimentPrompt}\n` +
    `${soWhatPrompt}\n\n` +
    `For EACH object in 'analysisBySource', you MUST return:\n` +
    `- sourceType: The category of the data (e.g., 'interview', 'survey', 'usability_test', 'general').\n` +
    `- themes: An array of themes found *for that source type*.\n\n` +
    `For EACH theme in the 'themes' array, you MUST return:\n` +
    `- theme: concise name (title case)\n` +
    `- prominence: a number from 0 to 1 representing the theme's importance or frequency (e.g., 0.85)\n` +
    `- emoji: A single emoji that represents the theme.\n` +
    `- themeNarrative: 3–6 sentences that interpret the evidence (what it means, why it matters, implications)\n` +
    `- quantitativeEvidence: A string summarizing any relevant counts from the data, if available (e.g., '15/50 survey responses' or 'Mentioned by 4 interviewees'). If not applicable, return null.\n` +
    `- drivers: 2–4 short bullets (motivators/causes)\n` +
    `- barriers: 2–4 short bullets (frictions/constraints)\n` +
    `- tensions: 1–3 concise bullets (trade-offs/contradictions)\n` +
    `- opportunities: 2–4 actionable bullets (imperative phrasing)\n` +
    `- confidence: number 0–1 based on evidence quality/consistency\n` +
    `- evidence: 2–3 quotes MAX. Each quote must be meaningful on its own (8–30 words), no filler, no duplicates.\n\n` +
    `Rules:\n` +
    `- Focus on interpretation over summary. Do NOT regurgitate data.\n` +
    `- Quotes must be trimmed to the most meaningful sentence fragment and anonymised.\n` +
    `- Avoid generic statements; be specific to this dataset.\n` +
    `Return ONLY valid JSON conforming to the schema.\n` +
    `${instructionText}\n\n` +
    `Research Question: "${researchQuestion || ''}"\n\n` +
    `Data:\n"""\n${dataForPrompt || ''}\n"""\n`;
  // === END STEP 3 ===

  // === STEP 3: Define theme schema once for re-use ===
  const themeProperties = {
    type: "OBJECT",
    properties: {
      theme: { type: "STRING" },
      themeNarrative: { type: "STRING" },
      quantitativeEvidence: { type: "STRING" },
      drivers: { type: "ARRAY", items: { type: "STRING" } },
      barriers: { type: "ARRAY", items: { type: "STRING" } },
      tensions: { type: "ARRAY", items: { type: "STRING" } },
      opportunities: { type: "ARRAY", items: { type: "STRING" } },
      confidence: { type: "NUMBER" },
      evidence: { type: "ARRAY", items: { type: "STRING" } },
      emoji: { type: "STRING" },
      prominence: { type: "NUMBER" }
    },
    required: ["theme", "themeNarrative", "prominence", "emoji"]
  };
  // === END STEP 3 ===

  // === STEP 2: Update response schema for new structure ===
  const properties = {
    narrativeOverview: { type: "STRING" },
    analysisBySource: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          sourceType: { type: "STRING" },
          themes: {
            type: "ARRAY",
            items: themeProperties // Re-use theme schema
          }
        },
        required: ["sourceType", "themes"]
      }
    }
  };
  // === END STEP 2 ===

  // === Dynamically build the 'required' array ===
  const requiredFields = ["narrativeOverview", "analysisBySource"];

  if (reportConfig?.components?.sentiment) {
    properties.sentimentDistribution = {
      type: "OBJECT",
      properties: {
        positive: { type: "NUMBER" },
        negative: { type: "NUMBER" },
        neutral: { type: "NUMBER" }
      }
    };
    requiredFields.push("sentimentDistribution");
  }
  if (reportConfig?.components?.quotes) {
    properties.verbatimQuotes = { type: "ARRAY", items: { type: "STRING" } };
    requiredFields.push("verbatimQuotes");
  }
  if (reportConfig?.components?.soWhat) {
    properties.soWhatActions = { type: "ARRAY", items: { type: "STRING" } };
    requiredFields.push("soWhatActions");
  }
  // === END BUG FIX ===

  const generationConfig = {
    response_mime_type: 'application/json',
    response_schema: { type: "OBJECT", properties, required: requiredFields }
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
    // Throw an error to be caught by the main handler
    throw new Error(`Google AI API Error ${r.status}: ${details.slice(0, 2000)}`);
  }

  // Parse JSON envelope from API
  let result;
  try {
    result = JSON.parse(rawText);
  } catch {
    console.error('Non-JSON response from API:', rawText.slice(0, 1000));
    throw new Error('Unexpected non-JSON response from Gemini.');
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
    throw new Error('The AI returned an invalid response that could not be parsed.');
  }

  // --- Post-process to enforce narrative + trim quotes ---
  function dedupeCaseInsensitive(arr = []) {
    const seen = new Set();
    const out = [];
    for (const s of arr) {
      const key = String(s || '').trim().toLowerCase();
      if (key && !seen.has(key)) { seen.add(key); out.push(s); }
    }
    return out;
  }
  function wordCount(s = '') { return (s.trim().match(/\S+/g) || []).length; }

  if (Array.isArray(aiJson?.analysisBySource)) {
    aiJson.analysisBySource.forEach(sourceAnalysis => {
      if (Array.isArray(sourceAnalysis?.themes)) {
        sourceAnalysis.themes = sourceAnalysis.themes.map((t) => {
          const narrative = (t.themeNarrative || t.whyItMatters || '').trim();

          let quotes = Array.isArray(t.evidence) ? dedupeCaseInsensitive(t.evidence) : [];
          quotes = quotes
            .map(q => String(q || '').replace(/\s+/g, ' ').trim())
            .filter(q => wordCount(q) >= 8 && wordCount(q) <= 30)
            .slice(0, 3);

          const asArray = (x) => Array.isArray(x) ? x : [];
          return {
            ...t,
            themeNarrative: narrative,
            evidence: quotes,
            drivers: asArray(t.drivers).slice(0, 6),
            barriers: asArray(t.barriers).slice(0, 6),
            tensions: asArray(t.tensions).slice(0, 4),
            opportunities: asArray(t.opportunities).slice(0, 6)
          };
        });
      }
    });
  }
  
  return aiJson;
}

/**
 * Performs all quantitative calculations locally.
 */
async function getQuantitativeResults(quantitativeData, reportConfig) {
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
  return quantitativeResults;
}


/**
 * Main handler
 */
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const {
      textData, // Kept for fallback
      textSources, // === STEP 2: Receive new structure ===
      quantitativeData,
      researchQuestion,
      reportConfig = { components: {} }
    } = body;

    // --- 1. API Key Check ---
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'GOOGLE_API_KEY or GEMINI_API_KEY must be set in Netlify environment variables.'
        })
      };
    }

    // --- 2. Build API / Prompt Inputs ---
    const MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const apiVersion = MODEL.startsWith('gemini-2.0') ? 'v1beta' : 'v1';
    const apiUrl = `https://generativelanguage.googleapis.com/${apiVersion}/models/${MODEL}:generateContent?key=${apiKey}`;

    const instructions = [];
    if (reportConfig.focus) {
      instructions.push(
        `Pay special attention to the following context or focus areas: "${reportConfig.focus}".`
      );
    }
    if (!reportConfig?.components?.sentiment) {
      instructions.push("Do not include 'sentimentDistribution' field in your response.");
    }
    if (!reportConfig?.components?.quotes) {
      instructions.push("Do not include the 'verbatimQuotes' field in your response.");
    }
    if (!reportConfig?.components?.soWhat) {
      instructions.push("Do not include the 'soWhatActions' field in your response.");
    }
    const instructionText =
      instructions.length > 0 ? `\nInstructions:\n- ${instructions.join('\n- ')}` : '';

    const sentimentPrompt = reportConfig?.components?.sentiment
      ? `\n- sentimentDistribution: An object with { positive: number, negative: number, neutral: number } as 0-1 decimals (e.g., 0.7, 0.2, 0.1).`
      : '';

    const soWhatPrompt = reportConfig?.components?.soWhat
      ? `\n- soWhatActions: 3-5 actionable bullet-point recommendations based on the analysis.`
      : '';

    let dataForPrompt = '';
    if (Array.isArray(textSources)) {
      const sourcesByCategory = {};
      textSources.forEach(source => {
        const category = source.category || 'general';
        if (!sourcesByCategory[category]) {
          sourcesByCategory[category] = [];
        }
        sourcesByCategory[category].push(`---\n[File: ${source.fileName}]\n${source.content}\n---`);
      });

      for (const category in sourcesByCategory) {
        const categoryName = category.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()); // e.g., "Usability Test"
        dataForPrompt += `\n\n====================\nData from: ${categoryName}\n====================\n`;
        dataForPrompt += sourcesByCategory[category].join('\n');
      }
    } else if (textData) { // Fallback
      dataForPrompt = textData;
    }
    
    // --- 3. Run AI and Quantitative Analysis in Parallel ---
    
    const aiPromise = getAiAnalysis(
      dataForPrompt,
      researchQuestion,
      reportConfig,
      instructionText,
      sentimentPrompt,
      soWhatPrompt,
      apiUrl
    );
    
    const quantPromise = getQuantitativeResults(quantitativeData, reportConfig);

    // Wait for both to finish
    const [aiJson, quantitativeResults] = await Promise.all([
      aiPromise,
      quantPromise
    ]);

    // --- 4. Combine and Return ---
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
