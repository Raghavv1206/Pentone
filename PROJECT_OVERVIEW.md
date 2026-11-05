# Pentone: Voice-First, Local-First Browser AI Copilot

Pentone is an autonomous, on-device AI browser assistant built as a Chrome Manifest V3 extension. It allows users to control the browser, interact with web pages, search, manage tabs, synthesize summaries, and store semantic memories using natural spoken commands—operating **100% locally and privately on-device**.

---

## 1. Technology Stack

### Core Framework & UI
- **[Plasmo](https://docs.plasmo.com/) (v0.90.5)**: Modern Chrome Extension Manifest V3 framework with background service worker and side panel architecture.
- **[React 18](https://react.dev/)**: Component architecture for the extension side panel and popup interfaces.
- **[TypeScript 5.3](https://www.typescriptlang.org/)**: Strict type safety across content scripts, background workers, and UI contexts.
- **[Tailwind CSS](https://tailwindcss.com/) & Radix UI**: High-performance, dark-themed responsive user interface.
- **[Zustand](https://github.com/pmndrs/zustand)**: Lightweight, reactive state management for chat streams, audio states, and browser contexts.

### On-Device Artificial Intelligence
- **Chrome Built-in AI (Gemini Nano / Prompt API)**: High-speed, zero-cloud inference executed directly on local device hardware.
- **Chrome Summarizer & Writer APIs**: Fast on-device text summarization, content rewriting, and document synthesis.
- **Chrome Language Detection & Translation APIs**: In-browser translation and language identification without third-party APIs.
- **[@xenova/transformers](https://huggingface.co/docs/transformers.js) (v2.17.2)**: In-browser transformer runtime running `all-MiniLM-L6-v2` via WebAssembly (ONNX Runtime Web) to generate 384-dimensional dense vector embeddings.

### Voice & Speech Processing
- **Web Speech API (`SpeechRecognition` & `SpeechSynthesis`)**: Real-time push-to-talk voice capture and streaming natural voice output.
- **Custom Streaming Sentence Chunker (`lib/sentence-parser.ts`)**: Punctuation-aware progressive token buffer preventing single-word speech stuttering.
- **[Picovoice Porcupine](https://picovoice.ai/)**: On-device wake-word detection engine (*"Hey Pentone"*).
- **Web Audio API & Sound Effects**: Acoustic feedback for microphone triggers, shutter snaps, completions, and thinking states.

### Browser Automation & Content Extraction
- **Chrome MV3 APIs**: `chrome.tabs`, `chrome.scripting`, `chrome.sidePanel`, `chrome.storage`, `chrome.tabCapture`.
- **Readability.js & Turndown**: DOM parsing, article decluttering, and semantic Markdown conversion.

---

## 2. Key Features

1. **Voice-First Natural Interaction**:
   - Hold `Spacebar` anywhere in the browser to talk via push-to-talk.
   - Zero-latency streaming text-to-speech with natural speech interruption.
   - Conversational conciseness: answers directly in 1–2 punchy sentences; elaborates deeply only for theoretical, scientific, or educational inquiries.

2. **Multi-Intent Chained Command Execution**:
   - Automatically decomposes complex multi-task voice queries into sequential steps:
     * *Example*: *"Open YouTube and search for SpaceX, remember that I love space technology, check what tabs are open, and take a screenshot."*
     * Executes all 4 actions deterministically without waiting on LLM round-trip latency.

3. **27 Implementable Browser Tools**:
   - **Tab & Window Operations**: `openTab`, `closeTab` (supports closing current tab, specific tabs, `"close other tabs"`, or `"close all tabs"`), `switchTab`, `getTabs`, `getPageTitle`.
   - **Vision & Screen Capture**: `captureScreenshot` (with camera audio and visual flash), `captureCurrentPage`, `highlightText`, `highlightSelector`.
   - **Web Automation**: `findElements`, `clickElement`, `fillInput`, `pressKey`, `scrollDown`, `scrollUp`, `getAccessibilitySnapshot`.
   - **Local Semantic Memory**: `storeMemory`, `getMemories`, `searchVault`, `getVaultStats`.
   - **On-Device Intelligence**: `summarizePage`, `writeContent`, `translateText`, `detectLanguage`, `listen`, `think`, `getPlaybook`.

4. **Zero-Cloud Persistent Memory Vault**:
   - Stores user preferences, facts, and page summaries locally in IndexedDB.
   - Injects the top relevant preferences into the LLM context automatically during subsequent interactions.

5. **Safe Window & Tab Management**:
   - Batch tab closing safeguards: when closing all tabs, Pentone opens a fresh active tab first to ensure the Chrome window and Pentone side panel never crash or abruptly exit.

---

## 3. How Features Were Implemented

### 1. Dual Execution Pipeline (Background vs. UI Context)
Tools requiring direct user gesture (such as `summarizePage`, `writeContent`, `translateText`, `detectLanguage`) run directly in the active side panel UI context via `lib/ui-tools.ts`. All other automation tools (`openTab`, `closeTab`, `scrollDown`, `captureScreenshot`, etc.) are dispatched via `chrome.runtime.sendMessage({ type: 'run_tool' })` and executed inside the background service worker in `background.ts`.

### 2. Multi-Intent Fast Path & Refusal Suppression
Standard base models (including Gemini Nano) can fall back to generic LLM training disclaimers (e.g., claiming they cannot browse or control windows). Pentone solves this via a dual-layer strategy:
- **`lib/intent-detector.ts`**: Pattern-matches discrete user tasks upfront and immediately executes them.
- **Refusal Interceptor (`lib/chat-context.tsx`)**: Flags model refusals using `isModelRefusal()`, suppresses refusal disclaimers from the TTS audio queue, and gracefully substitutes the completed task result.

### 3. Progressive Streaming TTS Sentence Chunker
Instead of waiting for an entire AI response or speaking individual words as tokens stream in, `lib/sentence-parser.ts` buffers incoming characters until a natural punctuation boundary (`.`, `!`, `?`, or newline) is reached. It intelligently handles:
- Decimal numbers (`Flight 3.5`, `28.5%`) without premature splitting.
- Common contractions (`I've`, `I'll`, `I'm`) and abbreviations (`e.g.`, `vs.`).
- Immediate sentence flushing on generation completion.

### 4. Spacebar Push-to-Talk & Debounce Handling
Integrated into `components/onboarding/steps/model-availability-step.tsx` and `screens/main-screen.tsx`, global capture listeners track spacebar down and up states. A 3500ms post-release grace period allows the browser speech recognition engine to finalize phonetic transcription without abrupt cutoffs, supporting phonetic variations like `"download"`, `"done load"`, and `"down"`.

---

## 4. Codebase Structure

```
├── background.ts                  # Background service worker (background tool handlers)
├── content.ts                     # Content script for DOM inspection & highlights
├── sidepanel.tsx                  # Main Side Panel entry point
├── popup.tsx                      # Extension toolbar popup
├── components/                    # React UI components
│   ├── chat/                     # Message list, input controls, speech indicators
│   ├── onboarding/               # Setup wizard and model availability steps
│   └── visual/                   # Shutter animations & highlight overlays
├── lib/                           # Core logic & agent engine
│   ├── ai.ts                     # Gemini Nano session management & context pruning
│   ├── core-tools.ts             # Active tools exposed to the model prompt
│   ├── tool-registry.ts          # Aggregated tool specifications & spoken lines
│   ├── intent-detector.ts        # Intent parser, refusal detector, creator fast-path
│   ├── sentence-parser.ts        # Punctuation-aware TTS sentence chunker
│   ├── chat-context.tsx          # Master chat provider & agent loopback runner
│   ├── ui-tools.ts               # UI-context tool handlers requiring user gestures
│   └── tools/                    # 27 individual tool implementation modules
├── assets/                        # Sound effects, WASM binaries, Readability scripts
└── scratch/                       # Test suites & regression test harnesses
```

---

## 5. Creator Attribution
Pentone was created and developed by **Raghav**. When queried about its author or creator (*"Who made you?"*), Pentone responds directly with **Raghav**.
