# Local AI Engine Setup

Onboarding and Settings share the same live checklist. Select **Download all supported models & packs** once to prepare available resources. Missing microphone permission opens Pentone's permission tab; approve the browser prompt and return. Setup does not start recognition or hands-free listening.

The Voice page shows **Finish local setup** when an important resource is missing, unsupported or needs retry. **Open missing items in Settings** scrolls to and focuses the first affected item. Checks run on screen entry, window focus, permission changes, local voice changes and microphone preparation. Skipping onboarding keeps completed downloads and leaves the repair link available.

## What users need

| Resource | Used for | Setup |
| --- | --- | --- |
| Compatible desktop Chrome and hardware | Native on-device AI APIs | Browser-managed; update Chrome if unsupported. Flags, where offered, require a browser relaunch. |
| Gemini Nano / Prompt API | Assistant reasoning, chat and browser tools | Browser-managed download; size varies and can be several GB. |
| all-MiniLM-L6-v2, tokenizer and configuration | Semantic memory, page/file embeddings and search | Transformers.js downloads model files (approximately 23 MB plus supporting files); inference runs locally. |
| Summarizer API | Page summaries | Prepare its browser-managed resources when supported. |
| Writer API | Drafting text | Prepare its browser-managed resources when supported. |
| Rewriter API | Editing and improving text | Prepare its browser-managed resources when supported. |
| Language Detector API | Detecting text languages | Prepare its browser-managed resources when supported. |
| Translator API language pairs | Translation | Start with non-English languages from the browser's preferences. Prepare both English-to-language and language-to-English packs; allow up to five selected languages. No arbitrary second language is downloaded for an English-only browser. |
| Local speech-recognition language pack | Microphone voice commands | Prepare English speech for the locale currently used by Pentone; reuse an installed compatible English dialect. No online recognition fallback. |
| Microphone permission | Voice capture | User approves Chrome's native prompt. Denials link to Chrome's site settings. |
| Local English system voice | Spoken replies | Detect installed local voices. If missing, show Windows/macOS setup instructions and a recheck action; extensions cannot install OS voice packages. |
| Prompt API image/audio support | Image and audio-file understanding | Optional browser capability; prepare supported resources, report unsupported configurations. Separate from microphone recognition. |
| Picovoice AccessKey | Optional “Hey Pentone” wake word | Model and runtime files are included. User configures a key in Audio & Speech; license activation is checked when hands-free listening starts and may need a network connection. A saved key is not claimed to be verified. |
| Bookmarks, downloads, history, sessions, tab groups | Optional browser tools | Explicit individual permission controls, including revoke. These are not downloads and are not granted by Download all. |

Chrome may share model files among APIs. Pentone does not invent a combined download total or claim unavailable APIs are installed. Local AI inference and speech remain on-device; initial model downloads, ordinary website access and optional wake-word license activation can use the network.

## Already packaged

The expandable library list covers Transformers.js and ONNX/WASM; Porcupine and Web Voice Processor with the wake-word models; PDF.js and its worker, Readability and Turndown; Zod, dom-accessibility-api, Papa Parse and Plasmo messaging; Compromise, Compromise Numbers, Fuse.js and Double Metaphone; React, Radix, Zustand, animation/icon/audio libraries; Markdown, internationalization and styling helpers. Page-agent code, images, sounds and styles are also included. Normal users do not install Node.js, npm, Python, developer dependencies or cloud AI SDKs.

## Readiness and recovery

- Each native API is inspected with the same options later used to create its temporary setup session. Download actions start in the initiating browser click, forward cancellation and download progress, and destroy sessions even if they finish after cancellation.
- Setup verifies availability after creation; a successful create or install call alone is insufficient. Embedding preparation uses the runtime singleton and checks a 384-element inference result. Subsequent checks inspect the four required cache entries instead of trusting the legacy cached boolean.
- Failed items do not block other downloads. Retry addresses only that item. Focus/permission refreshes preserve actionable retry messages until readiness is confirmed.
- Cancellation releases the UI and prevents late results from changing the new run. Native and Transformers.js downloads may continue in the background when their underlying API cannot cancel them. Cancelling setup never starts the microphone.
- Language choices are validated and stored locally. Changing choices reinspects availability; removing a choice does not delete Chrome's cached models.

Automated native-model tests use controlled API fixtures and local pages. A valid download status is not a certification of inference quality, physical audio, every language pair, every hardware configuration or every website. See [production-readiness.md](production-readiness.md) for the recorded release checks.
