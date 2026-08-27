import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { runOpenAIOAuthLogin, startOpenAIOAuthServer } from 'openai-oauth';
import { createOpenAIOAuthRequest } from '@openai-oauth/core';

dotenv.config();

// Global crash protection for graceful error handling
process.on('uncaughtException', (err) => {
  console.warn('[Miku Quizer] Handled uncaughtException:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.warn('[Miku Quizer] Handled unhandledRejection:', reason?.message || reason);
});

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
let oauthServerInstance = null;

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
 * Ensure OpenAI OAuth proxy server is running.
 */
async function ensureOpenAIOAuthRunning() {
  const available = await isOpenAIOAuthAvailable(true);
  if (!available) {
    try {
      console.log('[Miku Quizer] 🚀 Starting embedded OpenAI OAuth proxy on port 10531...');
      oauthServerInstance = await startOpenAIOAuthServer({ port: 10531, host: '127.0.0.1' });
      cachedOAuthAvailable = true;
      console.log('[Miku Quizer] ✨ OpenAI OAuth proxy listening on:', oauthServerInstance.url);
    } catch (err) {
      if (err.message && err.message.includes('EADDRINUSE')) {
        cachedOAuthAvailable = true;
      } else {
        console.warn('[Miku Quizer] ⚠️ Could not start OAuth proxy:', err.message);
      }
    }
  } else {
    console.log('[Miku Quizer] ✨ OpenAI OAuth proxy connected (http://127.0.0.1:10531/v1)');
  }
}

ensureOpenAIOAuthRunning();

/**
 * Read stored auth tokens from ~/.codex/auth.json
 */
function getStoredAuthInfo() {
  try {
    const authPath = path.join(os.homedir(), '.codex', 'auth.json');
    if (!fs.existsSync(authPath)) return null;

    const data = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    if (data && data.tokens) {
      let email = 'ChatGPT User';
      let name = 'User';

      if (data.tokens.id_token) {
        const parts = data.tokens.id_token.split('.');
        if (parts.length >= 2) {
          try {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
            email = payload.email || email;
            name = payload.name || name;
          } catch {}
        }
      }

      return {
        email,
        name,
        hasTokens: Boolean(data.tokens.access_token || data.tokens.refresh_token)
      };
    }
  } catch (err) {
    console.warn('[Miku Quizer] Could not read auth info:', err.message);
  }
  return null;
}

// Active OAuth login tracking
let activeLoginPromise = null;
let currentAuthUrl = null;

/**
 * Free any stale process on a given port (e.g. port 1455)
 */
function freePort(port) {
  try {
    if (process.platform !== 'win32') {
      exec(`lsof -ti :${port} | xargs kill -9 2>/dev/null || true`);
    } else {
      exec(`for /f "tokens=5" %a in ('netstat -aon ^| findstr :${port}') do taskkill /f /pid %a 2>nul`);
    }
  } catch {}
}

/**
 * Initiate universal OAuth Login Flow with Google / ChatGPT
 */
async function triggerOAuthLogin() {
  if (activeLoginPromise && currentAuthUrl) {
    return { inProgress: true, authUrl: currentAuthUrl };
  }

  // Pre-generate request for zero-latency URL return
  try {
    const preReq = await createOpenAIOAuthRequest({
      redirectUri: 'http://127.0.0.1:1455/auth/callback'
    });
    if (preReq && preReq.authorizationUrl) {
      currentAuthUrl = preReq.authorizationUrl;
    }
  } catch (preErr) {
    console.warn('[Miku Quizer OAuth] Pre-req generation note:', preErr.message);
  }

  activeLoginPromise = runOpenAIOAuthLogin({
    openBrowser: true,
    redirectHost: '127.0.0.1',
    host: '127.0.0.1',
    onMessage: (msg) => {
      console.log('[Miku Quizer OAuth]', msg);
      if (typeof msg === 'string' && msg.includes('login URL:')) {
        const parts = msg.split('login URL:');
        if (parts[1]) {
          currentAuthUrl = parts[1].trim();
        }
      }
    }
  }).then((res) => {
    console.log('[Miku Quizer OAuth] ✨ Login successful! Saved to:', res.path);
    activeLoginPromise = null;
    currentAuthUrl = null;
    cachedOAuthAvailable = false;
    ensureOpenAIOAuthRunning();
    return res;
  }).catch((err) => {
    console.warn('[Miku Quizer OAuth] ⚠️ Login note:', err.message);
    activeLoginPromise = null;
    currentAuthUrl = null;
    return null;
  });

  // Give brief moment for auth URL to generate if needed
  for (let i = 0; i < 10; i++) {
    if (currentAuthUrl) break;
    await new Promise(r => setTimeout(r, 50));
  }

  return { inProgress: true, authUrl: currentAuthUrl };
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

// Trigger OAuth Login Flow (Direct & Non-conflicting)
app.post('/api/auth/login', async (req, res) => {
  try {
    console.log('[Miku Quizer] 🌐 Launching OpenAI Google/ChatGPT Login...');
    const result = await triggerOAuthLogin();

    res.json({
      success: true,
      message: 'OAuth login initiated in browser.',
      authUrl: result.authUrl
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Logout / Reset session endpoint
app.post('/api/auth/logout', (req, res) => {
  try {
    const authPath = path.join(os.homedir(), '.codex', 'auth.json');
    if (fs.existsSync(authPath)) {
      fs.unlinkSync(authPath);
    }
    cachedOAuthAvailable = false;
    res.json({ success: true, message: 'Logged out successfully.' });
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

    if (!question || !options || !Array.isArray(options) || options.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request: "question" string and non-empty "options" array required.'
      });
    }

    const validOptionLabels = options.map(o => o.label || o.text);
    const optionsText = options.map(o => `[${o.label || '?'}] ${o.text}`).join('\n');

    let userPrompt = `Question: ${question}\n\nAvailable Options:\n${optionsText}`;
    if (questionNumber && totalQuestions) {
      userPrompt = `[Question ${questionNumber} of ${totalQuestions}]\n${userPrompt}`;
    }

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ];

    let rawParsed = null;
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        rawParsed = await queryAI(messages, model);
        const validation = validateAIResponse(rawParsed, validOptionLabels);
        if (validation.valid) {
          return res.json({
            success: true,
            provider: 'OpenAI OAuth (ChatGPT)',
            model: model || 'gpt-5.4',
            ...validation.data
          });
        }
      } catch (aiErr) {
        console.warn(`[Miku Quizer] AI query attempt ${attempts} failed:`, aiErr.message);
        if (attempts >= maxAttempts) {
          return res.status(502).json({
            success: false,
            error: `OpenAI OAuth query failed: ${aiErr.message}`
          });
        }
      }
    }

    return res.status(500).json({
      success: false,
      error: 'Failed to obtain valid answer from OpenAI OAuth.'
    });
  } catch (err) {
    console.error('[Miku Quizer] Unexpected error in /api/solve:', err);
    res.status(500).json({ success: false, error: err.message });
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
