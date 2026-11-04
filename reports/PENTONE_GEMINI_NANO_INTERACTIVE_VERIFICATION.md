# Pentone Gemini Nano Interactive Desktop Verification Report

**Date:** November 2, 2026  
**Status:** BLOCKED ON ON-DEVICE MODEL WEIGHT DOWNLOAD (`nano_v3_cpu_component`)  
**Branch:** `feature/browser-tools-reliability` (Release-Freeze Mode)  
**Evaluator:** Pentone Release Verification Team  

---

## 1. Executive Summary

This investigation performed interactive verification of Chrome's built-in on-device AI capabilities using **Official Google Chrome Stable** on Windows 11.

### Primary Breakthrough & Current Blocker
1. **Manifest Successfully Updated:** Unlike headless automation clients, Official Google Chrome `156.0.8078.74` successfully communicated with Google's component updater and provisioned:
   ```text
   Optimization Guide On DeviceModels Manifest - Version: 1.20261018.2 (Status: Up-to-date)
   ```
2. **Prompt API Reports 'downloadable':** `(await window.LanguageModel.availability())` returned `'downloadable'`.
3. **User Gesture Gate Enforced:** Chrome's security model strictly mandates transient user activation to initiate download:
   ```text
   Requires a user gesture when availability is "downloading" or "downloadable".
   ```
4. **Download Component Registered:** When a trusted user gesture was dispatched via CDP, Chrome registered the specific on-device model component:
   ```text
   Optimization Guide Manifest Component: nano_v3_cpu_component - Version: 0.0.0.0 (Status: New)
   ```
5. **Inference Status (BLOCKED):** Because the multi-gigabyte model weight payload (`nano_v3_cpu_component`) is currently at version `0.0.0.0` (Status: New) and has not completed downloading to disk, local model inference cannot execute. In accordance with release-freeze criteria, Gemini Nano is classified as **BLOCKED**.

---

## 2. Environment & System Profile

| Specification | Observed Value | Verification Source |
| :--- | :--- | :--- |
| **Browser Executable** | `C:\Program Files\Google\Chrome\Application\chrome.exe` | File System Check |
| **Chrome Version** | `156.0.8078.74 (Official Build) (64-bit) (cohort: Stable)` | `chrome://version` via CDP |
| **Operating System** | Windows 11 Build 26200 (`win32 10.0.26200 x64`) | Node.js `os` Inspection |
| **CPU Architecture** | 13th Gen Intel(R) Core(TM) i5-13450HX (16 Cores) | Node.js `os.cpus()` |
| **System Memory** | 16.85 GB Total / 4.49 GB Free Physical Memory | Node.js `os.totalmem()` / `freemem()` |
| **Active Profile** | `scratch/chrome-persistent-profile` | Chrome User Data Dir |
| **Active Feature Flags** | `--enable-features=PromptAPIForGeminiNano,OptimizationGuideOnDeviceModel` | Process CLI arguments |

---

## 3. Chrome Component & Model Provisioning Audit

Via Chrome DevTools Protocol attached to `chrome://components`:

```text
Component 1:
  Name: Optimization Guide On DeviceModels Manifest
  Version: 1.20261018.2
  Status: Up-to-date

Component 2:
  Name: Optimization Guide Manifest Component: nano_v3_cpu_component
  Version: 0.0.0.0
  Status: New
```

### Analysis of Provisioning Lifecycle
1. **Manifest Resolution:** Chrome identified that the device hardware (13th Gen Intel Core i5 with 16 GB RAM) meets the compute and memory threshold for Gemini Nano.
2. **Component Registration:** Chrome assigned the `nano_v3_cpu_component` package to this profile.
3. **Weight Transfer Constraint:** Because Chrome does not bundle multi-gigabyte weights in the installer, weights must be transferred over the network via background component updater or user-consented session creation. In this automated session, the download state transitioned from `downloadable` to `New`, but transfer completion remains pending.

---

## 4. Prompt API Stage-by-Stage Verification

```typescript
// 1. Check Global Interface Existence
typeof window.LanguageModel !== 'undefined' // true
typeof (window.LanguageModel || self.LanguageModel).availability === 'function' // true

// 2. Query Availability Status
const availability = await window.LanguageModel.availability();
// Result: "downloadable"

// 3. Attempt Execution Without Gesture
try {
  await window.LanguageModel.create();
} catch (e) {
  // Throws: "Requires a user gesture when availability is 'downloading' or 'downloadable'."
}

// 4. Attempt Execution With Trusted User Gesture (CDP Mouse Event)
// State after click:
{
  clicked: true,
  hasUserActivation: true,
  hasBeenActive: true,
  availability: "downloadable",
  sessionInitiated: true
}
```

### Empirical Finding on Inference
While session initialization was successfully initiated under a trusted gesture, the model session cannot complete evaluation (`session.prompt()`) until `nano_v3_cpu_component` completes weight download and DirectML/Vulkan compilation.

---

## 5. Pentone AI Tools Functional Audit

Using Pentone's real unpacked extension runtime without code modifications:

| Tool Name | BG Boundary Enforcement | Sidepanel UI Routing | User Activation Accepted | Model Inference Status | Final Tool Classification |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `writeContent` | **PASS** | **PASS** | **PASS** | **BLOCKED** (`nano_v3_cpu_component` 0.0.0.0) | **BLOCKED** |
| `translateText` | **PASS** | **PASS** | **PASS** | **BLOCKED** (`nano_v3_cpu_component` 0.0.0.0) | **BLOCKED** |
| `detectLanguage` | **PASS** | **PASS** | **PASS** | **BLOCKED** (`nano_v3_cpu_component` 0.0.0.0) | **BLOCKED** |
| `summarizePage` | **PASS** | **PASS** | **PASS** | **BLOCKED** (`nano_v3_cpu_component` 0.0.0.0) | **BLOCKED** |

### Verification of Summarization Handling
- **Normal Article (`#article-section`):** Content successfully extracted via Readability logic (1,248 characters).
- **Longer Article:** Chunking logic in `lib/vault.ts` tested; breaks content into 500-char segments without buffer overflow.
- **Adversarial Content:** Injected prompt override strings (`SYSTEM OVERRIDE: ignore instructions`) extracted strictly as inert text strings; no privilege escalation occurred.

---

## 6. Offline Invariance & Cloud Isolation

1. **Zero External Inference:** Pentone did not transmit any prompts, document text, or user inputs to external LLM providers (Google Cloud, OpenAI, Anthropic, etc.).
2. **Fail-Closed Guarantees:** When native APIs report `unavailable` or `downloadable`, Pentone fails closed with structured error objects rather than silently routing prompts to cloud fallbacks.
3. **Whisper ASR Independence:** Pentone's speech recognition pipeline is completely independent of Gemini Nano. Local Whisper runs in ONNX WASM and remains fully operational offline.
