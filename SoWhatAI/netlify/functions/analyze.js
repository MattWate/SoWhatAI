// This is a Netlify Function.
// It acts as a secure backend to process data and call the Gemini AI API.
// You would save this in your project in a 'netlify/functions' directory.
// For example: /netlify/functions/analyze.js

exports.handler = async (event) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // Parse the data sent from the React frontend
    const { textData, quantitativeData, researchQuestion } = JSON.parse(event.body);

    // --- 1. Construct the Prompt for the AI ---
    // This is where the "magic" happens. We combine the user's research question
    // with the data to give the AI clear instructions.
    const prompt = `
      As a qualitative and quantitative data analyst, your task is to synthesize the following data to answer a specific research question.

      **Research Question:** "${researchQuestion}"

      **Provided Data:**
      ${textData}

      **Your Task:**
      Based *only* on the provided data, generate a comprehensive analysis report in JSON format. The report must contain the following fields:
      - "narrativeOverview": A synthesized narrative that directly answers the research question, weaving together insights from both the text and any relevant quantitative context.
      - "sentiment": The overall sentiment of the text data (Positive, Negative, or Neutral).
      - "themes": An array of the top 3-5 recurring themes. Each theme should be an object with "theme" (a short title), "evidence" (an array of direct quotes supporting the theme), and "prominence" (a score from 1-10).
      - "verbatimQuotes": An array of 3 impactful, verbatim quotes from the text.
      - "sentimentDistribution": An object with "positive", "negative", and "neutral" keys, with percentage values (e.g., { "positive": 65, "negative": 20, "neutral": 15 }).
      - "soWhatActions": An array of 3 concrete, actionable recommendations based on the analysis. These could be strategic changes, specific actions, or suggestions for future research.

      **Important:**
      - The analysis must be objective and based strictly on the provided data.
      - The JSON output must be perfectly formatted and contain all the requested fields.
    `;

    // --- 2. Call the Google Gemini API ---
    // We use an environment variable for the API key for security.
    // This key should be set in your Netlify site's settings, NOT in the code.
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable not set.");
    }
    
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    const payload = {
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        responseMimeType: "application/json",
      }
    };
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorBody = await response.text();
        console.error("Gemini API Error:", errorBody);
        throw new Error(`Gemini API failed with status: ${response.status}`);
    }

    const result = await response.json();
    
    // Extract the JSON string from the AI's response
    const aiResponseText = result.candidates[0].content.parts[0].text;
    const aiJson = JSON.parse(aiResponseText);

    // --- 3. Add Quantitative Data and Return ---
    // The AI handles the qualitative part. We'll still process the quantitative part here.
    let quantitativeResults = null;
    if (quantitativeData && quantitativeData.length > 0) {
        const resultsByFile = {};
        quantitativeData.forEach(({ title, values, mapping, sourceFile }) => {
            if (!resultsByFile[sourceFile]) {
                resultsByFile[sourceFile] = { stats: [], categories: [] };
            }
            if (mapping === 'stats' && values.length > 0) {
                const numbers = values.map(Number).filter(n => !isNaN(n));
                if (numbers.length > 0) {
                  const sum = numbers.reduce((a, b) => a + b, 0);
                  const mean = (sum / numbers.length).toFixed(2);
                  const sorted = [...numbers].sort((a, b) => a - b);
                  const median = sorted.length % 2 === 0 ? ((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2).toFixed(2) : sorted[Math.floor(sorted.length / 2)];
                  resultsByFile[sourceFile].stats.push({ title, mean, median, mode: 'N/A' });
                }
            } else if (mapping === 'category' && values.length > 0) {
                const counts = values.reduce((acc, val) => { acc[val] = (acc[val] || 0) + 1; return acc; }, {});
                const categoryData = Object.entries(counts).map(([name, count]) => ({ name, count }));
                resultsByFile[sourceFile].categories.push({ title, data: categoryData });
            }
        });
        quantitativeResults = Object.entries(resultsByFile).map(([sourceFile, data]) => ({ sourceFile, ...data }));
    }

    const finalReport = {
        ...aiJson,
        quantitativeResults,
        researchQuestion
    };

    return {
      statusCode: 200,
      body: JSON.stringify(finalReport),
    };

  } catch (error) {
    console.error('Error in analyze function:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
