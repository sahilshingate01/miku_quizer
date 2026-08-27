# 🎵 Miku Quizer — Chrome Extension (Manifest V3)

> **Miku Quizer** is an AI-powered quiz assistant Chrome extension and proxy backend. It detects multiple-choice questions on web pages, queries cutting-edge AI models (featuring **GPT-5.4 via OpenAI OAuth** and **Groq**), provides step-by-step reasoning and explanations, performs safe single-selection on assessment platforms (such as Newton School), and auto-advances at a natural human pacing rhythm.

---

## 🌟 Key Features

* 🧠 **GPT-5.4 with Chain-of-Thought Reasoning**: Integrated with local OpenAI OAuth (`openai-oauth`) allowing you to sign in with your Google/ChatGPT account for 99% reasoning accuracy without API costs.
* ⚡ **Multi-Provider Fallback**: Automatically connects to OpenAI OAuth (`GPT-5.4`, `GPT-5.5`) and fails over gracefully to Groq (`openai/gpt-oss-120b`, `qwen/qwen3.8-27b`).
* 🎯 **Smart Option Selection**: Accurately matches options by label or index and prevents toggle deselection.
* ⏩ **Natural Pacing Engine**: 2.5s default pacing per question with animated live countdown and `[Pause]` controls.
* 🏁 **End-of-Quiz Safety**: Automatically detects final questions (e.g., Question 5/5) and halts at an **"End of Quiz"** review card (never auto-submits exams).
* 🎛️ **Cyber Floating HUD**: Draggable, collapsible HUD displaying question number, reasoning confidence, pedagogical explanation, and pacing countdown.
* 🌐 **Google / ChatGPT Sign-In**: One-click authentication directly from the extension popup.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│               Chrome Web Browser                        │
│                                                         │
│  ┌───────────────────────┐   ┌───────────────────────┐  │
│  │ Content Script        │   │ Popup & Options Page  │  │
│  │ (DOM Extractor, HUD,  │   │ (OAuth Login, Metrics,│  │
│  │  Selection & Pacing)  │   │  Pacing Settings)     │  │
│  └───────────┬───────────┘   └───────────┬───────────┘  │
│              │                           │              │
│              ▼                           ▼              │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Background Service Worker (Manifest V3)           │  │
│  │ (Storage, Caching, Event Debouncing)              │  │
│  └─────────────────────────┬─────────────────────────┘  │
└────────────────────────────┼────────────────────────────┘
                             │ Local HTTP POST
                             ▼
┌─────────────────────────────────────────────────────────┐
│ Miku Quizer Local Backend Proxy (Node.js Express)        │
│ ∙ Authenticates with ChatGPT via OpenAI OAuth (Port 10531)│
│ ∙ Fallback to Groq API with TPM rate limit protection    │
│ ∙ Enforces Strict JSON Schema Validation & CoT Reasoning │
└──────────────┬─────────────────────────────┬────────────┘
               │                             │
               ▼                             ▼
┌───────────────────────────┐  ┌──────────────────────────┐
│ OpenAI OAuth (GPT-5.4)    │  │ Groq AI API              │
└───────────────────────────┘  └──────────────────────────┘
```

---

## 🚀 Quick Start Guide

### 1. Install Backend Dependencies

```bash
cd backend
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

### 3. Start Backend Server

```bash
node server.js
```

The backend will automatically connect to your local OpenAI OAuth proxy (`http://127.0.0.1:10531/v1`) or fall back to Groq.

### 4. Load the Chrome Extension

1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select the root directory of this repository (`miku_quizer`).
4. Pin **Miku Quizer** to your toolbar!

---

## 🧪 Interactive Test Suite

To test the extension locally:
1. Open `http://localhost:3001/test` in Chrome.
2. Open the Miku Quizer popup and click **`[⚡ Start Assistant on Tab]`**.
3. Watch Miku analyze questions, select choices, and display reasoning in the HUD!

---

## 📜 License

MIT License.
