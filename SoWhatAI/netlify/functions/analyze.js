// In netlify/functions/analyze.js

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { textData, quantitativeData, researchQuestion, conversationHistory, newQuestion } = JSON.parse(event.body);
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable not set.");
    }
    
    let prompt;
    let responseMimeType = "application/json";

    if (conversationHistory && newQuestion) {
      // This is a FOLLOW-UP QUESTION
      responseMimeType = "text/plain"; 

      prompt = `
        You are a data analyst who has already provided an initial report. Now, you must answer a follow-up question based ONLY on the original data and the conversation history.
        **Original Research Question:** "${researchQuestion}"
        **Original Data Provided:**
        """
        ${textData}
        """
        **Conversation History:**
        ${conversationHistory.map(turn => `${turn.role}: ${turn.content}`).join('\n')}
        **New Follow-up Question:** "${newQuestion}"
        Your task is to provide a concise, direct answer to the new question. Do not re-summarize the entire dataset. Base your answer strictly on the original data and the context of the conversation.
      `;

    } else {
      // This is an INITIAL ANALYSIS request
      prompt = `
        As a qualitative and quantitative data analyst, your task is to synthesize the following data to answer a specific research question.
        **Research Question:** "${researchQuestion}"
        **Provided Data:** ${textData}
        **Your Task:** Based *only* on the provided data, generate a comprehensive analysis report in JSON format. The report must contain the following fields:
        - "narrativeOverview": A synthesized narrative that directly answers the research question.
        - "sentiment": The overall sentiment of the text data (Positive, Negative, or Neutral).
        - "themes": An array of the top 3-5 recurring themes. Each theme should be an object with "theme", "evidence" (an array of direct quotes), "emoji", and "prominence" (a score from 1-10).
        - "verbatimQuotes": An array of 3 impactful, verbatim quotes.
        - "sentimentDistribution": An object with "positive", "negative", and "neutral" keys, with percentage values.
        - "soWhatActions": An array of 3 concrete, actionable recommendations.
        **Important:** The JSON output must be perfectly formatted.
      `;
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: responseMimeType }
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
    const aiResponseText = result.candidates[0].content.parts[0].text;

    if (conversationHistory) {
      // For a follow-up, just return the plain text answer
      return {
        statusCode: 200,
        body: JSON.stringify({ answer: aiResponseText }),
      };
    } else {
      // For an initial report, parse the AI's response and add quantitative data
      const aiJson = JSON.parse(aiResponseText);
      
      // --- RESTORED QUANTITATIVE ANALYSIS LOGIC ---
      let quantitativeResults = [];
      if (quantitativeData && quantitativeData.length > 0) {
          const resultsByFile = {};
          quantitativeData.forEach(({ title, values, mapping, sourceFile }) => {
              if (!resultsByFile[sourceFile]) {
                  resultsByFile[sourceFile] = { sourceFile, stats: [], categories: [] };
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
          quantitativeResults = Object.values(resultsByFile);
      }
      // --- END OF RESTORED LOGIC ---

      const finalReport = { ...aiJson, quantitativeResults, researchQuestion };
      return {
        statusCode: 200,
        body: JSON.stringify(finalReport),
      };
    }

  } catch (error) {
    console.error('Error in analyze function:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
