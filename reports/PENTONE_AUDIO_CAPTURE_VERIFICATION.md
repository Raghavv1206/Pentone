# Pentone Audio Capture Verification Report (`captureAudio` vs `listen`)

**Date:** November 2, 2026  
**Status:** `captureAudio`: PARTIALLY VERIFIED \| `listen`: UNVERIFIED  
**Branch:** `feature/browser-tools-reliability`  
**Target Subsystems:** `lib/tools/captureAudio.ts`, `lib/tools/listen.ts`, and `content.ts`  

---

## 1. Executive Summary

Pentone provides two distinct tools for tab audio capture:
1. `captureAudio` — Evaluated from the extension sidepanel UI context with direct user activation.
2. `listen` — Evaluated as a background service worker message handler designed to capture and transcribe tab audio.

This audit evaluated both tools against Chrome Manifest V3 security boundaries, `chrome.tabCapture` API prerequisites, MediaStream lifecycles, and headless automation constraints.

### Summary of Audio Findings

| Tool | Invocation Context | Stream ID Generation | MediaStream Acquisition | Track Cleanup | Audio Data Reception | Final Status |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| `captureAudio` | Extension Sidepanel (UI gesture) | **PASS** | **PASS** | **PASS** | **UNVERIFIED (Headless)** | **PARTIALLY VERIFIED** |
| `listen` | Background Service Worker | **BLOCKED (activeTab)** | **UNVERIFIED** | **UNVERIFIED** | **UNVERIFIED** | **UNVERIFIED** |

---

## 2. Detailed Verification of `captureAudio`

`captureAudio` was executed within the unpacked extension's sidepanel page (`chrome-extension://ijogpbchahinneehlainppdfnlgekjho/sidepanel.html`) using a synthetic click gesture.

### 2.1 Stage 1: Stream ID Generation
- **Mechanism:** In `lib/tools/captureAudio.ts`, `acquireTabCaptureStreamId` calls:
  ```typescript
  chrome.tabCapture.getMediaStreamId({ consumerTabId: targetTabId }, (id) => ...)
  ```
- **Observed Behavior:** `chrome.tabCapture` API is fully defined and active in the sidepanel context. With a user gesture attached, Chrome returned a valid, non-empty media stream identifier string.
- **Result:** **PASS**.

### 2.2 Stage 2: MediaStream Acquisition
- **Mechanism:** In `content.ts`, `handleTabAudioCapture` invokes:
  ```typescript
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    }
  })
  ```
- **Observed Behavior:** The constraints format is compliant with Chrome's tab capture specification. In headless Chrome for Testing, `getUserMedia` evaluates the constraints without schema rejections.
- **Result:** **PASS**.

### 2.3 Stage 3: Live Audio Track Inspection & Presence
- **Mechanism:** `stream.getAudioTracks()`.
- **Observed Behavior:** When a tab capture stream is bound, an `AudioStreamTrack` is created.
- **Result:** **PASS**.

### 2.4 Stage 4: Audio Data Reception via MediaRecorder
- **Mechanism:**
  ```typescript
  const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) audioChunks.push(event.data)
  }
  ```
- **Observed Behavior:** In a headless runner environment without an active physical audio device or playing media element, `MediaRecorder` receives silent or empty chunk buffers. Real physical audio data reception could not be demonstrated in the headless test runner.
- **Result:** **UNVERIFIED IN HEADLESS RUNNER**.

### 2.5 Stage 5: Stopping and Cleanup of Tracks
- **Mechanism:**
  ```typescript
  mediaRecorder.stop()
  stream.getTracks().forEach(track => track.stop())
  audioContext.close()
  ```
- **Observed Behavior:** Both track teardown and AudioContext termination execute cleanly upon timeout expiration, preventing audio leaks or lingering background media streams.
- **Result:** **PASS**.

### 2.6 Stage 6: Privacy & Network Isolation
- **Mechanism:** The recorded blob is serialized to a `data:audio/webm;base64,...` URL using `FileReader.readAsDataURL()` and returned locally to the caller.
- **Observed Behavior:** **Zero external network requests** were initiated. Audio data remains strictly within local memory.
- **Result:** **PASS**.

---

## 3. Detailed Verification of `listen`

`listen` is a Plasmo message handler implemented in `lib/tools/listen.ts` and executed by the background service worker.

### 3.1 The `activeTab` Permission Constraint
When `listen` attempts to capture audio from the background service worker:
```typescript
chrome.tabCapture.getMediaStreamId({ consumerTabId: tab.id }, (streamId) => ...)
```
Chrome MV3 enforces:
```text
Extension has not been invoked for the current page (see activeTab permission). Chrome pages cannot be captured.
```

### 3.2 Root Cause Analysis
Under Manifest V3 security rules:
1. The `activeTab` permission is granted **only upon explicit user interaction with the extension's UI** (e.g., clicking the extension action icon in the browser toolbar or selecting a context menu item).
2. Background automated message dispatches (`run_tool`) from the test harness do not satisfy `activeTab` delegation unless the user has physically clicked the extension icon on that specific tab.
3. As a result, `listen` cannot obtain a `streamId` when invoked purely from a background script automation harness.

### 3.3 Exactly Which Stages Remain Unverified
- **Unverified Stages:**
  - Active tab audio stream acquisition from background worker.
  - Ingestion of live audio into the Whisper ASR pipeline from tab capture.
  - Full-duplex playback loop during tab audio listening.
- **Status:** Accurately classified as **UNVERIFIED**.

---

## 4. Remediation Recommendations

1. **Unify Tab Audio Capture Architecture:**
   - Migrate `listen` to delegate to `captureAudio`'s sidepanel UI pipeline, where user gestures are legitimately available.
2. **Interactive Acceptance Testing:**
   - Physical demonstration of `listen` should be conducted in an interactive desktop Chrome session where the toolbar action icon can be physically clicked on a playing media tab (e.g., YouTube video).
