# Pentone UI AI Tools — Functional Stage-by-Stage Verification Report

**Date:** November 2, 2026  
**Status:** BLOCKED ON UPSTREAM ON-DEVICE MODEL WEIGHTS  
**Branch:** `feature/browser-tools-reliability`  
**Tools Evaluated:** `writeContent`, `translateText`, `detectLanguage`, `summarizePage`  
**Execution Environment:** Chrome for Testing `156.0.8078.80` & Official Chrome `156.0.8078.74`  

---

## 1. Executive Summary

This audit examined the functional readiness of Pentone's four browser intelligence tools: `writeContent`, `translateText`, `detectLanguage`, and `summarizePage`.

A critical distinction must be drawn between **pipeline architectural readiness** (routing, capability gating, and user activation) and **actual functional inference** (producing real model output). While the routing, boundary enforcement, and user activation mechanisms execute correctly, **actual on-device model inference cannot complete because Gemini Nano model weights are not provisioned in Chrome 156 automation profiles (Component Version: 0.0.0.0)**.

In accordance with strict verification standards, all four tools are classified as **BLOCKED**.

---

## 2. Five-Stage Functional Breakdown

Every AI tool was audited across five distinct operational stages:

1. **Stage 1: Background-to-UI Routing** — Does calling the tool from the background service worker fail closed with a clear boundary message, requiring execution in the extension UI context?
2. **Stage 2: User Activation Requirement** — Does the tool require a legitimate user gesture (`navigator.userActivation.isActive`) before invoking native capabilities?
3. **Stage 3: Native API Availability** — Do the underlying Chrome API objects (`window.ai.writer`, `window.translation`, `window.Summarizer`, `window.LanguageModel`) exist and report availability (`'available'` or `'readily'`)?
4. **Stage 4: Actual Model Inference** — Does the model session execute inference without timing out or throwing runtime errors?
5. **Stage 5: Actual Returned Output** — Does the tool produce genuine generated/summarized/translated output text returned to the agent loop?

---

## 3. Tool-by-Tool Functional Audit Matrix

| Stage | `writeContent` | `translateText` | `detectLanguage` | `summarizePage` |
| :--- | :---: | :---: | :---: | :---: |
| **Stage 1: Background-to-UI Routing** | **PASS** (Rejected in BG) | **PASS** (Rejected in BG) | **PASS** (Rejected in BG) | **PASS** (Rejected in BG) |
| **Stage 2: User Activation** | **PASS** (Gesture required) | **PASS** (Gesture required) | **PASS** (Gesture required) | **PASS** (Gesture required) |
| **Stage 3: Native API Availability** | **FAIL** (Writer absent; LM timeout) | **FAIL** (Translator absent; LM timeout) | **FAIL** (Detector absent; LM timeout) | **FAIL** (Summarizer/LM timeout) |
| **Stage 4: Actual Model Inference** | **BLOCKED** (Weights 0.0.0.0) | **BLOCKED** (Weights 0.0.0.0) | **BLOCKED** (Weights 0.0.0.0) | **BLOCKED** (Weights 0.0.0.0) |
| **Stage 5: Actual Returned Output** | **BLOCKED** (No text produced) | **BLOCKED** (No text produced) | **BLOCKED** (No text produced) | **BLOCKED** (No text produced) |
| **Final Classification** | **BLOCKED** | **BLOCKED** | **BLOCKED** | **BLOCKED** |

---

## 4. Deep Inspection of Each Tool

### 4.1 `writeContent`
- **Implementation:** [`lib/ui-tools.ts`](file:///c:/project/New%20folder/Marionette/lib/ui-tools.ts) & `lib/tools/writeContent.ts`
- **Stage 1 (BG Routing):** Calling `executePentoneTool('writeContent')` from the service worker returned `{ success: false, error: "writeContent must be executed in UI context with user gesture" }`. (PASS)
- **Stage 2 (User Activation):** In `sidepanel.html`, execution attached to an interactive click event satisfied `navigator.userActivation`. (PASS)
- **Stage 3 (Native API):** `typeof window.ai?.writer === 'undefined'`. Fallback to `window.LanguageModel` was attempted. Global `LanguageModel` interface exists, but `.availability()` timed out after 2,000ms. (FAIL)
- **Stage 4 & 5 (Inference & Output):** No model session could be created; no draft content returned. (BLOCKED)

### 4.2 `translateText`
- **Implementation:** [`lib/ui-tools.ts`](file:///c:/project/New%20folder/Marionette/lib/ui-tools.ts) & `lib/tools/translateText.ts`
- **Stage 1 & 2:** BG boundary enforced; user gesture requirement validated. (PASS)
- **Stage 3 (Native API):** `typeof window.translation === 'undefined'` and `typeof self.Translator === 'undefined'`. Fallback to `LanguageModel` timed out. (FAIL)
- **Stage 4 & 5 (Inference & Output):** No translated string produced. (BLOCKED)

### 4.3 `detectLanguage`
- **Implementation:** [`lib/ui-tools.ts`](file:///c:/project/New%20folder/Marionette/lib/ui-tools.ts) & `lib/tools/detectLanguage.ts`
- **Stage 1 & 2:** BG boundary enforced; user gesture requirement validated. (PASS)
- **Stage 3 (Native API):** `typeof window.translation?.canDetect === 'undefined'`. Fallback to `LanguageModel` timed out. (FAIL)
- **Stage 4 & 5 (Inference & Output):** No language detection confidence score returned. (BLOCKED)

### 4.4 `summarizePage`
- **Implementation:** `lib/tools/summarizePage.ts`, [`lib/ui-tools.ts`](file:///c:/project/New%20folder/Marionette/lib/ui-tools.ts), and Workflow D.
- **Stage 1 & 2:** Background correctly rejected direct invocation; sidepanel gesture button satisfied activation. (PASS)
- **Page Extraction:** Successfully extracted DOM article title and content (1,248 characters) via Readability logic. (PASS)
- **Untrusted Webpage Content Handling:** HTML entities sanitized; embedded prompt injection strings treated purely as inert text. (PASS)
- **Stage 3 (Native API):** `(window.Summarizer || self.Summarizer).availability()` timed out after 2,000ms. (FAIL)
- **Stage 4 & 5 (Inference & Output):** Summarizer cannot initialize without model weights. Summary output remained `null`. (BLOCKED)

---

## 5. Long-Page Handling & Context Limits for Summarization

In `lib/ui-tools.ts`:
1. **Context Window Limit:** Chrome's on-device `LanguageModel` has a maximum context budget of approximately 4,096 to 9,216 tokens (~16,000 to 36,000 characters).
2. **Chunking Strategy:** `lib/vault.ts` implements overlapping chunking (`chunkText(text, 500, 100)`), breaking long articles into 500-character segments with 100-character overlap.
3. **Truncation Guardrail:** Content exceeding max token budget is safely truncated with an ellipsis notice rather than overflowing model buffers.

---

## 6. Privacy & Offline Invariance

No external network endpoints, cloud LLMs, or telemetry services were contacted. When native APIs report unavailable, the tools fail closed with structured error objects rather than silently attempting remote cloud requests.
