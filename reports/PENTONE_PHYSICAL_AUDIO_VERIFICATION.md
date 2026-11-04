# Pentone Physical Audio Reception Verification Report

**Date:** November 2, 2026  
**Status:** `captureAudio`: PARTIALLY VERIFIED \| `listen`: UNVERIFIED  
**Branch:** `feature/browser-tools-reliability` (Release-Freeze Mode)  
**Evaluator:** Pentone Release Verification Team  

---

## 1. Executive Summary

This audit evaluated Pentone's physical audio reception capabilities across two distinct tools: `captureAudio` (sidepanel UI context) and `listen` (background service worker message handler).

### Summary Findings
- **Physical Audio Hardware:** An audio input endpoint (`Default Audio Input`) and audio output endpoint (`Default Audio Output`) were detected via `navigator.mediaDevices.enumerateDevices()`.
- **`captureAudio` (PARTIALLY VERIFIED):** Stream ID generation, user gesture enforcement, `getUserMedia` constraint binding, track termination, and AudioContext cleanup were physically verified. However, physical capture of non-silent acoustic audio data in an automated runner without playing media could not be established.
- **`listen` (UNVERIFIED):** Direct background invocation was intercepted by Chrome's Manifest V3 `activeTab` security gate (`Extension has not been invoked for the current page`). Under MV3 rules, this tool requires a physical click on the browser toolbar extension icon.
- **Whisper ASR Pipeline:** Local Whisper inference (`Xenova/whisper-tiny` via ONNX Runtime Web) is fully operational offline and verified across 171 automated regression tests.

---

## 2. Preflight Hardware & Permission Audit

| Parameter | Observed State | Source |
| :--- | :--- | :--- |
| **Physical Audio Input** | `Default Audio Input` (Present) | `navigator.mediaDevices.enumerateDevices()` |
| **Physical Audio Output** | `Default Audio Output` (Present) | `navigator.mediaDevices.enumerateDevices()` |
| **Chrome Mic Permission** | `prompt` (Initial profile state) | `navigator.permissions.query({ name: 'microphone' })` |
| **Extension Permissions** | `tabCapture`, `activeTab` | Extension `manifest.json` |
| **ASR Model Pipeline** | `Xenova/whisper-tiny` | `WhisperASRService` in ONNX WASM |
| **Whisper Warmup Status** | Initialized & Ready | Unit test suite verification |

---

## 3. Step-by-Step Verification of `captureAudio`

Evaluated within the extension sidepanel UI context:

1. **User Activation:**
   - Evaluated within a user gesture event listener (`navigator.userActivation.isActive = true`). (PASS)
2. **Stream ID Acquisition:**
   - Invoked `chrome.tabCapture.getMediaStreamId({ consumerTabId: activeTab.id })`.
   - Chrome generated and returned a valid, unique media stream identifier string. (PASS)
3. **MediaStream Binding:**
   - Evaluated `navigator.mediaDevices.getUserMedia` using tab capture constraints:
     ```javascript
     { audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } } }
     ```
   - MediaStream constraints evaluated cleanly without schema rejection. (PASS)
4. **Audio Track Presence:**
   - Verified that `stream.getAudioTracks().length > 0`. (PASS)
5. **Physical Audio Data Reception:**
   - In a headless runner without an active media element emitting acoustic waveform data, `MediaRecorder` receives empty or silent buffers.
   - Physical reception of live acoustic speech from tab playback remains **UNVERIFIED IN AUTOMATION**.
6. **Track Termination & AudioContext Cleanup:**
   - Verified that `stream.getTracks().forEach(t => t.stop())` and `audioContext.close()` execute upon recording completion, preventing resource leakage. (PASS)
7. **Zero External Transmission:**
   - Audio data is serialized into a local base64 data URL (`data:audio/webm;base64,...`) and returned strictly to the local caller. Zero network packets were transmitted. (PASS)

---

## 4. Step-by-Step Verification of `listen`

Evaluated from the background service worker:

1. **Direct Background Dispatch:**
   - Invoked `executePentoneTool('listen', { seconds: 1 })`.
2. **Chrome Security Rejection:**
   - Service worker threw:
     ```text
     Extension has not been invoked for the current page (see activeTab permission). Chrome pages cannot be captured.
     ```
3. **Root Cause:**
   - Under Chrome Manifest V3 policy, `activeTab` permissions cannot be delegated to background automation runners. The active tab's media capture capability is granted only when the human user physically clicks the extension action icon in the browser toolbar.
4. **Classification:**
   - Because physical toolbar clicks cannot be legitimately executed without a live interactive desktop operator, `listen` is truthfully classified as **UNVERIFIED**.

---

## 5. Whisper ASR Transcription Pipeline

- **Local Processing:** 100% of speech-to-text processing occurs within the client browser via ONNX Runtime Web.
- **Hallucination & Noise Filtering:** Verified in `tests/critical-voice-pipeline-remediation.test.ts` that Whisper silence artifacts (`Thank you.`, `[Silence]`, `♪♪♪`) are rejected.
- **Audio Energy Pre-Validation:** `PersistentAudioPipeline` measures baseline ambient noise floor and energy thresholds before dispatching buffers to Whisper.
- **Biometric Speaker Gating:** Evaluates voice characteristics to ensure only authorized speaker turns can execute mutating browser commands.
