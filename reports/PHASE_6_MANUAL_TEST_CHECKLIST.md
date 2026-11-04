# PENTONE — PHASE 6: MANUAL TEST CHECKLIST & HARDWARE VALIDATION GUIDE

- **Date:** November 3, 2026
- **Purpose:** Operator instructions for physical hardware verification and interactive manual acceptance.
- **Target Environment:** Chrome Manifest V3 (Chromium 156.0.8078.80 / Windows 11 x64)
- **Extension Path:** `build/chrome-mv3-prod`

---

## 1. PRE-TEST ENVIRONMENT SETUP

1. **Load Extension:**
   - Open Chrome browser.
   - Navigate to `chrome://extensions`.
   - Enable "Developer mode" (top right toggle).
   - Click "Load unpacked" and select `build/chrome-mv3-prod`.
   - Confirm Pentone icon appears in the Chrome toolbar.
2. **Hardware Connected:**
   - Plug in a physical USB or 3.5mm microphone.
   - Verify default audio input in Windows Sound Settings (`mmsys.cpl`).
   - Connect physical stereo headphones or external desktop speakers.

---

## 2. PHYSICAL HARDWARE AUDIO & VOICE VERIFICATION

### Test 2.1 — Microphone Permission & Physical Push-To-Talk (PTT)
- **Action:** Open Pentone sidepanel. Click the Microphone icon (or hold Spacebar if PTT hotkey is active).
- **Prompt:** When Chrome displays the permission prompt, select "Allow".
- **Speak:** Speak clearly: *"What is the title of my active page?"*
- **Release:** Release the button / hotkey.
- **Expected Results:**
  - [ ] Microphone waveform animates in the UI during speech.
  - [ ] Transcript appears in chat: *"What is the title of my active page?"*
  - [ ] Whisper Tiny transcribes speech with $< 1.5\text{s}$ latency.
  - [ ] Assistant executes `getPageTitle` tool and responds with the current tab title.
- **Record:** `[ ] PASS   [ ] FAIL` | Notes: `_____________________`

### Test 2.2 — Physical Loudspeaker Text-to-Speech (TTS) & Barge-In
- **Action:** In chat, send: *"Explain what WebAssembly is in three short sentences."*
- **Listen:** Listen to the physical desktop speakers.
- **Speak during playback (Barge-in):** Press PTT while assistant is speaking.
- **Expected Results:**
  - [ ] Physical speakers emit audible speech using the selected local voice.
  - [ ] Pressing PTT or clicking "Mute" halts speech immediately without clipping or hanging.
- **Record:** `[ ] PASS   [ ] FAIL` | Notes: `_____________________`

### Test 2.3 — Voice Biometric Speaker Verification (CAM++)
- **Enrollment:** In Settings > Voice, complete the one-time 3-phrase voice enrollment.
- **Authorized Turn:** Speak: *"Open a new tab to github.com"*.
  - [ ] Embedding matches profile (cosine similarity $> 0.72$).
  - [ ] `VoiceAuthorizationToken` is minted; tab opens successfully.
- **Unauthorized Speaker:** Have another person speak the same command.
  - [ ] Assistant rejects the command: *"Voice authorization denied: UNAUTHORIZED_SPEAKER"*.
- **Record:** `[ ] PASS   [ ] FAIL` | Notes: `_____________________`

---

## 3. BROWSER AUTOMATION & SENSITIVE ACTION GATING

### Test 3.1 — High-Impact Financial URL Protection
- **Action:** In text chat, type: `"Open https://banking.chase.com/login"`.
- **Expected Result:**
  - [ ] Assistant displays an interactive confirmation dialog: *"Tool 'openTab' requires confirmation to access sensitive endpoint"*.
  - [ ] Tab does NOT open automatically.
  - [ ] Clicking "Approve" opens the tab; clicking "Deny" cancels the action.
- **Record:** `[ ] PASS   [ ] FAIL` | Notes: `_____________________`

### Test 3.2 — Checkout Button Protection
- **Action:** On an e-commerce page, ask: `"Click the Place Order button"`.
- **Expected Result:**
  - [ ] High-impact action gate prompts for confirmation before dispatching click.
- **Record:** `[ ] PASS   [ ] FAIL` | Notes: `_____________________`

---

## 4. DOCUMENT EXTRACTION & OCR LIMITATION

### Test 4.1 — DOCX File Upload
- **Action:** Drag and drop a `.docx` file containing headings, paragraphs, and tables into chat.
- **Expected Result:**
  - [ ] Status updates to "Decompressing archive...".
  - [ ] Paragraphs and formatted tables are extracted into chat context.
  - [ ] Asking: *"Summarize the table in this document"* answers with actual table rows.
- **Record:** `[ ] PASS   [ ] FAIL` | Notes: `_____________________`

### Test 4.2 — PPTX File Upload (Presentation Order)
- **Action:** Upload a `.pptx` presentation with multiple slides and speaker notes.
- **Expected Result:**
  - [ ] Slides are presented in exact presentation order.
  - [ ] Asking: *"What are the speaker notes on slide 1?"* returns genuine notes from the file.
- **Record:** `[ ] PASS   [ ] FAIL` | Notes: `_____________________`

### Test 4.3 — Scanned Image-Only PDF Upload
- **Action:** Upload a PDF consisting of scanned document photographs (no text layer).
- **Expected Result:**
  - [ ] Assistant displays: `[Scanned PDF: Local OCR engine is not available offline in browser runtime. To process this document, please use a searchable PDF or provide a transcript.]`.
  - [ ] No hallucinated or fake text is returned.
- **Record:** `[ ] PASS   [ ] FAIL` | Notes: `_____________________`

---

## 5. VISION & IMAGE CAPTIONING

### Test 5.1 — Screenshot Scene Captioning
- **Action:** Open a news article with a photo. In chat, click "Capture Screenshot". Ask: *"Describe this image"*.
- **Expected Result:**
  - [ ] ViT-GPT2 processes the image on-device and returns a descriptive scene caption.
- **Record:** `[ ] PASS   [ ] FAIL` | Notes: `_____________________`

### Test 5.2 — Fine-Grained VQA Boundary Verification
- **Action:** Upload a screenshot of a complex spreadsheet. Ask: *"What is the exact value in cell D12?"*.
- **Expected Result:**
  - [ ] Assistant provides a scene description and adds: *"Fine-grained visual question answering (VQA) requires a multimodal VLM exceeding Chrome's 32-bit WASM memory ceiling. Detailed cell reading is not supported offline."*
- **Record:** `[ ] PASS   [ ] FAIL` | Notes: `_____________________`

---

## 6. OFFLINE STARTUP & MODEL CACHE RESILIENCE

### Test 6.1 — Offline Disconnection
- **Action:**
  - Provision all models in Settings (100% downloaded).
  - Disconnect PC from Wi-Fi / unplug Ethernet cable.
  - Close and relaunch Chrome.
  - Open Pentone sidepanel.
  - Send: *"Explain the difference between a stack and a queue."*
- **Expected Result:**
  - [ ] Assistant loads SmolLM-135M from local `CacheStorage`.
  - [ ] Generation produces correct response entirely offline.
  - [ ] Zero network error toasts appear.
- **Record:** `[ ] PASS   [ ] FAIL` | Notes: `_____________________`

---

## 7. SIDEPANEL LIFECYCLE & PERSISTENCE

### Test 7.1 — Sidepanel Close and Reopen During Generation
- **Action:** Submit a long generation prompt. Close the sidepanel midway. Reopen sidepanel after 5 seconds.
- **Expected Result:**
  - [ ] Background worker completes or gracefully aborts without memory leaks.
  - [ ] Reopening sidepanel renders previous conversation history accurately from IndexedDB.
- **Record:** `[ ] PASS   [ ] FAIL` | Notes: `_____________________`
