# Pentone Central AI Runtime & Reliability Audit
**Phase 0 Deliverable:** Comprehensive Read-Only Audit  
**Document Path:** `reports/PENTONE_AI_RUNTIME_AUDIT.md`  
**Execution Timestamp:** 2026-11-02T01:40:40Z  
**Branch:** `feature/browser-tools-reliability`  

---

## 1. Executive Summary

This audit assesses the runtime lifecycle, concurrency controls, messaging architecture, error handling, and reliability mechanisms across Pentone's AI and browser subsystems.

### Core Strategic Finding
Pentone's AI execution is currently **fragmented across five disconnected runtimes**:
1. `lib/ai.ts` (Central resident `LanguageModel` Prompt API session).
2. `lib/use-text-explainer.ts` (Independent `LanguageModel` session).
3. `lib/ui-tools.ts` (`summarizePage` one-off `Summarizer` / `LanguageModel` session).
4. `lib/use-text-writer.ts` / `lib/ui-tools.ts` (`window.Writer` session).
5. `lib/use-text-rewriter.ts` (`window.Rewriter` session).

**Architectural Recommendation:** Consolidate all language generation, summarization, rewriting, and writing into a **single, centralized, resident AI runtime** (`lib/ai.ts`). Specialized local models (Whisper, Silero VAD, CAM++, MiniLM) should remain isolated dedicated workers for their respective acoustic and vector domains.

---

## 2. Specialized vs. Centralized Component Division

| Component | Optimal Architecture | Justification |
|---|:---:|---|
| **Whisper ASR (`whisper-tiny.en`)** | **Remain Specialized** | Acoustic speech-to-text requires dedicated 16 kHz Float32 PCM preprocessing and streaming token cancellation. Runs efficiently in WebAssembly. |
| **Silero VAD** | **Remain Specialized** | Sub-millisecond voice activity detection must run synchronously in the audio render loop to trigger instant TTS barge-in. Zero-download ONNX asset. |
| **CAM++ Biometrics** | **Remain Specialized** | 512-D speaker verification must strictly evaluate acoustic similarity without mixing with prompt contexts. Zero-download ONNX asset. |
| **all-MiniLM-L6-v2** | **Remain Specialized** | 384-D dense embedding generation is optimized for vector search in `vault.ts` and `findElements.ts`. |
| **Porcupine Wake Word** | **Remain Specialized** | Ultra-low power keyword spotting via WebVoiceProcessor. Zero-download asset. |
| **Web Speech API (`webkitSpeechRecognition`)** | **ELIMINATE** | Cloud network dependency that leaks user voice audio to external servers. Replaced entirely by local Whisper. |
| **SpeechSynthesis (`window.speechSynthesis`)** | **Remain Specialized** (Hardened) | Native browser TTS is fast and reliable; harden by filtering to local OS voices only. |
| **Page Summarization (`summarizePage`)** | **Consolidate to Central Runtime** | High-level text summarization is a language generation task. Delegating to the central `LanguageModel` eliminates experimental `window.Summarizer` failures. |
| **Content Writing (`writeContent`)** | **Consolidate to Central Runtime** | Drafting text is standard LLM prompting. Reusing the resident Prompt API eliminates the unstandardized `window.Writer` dependency. |
| **In-Page Rewriting (`useTextRewriter`)** | **Consolidate to Central Runtime** | Rewriting with tone/length controls is easily achieved via system prompts in the central runtime. Eliminates `window.Rewriter`. |
| **In-Page Explanations (`useTextExplainer`)** | **Consolidate to Central Runtime** | Currently maintains a duplicate `LanguageModel` session. Should share the resident session from `lib/ai.ts`. |
| **Translation (`translateText`)** | **Consolidate to Central Runtime** | Can be executed via prompt instructions on the resident LLM or local MarianMT, eliminating `window.Translator` flags. |

---

## 3. Reliability & Lifecycle Deep-Dive

### A. Sidepanel-to-Background Messaging
- **Mechanism:** `chrome.runtime.sendMessage({ type: 'run_tool', payload })`.
- **Strengths:** Clean asynchronous promise wrapper (`plasmoWrapper`) in [`background.ts:41-56`](file:///c:/project/New%20folder/Marionette/background.ts#L41-L56). Resolves structured `{ success: true, ... }` or `{ success: false, error: ... }`.
- **Vulnerabilities:** If the background service worker is terminated by Chrome due to inactivity mid-tool, message delivery can fail with `"Could not establish connection. Receiving end does not exist."`.
- **Mitigation:** Pentone's `executeTool` in `lib/tools.ts` should implement a single transparent retry upon connection failure.

### B. Background-to-Content-Script Messaging
- **Mechanism:** `chrome.tabs.sendMessage(tabId, { type: 'fill_input', ... })`.
- **Strengths:** Robust content script listener in [`content.ts:53-81`](file:///c:/project/New%20folder/Marionette/content.ts#L53-L81) with `return true` for asynchronous response.
- **Vulnerabilities:** If a page was loaded before the extension was installed or reloaded, content scripts are not injected, causing message rejection.
- **Mitigation:** Before dispatching `chrome.tabs.sendMessage`, inject content scripts programmatically if ping fails (`chrome.scripting.executeScript`).

### C. Service Worker Lifecycle & State Persistence
- **State Storage:** Background service worker retains zero critical state in global JavaScript variables. All persistent state is serialized to `chrome.storage.local` (`pentone_settings`, `pentone_vault`, `chat_history`).
- **Capability Tokens:** Tokens minted in the UI context are synchronized to the background worker via `{ type: 'auth_mint_token' }` and stored in memory with TTL timestamps.

### D. Tool Authorization & Capability Tokens
- **Two-Tiered Security Model:**
  1. *Level A (Turn Grant):* Generated upon validated voice input or deliberate PTT hold with CAM++ speaker verification. Monotonically increasing `turnId`.
  2. *Level B (Execution Token):* Minted immediately prior to calling a specific tool. Bound to `toolName`, single-use (`consumed: true`), with strict 5,000ms TTL.
- **Classifier:** [`lib/audio/tool-authorization-classifier.ts`](file:///c:/project/New%20folder/Marionette/lib/audio/tool-authorization-classifier.ts) classifies every tool:
  - `READ_ONLY_INFORMATIONAL` (auto-granted with valid turn)
  - `SAFE_NAVIGATION` (auto-granted)
  - `MUTATING_CONTENT` (requires Level B token)
  - `EXECUTE_MUTATING_ACTIONS` (requires Level B token)
  - `DESTRUCTIVE_HIGH_RISK` (strictly requires interactive confirmation modal)

### E. Session Lifecycle & Compaction
- **Input Quota:** 9,216 tokens.
- **Proactive Compaction Threshold:** 5,500 tokens (~60% of context window).
- **Reserve Headroom:** 3,716 guaranteed reserve tokens for tool results and page dumps.
- **Incremental Compaction:** [`lib/summarizer.ts:210-242`](file:///c:/project/New%20folder/Marionette/lib/summarizer.ts#L210-L242) partitions messages, keeping the active task state and the last 3 conversational turns intact while compacting older history.
- **Compacted Session Reset:** [`lib/ai.ts:344-358`](file:///c:/project/New%20folder/Marionette/lib/ai.ts#L344-L358) cleanly destroys the old session and recreates a fresh session with `isFirstPrompt = false`, avoiding redundant model weight warmup.

### F. Concurrency, Race Conditions & Mutexes
- **Session Creation Mutex:** [`lib/ai.ts:91-96`](file:///c:/project/New%20folder/Marionette/lib/ai.ts#L91-L96) uses `sessionCreationPromise` to deduplicate concurrent creation attempts.
- **Microphone Hardware Lock:** [`lib/use-speech-recognition.ts:21-27`](file:///c:/project/New%20folder/Marionette/lib/use-speech-recognition.ts#L21-L27) uses `isSpeechRecognitionActive` lock to prevent simultaneous mic acquisition between TTS and speech input.
- **Monotonic Turn Guard:** [`lib/chat-context.tsx:706`](file:///c:/project/New%20folder/Marionette/lib/chat-context.tsx#L706) increments `activeTurnIdRef.current` on every user turn. Superseded turns immediately abort in-flight streams.

### G. Timeouts & Cancellation
- **AbortController:** Every stream in `lib/ai.ts` is bound to `currentController = new AbortController()`.
- **Instant Interrupt:** User clicking the stop button or pressing PTT triggers `interruptAI()`, which invokes `currentController.abort()`.
- **Defensive Availability Timeouts:** `checkPromptAPIAvailability` enforces a strict 5,000ms timeout ([`lib/ai-config.ts:276-280`](file:///c:/project/New%20folder/Marionette/lib/ai-config.ts#L276-L280)), preventing UI hangs when Chrome AI components are not provisioned.

### H. Crash Circuit Breakers
- Chromium enforces an enterprise circuit breaker: if an on-device utility process crashes 3 consecutive times, Chromium disables the API until browser restart.
- **Pentone Protection:** [`lib/ai-config.ts:346-348`](file:///c:/project/New%20folder/Marionette/lib/ai-config.ts#L346-L348) catches `"crashed too many times"` and alerts the user to restart Chrome via `chrome://restart`, preventing infinite cascading crash loops.
