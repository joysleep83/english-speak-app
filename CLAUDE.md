# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**EnglishAI Chat** — A single-page web app for English conversation practice. Features: STT input (Web Speech API), streaming AI responses (OpenRouter), TTS output (SpeechSynthesis), real-time grammar feedback, session history, and a stats dashboard.

No backend. All API calls go directly from the browser.

## How to Run

Web Speech API requires a secure context (HTTPS or localhost):

```bash
npx serve . -l 3000     # http://localhost:3000
python -m http.server 8080
```

**Chrome or Edge only** — `SpeechRecognition` and `SpeechSynthesis` are not reliable in Firefox or Safari.

## API Key Setup

`config.js` (gitignored) must define a global `CONFIG` object before `app.js` loads:

```js
const CONFIG = { OPENROUTER_API_KEY: 'sk-or-v1-...' };
```

Copy from `config.example.js`. If absent, `getApiKey()` falls back to `localStorage.getItem('or_api_key')`.

## Models

**AI Chat** (Google / OpenAI / Meta only — no Chinese models):
- Primary: `gemini-2.0-flash` via Google AI Studio (requires `GEMINI_API_KEY` in `config.js`)
- OpenRouter pool (fallback): `meta-llama/llama-3.3-70b-instruct:free` (Meta), `openai/gpt-oss-20b:free` (OpenAI), `google/gemma-3-27b-it:free` (Google)
- Last-resort backup: `openai/gpt-oss-120b:free`, `google/gemma-3-12b-it:free`

**Feedback**: tries `google/gemma-3-27b-it:free` → `meta-llama/llama-3.3-70b-instruct:free` → `openai/gpt-oss-20b:free`
**Translation / Suggestions**: tries `meta-llama/llama-3.3-70b-instruct:free` → `openai/gpt-oss-20b:free` → `google/gemma-3-27b-it:free`

Note: Anthropic Claude has no free models on OpenRouter — not included.

`callAI()` tries Gemini first, falls back to OpenRouter pool, then backup pool on any error. Feedback/translation/suggestions each try 3 models before returning null.

## Tech Stack

Vanilla HTML/CSS/JS — no build tool, no bundler, no npm dependencies (except `npx serve` for dev). Chart.js is loaded via CDN in `index.html`.

## Architecture

Everything lives in three files. `app.js` is the entire application — no modules, no classes.

### localStorage keys

| Key | Purpose |
|-----|---------|
| `englishai_v1` | Current conversation `messages[]` array |
| `eai_profile` | User profile (name, level, goals, dailyTarget) |
| `eai_sessions` | Array of completed/ongoing session objects |
| `eai_feedbacks` | Cumulative feedback log across all sessions |
| `eai_badges` | Earned badge records |
| `eai_streak` | `{ lastStudyDate, currentStreak }` |

All reads go through `safeGet(key, fallback)` and writes through `safeSet(key, value)`. `safeSet` handles `QuotaExceededError` by evicting the oldest session from `eai_sessions` and retrying.

### SPA routing

Hash-based: `#/chat`, `#/stats`, `#/history`, `#/profile`. `router()` reads `window.location.hash` and calls `showView(name)`, which toggles `.active` on view `<section>` elements and shows/hides the `<footer>` (footer is chat-only). On first load with no profile, `history.replaceState` redirects to `#/profile` before `router()` runs.

### Session lifecycle

`currentSession` is `null` until the first message of a conversation. `startSession()` creates it; `addSessionTurn()` appends messages and calls `upsertSession()` (which overwrites the same `sessionId` in `eai_sessions`). `endSession()` is called on chat clear and finalises duration. Sessions store only the messages added *in that session*, not the full `messages[]` history.

### Dual API calls in `sendMessage()`

When the user sends a message, two API calls fire in parallel:
1. `callAI()` → streaming response rendered into a new AI bubble via `fetchStream()`
2. `callFeedback()` → non-streaming, returns JSON; `await feedbackPromise` runs after the AI response resolves

`fetchStream()` both mutates the DOM (creates the bubble, streams tokens into it) *and* returns the final text string. `sendMessage()` never calls `renderMessage()` for AI responses.

### Feedback JSON contract

`callFeedback()` asks the model for a strict JSON object. The response may come wrapped in a markdown code block; `parseJSONFromText()` handles both cases (code block and raw JSON). If parsing fails or the API errors, the promise resolves to `null` and feedback is silently skipped.

### TTS word highlighting

`speak(text, bubbleEl)` replaces the bubble's `innerHTML` with word-wrapped `<span class="tts-word" data-start="N">` elements before calling `speechSynthesis.speak()`. The `onboundary` event uses `charIndex` to add `.active` to the matching span. Spans remain in the DOM after TTS ends but are visually transparent.

### Role naming split

`messages[]` uses OpenAI roles (`'user'` / `'assistant'`). CSS classes use `'user'` / `'ai'`. `renderMessage()` maps `'assistant'` → `'ai'`. The feedback `type` field must be one of `grammar`, `expression`, or `vocabulary` for the badge CSS to apply correctly.

### Profile → system prompt

`buildSystemPrompt()` appends level and goals from `eai_profile` to `SYSTEM_PROMPT`. This runs on every `sendMessage()` call so profile changes take effect immediately without reloading.

### Chart.js instances

`weeklyChartInst` and `errorChartInst` are module-level. `renderStatsView()` destroys existing instances before recreating them to avoid the "canvas already in use" error on repeated navigation.

## Test Scripts

`test-*.mjs` files in the project root test the OpenRouter API directly via Node.js ESM. Run with `node <file>.mjs`. They read the key from `.env` (not `config.js`).
