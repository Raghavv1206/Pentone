# Pentone Feature Inventory & Classification Reconciliation

**Branch:** `feature/reliability-completion`  
**Base Commit:** `f8930bb` (stable release)  
**Date:** 2026-11-01  
**Extension:** Pentone (Chrome Extension MV3)

---

## 1. Executive Summary & Classification Schema

This inventory defines and catalogs every distinct user-facing feature, registered browser automation tool, and internal safety service in Pentone. Each item has a unique ID, belongs to specific domains, and is categorized under strict verification terminology.

### Distinct Verification Terminology
- **`LOGIC VERIFIED`**: Pure JavaScript/TypeScript algorithmic logic, state machines, mathematical thresholding, and string normalization verified in tests without external system mocks.
- **`AUTOMATED MOCK VERIFIED`**: Verified via automated test suites using simulated or mocked Chrome extension APIs (`chrome.tabs`, `chrome.scripting`, `chrome.tabCapture`, `window.Writer`, `window.Translator`, `window.LanguageDetector`) or simulated audio buffers.
- **`INTEGRATION VERIFIED`**: Multi-component pipeline verified within the automated test harness (e.g. keyboard event -> PTT state machine -> audio pipeline -> authorization gate).
- **`PHYSICAL CHROME VERIFIED`**: Verified via live interactive testing in a running Chrome 156 instance with real hardware (physical microphone, display, real Gemini Nano download from Google CDN, real YouTube tab). (Currently: 0 — automated test runner does not record physical hardware interactions).
- **`BLOCKED`**: Blocked by external/browser architectural limitations (e.g. desktop Gemini Nano text-only model rejecting image inputs).
- **`NOT VERIFIED`**: Feature present in code but not covered by automated or physical tests. (Currently: 0 — all items have automated test coverage).

### Mathematical Reconciliation Summary (60 Unique Functional Units)

$$\begin{aligned}
\text{Unique User-Facing Features (Non-Tool UI/UX)} &= 22 \\
\text{Registered Browser Automation Tools (TOOL\_REGISTRY)} &= 27 \\
\text{Internal Services \& Subsystems} &= 11 \\
\hline
\text{Total Unique Cataloged Units} &= \mathbf{60}
\end{aligned}$$

$$\begin{aligned}
\text{LOGIC VERIFIED} &= 22 \quad (10 \text{ Features} + 5 \text{ Tools} + 7 \text{ Services}) \\
\text{AUTOMATED MOCK VERIFIED} &= 33 \quad (10 \text{ Features} + 22 \text{ Tools} + 1 \text{ Service}) \\
\text{INTEGRATION VERIFIED} &= 4 \quad (1 \text{ Feature} + 0 \text{ Tools} + 3 \text{ Services}) \\
\text{BLOCKED} &= 1 \quad (\text{FEAT-IMG-02: Multimodal Screenshot Analysis}) \\
\text{PHYSICAL CHROME VERIFIED} &= 0 \\
\text{NOT VERIFIED} &= 0 \\
\hline
\text{Reconciliation Total: } 22 + 33 + 4 + 1 + 0 + 0 &= \mathbf{60} \quad \checkmark
\end{aligned}$$

---

## 2. Unique User-Facing Features (22 Features)

| Unique ID | Feature Name | Source File(s) | UI / Entry Point | Domain Mapping | Verification Status | Exact Evidence & Limitations |
|:---|:---|:---|:---|:---|:---|:---|
| **FEAT-TXT-01** | In-Page Selection Tooltip | `components/text-selection-tooltip.tsx` | Mouseup on web page text selection | Text AI, UI Controls | **AUTOMATED MOCK VERIFIED** | Tested in `suite-f-in-page-components.test.ts`. Position calculation and action buttons verified; physical cursor mouseup in live Chrome required for physical verification. |
| **FEAT-TXT-02** | Text Explainer View | `components/text-explainer-view.tsx` | Tooltip popup view | Text AI, UI Controls | **LOGIC VERIFIED** | Tested in `suite-f-in-page-components.test.ts`. Pure React component; markdown render, streaming chunk display, and theme styling verified. |
| **FEAT-TXT-03** | Text Explanation Action | `lib/use-text-explainer.ts` | Tooltip → "Explain" button | Text AI | **LOGIC VERIFIED** | Tested in `tests/independent-ai-verification.test.ts`. Calls `ensureTextSession({ multimodal: false })`; streams response without multimodal options. |
| **FEAT-TXT-04** | Text Preset Actions (Summarize, Rewrite, Translate, Ask) | `lib/use-text-explainer.ts` | Tooltip → Action buttons | Text AI | **LOGIC VERIFIED** | Tested all 4 actions separately in `tests/independent-ai-verification.test.ts`. Each requests text-only session and applies correct prompt instruction. |
| **FEAT-TXT-05** | Text Rewriter View & Presets | `lib/use-text-rewriter.ts`, `components/text-rewriter-view.tsx` | Selected text in editable field | Text AI, UI Controls | **AUTOMATED MOCK VERIFIED** | Tested in `suite-f-in-page-components.test.ts`. Preset tones/lengths mapped to `window.Rewriter` mock. Real Chrome Rewriter API physical check required. |
| **FEAT-TXT-06** | In-Place Text Replacement | `lib/use-text-rewriter.ts` | "Replace" button in Rewriter view | Text AI, UI Controls | **AUTOMATED MOCK VERIFIED** | Tested in `suite-f-in-page-components.test.ts`. Input/textarea DOM value replacement verified; live contenteditable execCommand requires physical Chrome check. |
| **FEAT-TXT-07** | Text Writer View & Generator | `lib/use-text-writer.ts`, `components/text-writer-view.tsx` | Double-click or `/write` command | Text AI, UI Controls | **AUTOMATED MOCK VERIFIED** | Tested in `suite-k-ptt-lifecycle-and-writer-api.test.ts`. Options & BCP-47 language normalization verified; Chrome Writer API mocked. |
| **FEAT-TXT-08** | In-Place Text Insertion | `lib/use-text-writer.ts` | "Insert" button in Writer view | Text AI, UI Controls | **AUTOMATED MOCK VERIFIED** | Tested in `suite-f-in-page-components.test.ts`. Cursor position text insertion verified on mock input. |
| **FEAT-IMG-01** | Crosshair Drag Screenshot Selection | `components/custom-text-selection.tsx` | Floating camera button | Image & Media, UI Controls | **AUTOMATED MOCK VERIFIED** | Tested in `suite-f-in-page-components.test.ts`. Bounding box math and canvas crop verified; physical mouse drag on screen required. |
| **FEAT-IMG-02** | Multimodal Screenshot Analysis | `lib/ai.ts`, `lib/use-text-explainer.ts` | Image explanation in Explainer | Image & Media, Text AI | **BLOCKED** | Tested in `tests/independent-ai-verification.test.ts`. Standard desktop Chrome Gemini Nano is text-only. Image input is rejected by local runtime. Non-crashing capability fallback message is verified. |
| **FEAT-VOX-01** | PTT Spacebar Keyboard Trigger | `lib/audio/ptt-state-machine.ts`, `use-full-duplex-voice.ts` | Spacebar Keydown in Side Panel | Voice & Audio | **INTEGRATION VERIFIED** | Tested in `suite-a-ptt-state-machine.test.ts`. 150ms hold hysteresis, repeat rejection, and state transitions verified; physical OS Spacebar press required for physical Chrome verification. |
| **FEAT-VOX-02** | Voice Reactive Waveform Visualizer | `components/waveform.tsx` | Side panel & Main screen | Voice & Audio, UI Controls | **LOGIC VERIFIED** | Tested in `tests/persistent-audio-pipeline-ptt.test.ts`. 32 canvas bars, RMS level calculation, and decay verified. Strictly 0 diff from baseline release. |
| **FEAT-VOX-03** | Speaker Profile Acoustic Enrollment Screen | `screens/voice-enrollment-screen.tsx` | Settings → Voice Profile | Voice & Audio, Settings | **AUTOMATED MOCK VERIFIED** | Tested in `suite-h-security-invariance.test.ts`. 3-prompt UI workflow & similarity thresholding verified in mock; physical acoustic enrollment required. |
| **FEAT-VOX-04** | Full-Duplex Audio & Barge-In Playback Interruption | `lib/audio/barge-in-controller.ts` | Assistant speaking | Voice & Audio | **LOGIC VERIFIED** | Tested in `tests/barge-in-cancellation-stage3.test.ts`. State machine transitions (ASSISTANT_SPEAKING -> INTERRUPTING) verified. |
| **FEAT-VOX-05** | Text-to-Speech (TTS) Voice Playback | `lib/tts-context.tsx` | Assistant responses | Voice & Audio | **AUTOMATED MOCK VERIFIED** | Tested in `suite-e-permissions-and-injection.test.ts`. Voice selection, pitch, rate, and speech queue verified with mock `window.speechSynthesis`. |
| **FEAT-CHAT-01** | Side Panel Chat Streaming Interface | `screens/chat-screen.tsx`, `lib/ai.ts` | Side panel message stream | Chat & Context | **LOGIC VERIFIED** | Tested in `tests/conversation-integrity.test.ts`. Real-time token streaming, message history, and auto-scroll verified. |
| **FEAT-CHAT-02** | Proactive Context Window Compaction | `lib/summarizer.ts`, `lib/chat-context.tsx` | Chat context manager | Chat & Context | **LOGIC VERIFIED** | Tested in `tests/context-summarizer-selection.test.ts`. Proactive compaction at 5,500 tokens before 9,216 limit verified. |
| **FEAT-UI-01** | In-Page Draggable Floating Action Controls | `components/capture-overlay-buttons.tsx` | In-page overlay (top right) | UI Controls | **LOGIC VERIFIED** | Tested in `suite-f-in-page-components.test.ts`. Boundary clamping, drag offset math, countdown, and DOM rendering verified. |
| **FEAT-UI-02** | Dual Theme System (Light / Dark / System Palette) | `lib/theme-context.tsx` | Settings → General tab | Settings, UI Controls | **LOGIC VERIFIED** | Tested in `suite-h-security-invariance.test.ts`. Palette tokens (`THEME_PALETTE`), CSS variable injection, and persistence verified. |
| **FEAT-SET-01** | Settings Screen (5 Tabs) | `screens/settings-screen.tsx` | Header → Settings icon | Settings | **AUTOMATED MOCK VERIFIED** | Tested in `suite-h-security-invariance.test.ts`. General, Voice, AI, Privacy, Advanced tabs verified with mocked `chrome.storage.local`. |
| **FEAT-SET-02** | Diagnostics Telemetry Screen | `screens/diagnostics-screen.tsx` | Header → Diagnostics icon | Settings | **LOGIC VERIFIED** | Tested in `suite-h-security-invariance.test.ts`. Latency calculations, token usage metrics, and Prompt API status rendering verified. |
| **FEAT-SET-03** | Onboarding Setup & Model Readiness Flow | `components/onboarding/onboarding-flow.tsx`, `model-availability-step.tsx` | First run / Reset onboarding | Settings, Onboarding | **AUTOMATED MOCK VERIFIED** | Tested in `suite-j-onboarding-and-download-lifecycle.test.ts`. Simulated download progress & permissions verified; physical Google CDN download required. |

---

## 3. Registered Browser Automation Tools (27 Tools in `TOOL_REGISTRY`)

All tools are declared in [`lib/tool-registry.ts`](file:///c:/project/New%20folder/Marionette/lib/tool-registry.ts), validated via [`lib/tool-parser.ts`](file:///c:/project/New%20folder/Marionette/lib/tool-parser.ts), and gated by [`lib/audio/voice-authorization-manager.ts`](file:///c:/project/New%20folder/Marionette/lib/audio/voice-authorization-manager.ts).

| Tool ID | Tool Name | Tool Spec File | Handler File | Execution Boundary | Requires User Gesture | Verification Status | Exact Evidence & Limitations |
|:---|:---|:---|:---|:---|:---:|:---|:---|
| **TOOL-01** | `think` | `lib/tools/think.ts` | `lib/tools/think.ts` | Background | No | **LOGIC VERIFIED** | Tested in `suite-c`. Pure JavaScript; records internal thought trace, stripped from user UI. |
| **TOOL-02** | `getPageTitle` | `lib/tools/getPageTitle.ts` | `lib/tools/getPageTitle.ts` | Background | No | **AUTOMATED MOCK VERIFIED** | Tested in `suite-c`. Verified with mocked `chrome.tabs.query`. Physical tab title check required. |
| **TOOL-03** | `openTab` | `lib/tools/openTab.ts` | `lib/tools/openTab.ts` | Background | No | **AUTOMATED MOCK VERIFIED** | Tested in `suite-d`. Scheme validation (`validateAndSanitizeUrl`) logic verified; `chrome.tabs.create` mocked. |
| **TOOL-04** | `closeTab` | `lib/tools/closeTab.ts` | `lib/tools/closeTab.ts` | Background | No | **AUTOMATED MOCK VERIFIED** | Tested in `suite-c`. Index/ID/closeActive logic verified; `chrome.tabs.remove` mocked. |
| **TOOL-05** | `getAccessibilitySnapshot` | `lib/tools/getAccessibilitySnapshot.ts` | `lib/tools/getAccessibilitySnapshot.ts` | Background (Scripting) | No | **AUTOMATED MOCK VERIFIED** | Tested in `suite-c`. Tree structure format verified; `chrome.scripting.executeScript` mocked. |
| **TOOL-06** | `findElements` | `lib/tools/findElements.ts` | `lib/tools/findElements.ts` | Background (Scripting) | No | **AUTOMATED MOCK VERIFIED** | Tested in `tests/tool-parser.test.ts`. YouTube Polymer card parsing & view-count sorting logic verified; live DOM query mocked. |
| **TOOL-07** | `clickElement` | `lib/tools/clickElement.ts` | `lib/tools/clickElement.ts` | Background (Scripting) | No | **AUTOMATED MOCK VERIFIED** | Tested in `suite-d`. Navigation polling `verifyNavigationState` logic verified; DOM click mocked. |
| **TOOL-08** | `fillInput` | `lib/tools/fillInput.ts` | `lib/tools/fillInput.ts` | Background (Scripting) | No | **AUTOMATED MOCK VERIFIED** | Tested in `suite-d`. Dual-path content messaging & scripting fallback verified with mocks. |
| **TOOL-09** | `listen` | `lib/tools/listen.ts` | `lib/tools/listen.ts` | Background | No | **AUTOMATED MOCK VERIFIED** | Tested in `suite-c`. Audio stream trigger verified with mock pipeline. |
| **TOOL-10** | `captureScreenshot` | `lib/tools/captureScreenshot.ts` | `lib/tools/captureScreenshot.ts` | Background | No | **AUTOMATED MOCK VERIFIED** | Tested in `suite-c`. Return schema verified; `chrome.tabs.captureVisibleTab` mocked. |
| **TOOL-11** | `captureAudio` | `lib/tools/captureAudio.ts` | `lib/ui-tools.ts` | UI Context | **Yes** | **AUTOMATED MOCK VERIFIED** | Tested in `suite-i`. User gesture & pre-acquired stream ID consumption verified; `tabCapture.getMediaStreamId` mocked. |
| **TOOL-12** | `writeContent` | `lib/tools/writeContent.ts` | `lib/ui-tools.ts` | UI Context | **Yes** | **AUTOMATED MOCK VERIFIED** | Tested in `suite-k`. Language normalization (`normalizeWriterLanguage`) logic verified; Chrome Writer API mocked. |
| **TOOL-13** | `summarizePage` | `lib/tools/summarizePage.ts` | `lib/ui-tools.ts` | UI Context | **Yes** | **AUTOMATED MOCK VERIFIED** | Tested in `suite-c`. Readability & chunking logic verified; Summarizer API mocked. |
| **TOOL-14** | `storeMemory` | `lib/tools/storeMemory.ts` | `lib/tools/storeMemory.ts` | Background | No | **LOGIC VERIFIED** | Tested in `tests/voice-memory-reliability.test.ts`. Rejects single words/names; validates full factual statements. |
| **TOOL-15** | `translateText` | `lib/tools/translateText.ts` | `lib/ui-tools.ts` | UI Context | **Yes** | **AUTOMATED MOCK VERIFIED** | Tested in `suite-c`. Parameter validation verified; Chrome Translator API mocked. |
| **TOOL-16** | `detectLanguage` | `lib/tools/detectLanguage.ts` | `lib/ui-tools.ts` | UI Context | **Yes** | **AUTOMATED MOCK VERIFIED** | Tested in `suite-c`. Parameter validation verified; Chrome LanguageDetector API mocked. |
| **TOOL-17** | `scrollUp` | `lib/tools/scrollUp.ts` | `lib/tools/scrollUp.ts` | Background (Scripting) | No | **AUTOMATED MOCK VERIFIED** | Tested in `suite-c`. Verified with mocked `chrome.scripting.executeScript`. |
| **TOOL-18** | `scrollDown` | `lib/tools/scrollDown.ts` | `lib/tools/scrollDown.ts` | Background (Scripting) | No | **AUTOMATED MOCK VERIFIED** | Tested in `suite-c`. Verified with mocked `chrome.scripting.executeScript`. |
| **TOOL-19** | `pressKey` | `lib/tools/pressKey.ts` | `lib/tools/pressKey.ts` | Background (Scripting) | No | **AUTOMATED MOCK VERIFIED** | Tested in `suite-c`. Key event dispatch verified with mocked scripting. |
| **TOOL-20** | `highlightSelector` | `lib/tools/highlightSelector.ts` | `lib/tools/highlightSelector.ts` | Background (Scripting) | No | **AUTOMATED MOCK VERIFIED** | Tested in `suite-c`. Style injection verified with mocked scripting. |
| **TOOL-21** | `highlightText` | `lib/tools/highlightText.ts` | `lib/tools/highlightText.ts` | Background (Scripting) | No | **AUTOMATED MOCK VERIFIED** | Tested in `suite-c`. Text highlight wrapper verified with mocked scripting. |
| **TOOL-22** | `captureCurrentPage` | `lib/tools/captureCurrentPage.ts` | `lib/tools/captureCurrentPage.ts` | Background (Scripting) | No | **AUTOMATED MOCK VERIFIED** | Tested in `suite-c`. Text extraction verified with mocked scripting. |
| **TOOL-23** | `searchVault` | `lib/tools/searchVault.ts` | `lib/tools/searchVault.ts` | Background | No | **LOGIC VERIFIED** | Tested in `suite-c`. In-memory vector similarity ranking verified purely in JS. |
| **TOOL-24** | `getVaultStats` | `lib/tools/getVaultStats.ts` | `lib/tools/getVaultStats.ts` | Background | No | **LOGIC VERIFIED** | Tested in `suite-c`. Memory count and stats calculation verified purely in JS. |
| **TOOL-25** | `getPlaybook` | `lib/tools/getPlaybook.ts` | `lib/tools/getPlaybook.ts` | Background | No | **LOGIC VERIFIED** | Tested in `suite-c`. Predefined routine instructions retrieval verified purely in JS. |
| **TOOL-26** | `getTabs` | `lib/tools/getTabs.ts` | `lib/tools/getTabs.ts` | Background | No | **AUTOMATED MOCK VERIFIED** | Tested in `suite-c`. Tab list query verified with mocked `chrome.tabs.query`. |
| **TOOL-27** | `switchTab` | `lib/tools/switchTab.ts` | `lib/tools/switchTab.ts` | Background | No | **AUTOMATED MOCK VERIFIED** | Tested in `suite-c`. Active tab update verified with mocked `chrome.tabs.update`. |

---

## 4. Internal Services & Safety Subsystems (11 Components)

| Service ID | Service Name | Source File(s) | Domain Mapping | Verification Status | Exact Evidence & Limitations |
|:---|:---|:---|:---|:---|:---|
| **SVC-VOX-01** | PTT Focus-Loss Safety Guard & Invalidation | `lib/audio/ptt-state-machine.ts`, `lib/audio/voice-authorization-manager.ts` | Voice & Audio | **INTEGRATION VERIFIED** | Tested in `suite-a` and `suite-k`. Halts mic stream, releases tracks, and invalidates turn grant upon Side Panel blur. |
| **SVC-VOX-02** | React Unmount Lifecycle Cleanup Engine | `lib/audio/use-full-duplex-voice.ts` | Voice & Audio | **INTEGRATION VERIFIED** | Tested across all 5 active turn phases in `suite-k`. Cancels in-flight turns and cleans up timers and listeners. |
| **SVC-VOX-03** | Local Whisper ASR WebAssembly Engine | `lib/audio/whisper-asr-service.ts` | Voice & Audio | **AUTOMATED MOCK VERIFIED** | Tested in `tests/local-whisper-asr-stage2.test.ts`. ONNX session initialization & Float32Array inference verified with mocks. |
| **SVC-VOX-04** | Audio Pre-Validation Energy & Duration Gate | `lib/audio/audio-pre-validation.ts` | Voice & Audio | **LOGIC VERIFIED** | Tested in `tests/voice-model-preloading-noise-rejection.test.ts`. Discards <150ms or RMS < 0.005 buffers purely algorithmically. |
| **SVC-VOX-05** | Whisper Hallucination Filter | `lib/audio/asr-orchestrator.ts` | Voice & Audio | **LOGIC VERIFIED** | Tested in `tests/voice-model-preloading-noise-rejection.test.ts`. Rejects 24+ common silence hallucinations purely via string matching. |
| **SVC-VOX-06** | Audio Resampling Engine | `lib/audio/audio-resampler.ts` | Voice & Audio | **LOGIC VERIFIED** | Tested in `tests/full-duplex-audio-stage1.test.ts`. Algorithmic sample rate transformation (44.1k/48k -> 16kHz mono). |
| **SVC-VOX-07** | Ambient Noise Floor Dynamic Calibration | `lib/audio/persistent-audio-pipeline.ts` | Voice & Audio | **LOGIC VERIFIED** | Tested in `tests/voice-model-preloading-noise-rejection.test.ts`. RMS running calculation verified without external dependencies. |
| **SVC-VOX-08** | Voice Authorization Gate & Token Manager | `lib/audio/voice-authorization-manager.ts` | Voice & Audio, Security | **INTEGRATION VERIFIED** | Tested in `suite-b` and `suite-h`. Single-use capability token validation, replay attack prevention, and account isolation verified. |
| **SVC-CHAT-01** | Silent Reasoning & Thought XML Stripper | `lib/silent-reasoning.ts` | Chat & Context | **LOGIC VERIFIED** | Tested in `tests/agent-execution-reasoning.test.ts`. Strips `<think>` tags and `think()` calls before UI rendering. |
| **SVC-CHAT-02** | In-Prompt Stored Memory Injection | `lib/system-prompt.ts` | Chat & Context | **LOGIC VERIFIED** | Tested in `tests/voice-memory-reliability.test.ts`. Injects memories into system prompt within 1,500 token budget. |
| **SVC-IMG-01** | Audio Modality Boundary Guard | `lib/use-text-explainer.ts` | Image & Media, Text AI | **LOGIC VERIFIED** | Tested in `suite-j`. Surfaces honest Gemini Nano on-device modal boundary message. |
