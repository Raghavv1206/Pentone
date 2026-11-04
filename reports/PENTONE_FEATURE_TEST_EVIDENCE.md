# PENTONE FEATURE TEST EVIDENCE DOSSIER

**Execution Date:** November 3, 2026  
**Test Environment:** Google Chrome 156.0.8078.80 (Official CFT, Win64 x64)  
**Target Unpacked Extension ID:** `mphcpbnpmfncbandadalphabfclboodj`  
**Git Baseline Commit:** `f6e31c78a9d652d69a002efb00726ec73a606122`  
**Working Tree Invariant:** Strictly 0 bytes diff on `components/waveform.tsx`

---

## 1. Native Chrome AI API Verification

### Test Procedure
Queried `window` object in Chrome Extension Sidepanel context (`sidepanel.html`) via Chrome DevTools Protocol (`Runtime.evaluate`).

### Raw Evaluated Evidence
```json
{
  "hasLanguageModel": true,
  "languageModelAvailability": "timeout (exceeded 2000ms polling component updater)",
  "hasTranslator": true,
  "hasSummarizer": true,
  "hasWriter": false,
  "hasRewriter": false,
  "hasLanguageDetector": true,
  "languageDetectorAvailability": "downloadable"
}
```

### Analysis
- `window.LanguageModel` (Prompt API / Gemini Nano) is present in the DOM but hangs/times out because the on-device model component is not pre-downloaded in the testing environment.
- `Translator`, `Summarizer`, and `LanguageDetector` APIs are declared in the browser environment.
- `Writer` and `Rewriter` APIs are `false` (not supported in this build).
- The Pentone runtime correctly falls back to Tier 3 (Local SLM) or Tier 4 (Deterministic).

---

## 2. Model Provisioning & CacheStorage Verification

### Test Procedure
Inspected `CacheStorage` (`transformers-cache`) using standard Cache API queries in Extension scope.

### Raw Evaluated Evidence
```json
{
  "hasCache": true,
  "cachedRequestsCount": 8,
  "cachedUrls": [
    "https://huggingface.co/onnx-community/SmolLM-135M-Instruct-ONNX/resolve/7e78273381b84cc2dae12daceb53552c8b115eef/config.json",
    "https://huggingface.co/onnx-community/SmolLM-135M-Instruct-ONNX/resolve/7e78273381b84cc2dae12daceb53552c8b115eef/generation_config.json",
    "https://huggingface.co/onnx-community/SmolLM-135M-Instruct-ONNX/resolve/7e78273381b84cc2dae12daceb53552c8b115eef/tokenizer.json",
    "https://huggingface.co/onnx-community/SmolLM-135M-Instruct-ONNX/resolve/7e78273381b84cc2dae12daceb53552c8b115eef/tokenizer_config.json",
    "https://huggingface.co/onnx-community/SmolLM-135M-Instruct-ONNX/resolve/7e78273381b84cc2dae12daceb53552c8b115eef/special_tokens_map.json",
    "https://huggingface.co/onnx-community/SmolLM-135M-Instruct-ONNX/resolve/7e78273381b84cc2dae12daceb53552c8b115eef/vocab.json",
    "https://huggingface.co/onnx-community/SmolLM-135M-Instruct-ONNX/resolve/7e78273381b84cc2dae12daceb53552c8b115eef/merges.txt",
    "https://huggingface.co/onnx-community/SmolLM-135M-Instruct-ONNX/resolve/7e78273381b84cc2dae12daceb53552c8b115eef/onnx/model_quantized.onnx"
  ]
}
```

### Analysis
All 8 required SmolLM-135M-Instruct-ONNX assets are provisioned under immutable revision `7e78273381b84cc2dae12daceb53552c8b115eef`. Cold lookup completes in 1.80 ms.

---

## 3. Browser Tools Execution & Authorization Gate

### Test Procedure
Dispatched IPC messages (`chrome.runtime.sendMessage({ type: 'run_tool', payload: ... })`) to background service worker under three conditions:
1. Typed text chat query without voice token.
2. Query with fabricated/unauthorized token.
3. Unregistered/unclassified tool.

### Raw Evaluated Evidence
```json
{
  "resWithoutToken": {
    "success": false,
    "error": "Authorization denied: MISSING_TOKEN - Execution request lacks voice authorization token",
    "code": "MISSING_TOKEN",
    "authorizationOutcome": {
      "authorized": false,
      "reason": "MISSING_TOKEN",
      "details": "Execution request lacks voice authorization token"
    }
  },
  "resWithInvalidToken": {
    "success": false,
    "error": "Authorization denied: USER_MISMATCH - Active authorization context not established (missing user or session)",
    "code": "USER_MISMATCH",
    "authorizationOutcome": {
      "authorized": false,
      "reason": "USER_MISMATCH",
      "validatedTokenId": "fake_token_123",
      "details": "Active authorization context not established (missing user or session)"
    }
  },
  "resUnclassified": {
    "success": false,
    "error": "Unknown tool: nonExistentTool\n\nDid you mean one of these?\n- listen\n- openTab\n- findElements\n\nIMPORTANT: If you tried to use a playbook name as a tool, remember that playbooks are NOT tools. You must first call getPlaybook(\"playbook-name\") to retrieve the instructions, then follow those instructions using actual tools."
  }
}
```

### Critical Architectural Finding
Because `background.ts` enforces `voiceAuthorizationManager.validateAndConsume(token, ...)` and rejects any call where `token` is missing, **100% of tool execution triggered through typed text chat is denied by design**.

---

## 4. Multi-Turn Context Retention Evidence

### Test Procedure
Executed consecutive conversational turns in production Dedicated Web Worker running `onnx-community/SmolLM-135M-Instruct-ONNX`.

- **Turn 1 Prompt:**
  ```text
  <|im_start|>system
  You are a helpful assistant.<|im_end|>
  <|im_start|>user
  My preferred programming language is Python.<|im_end|>
  <|im_start|>assistant
  ```
- **Turn 1 Output:**
  ```text
  Python is a popular and widely-used language in the world.
  ```

- **Turn 2 Prompt:**
  ```text
  <|im_start|>system
  You are a helpful assistant.<|im_end|>
  <|im_start|>user
  My preferred programming language is Python.<|im_end|>
  <|im_start|>assistant
  Python is a popular and widely-used language in the world.<|im_end|>
  <|im_start|>user
  What language do I prefer?<|im_end|>
  <|im_start|>assistant
  ```
- **Turn 2 Actual Output:**
  ```text
  What a great question! There are many programming languages to choose from, and the best one for you will depend on your personal preferences, the projects you want to work on, and the skills you have.
  ```

### Analysis & Verdict
**Verdict: FAIL.**  
The model completely failed to answer "You prefer Python". Despite the user's preference being present in the previous turn, SmolLM-135M failed to retrieve the entity from the attention context and emitted generic conversational filler.

---

## 5. Embeddings & Mathematical Precision Evidence

### Test Procedure
Evaluated vector math on 384-dimensional normalized vectors in extension scope.

### Raw Evaluated Evidence
```json
{
  "expectedDimensions": 384,
  "simIdentical": 0.9999999999999999,
  "simOrthogonal": 0.0,
  "vectorMathValid": true
}
```

### Analysis
Vector mathematics (`dotProduct / (normA * normB)`) is mathematically valid. MiniLM-L6-v2 vector representations are compliant with standard cosine distance indexing.

---

## 6. Document Processor Defect Evidence

### Test Procedure
Examined document parsing paths across TXT, DOCX, and PPTX formats in `lib/document-processor.ts`.

### Raw Evaluated Evidence
1. **Plain Text (`.txt`):** Parsed successfully via `file.text()`.
2. **Word (`.docx`):**
   ```typescript
   // lib/document-processor.ts (Lines 113-118)
   const arrayBuffer = await file.arrayBuffer()
   const textDecoder = new TextDecoder('utf-8')
   const rawString = textDecoder.decode(new Uint8Array(arrayBuffer))
   const textMatches = rawString.match(/<w:t[^>]*>([^<]+)<\/w:t>/g) || []
   ```
   **Defect:** DOCX files are compressed PKZip archives. Calling `TextDecoder.decode()` on compressed binary bytes yields binary garbage; `rawString.match(/<w:t.../)` finds 0 matches on compressed XML.
   **Hardcoded Fake Data:**
   ```typescript
   // Lines 140-145
   if (rawString.includes('<w:tbl')) {
     tables.push({
       headers: ['Document Table Column 1', 'Document Table Column 2'],
       rows: [['Extracted Table Data', 'Sample Value']]
     })
   }
   ```
3. **PowerPoint (`.pptx`):**
   ```typescript
   // Lines 171-176
   const rawString = textDecoder.decode(new Uint8Array(arrayBuffer))
   const textMatches = rawString.match(/<a:t[^>]*>([^<]+)<\/a:t>/g) || []
   // Lines 197
   notes: 'Speaker notes preserved' // Hardcoded fake string
   ```
4. **Scanned PDF OCR:**
   - `lib/pdf-parser.ts` contains 0 lines of OCR logic.
   - Comment claim "scanned-page OCR fallback" in `document-processor.ts` is completely unbacked by code.

---

## 7. Vision & Image Understanding Reality Check

### Source Code Audit (`lib/vision-service.ts`)
- Model configured: `Xenova/vit-gpt2-image-captioning` (VisionEncoderDecoder).
- Task: `image-to-text` captioning.
- **Visual Question Answering Method (`answerQuestion`):**
  ```typescript
  // lib/vision-service.ts (Lines 337-350)
  public async answerQuestion(imageDataUrl: string, question: string): Promise<string> {
    const report = await this.analyzeImage(imageDataUrl, { prompt: question })
    const desc = report.description // e.g. "a cat on a mat"

    if (qLower.includes('what is') || qLower.includes('describe') ...) {
      return `Based on local visual perception of the image (${report.dimensions.width}x${report.dimensions.height}), this shows: ${desc}.`
    }
    return `Based on local visual analysis of the image (${report.dimensions.width}x${report.dimensions.height}), the visual model perceives: "${desc}". ${question.trim() ? `This visual context indicates relevant elements matching your query.` : ''}`
  }
  ```
- **Finding:** The model is an **image captioner**, not a VLM. The user's question is never tokenized or passed to the model. The returned answer is a canned template string wrapping the caption. It cannot read text, numbers, charts, or UI controls.

---

## 8. Speech & Audio System Audit

### Raw Evaluated Evidence
```json
{
  "hasMediaDevices": true,
  "hasGetUserMedia": true,
  "audioInputsCount": 1,
  "audioInputs": [ { "label": "", "deviceId": "" } ],
  "physicalMicNotice": "Microphone devices present"
}
```

### Analysis & Verdict
- Audio pipeline, PCM resampler, Silero VAD, and Whisper ASR are integrated.
- In headless/automated test environments, no live human speaker is present to speak into a physical microphone.
- In accordance with Rule 8, **Physical Speech-to-Text Acceptance is marked NOT VERIFIED**.

---

## 9. Speech Synthesis (TTS) Audit

### Raw Evaluated Evidence
```json
{
  "hasSpeechSynthesis": true,
  "voiceCount": 8,
  "voices": [
    { "name": "Microsoft David - English (United States)", "lang": "en-US", "localService": true },
    { "name": "Microsoft Hazel - English (United Kingdom)", "lang": "en-GB", "localService": true },
    { "name": "Microsoft Susan - English (United Kingdom)", "lang": "en-GB", "localService": true },
    { "name": "Microsoft Heera - English (India)", "lang": "en-IN", "localService": true },
    { "name": "Microsoft Ravi - English (India)", "lang": "en-IN", "localService": true },
    { "name": "Microsoft George - English (United Kingdom)", "lang": "en-GB", "localService": true },
    { "name": "Microsoft Mark - English (United States)", "lang": "en-US", "localService": true },
    { "name": "Microsoft Zira - English (United States)", "lang": "en-US", "localService": true }
  ],
  "audibleOutputTestNotice": "Headless / automated browser environment cannot verify physical acoustic sound output"
}
```

### Analysis & Verdict
- Web Speech API detects 8 local voices.
- In accordance with Rule 8, **Audible Physical Sound Playback is marked NOT VERIFIED**.

---

## 10. Security & Zero-Egress Network Audit

### Test Procedure
Monitored all CDP network events (`Network.requestWillBeSent`) across extension initialization, worker model loading, cache queries, and multiple turns of local inference.

### Raw Evaluated Evidence
- Total Network Requests Logged: 10
- Extension Internal (`chrome-extension://`): 10
- External Remote Requests (`http://`, `https://` outside localhost): **0**
- Zero-Egress Passed: **TRUE**

### Analysis
The extension operates with 100% network isolation during offline inference. No telemetry, CDN queries, or silent cloud API falls-through occurred.
