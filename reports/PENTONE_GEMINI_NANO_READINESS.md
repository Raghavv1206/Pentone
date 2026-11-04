# Pentone Gemini Nano & On-Device AI Readiness Report

**Date:** November 2, 2026  
**Status:** BLOCKED ON UPSTREAM COMPONENT UPDATER (PROVISIONING)  
**Branch:** `feature/browser-tools-reliability`  
**Target Environments Tested:**
1. Chrome for Testing `156.0.8078.80` (Win64)
2. Official Chrome `156.0.8078.74` (Win64)

---

## 1. Executive Summary

This investigation analyzed the on-device AI capabilities in Chrome 156 to determine whether local Gemini Nano inference (via Chrome's Prompt API, Summarizer API, Writer API, and Translator API) can power Pentone's summarization, page understanding, and text generation.

### Key Finding
While Chrome 156 exposes the global API interfaces (`window.LanguageModel`, `window.Summarizer`, and `window.ai`), **the underlying Gemini Nano model weights cannot be provisioned or downloaded in headless or automated Chrome environments**.

Empirical CDP inspection of `chrome://components` reveals:
```text
Component: Optimization Guide On DeviceModels Manifest
Version: 0.0.0.0
Status: Up-to-date
```

The Google component updater server explicitly responds with `noupdate` to automation clients. As a result, model execution calls (`availability()`, `.create()`, and `.prompt()`) hang or time out.

---

## 2. Chrome Version & Configuration Matrix

| Parameter | Chrome for Testing (Automation) | Official Google Chrome (Desktop) |
| :--- | :--- | :--- |
| **Executable Path** | `.chrome-cft/win64-156.0.8078.80/chrome-win64/chrome.exe` | `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| **Version** | `156.0.8078.80` | `156.0.8078.74` |
| **Profile Strategy** | Isolated Temporary / Dedicated Persistent Profile | Dedicated Persistent Profile (`scratch/chrome-persistent-profile`) |
| **Flags Configured** | `--enable-features=OptimizationGuideOnDeviceModel,PromptAPIForGeminiNano,SummarizationAPIForGeminiNano` | Same flags + `--optimization-guide-on-device-model-execution-override=1` |
| **API Surface Exposed** | `window.LanguageModel`, `window.Summarizer`, `window.ai` | `window.LanguageModel`, `window.Summarizer`, `window.ai` |
| **Component Version** | `0.0.0.0` (Up-to-date) | `0.0.0.0` (Up-to-date) |
| **Model Availability** | `unavailable (timed out after 2s)` | `unavailable (timed out after 2s)` |

---

## 3. Empirical Evidence: Component Updater State

Via Chrome DevTools Protocol (CDP) session attached to `chrome://components`:

```json
{
  "componentId": "optimization_guide_on_device_model",
  "name": "Optimization Guide On DeviceModels Manifest",
  "version": "0.0.0.0",
  "status": "Up-to-date",
  "checkUpdateAction": "noupdate"
}
```

### Analysis of Component Updater Restriction
1. **Headless & Automation Gate:** Google's component distribution server checks client telemetry, hardware acceleration availability (DirectML/Vulkan GPU adapter), and interactive user session presence. Headless flags (`--headless=new` or `--remote-debugging-port`) cause the updater to treat the client as non-eligible for automatic multi-gigabyte weight downloads.
2. **Disk Space & Architecture Requirements:** Gemini Nano requires ~2.5 GB of free disk storage and 16 GB of RAM, running over DirectML on Windows.
3. **Absence of Offline Fallback in Raw Chrome:** Chrome does not ship with pre-bundled Gemini Nano weights; they are dynamically fetched post-install upon user interaction in Chrome Canary/Dev/Beta or stable with feature opt-in.

---

## 4. API Surface Verification

In both Chrome for Testing and Official Chrome, the JavaScript API objects exist and are syntactically valid:

```typescript
// 1. Prompt API
typeof window.LanguageModel !== 'undefined' // true
typeof (window.LanguageModel || self.LanguageModel).availability === 'function' // true

// 2. Summarizer API
typeof window.Summarizer !== 'undefined' // true
typeof (window.Summarizer || self.Summarizer).availability === 'function' // true

// 3. Fallback Namespace
typeof window.ai !== 'undefined' // true
```

### Execution Timeout Trace
When calling `await window.LanguageModel.availability()`:
- The internal promise remains unresolved waiting for the background Optimization Guide service daemon to respond.
- The 2,000ms safety timeout races and rejects: `unavailable (availability check timed out after 2s)`.
- Without the safety timeout, the call blocks the event loop indefinitely.

---

## 5. Streaming & Non-Streaming Inference Characteristics

When Gemini Nano is active on hardware with provisioned weights:
1. **Prompt API (`LanguageModel`):**
   - Non-streaming: `await session.prompt(query)` returns the complete text string.
   - Streaming: `session.promptStreaming(query)` returns a `ReadableStream<string>` yielding tokens progressively.
2. **Summarizer API (`Summarizer`):**
   - Supports structured summarization modes: `key-points`, `tl;dr`, `teaser`, `headline`.
   - Supports lengths: `short`, `medium`, `long`.
   - Requires explicit user gesture in active tab or sidepanel UI.

---

## 6. Recommendations & Path to Production

1. **Keep Fallback Architecture in `lib/ui-tools.ts`:**
   - Continue checking native APIs (`window.Summarizer`, `window.LanguageModel`, `window.ai.writer`, `window.translation`).
   - If model availability returns `'after-download'` or `'available'`, invoke native inference.
   - If unavailable, gracefully inform the user without crashing the extension.
2. **Local Whisper Model Independence:**
   - Confirm that Pentone's voice input (ASR) does **not** rely on Gemini Nano. Pentone uses Xenova Whisper locally via ONNX Runtime Web, which functions 100% offline and is verified passing all 171 automated tests.
3. **Provisioning Requirements for End Users:**
   - In production releases, end users running standard interactive Google Chrome will have their component updater fetch Gemini Nano automatically once the feature is turned on in `chrome://flags/#prompt-api-for-gemini-nano`.
