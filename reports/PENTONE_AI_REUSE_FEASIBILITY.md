# Pentone AI Model Reuse & Architecture Feasibility
**Document Type:** Technical Architecture Audit (Read-Only)  
**Target Repository:** Pentone MV3 Voice Browser Assistant  
**Branch:** `feature/browser-tools-reliability`  
**Execution Timestamp:** 2026-11-02T01:18:00Z  

---

## 1. Executive Summary

The central question posed by the user is:
> **"Pentone's normal speech/conversation functionality is working, so which AI models and runtime components make that possible, and can the same existing AI infrastructure power webpage summarization, webpage understanding, and other browser intelligence features?"**

### Primary Technical Answer: **YES.**
The existing AI infrastructure can completely power webpage summarization, webpage question answering, in-page explanation, and browser intelligence.

Currently, Pentone suffers from an **artificial fragmentation** of its AI architecture:
- `chat-context.tsx` and `lib/ai.ts` maintain a resident **Prompt API session** (`window.LanguageModel`).
- `useTextExplainer.ts` uses `window.LanguageModel` to explain, summarize, rewrite, translate, and answer questions about selected text.
- BUT `summarizePage` in `lib/ui-tools.ts` treats summarization as a separate domain, attempting to call an unprovisioned `window.Summarizer` API and spinning up a redundant, isolated `LanguageModel` session.
- Furthermore, Pentone **already bundles `@xenova/transformers` with ONNX WebAssembly**, which already runs local embeddings (`all-MiniLM-L6-v2`) and local ASR (`whisper-tiny.en`).

Unifying these disparate execution paths onto the existing resident AI engine eliminates model duplication, circumvents experimental Chrome flags, and preserves 100% offline privacy with zero external API costs.

---

## 2. Comparison of Pentone AI Modalities & Execution Paths

| Capability / Feature | Underlying Model / Runtime | Shared Engine vs. Separate API | Can Receive Arbitrary Long Text? | Token / Context Capacity | Execution Context | User Gesture Required? | Integrated with Chat Engine? |
|---|---|---|:---:|:---:|---|:---:|:---:|
| **A. Normal Voice Conversation** | Chrome Prompt API (`window.LanguageModel` / Gemini Nano) | Shared resident engine in `lib/ai.ts` | Yes | 9,216 tokens (Compacted at 5,500) | Sidepanel UI context (`sidepanel.html`) | No (runs in open sidepanel) | **Yes** (Primary driver) |
| **B. Agent Reasoning & Planning** | Chrome Prompt API (`window.LanguageModel`) | Shared resident engine in `lib/ai.ts` | Yes | 9,216 tokens | Sidepanel UI context | No | **Yes** |
| **C. Browser Tool Selection** | Chrome Prompt API (`window.LanguageModel`) | Shared resident engine in `lib/ai.ts` | Yes | 9,216 tokens | Sidepanel UI context | No | **Yes** |
| **D. Webpage Summarization (`summarizePage`)** | Experimental Chrome Summarizer API (`window.Summarizer`) with isolated `LanguageModel` fallback | **Separate experimental API**; isolated session in `ui-tools.ts` | Yes (chunked to 3,500 chars) | ~4,000 chars per chunk | Sidepanel UI context | **Yes** (`requiresUserGesture: true`) | **No** (returns string to chat; does not use resident session) |
| **E. In-Page Selected Text Actions (`useTextExplainer`)** | Chrome Prompt API (`window.LanguageModel`) | Separate session in `use-text-explainer.ts` | Yes | 9,216 tokens | Content script / Sidepanel | No | **No** (Displays in floating pill) |
| **F. Writing / Rewriting (`useTextWriter`, `useTextRewriter`)** | Experimental Chrome Writer & Rewriter APIs (`window.Writer`, `window.Rewriter`) | **Separate experimental APIs** | Yes | Variable Chrome quota | Content script / Sidepanel | **Yes** | **No** |
| **G. Translation (`translateText`)** | Experimental Chrome Translator API (`window.Translator`) | **Separate experimental API** | Yes | Variable Chrome quota | Sidepanel UI context | **Yes** | **No** |
| **H. Language Detection (`detectLanguage`)** | Experimental Chrome LanguageDetector API (`window.LanguageDetector`) | **Separate experimental API** | Yes | 1,000 chars | Sidepanel UI context | **Yes** | **No** |
| **I. Semantic Memory Search (`vault.ts`, `embeddings.ts`)** | Local Transformers.js (`Xenova/all-MiniLM-L6-v2` via ONNX WASM) | **Local WASM pipeline** | Yes (chunked to 512 tokens) | 512 tokens per chunk | Sidepanel / Background | No | **Yes** (Provides context to chat) |

---

## 3. Capability Feasibility Matrix: Reusing Existing Infrastructure

| # | Pentone Capability | Feasibility Classification | Technical Basis & Recommended Architecture |
|---|--------------------|:--------------------------:|--------------------------------------------|
| 1 | **Normal Voice Conversation** | **ALREADY SUPPORTED** | Operational via Whisper / WebSpeech + Prompt API (`lib/ai.ts`) + SpeechSynthesis. |
| 2 | **Webpage Summarization** | **SUPPORTED WITH EXISTING INFRASTRUCTURE** | The content extractor in `ui-tools.ts` already extracts clean text. Instead of invoking `window.Summarizer`, feed the extracted text directly to the resident `LanguageModel` in `lib/ai.ts` (using the summarization prompt template already present in `useTextExplainer.ts`). |
| 3 | **Webpage Question Answering** | **SUPPORTED WITH EXISTING INFRASTRUCTURE** | Already implemented in `useTextExplainer.ts` (`generateAction('ask', text, prompt)`). Can be routed to the resident conversation session by injecting page content as a reference block. |
| 4 | **Selected-Text Explanation** | **ALREADY SUPPORTED** | Fully implemented in `components/text-explainer-view.tsx` and `lib/use-text-explainer.ts`. |
| 5 | **Webpage Content Extraction & Analysis** | **ALREADY SUPPORTED** | `Readability.js`, YouTube specialized extractor, and structured contact extractor in `ui-tools.ts` (L60–185) are completely functional. |
| 6 | **Multi-Step Browser Automation** | **ALREADY SUPPORTED** | Decomposed and tracked via `ActiveTaskState` (`lib/task-state.ts`), tool loop in `chat-context.tsx`, and 27 registered tools. |
| 7 | **Tool Selection and Execution** | **ALREADY SUPPORTED** | 27-tool registry (`lib/tool-registry.ts`), XML parser (`lib/tool-parser.ts`), and background/UI dispatchers fully operational. |
| 8 | **Translation** | **SUPPORTED WITH SMALL INTEGRATION** | Can be executed via the existing `LanguageModel` session using prompting (`"Translate the following text into {targetLanguage}: ..."`), or via local Transformers.js MarianMT model, avoiding the experimental `window.Translator` flag. |
| 9 | **Language Detection** | **SUPPORTED WITH SMALL INTEGRATION** | Can be executed via lightweight client-side heuristic libraries (such as `franc` or `i18next-browser-languagedetector` which is already in `package.json`!), eliminating the experimental `window.LanguageDetector` flag. |
| 10 | **Memory Retrieval & Contextual Answers** | **ALREADY SUPPORTED** | Fully operational via `@xenova/transformers` (`all-MiniLM-L6-v2`) and `lib/vault.ts`. |

---

## 4. Architectural Alternatives to Overcome Summarization Failure

### Option 1: Direct Prompt API Delegation (Zero New Dependencies)
- **Concept:** Remove the dependency on `window.Summarizer` in `summarizePage`. Route page content directly into the existing `LanguageModel` session in `lib/ai.ts` or `chat-context.tsx`.
- **Pros:**
  - Zero new dependencies.
  - Reuses the existing resident Gemini Nano session.
  - Matches the pattern already proven in `useTextExplainer.ts`.
  - Full streaming support into the chat UI.
- **Cons:**
  - Still requires Gemini Nano weights to be present in Chrome.

### Option 2: Local Transformers.js Summarizer (100% Chrome-Independent)
- **Concept:** Pentone already bundles `@xenova/transformers` and ONNX WASM for Whisper and MiniLM. A quantized, small summarization model (e.g. `Xenova/distilbart-cnn-6-12` or `Xenova/t5-small`) can run completely on-device in the sidepanel.
- **Pros:**
  - Runs in **any Chromium environment**, including Chrome for Testing, Brave, Edge, and older Chrome builds.
  - Zero dependence on Chrome Built-in AI flags (`#prompt-api-for-gemini-nano`, `#summarization-api`).
  - Zero dependence on Omaha ComponentUpdater.
  - 100% offline and private.
- **Cons:**
  - One-time weight download (~150 MB - 250 MB) cached in browser storage.
  - Higher CPU/memory overhead than Chrome's C++ native engine.

### Option 3: Extracted Text Ingestion into Active Conversation
- **Concept:** When user asks to "summarize this page", the tool extracts the content and sets it as an active conversation `ChatReference` (just like screenshot or audio references in `chat-context.tsx` L725–743). The model then naturally summarizes the reference during its standard conversational turn.
- **Pros:**
  - Seamless conversational continuity: user can follow up with questions ("what does it say about pricing?").
  - Strictly preserves existing agent loop and token budget compaction.
