import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const OPENAI_OAUTH_URL = process.env.OPENAI_OAUTH_URL || 'http://127.0.0.1:10531/v1';

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Serve test suite at /test
app.use('/test', express.static(path.join(__dirname, '../test')));
app.get('/test', (req, res) => {
  res.sendFile(path.join(__dirname, '../test/quiz_test.html'));
});

const SYSTEM_PROMPT = `You are Miku, a world-class exam solver, senior computer scientist, and high-accuracy test assistant.

Given a multiple-choice question (including code snippets, theory, logic, and technical concepts) and its available options, carefully analyze the problem step-by-step and determine the undeniably correct answer.

Return ONLY valid JSON using this exact schema:
{
  "reasoning": "Step-by-step logical deduction and code/concept analysis verifying why the chosen answer is correct and eliminating distractors",
  "answer": "A",
  "confidence": 0.95,
  "explanation": "Clear, concise pedagogical explanation explaining why the answer is correct",
  "sources": []
}

Rules:
1. "reasoning" MUST be written first to think through the problem and verify code semantics before picking the answer.
2. The "answer" field must EXACTLY match one of the supplied option labels (e.g. "A", "B", "C", "D" or exact label provided).
3. Do not invent choices. Select ONLY from the provided options.
4. "confidence" must be a float between 0.0 and 1.0 (e.g. 0.99 for 99% certainty).
5. "explanation" should explain clearly and directly why the selected answer is correct.
6. Output raw JSON ONLY. No markdown wrappers or extra text outside JSON.`;

/**
 * Validates whether the AI response has valid structure and a matching answer label.
 */
function validateAIResponse(parsed, validOptionLabels) {
  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, reason: 'Response is not a valid JSON object' };
  }

  const rawAnswer = String(parsed.answer || '').trim();
  const normalizedLabels = validOptionLabels.map(l => String(l).trim().toUpperCase());
  const matchedLabel = normalizedLabels.find(
    l => l === rawAnswer.toUpperCase()
  );

  if (!matchedLabel) {
    return {
      valid: false,
      reason: `Answer "${rawAnswer}" does not match any available option labels: [${validOptionLabels.join(', ')}]`
    };
  }

  // Normalize confidence
  let confidence = typeof parsed.confidence === 'number' ? parsed.confidence : parseFloat(parsed.confidence);
  if (isNaN(confidence) || confidence < 0 || confidence > 1) {
    confidence = 0.95;
  }

  const explanation = typeof parsed.explanation === 'string' && parsed.explanation.trim()
    ? parsed.explanation.trim()
    : 'No explanation provided.';

  return {
    valid: true,
    data: {
      answer: matchedLabel,
      confidence: Math.round(confidence * 100) / 100,
      explanation,
      sources: Array.isArray(parsed.sources) ? parsed.sources : []
    }
  };
}

// Cached OAuth status
let cachedOAuthAvailable = false;
let lastOAuthCheck = 0;

async function isOpenAIOAuthAvailable(force = false) {
  const now = Date.now();
  if (!force && now - lastOAuthCheck < 5000) {
    return cachedOAuthAvailable;
  }
  try {
    const resp = await fetch(`${OPENAI_OAUTH_URL}/models`, {
      method: 'GET',
      signal: AbortSignal.timeout(4000)
    });
    cachedOAuthAvailable = resp.ok;
    lastOAuthCheck = now;
    return resp.ok;
  } catch {
    cachedOAuthAvailable = false;
    lastOAuthCheck = now;
    return false;
  }
}

/**
 * Query OpenAI OAuth Proxy with ChatGPT account (GPT-5.4 / GPT-5.5 / GPT-5.6).
 */
async function queryOpenAIOAuth(messages, requestedModel = 'gpt-5.4') {
  const model = requestedModel && requestedModel.startsWith('gpt-') ? requestedModel : 'gpt-5.4';
  const resp = await fetch(`${OPENAI_OAUTH_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      response_format: { type: 'json_object' }
    }),
    signal: AbortSignal.timeout(25000)
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OpenAI OAuth Error (${resp.status}): ${errText}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response received from OpenAI OAuth proxy.');
  }

  return JSON.parse(content);
}

/**
 * Sole AI Solver: Exclusively uses authenticated OpenAI OAuth (ChatGPT).
 */
async function queryAI(messages, requestedModel) {
  const oauthModel = requestedModel?.startsWith('gpt-') ? requestedModel : 'gpt-5.4';
  console.log(`[Miku Quizer] 🧠 Solving exclusively via OpenAI OAuth (${oauthModel})...`);
  return await queryOpenAIOAuth(messages, oauthModel);
}

// Auto-spawn OpenAI OAuth proxy if not running
function ensureOpenAIOAuthRunning() {
  isOpenAIOAuthAvailable(true).then(available => {
    if (!available) {
      const cliPath = '/Users/sahil/Desktop/WorkSpxce/openai-oauth/packages/openai-oauth/dist/cli.js';
      console.log('[Miku Quizer] 🚀 Spawning OpenAI OAuth proxy on port 10531...');
      try {
        const proc = spawn(process.execPath, [cliPath], {
          detached: true,
          stdio: 'ignore'
        });
        proc.unref();
      } catch (err) {
        console.warn('[Miku Quizer] Could not auto-spawn openai-oauth:', err.message);
      }
    } else {
      console.log('[Miku Quizer] ✨ OpenAI OAuth proxy connected (http://127.0.0.1:10531/v1)');
    }
  });
}

ensureOpenAIOAuthRunning();

function getStoredAuthInfo() {
  try {
    const authPath = path.join(os.homedir(), '.codex', 'auth.json');
    if (!fs.existsSync(authPath)) return null;

    const data = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    if (data && data.tokens && data.tokens.id_token) {
      const parts = data.tokens.id_token.split('.');
      if (parts.length >= 2) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
        return {
          email: payload.email || 'ChatGPT User',
          name: payload.name || 'User',
          hasTokens: Boolean(data.tokens.access_token)
        };
      }
    }
  } catch (err) {
    console.warn('[Miku Quizer] Could not read auth info:', err.message);
  }
  return null;
}

// Auth Status Endpoint
app.get('/api/auth/status', async (req, res) => {
  const authInfo = getStoredAuthInfo();
  const oauthActive = await isOpenAIOAuthAvailable();

  res.json({
    authenticated: Boolean(authInfo && authInfo.hasTokens),
    user: authInfo ? { email: authInfo.email, name: authInfo.name } : null,
    proxyActive: oauthActive,
    model: 'gpt-5.4'
  });
});

// Trigger OAuth Login Flow
app.post('/api/auth/login', (req, res) => {
  try {
    const cliPath = '/Users/sahil/Desktop/WorkSpxce/openai-oauth/packages/openai-oauth/dist/cli.js';
    console.log('[Miku Quizer] 🌐 Launching OpenAI Google/ChatGPT Login...');
    const loginProc = spawn(process.execPath, [cliPath, 'login'], {
      detached: true,
      stdio: 'inherit'
    });
    loginProc.unref();

    res.json({ success: true, message: 'OAuth login initiated in browser.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  const oauthActive = await isOpenAIOAuthAvailable();
  const authInfo = getStoredAuthInfo();
  res.json({
    status: 'ok',
    service: 'Miku Quizer Proxy (Exclusive OpenAI OAuth)',
    openaiOAuth: {
      active: oauthActive,
      endpoint: OPENAI_OAUTH_URL,
      model: 'gpt-5.4',
      user: authInfo ? authInfo.email : null
    }
  });
});

// List models endpoint (OpenAI OAuth exclusive)
app.get('/api/models', async (req, res) => {
  const models = [
    'gpt-5.4 (OpenAI OAuth - Highest Accuracy)',
    'gpt-5.5 (OpenAI OAuth - Advanced Reasoning)',
    'gpt-5.6-terra (OpenAI OAuth)',
    'gpt-5.4-mini (OpenAI OAuth - Fast)'
  ];
  res.json({ models, default: 'gpt-5.4' });
});

// Main solve endpoint
app.post('/api/solve', async (req, res) => {
  try {
    const { question, options, questionNumber, totalQuestions, model } = req.body;

    if (!question || typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({
        error: 'Missing or invalid "question" text.'
      });
    }

    if (!Array.isArray(options) || options.length < 2) {
      return res.status(400).json({
        error: 'Question must have at least 2 options.'
      });
    }

    // Extract option labels and texts
    const validOptionLabels = options.map((opt, idx) => {
      if (typeof opt === 'object' && opt.label) return String(opt.label).trim();
      return String.fromCharCode(65 + idx);
    });

    const formattedOptions = options.map((opt, idx) => {
      const label = (typeof opt === 'object' && opt.label) ? opt.label : String.fromCharCode(65 + idx);
      const text = (typeof opt === 'object' && opt.text) ? opt.text : String(opt);
      return `${label}. ${text}`;
    }).join('\n');

    const userPrompt = `Question ${questionNumber ? `${questionNumber}${totalQuestions ? `/${totalQuestions}` : ''}: ` : ''}
${question.trim()}

Available Options:
${formattedOptions}

Select the single best option label from: [${validOptionLabels.join(', ')}].`;

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ];

    let resultData = null;

    try {
      const parsed = await queryAI(messages, model);
      const validation = validateAIResponse(parsed, validOptionLabels);

      if (validation.valid) {
        resultData = validation.data;
      } else {
        console.warn(`[Miku Quizer] Validation failed on attempt 1: ${validation.reason}. Retrying...`);
        const retryMessages = [
          ...messages,
          { role: 'assistant', content: JSON.stringify(parsed) },
          {
            role: 'user',
            content: `ERROR: ${validation.reason}. Please fix this immediately. Output strictly valid JSON with "answer" equal to one of [${validOptionLabels.join(', ')}].`
          }
        ];

        const retryParsed = await queryAI(retryMessages, model);
        const retryValidation = validateAIResponse(retryParsed, validOptionLabels);
        if (retryValidation.valid) {
          resultData = retryValidation.data;
        } else {
          throw new Error(`Second attempt validation failed: ${retryValidation.reason}`);
        }
      }
    } catch (apiErr) {
      console.error('[Miku Quizer] OpenAI OAuth error:', apiErr.message);
      return res.status(502).json({
        error: `OpenAI OAuth Error: ${apiErr.message}`,
        details: 'Ensure you are signed in with Google/ChatGPT via OpenAI OAuth.'
      });
    }

    return res.json({
      success: true,
      questionNumber: questionNumber || null,
      totalQuestions: totalQuestions || null,
      ...resultData
    });

  } catch (error) {
    console.error('[Miku Quizer] Server error:', error);
    res.status(500).json({
      error: 'Internal server error while processing quiz question.',
      message: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`
  ======================================================
  🎵 Miku Quizer Backend Proxy Active!
  🌐 API Server: http://localhost:${PORT}
  🧪 Interactive Test Quiz: http://localhost:${PORT}/test
  🧠 Provider: Exclusively OpenAI OAuth (ChatGPT)
  🤖 Default Model: GPT-5.4
  ======================================================
  `);
});
