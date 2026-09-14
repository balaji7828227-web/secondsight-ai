const { GoogleGenAI, Type } = require('@google/genai');

const REQUIRED_TYPES = ['Clear', 'Minimizing', 'Informal', 'Incomplete', 'Conflicting'];

/**
 * Retrieves the configured GoogleGenAI instance using GEMINI_API_KEY or GOOGLE_API_KEY.
 * Throws a descriptive error if the API key is not present.
 */
function getGenAIClient() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    const error = new Error('GEMINI_API_KEY is not configured. Please add GEMINI_API_KEY=your_key to your .env file.');
    error.statusCode = 500;
    throw error;
  }

  return new GoogleGenAI({ apiKey });
}

/**
 * Safely parses JSON returned from Gemini, stripping any markdown code fences if present.
 */
function parseJsonOutput(rawText) {
  let cleaned = (rawText || '').trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  return JSON.parse(cleaned);
}

/**
 * Generates 5 realistic AI-powered stress-test variations from a seed input using Google Gemini.
 * 
 * @param {string} seedInput - The seed text to generate variations from.
 * @returns {Promise<object>} Object containing seedInput and 5 variations.
 */
async function generateVariations(seedInput) {
  const cleanInput = typeof seedInput === 'string' ? seedInput.trim() : '';

  if (!cleanInput) {
    const error = new Error('seedInput is required and cannot be empty.');
    error.statusCode = 400;
    throw error;
  }

  const ai = getGenAIClient();
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const systemInstruction = `You are SecondSight AI, an AI system that generates realistic stress-test variations of user input for testing AI robustness and handling human communication styles.
Your task is to take the user's seed input and generate exactly 5 realistic, natural variations while preserving the core meaning, situation, and context of the original input.

The 5 variation types are:
1. Clear: Articulate, unambiguous, well-structured, and direct. Retains all core facts clearly and professionally.
2. Minimizing: Downplays the severity, urgency, or importance of the situation (e.g., framing it as "probably nothing", "just minor", "not a big deal", or dismissing symptoms/issues).
3. Informal: Casual, colloquial phrasing, conversational tone, texting shorthand/slang, or lowercase messaging style.
4. Incomplete: Fragmented, cut off abruptly, missing crucial context or key details (e.g. trailing off with "...", omitting specifics).
5. Conflicting: Self-contradictory statements, mixed signals, or opposing facts (e.g. stating a problem exists but simultaneously stating everything is completely fine).

Generate natural, authentic-sounding variations that people would actually write or say. Avoid generic templates or rigid prefixes like "[Clear]" or "Specifically:".`;

  const prompt = `Seed input: "${cleanInput}"

Generate exactly 5 variations (one for each type: Clear, Minimizing, Informal, Incomplete, Conflicting). Return a JSON object with a "variations" array containing objects with "type" and "text" fields.`;

  let response;
  try {
    response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        systemInstruction,
        temperature: 0.7,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            variations: {
              type: Type.ARRAY,
              description: 'List of exactly 5 variations matching the required types.',
              items: {
                type: Type.OBJECT,
                properties: {
                  type: {
                    type: Type.STRING,
                    enum: REQUIRED_TYPES
                  },
                  text: {
                    type: Type.STRING,
                    description: 'The realistic variation text.'
                  }
                },
                required: ['type', 'text']
              }
            }
          },
          required: ['variations']
        }
      }
    });
  } catch (apiError) {
    const error = new Error(`Gemini API error: ${apiError.message || 'Failed to call Gemini model.'}`);
    error.statusCode = 502;
    error.originalError = apiError;
    throw error;
  }

  let parsedData;
  try {
    parsedData = parseJsonOutput(response.text);
  } catch (parseError) {
    const error = new Error('Failed to parse AI response into JSON format.');
    error.statusCode = 500;
    throw error;
  }

  if (!parsedData || !Array.isArray(parsedData.variations)) {
    const error = new Error('AI response did not return a valid variations list.');
    error.statusCode = 500;
    throw error;
  }

  // Build a map of generated types
  const variationsMap = new Map();
  for (const item of parsedData.variations) {
    if (item && item.type && item.text) {
      variationsMap.set(item.type, item.text);
    }
  }

  // Ensure all 5 required types are present without any placeholder or rule-based fallback
  const missingTypes = REQUIRED_TYPES.filter(type => !variationsMap.has(type) || !variationsMap.get(type).trim());
  if (missingTypes.length > 0) {
    const error = new Error(`Gemini failed to return required variation types: ${missingTypes.join(', ')}`);
    error.statusCode = 502;
    throw error;
  }

  const finalVariations = REQUIRED_TYPES.map(type => ({
    type,
    text: variationsMap.get(type).trim()
  }));

  return {
    seedInput,
    variations: finalVariations
  };
}

// Support both default CommonJS and destructuring exports
generateVariations.generateVariations = generateVariations;
module.exports = generateVariations;
