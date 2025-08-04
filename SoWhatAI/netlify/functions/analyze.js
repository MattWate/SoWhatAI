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
    let responseMimeType = "application/json"; // Default to JSON for the full report

    // --- LOGIC TO HANDLE EITHER A NEW REPORT OR A FOLLOW-UP QUESTION ---
    
    if (conversationHistory && newQuestion) {
      // --- This is a FOLLOW-UP QUESTION ---
      responseMimeType = "text/plain"; // For a simple text answer

      prompt = `
        You are a data analyst who has already provided an initial report. 
        Now, you must answer a follow-up question based ONLY on the original data and the conversation history.

        **Original Research Question:** "${researchQuestion}"

        **Original Data Provided:**
        """
        ${textData}
        """

        **Conversation History:**
        ${conversationHistory.map(turn => `${turn.role}: ${turn.content}`).join('\n')}

        **New Follow-up Question:** "${newQuestion}"

        Your task is to provide a concise, direct answer to the new question. 
        Do not re-summarize the entire dataset. 
        Base your answer strictly on the original data and the context of the conversation.
      `;

    } else {
      // --- This is an INITIAL ANALYSIS request ---
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

    // --- Call the Google Gemini API ---
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: responseMimeType,
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
    const aiResponseText = result.candidates[0].content.parts[0].text;

    // --- Final Step: Return the correct format ---

    if (conversationHistory) {
      // For a follow-up, just return the plain text answer
      return {
        statusCode: 200,
        body: JSON.stringify({ answer: aiResponseText }),
      };
    } else {
      // For an initial report, parse and process as before
      const aiJson = JSON.parse(aiResponseText);
      let quantitativeResults = []; // Simplified from your original for brevity
      // ... (your existing quantitative processing logic would go here)
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
