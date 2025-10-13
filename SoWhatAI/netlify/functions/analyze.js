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

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'GEMINI_API_KEY not set' }) };
    }

    const MODEL = 'gemini-1.5-flash-latest';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
    
    // --- Dynamically build the prompt based on reportConfig ---
    
    let instructions = [];
    if (reportConfig.focus) {
        instructions.push(`Pay special attention to the following context or focus areas: "${reportConfig.focus}".`);
    }

    // Build instructions for optional components
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

    const prompt = `
As a qualitative and quantitative data analyst, your task is to synthesize the following data to answer a specific research question.

Research Question: "${researchQuestion}"

Provided Data:
"""
${textData || ''}
"""
${instructionText}

Return ONLY a valid JSON object that strictly adheres to the provided schema. Do not include any markdown formatting, comments, or extra text outside the JSON structure.
    `.trim();

    // --- Dynamically build the response schema ---
    const properties = {
        narrativeOverview: { type: "STRING", description: "A detailed narrative summary that directly answers the research question, synthesizing insights from the provided data." },
        themes: {
            type: "ARRAY",
            description: "A list of 3-5 key themes discovered in the data.",
            items: {
                type: "OBJECT",
                properties: {
                    theme: { type: "STRING", description: "The name of the theme." },
                    evidence: {
                        type: "ARRAY",
                        description: "A list of direct quotes or data points from the text that support this theme.",
                        items: { type: "STRING" }
                    },
                    emoji: { type: "STRING", description: "A single emoji that represents the theme." },
                    prominence: { type: "NUMBER", description: "A score from 1-10 indicating how prominent this theme is in the data." }
                },
                required: ["theme", "evidence"]
            }
        },
    };

    if (reportConfig.components.sentiment) {
        properties.sentiment = { type: "STRING", description: "The overall sentiment of the text (Positive, Negative, or Neutral)." };
        properties.sentimentDistribution = {
            type: "OBJECT",
            properties: {
                positive: { type: "NUMBER", description: "Percentage of positive sentiment." },
                negative: { type: "NUMBER", description: "Percentage of negative sentiment." },
                neutral:  { type: "NUMBER", description: "Percentage of neutral sentiment." }
            }
        };
    }

    if (reportConfig.components.quotes) {
        properties.verbatimQuotes = {
            type: "ARRAY",
            description: "A list of 3-5 particularly insightful verbatim quotes from the data.",
            items: { type: "STRING" }
        };
    }
    
    if (reportConfig.components.soWhat) {
        properties.soWhatActions = {
            type: "ARRAY",
            description: "A list of actionable recommendations or suggestions for future research based on the analysis.",
            items: { type: "STRING" }
        };
    }

    const generationConfig = {
      responseMimeType: 'application/json',
      responseSchema: {
        type: "OBJECT",
        properties,
        required: ["narrativeOverview", "themes"]
      }
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
      return {
        statusCode: r.status,
        body: JSON.stringify({ error: `Google AI API Error ${r.status}`, details: errorBody.slice(0, 500) })
      };
    }

    const result = await r.json();
    const aiResponseText = result?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    let aiJson;
    try {
        aiJson = JSON.parse(aiResponseText);
    } catch(e) {
        console.error("Failed to parse AI response as JSON:", aiResponseText);
        return { statusCode: 500, body: JSON.stringify({ error: "The AI returned an invalid response."}) };
    }
    
    // --- Quantitative aggregation ---
    let quantitativeResults = [];
    if (reportConfig.components.quantitative && Array.isArray(quantitativeData) && quantitativeData.length > 0) {
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
    };

    return { statusCode: 200, body: JSON.stringify(finalReport) };

  } catch (error) {
    console.error('Analyze function error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message || String(error) }) };
  }
};

