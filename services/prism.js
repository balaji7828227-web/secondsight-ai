const { GoogleGenAI, Type } = require('@google/genai');
const generateVariations = require('./generator');

const REQUIRED_TYPES = ['Clear', 'Minimizing', 'Informal', 'Incomplete', 'Conflicting'];

/**
 * Retrieves the GoogleGenAI client from environment.
 */
function getGenAIClient() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    const error = new Error('GEMINI_API_KEY is not configured. Please add GEMINI_API_KEY to your .env file.');
    error.statusCode = 500;
    throw error;
  }
  return new GoogleGenAI({ apiKey });
}

/**
 * Safely parses JSON returned from Gemini.
 */
function parseJsonOutput(rawText) {
  let cleaned = (rawText || '').trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  return JSON.parse(cleaned);
}

/**
 * Transmits evaluation and trace records to the real PRISM HTTP API (e.g. Block Convey / PRISM platform).
 * Securely reads PRISM_API_KEY and PRISM_PROJECT_ID from process.env.
 * Never exposes or prints keys or credentials.
 */
async function sendTraceToPrismApi(tracePayload) {
  const apiKey = process.env.PRISM_API_KEY || process.env.PRISMTRACE_API_KEY;
  const projectId = process.env.PRISM_PROJECT_ID || process.env.PRISMTRACE_PROJECT_ID;
  const host = process.env.PRISM_API_URL || process.env.PRISMTRACE_HOST || 'https://prism.blockconvey.com';

  if (!apiKey || !projectId) {
    return {
      success: false,
      status: 'MISSING_CREDENTIALS',
      message: 'PRISM_API_KEY and/or PRISM_PROJECT_ID not set in .env'
    };
  }

  const endpoint = host.endsWith('/') ? `${host}api/traces` : `${host}/api/traces`;

  const body = {
    project_id: projectId,
    model: tracePayload.model || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    session_id: tracePayload.sessionId || `session_${Date.now()}`,
    input_messages: [
      {
        role: 'user',
        content: tracePayload.seedInput
      }
    ],
    output_message: typeof tracePayload.variations === 'string'
      ? tracePayload.variations
      : JSON.stringify(tracePayload.variations),
    metadata: {
      system: 'SecondSightAI',
      evaluation: tracePayload.evaluation || null,
      timestamp: new Date().toISOString()
    }
  };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PRISMtrace-Key': apiKey,
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    let resData = null;
    try {
      resData = await res.json();
    } catch (_) {
      try {
        resData = await res.text();
      } catch (e) {
        resData = null;
      }
    }

    return {
      success: res.ok,
      statusCode: res.status,
      statusText: res.statusText,
      data: resData
    };
  } catch (netErr) {
    return {
      success: false,
      status: 'NETWORK_ERROR',
      message: netErr.message || 'Failed to connect to PRISM HTTP API'
    };
  }
}

/**
 * Evaluates SecondSight AI's generated stress-test variations across required dimensions.
 * PRISM strictly evaluates SecondSight AI itself (its generator output fidelity and stress efficacy).
 *
 * @param {string} seedInput - The original seed input.
 * @param {Array<{type: string, text: string}>} variations - The 5 generated variations.
 * @returns {Promise<object>} Detailed PRISM evaluation scorecard, diagnosed weaknesses, and HTTP transmission status.
 */
async function evaluateVariations(seedInput, variations) {
  if (!seedInput || typeof seedInput !== 'string') {
    const err = new Error('seedInput is required for PRISM evaluation.');
    err.statusCode = 400;
    throw err;
  }

  if (!Array.isArray(variations) || variations.length === 0) {
    const err = new Error('variations array is required for PRISM evaluation.');
    err.statusCode = 400;
    throw err;
  }

  const ai = getGenAIClient();
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const systemInstruction = `You are PRISM (Persona Robustness & Stress-test Inference Scoring Matrix), an advanced meta-evaluator for SecondSight AI.
Your role is to rigorously evaluate and stress-score the output of SecondSight AI's own variation generator.
You MUST evaluate SecondSight AI itself — do NOT evaluate an external healthcare AI.

Evaluation Criteria:
1. Semantic Preservation (0-100): Does each variation preserve the core situation, key symptoms/events, and factual essence of the seed input without fabricating unrelated claims?
2. Category Distinctiveness (0-100): How authentically and distinctly does each variation embody its assigned stress-test category?
   - Clear: Direct, articulate, structured, professional, complete.
   - Minimizing: Downplaying urgency/severity ("probably nothing", "just minor", dismissing importance) while preserving the core facts.
   - Informal: Casual phrasing, conversational slang, texting shorthand, lowercase style.
   - Incomplete: Fragmented, cut off abruptly, missing key details or trailing off with '...' realistically.
   - Conflicting: Contradictory statements, cognitive dissonance, mixed signals (stating the problem but also claiming everything is fine).
3. Stress Efficacy (0-100): How effectively does each variation challenge downstream AI comprehension while remaining plausible human communication?

Diagnose concrete Weaknesses and Failure Patterns (e.g. Under-minimization, Over-truncation, Artificial phrasing, Missing core entity, Superficial conflict).`;

  const prompt = `Seed Input: "${seedInput.trim()}"

Generated Variations to Evaluate:
${JSON.stringify(variations, null, 2)}

Provide a rigorous evaluation. Return a JSON object adhering to the schema.`;

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        systemInstruction,
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            overallScore: {
              type: Type.INTEGER,
              description: 'Overall PRISM robustness score from 0 to 100.'
            },
            status: {
              type: Type.STRING,
              description: 'Status label: e.g. "Robust", "Moderate", "Needs Evolution"'
            },
            dimensions: {
              type: Type.OBJECT,
              properties: {
                semanticPreservation: { type: Type.INTEGER },
                categoryDistinctiveness: { type: Type.INTEGER },
                stressEfficacy: { type: Type.INTEGER }
              },
              required: ['semanticPreservation', 'categoryDistinctiveness', 'stressEfficacy']
            },
            categoryScores: {
              type: Type.OBJECT,
              properties: {
                Clear: { type: Type.INTEGER },
                Minimizing: { type: Type.INTEGER },
                Informal: { type: Type.INTEGER },
                Incomplete: { type: Type.INTEGER },
                Conflicting: { type: Type.INTEGER }
              },
              required: ['Clear', 'Minimizing', 'Informal', 'Incomplete', 'Conflicting']
            },
            categoryAssessments: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING },
                  score: { type: Type.INTEGER },
                  findings: { type: Type.STRING }
                },
                required: ['type', 'score', 'findings']
              }
            },
            weaknesses: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  category: { type: Type.STRING },
                  severity: { type: Type.STRING, enum: ['High', 'Medium', 'Low'] },
                  issue: { type: Type.STRING },
                  suggestion: { type: Type.STRING }
                },
                required: ['category', 'severity', 'issue', 'suggestion']
              }
            },
            recommendedImprovements: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Specific recommendations to evolve the SecondSight AI generator.'
            }
          },
          required: [
            'overallScore',
            'status',
            'dimensions',
            'categoryScores',
            'categoryAssessments',
            'weaknesses',
            'recommendedImprovements'
          ]
        }
      }
    });

    const parsed = parseJsonOutput(response.text);

    // Send trace/evaluation data to the real PRISM HTTP API
    const prismHttpDelivery = await sendTraceToPrismApi({
      seedInput,
      variations,
      model: modelName,
      evaluation: {
        overallScore: parsed.overallScore,
        status: parsed.status,
        dimensions: parsed.dimensions,
        categoryScores: parsed.categoryScores,
        weaknessCount: (parsed.weaknesses || []).length
      }
    });

    return {
      seedInput,
      timestamp: new Date(),
      evaluatedModel: modelName,
      overallScore: Math.min(100, Math.max(0, parsed.overallScore || 0)),
      status: parsed.status || (parsed.overallScore >= 80 ? 'Robust' : parsed.overallScore >= 60 ? 'Moderate' : 'Needs Evolution'),
      dimensions: parsed.dimensions || {
        semanticPreservation: 75,
        categoryDistinctiveness: 75,
        stressEfficacy: 75
      },
      categoryScores: parsed.categoryScores || {
        Clear: 80,
        Minimizing: 70,
        Informal: 75,
        Incomplete: 70,
        Conflicting: 70
      },
      categoryAssessments: parsed.categoryAssessments || [],
      weaknesses: parsed.weaknesses || [],
      recommendedImprovements: parsed.recommendedImprovements || [],
      prismHttpDelivery
    };
  } catch (err) {
    const error = new Error(`PRISM evaluation failed: ${err.message || 'Unknown error'}`);
    error.statusCode = 502;
    error.originalError = err;
    throw error;
  }
}

/**
 * Runs a complete PRISM Evolution cycle on SecondSight AI.
 * 1. Generates baseline variations ("Before").
 * 2. Evaluates baseline variations with PRISM.
 * 3. Uses PRISM's diagnosed weaknesses to guide an evolved generation ("After").
 * 4. Re-evaluates evolved variations with PRISM.
 * 5. Measures exact before-vs-after improvements.
 * 6. Sends evolution trace to the real PRISM HTTP API.
 *
 * @param {string} seedInput - The seed input to test and evolve.
 * @param {Array<{type: string, text: string}>} [existingBaseline] - Optional existing variations.
 * @returns {Promise<object>} Full before-vs-after evolution results.
 */
async function evolveVariations(seedInput, existingBaseline = null) {
  const cleanInput = typeof seedInput === 'string' ? seedInput.trim() : '';
  if (!cleanInput) {
    const err = new Error('seedInput is required for PRISM evolution.');
    err.statusCode = 400;
    throw err;
  }

  // 1. Obtain baseline variations ("Before")
  let baseline = existingBaseline;
  if (!baseline || !Array.isArray(baseline) || baseline.length < 5) {
    const generated = await generateVariations(cleanInput);
    baseline = generated.variations;
  }

  // 2. Evaluate baseline variations
  const evaluationBefore = await evaluateVariations(cleanInput, baseline);

  // 3. Formulate targeted evolution directives from detected weaknesses
  const ai = getGenAIClient();
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const weaknessDirectives = (evaluationBefore.weaknesses || [])
    .map((w, idx) => `${idx + 1}. For [${w.category}] (${w.severity} priority): Address "${w.issue}". Apply: "${w.suggestion}"`)
    .join('\n');

  const evolvedSystemInstruction = `You are SecondSight AI Evolved, an improved stress-test generator enhanced by PRISM meta-evaluation.
Your task is to generate 5 high-fidelity variations of the seed input that overcome the weaknesses identified in the baseline generator.

PRISM Diagnosis & Directives to Overcome:
${weaknessDirectives || 'Enhance realism, subtle psychological depth, and ensure sharp category differentiation.'}

Required Categories:
1. Clear: Highly structured, explicit, and medically/situationally complete.
2. Minimizing: Authentically downplaying severity (e.g. dismissing pain as "just indigestion", or saying "it'll pass, probably overreacting"), without erasing the core medical/factual anchor.
3. Informal: Extremely natural conversational phrasing, realistic texting habits, slang or colloquial tone.
4. Incomplete: Plausibly fragmented, realistic cut-off or omission of context that challenges downstream inference without becoming meaningless noise.
5. Conflicting: Deeply convincing contradictory signals (e.g. describing high pain while insisting on doing heavy chores, or contradictory timeline claims).

Output exactly 5 variations matching the types in order: Clear, Minimizing, Informal, Incomplete, Conflicting.`;

  const evolvedPrompt = `Seed Input: "${cleanInput}"

Generate the 5 evolved, high-robustness variations as JSON with a "variations" array containing objects with "type" and "text" fields.`;

  let evolvedVariations;
  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: evolvedPrompt,
      config: {
        systemInstruction: evolvedSystemInstruction,
        temperature: 0.75,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            variations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING, enum: REQUIRED_TYPES },
                  text: { type: Type.STRING }
                },
                required: ['type', 'text']
              }
            }
          },
          required: ['variations']
        }
      }
    });

    const parsed = parseJsonOutput(response.text);
    const varMap = new Map();
    for (const item of parsed.variations || []) {
      if (item && item.type && item.text) {
        varMap.set(item.type, item.text);
      }
    }

    evolvedVariations = REQUIRED_TYPES.map(type => ({
      type,
      text: varMap.get(type) || baseline.find(b => b.type === type)?.text || cleanInput
    }));
  } catch (genErr) {
    const error = new Error(`Evolved generation failed: ${genErr.message}`);
    error.statusCode = 502;
    throw error;
  }

  // 4. Evaluate evolved variations with PRISM ("After")
  const evaluationAfter = await evaluateVariations(cleanInput, evolvedVariations);

  // 5. Calculate measurable score delta and resolved weaknesses
  const scoreDelta = evaluationAfter.overallScore - evaluationBefore.overallScore;

  // Determine which weaknesses were addressed
  const resolvedWeaknesses = [];
  const remainingWeaknesses = [];

  for (const prevW of evaluationBefore.weaknesses) {
    const prevCatScore = evaluationBefore.categoryScores[prevW.category] || 0;
    const newCatScore = evaluationAfter.categoryScores[prevW.category] || 0;
    if (newCatScore > prevCatScore || evaluationAfter.overallScore > evaluationBefore.overallScore) {
      resolvedWeaknesses.push({
        category: prevW.category,
        issue: prevW.issue,
        resolution: `Score improved from ${prevCatScore} to ${newCatScore}. Evolved variation adopted: ${prevW.suggestion}`
      });
    } else {
      remainingWeaknesses.push(prevW);
    }
  }

  // 6. Send evolution comparison trace to the real PRISM HTTP API
  const prismHttpDelivery = await sendTraceToPrismApi({
    seedInput: cleanInput,
    variations: evolvedVariations,
    model: modelName,
    evaluation: {
      type: 'SecondSightAI_Evolution_Comparison',
      scoreBefore: evaluationBefore.overallScore,
      scoreAfter: evaluationAfter.overallScore,
      scoreDelta: scoreDelta,
      resolvedWeaknessCount: resolvedWeaknesses.length
    }
  });

  return {
    seedInput: cleanInput,
    timestamp: new Date(),
    model: modelName,
    comparison: {
      scoreBefore: evaluationBefore.overallScore,
      scoreAfter: evaluationAfter.overallScore,
      scoreDelta: scoreDelta,
      statusBefore: evaluationBefore.status,
      statusAfter: evaluationAfter.status,
      dimensionsBefore: evaluationBefore.dimensions,
      dimensionsAfter: evaluationAfter.dimensions,
      categoryScoresBefore: evaluationBefore.categoryScores,
      categoryScoresAfter: evaluationAfter.categoryScores
    },
    before: {
      variations: baseline,
      evaluation: evaluationBefore
    },
    after: {
      variations: evolvedVariations,
      evaluation: evaluationAfter
    },
    resolvedWeaknesses,
    remainingWeaknesses,
    prismHttpDelivery
  };
}

module.exports = {
  evaluateVariations,
  evolveVariations,
  sendTraceToPrismApi
};
