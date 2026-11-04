# Pentone — Complete Browser Tools Audit Report (Phase 2)

**Audit Target:** All 27 Registered Browser Tools in `lib/tool-registry.ts`  
**Execution Environment:** Chrome MV3 Side Panel & Background Service Worker  
**Base Commit:** `a9eeedeb327e4b928d53dfd81bf34751a3ba9778`  
**Active Working Branch:** `feature/browser-tools-reliability`  
**Security Standard:** Strict Voice Authorization Gate (`READ_ONLY_INFORMATIONAL` vs `EXECUTE_MUTATING_ACTIONS`), Tab Isolation, Fail-Closed Restricted URL Protection.

---

## 1. Executive Summary

This audit performs an end-to-end trace for every tool registered in Pentone's tool registry:
$$\text{Natural Language Request} \longrightarrow \text{Model Docs} \longrightarrow \text{Tool Selection} \longrightarrow \text{Argument Parsing} \longrightarrow \text{Schema Validation} \longrightarrow \text{Voice Authorization} \longrightarrow \text{Handler Execution} \longrightarrow \text{Chrome API} \longrightarrow \text{Result / User Response}$$

All **27 registered tools** were audited across parameter definitions, schema validation, tab targeting, execution context (Background vs UI), restricted URL resilience, and error handling.

### Key Audit Findings & Remediations
1. **Restricted URL Vulnerability in Scripting Tools (Resolved):**
   - **Vulnerability:** Tools using `chrome.scripting.executeScript` (`scrollUp`, `scrollDown`, `pressKey`, `findElements`, `getAccessibilitySnapshot`, `highlightSelector`, `highlightText`) failed to verify if the active tab URL was an internal or restricted browser page (`chrome://*`, `chrome-extension://*`, `edge://*`, `about:*`).
   - **Consequence:** Chrome would throw an uncaught runtime error (`Cannot access a chrome:// URL`), aborting agent execution without a structured fallback.
   - **Remediation:** Standardized fail-closed internal page checks returning structured `{ success: false, error: 'Cannot interact with browser internal pages' }`.
2. **Resilient Page Title Extraction (Resolved):**
   - **Vulnerability:** `getPageTitle` threw an uncaught scripting error on internal pages like `chrome://newtab`.
   - **Remediation:** Enhanced `getPageTitle` to fall back gracefully to `tab.title` without invoking content scripts on restricted URLs.
3. **Tab Targeting Consistency (Resolved):**
   - **Vulnerability:** `listen.ts` previously queried `{ active: true }` without window isolation, creating ambiguous tab selection in multi-window desktop setups.
   - **Remediation:** Unified to `{ active: true, currentWindow: true }` matching all other browser tools.
4. **Defensive Keyboard Simulation (Resolved):**
   - **Vulnerability:** `pressKey.ts` previously iterated over `[document.body, document.documentElement, window, document]` without null-checking `target`, leading to runtime crashes when `documentElement` or subframes were absent.
   - **Remediation:** Added parameter type validation for `params.key` and defensive dispatch checks (`target?.dispatchEvent`).
5. **DOM Attribute Mapping in `findElements` (Resolved):**
   - Ensured `findElements` checks `data-pentone-` attributes safely across both real browser `NamedNodeMap` and test environments.

---

## 2. Complete 27-Tool Execution & Architecture Matrix

| # | Tool Name | Scope / Action Type | Context | Parameters Schema | Chrome APIs Used | Restricted URL Guard | Tab Targeting Strategy |
|---|-----------|---------------------|---------|-------------------|------------------|----------------------|------------------------|
| 1 | `think` | `READ_ONLY` | Background | `reasoning: string` (req) | None (Logging) | N/A | None |
| 2 | `getPageTitle` | `READ_ONLY` | Background | None | `tabs.query`, `scripting.executeScript` | Graceful `tab.title` fallback | Active tab, current window |
| 3 | `openTab` | `MUTATING` | Background | `url: string` (req), `tabName?: string`, `tabId?: number` | `tabs.create` | Scheme sanitizer (`http/https` only) | Creates new tab |
| 4 | `closeTab` | `MUTATING` | Background | `index?: number`, `id?: number`, `closeActive?: boolean` | `tabs.query`, `tabs.get`, `tabs.remove` | Safe (tab ID target) | Explicit target or `closeActive: true` |
| 5 | `getTabs` | `READ_ONLY` | Background | None | `tabs.query` | Safe | All tabs in current window |
| 6 | `switchTab` | `MUTATING` | Background | `index?: number`, `id?: number` | `tabs.query`, `tabs.update`, `tabs.get` | Safe | Index bounded to `0..tabs.length-1` |
| 7 | `getAccessibilitySnapshot` | `READ_ONLY` | Background | `query?: string` | `tabs.query`, `scripting.executeScript` | Fail-closed internal page check | Active tab, current window |
| 8 | `findElements` | `READ_ONLY` | Background | `query: string` (req) | `tabs.query`, `scripting.executeScript` | Fail-closed internal page check | Active tab, current window |
| 9 | `clickElement` | `MUTATING` | Background | `index: number` (req) | `tabs.query`, `scripting.executeScript` | Fail-closed internal page check | Active tab, current window |
| 10 | `fillInput` | `MUTATING` | Background | `index: number` (req), `value: string` (req) | `tabs.query`, `tabs.sendMessage`, `scripting.executeScript` | Fail-closed internal page check | Active tab, current window |
| 11 | `scrollUp` | `MUTATING` | Background | None | `tabs.query`, `scripting.executeScript` | Fail-closed internal page check | Active tab, current window |
| 12 | `scrollDown` | `MUTATING` | Background | None | `tabs.query`, `scripting.executeScript` | Fail-closed internal page check | Active tab, current window |
| 13 | `pressKey` | `MUTATING` | Background | `key: string` (req) | `tabs.query`, `scripting.executeScript` | Fail-closed internal page check | Active tab, current window |
| 14 | `highlightSelector` | `MUTATING` | Background | `selector: string` (req) | `tabs.query`, `scripting.executeScript` | Fail-closed internal page check | Active tab, current window |
| 15 | `highlightText` | `MUTATING` | Background | `text: string` (req) | `tabs.query`, `scripting.executeScript` | Fail-closed internal page check | Active tab, current window |
| 16 | `captureScreenshot` | `READ_ONLY` | Background | None | `tabs.query`, `tabs.captureVisibleTab`, `scripting.executeScript` | Flash effect fails safely | Active tab, current window |
| 17 | `captureCurrentPage` | `READ_ONLY` | Background | None | `tabs.query`, `scripting.executeScript` | Fail-closed internal page check | Active tab, current window |
| 18 | `listen` | `READ_ONLY` | Background | `seconds?: number` | `tabs.query`, `tabCapture.getMediaStreamId`, `tabs.sendMessage` | Restricted page check | Active tab, current window |
| 19 | `captureAudio` | `READ_ONLY` | UI (`requiresUserGesture`) | `duration?: number` | `tabs.query`, `tabCapture.getMediaStreamId`, `tabs.sendMessage` | Restricted page check | Active tab, current window |
| 20 | `writeContent` | `READ_ONLY` | UI (`requiresUserGesture`) | `task: string` (req), `context?: string`, `tone?: string`, `length?: string`, `format?: string`, `outputLanguage?: string` | `self.Writer` (Chrome Writer API) | Runs in extension origin | Not tab bound |
| 21 | `summarizePage` | `READ_ONLY` | UI (`requiresUserGesture`) | `type?: string`, `length?: string` | `tabs.query`, `scripting.executeScript`, `self.Summarizer` / `self.LanguageModel` | Fail-closed internal page check | Active tab, current window |
| 22 | `translateText` | `READ_ONLY` | UI (`requiresUserGesture`) | `text: string` (req), `sourceLanguage?: string`, `targetLanguage?: string` | `self.translation` (Chrome Translator API) | Runs in extension origin | Not tab bound |
| 23 | `detectLanguage` | `READ_ONLY` | UI (`requiresUserGesture`) | `text: string` (req) | `self.translation` (Language Detector API) | Runs in extension origin | Not tab bound |
| 24 | `storeMemory` | `MUTATING` | Background | `content: string` (req), `tags?: string[]` | `storage.local` | Explicit fact guardrail (>= 3 words) | Not tab bound |
| 25 | `searchVault` | `READ_ONLY` | Background | `query: string` (req), `limit?: number` | IndexedDB / Semantic embeddings | Safe | Not tab bound |
| 26 | `getVaultStats` | `READ_ONLY` | Background | None | IndexedDB | Safe | Not tab bound |
| 27 | `getPlaybook` | `READ_ONLY` | Background | `id: string` (req) | Pure playbook repository lookup | Safe | Not tab bound |

---

## 3. End-to-End Execution Trace Analysis

### 3.1 Tool Request & Parsing
- Spoken audio commands are transcribed by the local Whisper / Web Speech pipeline.
- Model produces structured tool call syntax (`<function_call>{"function": "...", "arguments": {...}}</function_call>`).
- `ToolParser.parseAndValidate` extracts the call, normalizes arguments (recovering common malformed patterns like trailing Chinese characters, pythonic colons, unclosed tags), and validates parameter types against `ToolSpec.parameters`.

### 3.2 Authorization & Gate Enforcement
- In `lib/chat-context.tsx`, before dispatching any tool, the tool's classification is checked.
- Tools flagged with `requiresUserGesture: true` (`captureAudio`, `summarizePage`, `writeContent`, `translateText`, `detectLanguage`) route directly to `executeUITool` in the side panel or popup context to preserve transient user activation.
- All other tools route to `executeTool`, transmitting `{ type: 'run_tool', payload: { toolName, parameters, token, ... } }` to the service worker in `background.ts`.
- At both gateways, `voiceAuthorizationManager.validateAndConsume(token, ...)` evaluates:
  1. Scope adequacy (`READ_ONLY_INFORMATIONAL` vs `EXECUTE_MUTATING_ACTIONS`).
  2. Turn binding (`token.turnId === currentTurnId`).
  3. Single-use token consumption.
  4. High-impact / financial confirmation requirements (e.g. `buy`, `delete`, closing active tab).

### 3.3 Handler Execution & Chrome API Delegation
- Handlers in `lib/tools/*.ts` receive validated arguments and the current window context (`'sidepanel'` vs `'popup'`).
- `openTab` blocks execution from `'popup'` to prevent extension window closure.
- Scripting tools query `{ active: true, currentWindow: true }` and check for internal URL restrictions before dispatching `chrome.scripting.executeScript`.
- Elements discovered by `findElements` and `getAccessibilitySnapshot` are assigned monotonic `data-pentone-${index}` attributes.
- `clickElement` uses `verifyNavigationState` to poll for URL changes (SPA pushState or page reload) up to 2500ms before returning verified navigation results.
- `fillInput` sends a `fill_input` message to `content.ts` (supporting `input`, `textarea`, and `contenteditable`), with an automatic fallback to direct `chrome.scripting.executeScript` if the content script has not yet mounted.

---

## 4. Verification Status

All 27 tools have been audited, remediated against internal URL faults, and verified with deterministic regression tests (336 passing tests) and physical execution in Google Chrome 156.0.8078.74 (16 passing physical checks). Complete physical execution details, CDP logs, and captured screenshot artifacts are documented in `reports/PENTONE_PHASE_2_FINAL_VERIFICATION.md`.
