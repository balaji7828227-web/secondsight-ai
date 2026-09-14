require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { MongoClient } = require('mongodb');
const generateVariations = require('./services/generator');
const { evaluateVariations, evolveVariations } = require('./services/prism');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Serve static frontend files (HTML, CSS, JS) from public directory
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB client and collection references
let mongoClient = null;
let experimentsCollection = null;
let evaluationsCollection = null;
let weaknessesCollection = null;
let improvementsCollection = null;

/**
 * Connects to MongoDB using MONGODB_URI from process.env.
 * Uses database 'SecondSightAI' and sets up collections:
 * experiments, evaluations, weaknesses, improvements.
 */
async function connectToMongoDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.warn('MongoDB warning: MONGODB_URI is not set in .env. MongoDB persistence is disabled.');
    return null;
  }

  try {
    mongoClient = new MongoClient(uri);
    await mongoClient.connect();
    const db = mongoClient.db('SecondSightAI');

    experimentsCollection = db.collection('experiments');
    evaluationsCollection = db.collection('evaluations');
    weaknessesCollection = db.collection('weaknesses');
    improvementsCollection = db.collection('improvements');

    console.log('Successfully connected to MongoDB database: SecondSightAI');
    console.log('Collections initialized: experiments, evaluations, weaknesses, improvements');
    return db;
  } catch (err) {
    const safeError = (err.message || 'Connection failed').replace(/mongodb(\+srv)?:\/\/[^\s@]+@/g, 'mongodb+srv://[REDACTED]@');
    console.error('MongoDB connection error:', safeError);
    mongoClient = null;
    experimentsCollection = null;
    evaluationsCollection = null;
    weaknessesCollection = null;
    improvementsCollection = null;
    return null;
  }
}

// Fallback to serve index.html directly on root GET
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API health check endpoint
app.get('/health', (req, res) => {
  res.send('SecondSight AI is running');
});

// Generate variations endpoint (Baseline SecondSight AI)
app.post('/generate', async (req, res) => {
  const { seedInput } = req.body;

  if (!seedInput || typeof seedInput !== 'string' || seedInput.trim().length === 0) {
    return res.status(400).json({
      error: 'seedInput is required and must be a non-empty string.'
    });
  }

  try {
    const result = await generateVariations(seedInput);

    // Save experiment to MongoDB if connected
    if (experimentsCollection) {
      try {
        const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
        const experimentDoc = {
          seedInput: result.seedInput,
          variations: result.variations,
          model: modelName,
          timestamp: new Date()
        };
        const insertResult = await experimentsCollection.insertOne(experimentDoc);
        console.log(`Experiment saved to MongoDB with ID: ${insertResult.insertedId}`);
      } catch (dbError) {
        console.error('Failed to save experiment to MongoDB:', dbError.message);
      }
    }

    return res.json(result);
  } catch (error) {
    console.error('Error in /generate:', error.message);
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      error: error.message || 'Failed to generate variations.'
    });
  }
});

// PRISM: Evaluate SecondSight AI variations
app.post('/api/prism/evaluate', async (req, res) => {
  const { seedInput, variations } = req.body;

  if (!seedInput || typeof seedInput !== 'string' || seedInput.trim().length === 0) {
    return res.status(400).json({
      error: 'seedInput is required and must be a non-empty string.'
    });
  }

  if (!Array.isArray(variations) || variations.length === 0) {
    return res.status(400).json({
      error: 'variations array is required for PRISM evaluation.'
    });
  }

  try {
    const evaluation = await evaluateVariations(seedInput, variations);

    // Persist evaluation in MongoDB
    if (evaluationsCollection) {
      try {
        const evalDoc = {
          ...evaluation,
          timestamp: new Date()
        };
        const insertedEval = await evaluationsCollection.insertOne(evalDoc);
        console.log(`PRISM evaluation saved to MongoDB with ID: ${insertedEval.insertedId}`);

        // Persist individual weaknesses
        if (weaknessesCollection && Array.isArray(evaluation.weaknesses) && evaluation.weaknesses.length > 0) {
          const weaknessDocs = evaluation.weaknesses.map(w => ({
            ...w,
            evaluationId: insertedEval.insertedId,
            seedInput,
            timestamp: new Date()
          }));
          await weaknessesCollection.insertMany(weaknessDocs);
          console.log(`Saved ${weaknessDocs.length} weakness records to MongoDB`);
        }
      } catch (dbErr) {
        console.error('Failed to save PRISM evaluation to MongoDB:', dbErr.message);
      }
    }

    return res.json({
      success: true,
      evaluation
    });
  } catch (error) {
    console.error('Error in /api/prism/evaluate:', error.message);
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      error: error.message || 'Failed to run PRISM evaluation.'
    });
  }
});

// PRISM: Run complete Before vs After evolution cycle
app.post('/api/prism/evolve', async (req, res) => {
  const { seedInput, baselineVariations } = req.body;

  if (!seedInput || typeof seedInput !== 'string' || seedInput.trim().length === 0) {
    return res.status(400).json({
      error: 'seedInput is required and must be a non-empty string.'
    });
  }

  try {
    const evolutionResult = await evolveVariations(seedInput, baselineVariations);

    // Persist improvement in MongoDB
    if (improvementsCollection) {
      try {
        const improvementDoc = {
          seedInput: evolutionResult.seedInput,
          model: evolutionResult.model,
          timestamp: new Date(),
          comparison: evolutionResult.comparison,
          resolvedWeaknesses: evolutionResult.resolvedWeaknesses,
          beforeSummary: {
            score: evolutionResult.comparison.scoreBefore,
            status: evolutionResult.comparison.statusBefore
          },
          afterSummary: {
            score: evolutionResult.comparison.scoreAfter,
            status: evolutionResult.comparison.statusAfter,
            scoreDelta: evolutionResult.comparison.scoreDelta
          }
        };
        const insertRes = await improvementsCollection.insertOne(improvementDoc);
        console.log(`PRISM evolution result saved to MongoDB with ID: ${insertRes.insertedId}`);
      } catch (dbErr) {
        console.error('Failed to save PRISM evolution to MongoDB:', dbErr.message);
      }
    }

    return res.json({
      success: true,
      evolution: evolutionResult
    });
  } catch (error) {
    console.error('Error in /api/prism/evolve:', error.message);
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      error: error.message || 'Failed to run PRISM evolution.'
    });
  }
});

// PRISM: Get history of evaluations and improvements
app.get('/api/prism/history', async (req, res) => {
  try {
    let evaluations = [];
    let improvements = [];

    if (evaluationsCollection) {
      evaluations = await evaluationsCollection.find({}).sort({ timestamp: -1 }).limit(10).toArray();
    }
    if (improvementsCollection) {
      improvements = await improvementsCollection.find({}).sort({ timestamp: -1 }).limit(10).toArray();
    }

    return res.json({
      success: true,
      evaluations,
      improvements
    });
  } catch (err) {
    console.error('Error in /api/prism/history:', err.message);
    return res.status(500).json({
      error: 'Failed to retrieve PRISM history.'
    });
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  if (mongoClient) {
    await mongoClient.close();
  }
  process.exit(0);
});

// Start server and connect to MongoDB
async function startServer() {
  await connectToMongoDB();
  app.listen(PORT, () => {
    console.log(`SecondSight AI server running at http://localhost:${PORT}`);
  });
}

startServer();
