# Pentone Local-Processing & Network Boundary Audit
**Phase 0 Deliverable:** Comprehensive Read-Only Audit  
**Document Path:** `reports/PENTONE_LOCAL_PROCESSING_AUDIT.md`  
**Execution Timestamp:** 2026-11-02T01:39:30Z  
**Branch:** `feature/browser-tools-reliability`  

---

## 1. Executive Summary

This audit examined every source file across `background.ts`, `content.ts`, `sidepanel.tsx`, `lib/`, `components/`, and `screens/` to identify all network activities:
- `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`
- External API endpoints and cloud services
- Remote model weight downloads and CDN access
- Telemetry, analytics, and remote logging
- Web Speech API and speech synthesis network behavior
- External storage and synchronization

### Core Verdict
1. **Zero Cloud LLM Processing:** Pentone contains **no external cloud LLM dependencies** (no OpenAI, no Anthropic, no Google Cloud Vertex/Gemini API calls).
2. **Zero Telemetry or Analytics Transmission:** All references to "telemetry" are **100% in-memory ring buffers** displayed on internal developer screens (`screens/diagnostics-screen.tsx`). No telemetry packets ever leave the device.
3. **Remote Weight Downloads Exist for Transformers.js:** `@xenova/transformers` (`whisper-tiny.en` and `all-MiniLM-L6-v2`) downloads ONNX model weights and tokenizer configurations from `https://huggingface.co/` on first use. After download, they are cached locally in browser CacheStorage.
4. **Cloud Voice Leakage in Web Speech API:** The legacy half-duplex voice input path ([`lib/use-voice-input.ts`](file:///c:/project/New%20folder/Marionette/lib/use-voice-input.ts)) uses `window.webkitSpeechRecognition`. In Google Chrome, this streams microphone audio to Google speech servers. Conversely, the Full-Duplex/PTT path ([`lib/audio/use-full-duplex-voice.ts`](file:///c:/project/New%20folder/Marionette/lib/audio/use-full-duplex-voice.ts)) uses local Whisper via WebAssembly, keeping audio 100% on-device.
5. **Speech Synthesis Cloud Voice Risk:** In [`lib/tts-context.tsx`](file:///c:/project/New%20folder/Marionette/lib/tts-context.tsx), selecting a "Google ..." synthesized voice causes Chrome to stream synthesis text to Google TTS servers. Selecting local OS voices keeps synthesis on-device.

---

## 2. Exhaustive Network Dependency Audit

| File & Line | Invocation / Mechanism | Destination | Purpose | User Data / Audio Leaves Device? | Required for Initial Download Only? | Recommended Local Replacement or Fix |
|---|---|---|---|:---:|:---:|---|
| [`lib/audio/whisper-asr-service.ts:42`](file:///c:/project/New%20folder/Marionette/lib/audio/whisper-asr-service.ts#L42) | `@xenova/transformers` (`pipeline('automatic-speech-recognition')`) | `https://huggingface.co/Xenova/whisper-tiny.en` | Downloads Whisper ASR ONNX weights (~75 MB) and tokenizer JSON on first launch | **NO** (Zero audio leaves device; only static weights downloaded) | **YES** (Once cached in CacheStorage, runs 100% offline) | Bundle weights in extension `assets/` or provide pre-baked local cache; set `env.allowLocalModels = true`. |
| [`lib/embeddings.ts:5`](file:///c:/project/New%20folder/Marionette/lib/embeddings.ts#L5)<br>[`lib/vault.ts:97`](file:///c:/project/New%20folder/Marionette/lib/vault.ts#L97) | `@xenova/transformers` (`pipeline('feature-extraction')`) | `https://huggingface.co/Xenova/all-MiniLM-L6-v2` | Downloads embedding model ONNX weights (~90 MB) and tokenizer JSON on first use | **NO** (Zero user text leaves device; only static weights downloaded) | **YES** (Cached locally in CacheStorage) | Bundle weights in `assets/` or pre-warm during onboarding. |
| [`lib/use-speech-recognition.ts:95`](file:///c:/project/New%20folder/Marionette/lib/use-speech-recognition.ts#L95)<br>[`lib/use-voice-input.ts:23`](file:///c:/project/New%20folder/Marionette/lib/use-voice-input.ts#L23) | `window.webkitSpeechRecognition` | Google Speech Recognition Servers (`*.google.com`) | Transcribes speech in legacy half-duplex mic mode | **YES — CRITICAL PRIVACY RISK** (User voice audio is streamed over network to Google) | **NO** (Occurs on every spoken utterance) | **ELIMINATE.** Replace legacy `useVoiceInput` with `WhisperASRService` (which is already operational and 100% local). |
| [`lib/tts-context.tsx:89-100`](file:///c:/project/New%20folder/Marionette/lib/tts-context.tsx#L89-L100) | `window.speechSynthesis.speak()` | Google Cloud TTS (`*.google.com`) if a "Google ..." cloud voice is selected | Synthesizes assistant responses aloud | **CONDITIONAL PRIVACY RISK** (Generated text sent to Google if cloud voice chosen) | **NO** (Occurs on every spoken response if cloud voice active) | Filter `speechSynthesis.getVoices()` to strictly default to local OS voices (`voice.localService === true`). |
| [`lib/ai-config.ts:354-436`](file:///c:/project/New%20folder/Marionette/lib/ai-config.ts#L354-L436) | Chrome Omaha ComponentUpdater | Google Component Distribution CDN | Downloads Gemini Nano weights (~1.7 GB) for Prompt API | **NO** (Zero user prompt data leaves device; static model weights only) | **YES** (One-time background download by Chrome browser engine) | Keep for Prompt API; provide local Transformers.js fallback for environments where Omaha is absent. |
| [`lib/audio/speaker-verification-engine.ts:119`](file:///c:/project/New%20folder/Marionette/lib/audio/speaker-verification-engine.ts#L119) | `fetch(chrome.runtime.getURL('assets/cam_speaker.onnx'))` | Local Extension Sandbox (`chrome-extension://...`) | Loads bundled CAM++ ONNX model into WebAssembly memory | **NO** (100% Local memory read) | N/A (Local asset read) | None needed; this is completely local and offline. |
| [`lib/use-wake-word.ts:49-50`](file:///c:/project/New%20folder/Marionette/lib/use-wake-word.ts#L49-L50) | `fetch(chrome.runtime.getURL('assets/Hey-Marionette...'))` | Local Extension Sandbox (`chrome-extension://...`) | Loads bundled Porcupine wake-word weights into memory | **NO** (100% Local memory read) | N/A (Local asset read) | None needed; completely local. |
| [`lib/ai.ts:201`](file:///c:/project/New%20folder/Marionette/lib/ai.ts#L201) | `fetch(dataUrl)` | In-Memory Data URL (`data:image/png;base64,...`) | Converts base64 screenshot into a `Blob` for multimodal Prompt API | **NO** (100% In-memory transform) | N/A (In-memory) | None needed; zero network transit. |
| [`lib/use-text-explainer.ts:146`](file:///c:/project/New%20folder/Marionette/lib/use-text-explainer.ts#L146) | `fetch(imageDataUrl)` | In-Memory Data URL (`data:image/png;base64,...`) | Converts screenshot to `Blob` for in-page visual analysis | **NO** (100% In-memory transform) | N/A (In-memory) | None needed; zero network transit. |
| [`components/onboarding/steps/model-availability-step.tsx:100`](file:///c:/project/New%20folder/Marionette/components/onboarding/steps/model-availability-step.tsx#L100) | `fetch(wasmUrl, { method: 'HEAD' })` | Local Extension Sandbox (`chrome-extension://.../assets/ort-wasm-simd-threaded.mjs`) | Verifies that local ONNX WASM binary exists in package | **NO** (100% Local read) | N/A (Local check) | None needed; completely local. |

---

## 3. Telemetry, Analytics & Logging Verification

1. **Voice Diagnostic Tracker ([`lib/audio/voice-diagnostic-tracker.ts`](file:///c:/project/New%20folder/Marionette/lib/audio/voice-diagnostic-tracker.ts)):**
   - Implements `startTurn()`, `recordCAM()`, `recordWhisper()`, `recordAuth()`.
   - All records are appended to an in-memory ring buffer: `recentTurns: TurnDiagnosticRecord[] = []` (maximum 50 items).
   - Zero `fetch`, `navigator.sendBeacon`, or WebSocket calls exist in this module.
2. **Diagnostics Screen ([`screens/diagnostics-screen.tsx`](file:///c:/project/New%20folder/Marionette/screens/diagnostics-screen.tsx)):**
   - Reads directly from `voiceDiagnosticTracker.getRecentTurns()` and displays metrics (RMS, SNR gain, inference latency) in the sidepanel.
   - All diagnostic data is strictly confined to local sidepanel state.

---

## 4. Distinguishing Initial Weight Downloads from Active Inference

| Component | Initial Setup / Download Behavior | Active Operational / Inference Behavior |
|---|---|---|
| **Whisper ASR** | Downloads ~75 MB ONNX weights once from Hugging Face Hub to browser CacheStorage. | **100% Offline.** Evaluates Float32Array PCM frames locally in WebAssembly. Zero network access. |
| **MiniLM Embeddings** | Downloads ~90 MB ONNX weights once from Hugging Face Hub to browser CacheStorage. | **100% Offline.** Computes 384-D dense vectors in WebAssembly. Zero network access. |
| **Silero VAD** | **Zero network download.** Shipped inside extension bundle at `assets/silero_vad_*.onnx`. | **100% Offline.** Computes speech probabilities locally via ONNX Runtime Web. |
| **CAM++ Biometrics** | **Zero network download.** Shipped inside extension bundle at `assets/cam_speaker.onnx`. | **100% Offline.** Extracts 512-D bottleneck embeddings locally via ONNX Runtime Web. |
| **Chrome Prompt API** | Downloads ~1.7 GB Gemini Nano weights via Chrome ComponentUpdater. | **100% Offline.** Generates tokens inside Chrome's local C++ process (`OptimizationGuideOnDeviceModel`). |
| **Web Speech API** | No weight download (cloud service). | **Online.** Streams user audio to Google servers on every utterance. |
| **SpeechSynthesis** | OS-managed voices pre-installed. | **Local for OS voices; Online for "Google ..." voices.** |

---

## 5. Priority Action Items for Local-Only Hardening

1. **Deprecate `useVoiceInput` & Standardize on `WhisperASRService`:**
   Route all microphone input through the local WebAssembly Whisper pipeline. Eliminate `webkitSpeechRecognition` to guarantee that user voice never leaves the computer.
2. **Enforce Local TTS Voices Only:**
   Filter `window.speechSynthesis.getVoices()` to strictly exclude cloud-rendered voices (e.g. names starting with `"Google "` or where `voice.localService === false`), defaulting strictly to verified on-device OS voices (e.g., Microsoft David/Zira, Apple Samantha).
3. **Allow Local Model Weight Bundling for Transformers.js:**
   Update Transformers.js configuration to allow loading weights from local extension assets (`env.allowLocalModels = true`), providing complete air-gapped capability.
