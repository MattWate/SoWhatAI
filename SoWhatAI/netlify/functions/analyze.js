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
      reportConfig = { components: {} } // Default to an empty object
    } = body;

    // FIX 1: Ensure we are using the correct environment variable for THIS project.
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'GEMINI_API_KEY not set in Netlify environment variables.' }) };
    }

    const MODEL = 'gemini-1.5-flash-latest';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
    
    // --- Dynamically build the prompt (This part is correct) ---
    let instructions = [];
    if (reportConfig.focus) {
        instructions.push(`Pay special attention to the following context or focus areas: "${reportConfig.focus}".`);
    }
    if (!reportConfig.components.sentiment) {
        instructions.push("Do not include 'sentiment' or 'sentimentDistribution' fields in your response.");
    }
    if (!reportConfig.components.quotes) {
        instructions.push("Do not include the 'verbatimQuotes' field in your response.");
    }
     if (!reportConfig.components.soWhat) {
        instructions.push("Do not include the 'soWhatActions' field in your response.");
    }

    const instructionText = instructions.length > 0 ? `\nInstructions:\n- ${instructions.join('\n- ')}` : '';
    const prompt = `As a qualitative data analyst, synthesize the following data to answer the research question. ${instructionText}\n\nResearch Question: "${researchQuestion}"\n\nData:\n"""\n${textData || ''}\n"""\n\nReturn ONLY a valid JSON object matching the schema.`;

    // --- Dynamically build the response schema (This part is correct) ---
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
    if (reportConfig.components.sentiment) {
        properties.sentiment = { type: "STRING" };
        properties.sentimentDistribution = { type: "OBJECT", properties: { positive: { type: "NUMBER" }, negative: { type: "NUMBER" }, neutral:  { type: "NUMBER" } } };
    }
    if (reportConfig.components.quotes) {
        properties.verbatimQuotes = { type: "ARRAY", items: { type: "STRING" } };
    }
    if (reportConfig.components.soWhat) {
        properties.soWhatActions = { type: "ARRAY", items: { type: "STRING" } };
    }

    const generationConfig = {
      responseMimeType: 'application/json',
      responseSchema: { type: "OBJECT", properties, required: ["narrativeOverview", "themes"] }
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

    if (!r.ok) {
      const errorBody = await r.text().catch(() => '');
      console.error('Google AI API Error:', r.status, errorBody);
      return { statusCode: r.status, body: JSON.stringify({ error: `Google AI API Error ${r.status}`, details: errorBody.slice(0, 500) }) };
    }

    // FIX 2: Correctly process the response from Google AI
    const result = await r.json();
    const aiResponseText = result?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    
    let aiJson;
    try {
        // The AI gives us a string that LOOKS like JSON, we need to parse it.
        aiJson = JSON.parse(aiResponseText);
    } catch(e) {
        console.error("Failed to parse AI response as JSON:", aiResponseText);
        // This is a critical failure, we cannot continue.
        return { statusCode: 500, body: JSON.stringify({ error: "The AI returned an invalid response that could not be parsed."}) };
    }
    
    // --- Quantitative aggregation (This part is correct) ---
    let quantitativeResults = [];
    if (reportConfig.components.quantitative && Array.isArray(quantitativeData) && quantitativeData.length > 0) {
      const byFile = {};
      quantitativeData.forEach(({ title, values, mapping, sourceFile }) => {
        if (!byFile[sourceFile]) byFile[sourceFile] = { sourceFile, stats: [], categories: [] };
        if (mapping === 'stats' && values.length > 0) {
          const numbers = values.map(Number).filter(Number.isFinite);
          if (numbers.length > 0) {
            const sum = numbers.reduce((a, b) => a + b, 0);
            const mean = Number((sum / numbers.length).toFixed(2));
            const sorted = [...numbers].sort((a, b) => a - b);
            const median = sorted.length % 2 === 0 ? Number(((sorted[sorted.length/2-1] + sorted[sorted.length/2])/2).toFixed(2)) : sorted[Math.floor(sorted.length / 2)];
            const freq = numbers.reduce((acc, n) => (acc[n] = (acc[n] || 0) + 1, acc), {});
            const mode = Number(Object.keys(freq).reduce((a, b) => freq[a] > freq[b] ? a : b));
            byFile[sourceFile].stats.push({ title, mean, median, mode });
          }
        } else if (mapping === 'category' && values.length > 0) {
          const counts = values.reduce((acc, val) => { acc[val] = (acc[val] || 0) + 1; return acc; }, {});
          const data = Object.entries(counts).map(([name, count]) => ({ name, count }));
          byFile[sourceFile].categories.push({ title, data });
        }
      });
      quantitativeResults = Object.values(byFile);
    }

    // --- Build the FINAL report that the frontend expects ---
    const finalReport = {
      ...aiJson, // Spread the contents of the parsed AI response
      quantitativeResults,
      researchQuestion,
    };

    return { statusCode: 200, body: JSON.stringify(finalReport) };

  } catch (error) {
    console.error('Analyze function error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message || String(error) }) };
  }
};

