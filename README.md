# Pentone Whitepaper & Architecture Guide

<div align="center">

<img src="./media/MarionetteDemo.gif" alt="Pentone Demo" height="400" />
<img src="./media/rewrite-api.gif" alt="Pentone Demo" height="495" />

**AI browser automation agent powered by on-device hybrid intelligence**

**100% offline after one-time provisioning · Zero telemetry · Absolute privacy**

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)
![On-Device AI](https://img.shields.io/badge/AI-On--Device-00ff88)
![Privacy First](https://img.shields.io/badge/Privacy-100%25_Offline-f59e0b)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![Transformers.js](https://img.shields.io/badge/Transformers.js-2.17-f59e0b)
![ONNX Runtime Web](https://img.shields.io/badge/ONNX_Runtime-Web_WASM-005CED)
![Local SLM](https://img.shields.io/badge/SLM-Qwen2.5--0.5B-blueviolet)
![Plasmo](https://img.shields.io/badge/Plasmo-Framework-a855f7)
![Voice Control](https://img.shields.io/badge/Voice-Push--to--Talk-00ff88)
![License](https://img.shields.io/badge/License-MIT-blue)

</div>

---

## Table of Contents

- [Overview](#overview)
- [Hybrid Architecture & Execution Tiers](#hybrid-architecture--execution-tiers)
- [Zero-Egress Offline Invariant & Model Provisioning](#zero-egress-offline-invariant--model-provisioning)
- [Voice Authorization & Capability Security Gate](#voice-authorization--capability-security-gate)
- [Worker Isolation & Crash Recovery](#worker-isolation--crash-recovery)
- [27 Browser Automation Tools](#27-browser-automation-tools)
- [Setup & Installation](#setup--installation)
- [Design Notes](#design-notes)
  - [Multimodal Understanding](#multimodal-understanding)
  - [Interactive Text & Media Analysis](#interactive-text--media-analysis)
  - [Semantic Memory Vault & RAG](#semantic-memory-vault--rag)
  - [Playbook-Guided Workflows](#playbook-guided-workflows)
- [Tech Stack](#tech-stack)
- [E2E Testing & Verification](#e2e-testing--verification)
- [License](#license)

---

## Overview

Pentone removes digital barriers by letting you navigate, inspect, and control any website using natural language, running entirely on-device and in complete privacy. Voice-controlled, agentic, and equipped with semantic memory, Pentone operates with zero cloud dependencies.

### Privacy-First Invariant
After an initial one-time model provisioning during setup (~488 MB INT8 ONNX Qwen2.5-0.5B + 23 MB embeddings model + 39 MB Whisper ASR), Pentone enforces a **strict offline invariant**:
- `env.allowRemoteModels = false` in both the inference worker and runtime.
- Model assets are served strictly from browser `CacheStorage` (`transformers-cache`) with verified SHA-256 digests.
- **Zero telemetry, zero external network egress during inference, no API keys, and no remote trackers.**
- Any cache miss or missing asset fails closed with a typed `ModelNotProvisionedError` instead of falling back to remote CDNs.

### Responsive On-Device Performance
- Off-thread Web Worker inference prevents blocking the browser main thread, DOM event listeners, or audio capture pipelines.
- Instant specialist tools (TextRank summarization, dictionary translation, native language detection) provide low-latency sub-100ms fallbacks.
- Hardware-isolated audio resampling (44.1/48 kHz to 16 kHz Float32 PCM) guarantees glitch-free voice capture.

---

## Hybrid Architecture & Execution Tiers

Pentone employs a 4-tier hybrid execution runtime (`lib/generative-runtime.ts`) that selects the fastest, most capable local engine available for every task:

```
┌─────────────────────────────────────────────────────────────┐
│                    User Request / Voice                     │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│            Tier 1: Chrome Native Specialist APIs            │
│  (Summarizer, Writer, Translator, LanguageDetector APIs)    │
└──────────────────────────────┬──────────────────────────────┘
                               │ (if unavailable)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             Tier 2: Chrome Prompt API (Gemini Nano)         │
│          (On-device Gemini Nano via window.ai)              │
└──────────────────────────────┬──────────────────────────────┘
                               │ (if unavailable)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│       Tier 3: Local Neural SLM (Dedicated Web Worker)       │
│    (Qwen2.5-0.5B-Instruct INT8 ONNX via Transformers.js)   │
└──────────────────────────────┬──────────────────────────────┘
                               │ (if unavailable or crashed)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│          Tier 4: Deterministic Algorithmic Fallback         │
│   (Extractive TextRank, Lexicon Translator, N-gram Detect)  │
└─────────────────────────────────────────────────────────────┘
```

1. **Tier 1 — Chrome Native Specialist APIs:** High-speed hardware-accelerated built-in APIs (`Summarizer`, `Writer`, `Translation`, `LanguageDetector`) when supported by Chrome.
2. **Tier 2 — Chrome Prompt API (Gemini Nano):** Built-in multimodal model accessed via `LanguageModel` / `window.ai`.
3. **Tier 3 — Local Neural SLM (`onnx-community/Qwen2.5-0.5B-Instruct`):** Runs INT8 dynamic quantization inside a dedicated Web Worker (`lib/workers/inference-worker.ts`) using Transformers.js 2.17 and ONNX Runtime Web WASM.
4. **Tier 4 — Deterministic Algorithmic Fallbacks:** Algorithmic routines (TextRank summarizer, dictionary translation, heuristic classification) ensure the user is never left without functionality even when neural models are unprovisioned or during worker re-initialization.

Every assistant message and tool response carries transparent provenance metadata (`res.tier`: `'native'`, `'generative'`, or `'deterministic'`) so users and reviewers always know which tier produced each output.

---

## Zero-Egress Offline Invariant & Model Provisioning

Pentone guarantees strict post-provisioning network isolation:

```typescript
// lib/workers/inference-worker.ts & lib/generative-runtime.ts
env.allowLocalModels = false;
env.allowRemoteModels = false;
env.useBrowserCache = true;
```

### Provisioning Pipeline (`lib/model-provisioning.ts`)
- Model artifacts are provisioned once via the Settings screen and stored into the browser's `CacheStorage` (`transformers-cache`).
- Assets are pinned to immutable commit SHA `22942cb7d7ba4cc81bb4673549ca4d4614469b5e`.
- Checksums are verified with SHA-256 digests.
- If an asset is missing or corrupt, the runtime immediately surfaces a `ModelNotProvisionedError` and falls back gracefully to Tier 4 deterministic engines. Remote network fetch requests are strictly prohibited.

---

## Voice Authorization & Capability Security Gate

To protect against prompt injection, malicious web scripts, and unintended automation, Pentone implements a two-tiered capability authorization gate (`lib/audio/voice-authorization-manager.ts`):

```
Physical User Gesture (Spacebar PTT / Mic Click)
                     │
                     ▼
       Tier A: Voice Turn Grant (30s deadline)
                     │
                     ▼
      Tier B: Voice Authorization Token (10s TTL)
                     │
                     ▼ (Atomic single-use consumption)
         [Browser Tool Execution Boundary]
```

- **Tier A (Voice Turn Grant):** Issued only on genuine physical user activation (Spacebar Push-to-Talk or microphone click). Bound to an active speech turn with a strict 30-second deadline.
- **Tier B (Voice Authorization Token):** An ephemeral, cryptographically unique single-use token with a 10-second TTL minted from an active Voice Turn Grant.
- **Atomic Tool Boundary Consumption:** High-privilege browser tools (`clickElement`, `fillInput`, `openTab`, `closeTab`, `pressKey`, etc.) in `lib/ui-tools.ts` require a valid token. Once consumed, the token is invalidated immediately.
- **Prompt Injection Defense:** Local model outputs cannot forge, synthesize, or replay authorization tokens. Synthesized text claiming authorization is rejected at the execution boundary.

---

## Worker Isolation & Crash Recovery

Local neural inference is fully isolated in an off-thread Web Worker (`lib/workers/inference-worker.ts`):
- **Thread Isolation:** The heavy WebAssembly token generation loop runs completely outside the renderer main thread. Spacebar PTT events, audio callbacks (`ScriptProcessorNode.onaudioprocess`), and UI animations remain smooth and unstarved.
- **Bounded Exponential Backoff Auto-Recovery:** If the worker terminates unexpectedly (e.g., browser WASM isolate out-of-memory or tab freeze), `GenerativeRuntime` automatically initiates bounded recovery:
  - Attempt 1: 1s backoff
  - Attempt 2: 2s backoff
  - Attempt 3: 4s backoff
- **Clean In-Flight Rejection:** Any in-flight inference promises reject cleanly exactly once with a descriptive error.
- **UI Recovery Controls:** If recovery fails or is in progress, the chat screen surfaces an interactive status banner with a **"Restart Engine"** action and a **"Cancel"** option.
- **Safety Invariant:** In-flight tool executions and consumed capability tokens are **NEVER** automatically replayed or re-authorized across a worker crash.

---

## 27 Browser Automation Tools

Pentone registers 27 specialized browser automation tools in its registry (`lib/tool-registry.ts`):

| # | Tool Name | Scope | Description |
|---|-----------|-------|-------------|
| 1 | `think` | Reasoning | Deliberates on multi-step workflows without executing DOM actions |
| 2 | `captureScreenshot` | Perception | Captures visible viewport as visual context |
| 3 | `getPageTitle` | Perception | Retrieves title and URL of the active tab |
| 4 | `getAccessibilitySnapshot` | Perception | Ingests simplified accessibility tree of the page |
| 5 | `findElements` | Perception | Locates interactive DOM elements by query or selector |
| 6 | `clickElement` | Action | Clicks button, link, or interactive node (requires token) |
| 7 | `fillInput` | Action | Enters text into form field or contenteditable element (requires token) |
| 8 | `pressKey` | Action | Sends keyboard events (e.g. Enter, Escape, Arrow keys) |
| 9 | `scrollUp` | Navigation | Scrolls viewport up |
| 10 | `scrollDown` | Navigation | Scrolls viewport down |
| 11 | `openTab` | Tab Mgmt | Opens URL in a new browser tab |
| 12 | `closeTab` | Tab Mgmt | Closes specified or current tab |
| 13 | `getTabs` | Tab Mgmt | Lists all open browser tabs |
| 14 | `switchTab` | Tab Mgmt | Switches focus to target tab |
| 15 | `highlightSelector` | Visual Aid | Highlights DOM elements matching a CSS selector |
| 16 | `highlightText` | Visual Aid | Highlights text occurrences on page |
| 17 | `listen` | Audio | Captures active tab audio stream |
| 18 | `captureAudio` | Audio | Records 5s audio buffer directly for analysis |
| 19 | `summarizePage` | Generation | Summarizes webpage content via native or local engine |
| 20 | `writeContent` | Generation | Synthesizes tailored copy with tone and context parameters |
| 21 | `translateText` | Generation | Translates text between supported language pairs |
| 22 | `detectLanguage` | Generation | Detects language code with confidence score |
| 23 | `storeMemory` | Knowledge | Stores user facts and preferences in semantic memory |
| 24 | `searchVault` | Retrieval | RAG vector search across stored documents and captures |
| 25 | `getVaultStats` | Retrieval | Reports item count and vector index health in Vault |
| 26 | `captureCurrentPage` | Retrieval | Chunks and embeds full page content into vector vault |
| 27 | `getPlaybook` | Workflow | Retrieves structured domain instructions for complex tasks |

---

## Setup & Installation

### Option 1: Build From Source

```bash
# 1. Clone repository
git clone https://github.com/Raghavv1206/Pentone.git
cd Pentone

# 2. Install dependencies
pnpm install

# 3. Build extension for Chrome Manifest V3
pnpm build

# 4. Load in Chrome:
#    a. Open chrome://extensions
#    b. Enable "Developer mode" (top right)
#    c. Click "Load unpacked"
#    d. Select build/chrome-mv3-dev (or build/chrome-mv3-prod)
```

### Option 2: Model Provisioning (Settings Screen)
1. Open the Pentone sidepanel or popup.
2. Navigate to **Settings** (`screens/settings-screen.tsx`).
3. Under **Local AI Engine**, click **Download Model Assets**.
4. The extension caches the required INT8 ONNX models into `CacheStorage`. Once completed, the badge displays **Cached (Offline Ready)**.

### Chrome AI Flags (Optional Acceleration)
Chrome's built-in Prompt and Specialist APIs are optional hardware-acceleration tiers. Pentone functions fully without them via its local ONNX Web Worker. To enable Chrome's native APIs:
- `chrome://flags/#prompt-api-for-gemini-nano` → **Enabled**
- `chrome://flags/#optimization-guide-on-device-model` → **Enabled BypassPerfRequirement**
- `chrome://flags/#summarization-api-for-gemini-nano` → **Enabled**
- `chrome://flags/#writer-api-for-gemini-nano` → **Enabled**

---

## Design Notes

### Multimodal Understanding
Pentone integrates text, visual screen captures, and audio:
- **Screenshots:** Rendered and processed as JPEG/PNG blobs for element localization and visual confirmation.
- **Voice Input:** Spacebar Push-to-Talk or mic click triggers `PersistentAudioPipeline`, resampling hardware audio to 16 kHz Float32 PCM for Whisper transcription.
- **Audio Capture:** The `captureAudio` and `listen` tools capture browser tab audio for on-device analysis.

### Interactive Text & Media Analysis
- **Text Selection Overlays:** Selecting text on any webpage displays instant contextual actions (Explain, Rewrite, Send to Chat).
- **Inline `/write` Command:** Typing `/write` in any input field or contenteditable element brings up the on-device writing assistant with tone, length, and format options.

### Semantic Memory Vault & RAG
- **Vector Embeddings:** 384-dimensional dense vectors generated locally via Transformers.js (`Xenova/all-MiniLM-L6-v2`).
- **Chunk-Based Retrieval:** Ingests web articles, PDFs, and text snippets into chunked vector embeddings stored in IndexedDB.
- **Search:** Cosine similarity retrieval surfaces relevant memories and past research directly into agent prompts.

### Playbook-Guided Workflows
For complex workflows (form filling, e-commerce navigation, email triage), the agent loads domain-specific playbooks via `getPlaybook()`. Playbooks provide domain context and recommended action sequences while allowing the agent to reason autonomously.

---

## Tech Stack

- **Extension Framework:** Plasmo (Chrome Manifest V3)
- **UI & Components:** React 18, Tailwind CSS, Lucide Icons
- **Local AI Engine:** Transformers.js 2.17.2, ONNX Runtime Web (WASM / WebGPU)
- **Primary SLM:** `onnx-community/Qwen2.5-0.5B-Instruct` (INT8 dynamic quantization)
- **Embeddings:** `Xenova/all-MiniLM-L6-v2` (384-dimensional dense vectors)
- **Speech Recognition:** Whisper Web WASM (`openai/whisper-tiny`) + Web Speech API fallback
- **Storage:** IndexedDB (vector vault & conversation history), CacheStorage (`transformers-cache`)
- **Language:** TypeScript 5.3

---

## E2E Testing & Verification

Pentone features a comprehensive automated test suite with 305+ passing tests:

```bash
# Run core test suite (171 tests)
npm test

# Run targeted Phase 3–3.5 standalone test suites (113 tests)
npx tsx --test \
  tests/phase3-5-production-hardening.test.ts \
  tests/phase3-4-targeted-remediation.test.ts \
  tests/phase3-2-runtime-evidence.test.ts \
  tests/phase3-3-1-cache-offline.test.ts \
  tests/provenance-and-fallbacks.test.ts \
  tests/voice-authorization-boundary.test.ts \
  tests/voice-noise-prewarm-hardening.test.ts

# Run unit suites (21 tests)
npx tsx --test \
  tests/writer-api-normalization.test.ts \
  tests/chrome-version-compat.test.ts \
  tests/first-run-setup-state.test.ts

# Run Phase 4 offline resilience suite
npx tsx --test tests/phase4-offline-resilience.test.ts

# Run production build
npm run build
```

---

## License

MIT License. See [LICENSE.txt](./LICENSE.txt) for details.
