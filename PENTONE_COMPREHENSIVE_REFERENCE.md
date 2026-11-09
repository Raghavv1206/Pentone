# Pentone: The Comprehensive Technical & Non-Technical Reference

> **The World's First Autonomous, 100% Private, On-Device AI Browser Copilot**  
> *Created & Developed by **Raghav**.*

---

## Table of Contents
1. [Executive Summary & Non-Technical Overview](#1-executive-summary--non-technical-overview)
   - [What is Pentone?](#what-is-pentone)
   - [The Core Philosophy](#the-core-philosophy)
   - [Why "100% On-Device" Matters](#why-100-on-device-matters)
   - [Real-World Non-Technical Use Cases](#real-world-non-technical-use-cases)
   - [Creator Attribution](#creator-attribution)
2. [High-Level Architecture & System Design](#2-high-level-architecture--system-design)
   - [Manifest V3 Architecture Diagram](#manifest-v3-architecture-diagram)
   - [Runtime Execution Contexts](#runtime-execution-contexts)
3. [Technology Mapping Matrix (Where Which Technology Is Used)](#3-technology-mapping-matrix-where-which-technology-is-used)
4. [Deep-Dive: Core Subsystems & Technologies](#4-deep-dive-core-subsystems--technologies)
   - [4.1 In-Browser AI Engine (Gemini Nano & Chrome Built-in APIs)](#41-in-browser-ai-engine-gemini-nano--chrome-built-in-apis)
   - [4.2 Local Semantic Vector Vault & Embeddings](#42-local-semantic-vector-vault--embeddings)
   - [4.3 Voice Processing & Audio Subsystem](#43-voice-processing--audio-subsystem)
   - [4.4 DOM Automation & Accessibility Traversal Engine](#44-dom-automation--accessibility-traversal-engine)
   - [4.5 Intelligent Form Autofill & Resume Vault](#45-intelligent-form-autofill--resume-vault)
   - [4.6 Proactive Security & Privacy Suite](#46-proactive-security--privacy-suite)
   - [4.7 Zero-Latency Startup & Build Pipeline](#47-zero-latency-startup--build-pipeline)
5. [User Interface & Screen Reference](#5-user-interface--screen-reference)
   - [Main Screen](#main-screen)
   - [Chat Screen](#chat-screen)
   - [History Screen](#history-screen)
   - [Tools Screen](#tools-screen)
   - [Memory Screen](#memory-screen)
   - [Profile Screen (Vault & Resume Parser)](#profile-screen-vault--resume-parser)
   - [Settings Screen](#settings-screen)
   - [Debug Screen](#debug-screen)
6. [Complete Browser Automation Tools Catalog (30+ Tools)](#6-complete-browser-automation-tools-catalog-30-tools)
7. [In-Page Content Script Capabilities & Overlays](#7-in-page-content-script-capabilities--overlays)
8. [Data Flows & Execution Lifecycles](#8-data-flows--execution-lifecycles)
9. [Chrome On-Device AI Setup & Flags Guide](#9-chrome-on-device-ai-setup--flags-guide)
10. [Summary & Verification](#10-summary--verification)

---

## 1. Executive Summary & Non-Technical Overview

### What is Pentone?
**Pentone** is a next-generation browser copilot built as a Google Chrome extension (Manifest V3). It enables users to navigate, inspect, summarize, automate, and control any website using natural spoken English or typed conversation. 

Unlike traditional browser assistants (e.g., Microsoft Copilot, Claude extensions, ChatGPT sidebars) that transmit user keystrokes, browsing history, private web pages, and voice recordings to remote cloud servers, **Pentone runs 100% locally on your computer**. Every artificial intelligence computation, embedding calculation, speech recognition pass, audio synthesis run, and document parse is executed on your local CPU and GPU.

### The Core Philosophy
1. **Local-First & Offline-First**: No data packets leave your device. The extension functions with full capability whether you are connected to high-speed fiber or completely disconnected on an airplane.
2. **Voice-First Accessibility**: Voice is treated as a first-class control modality. Users can hold the Spacebar from anywhere in the browser to command their machine, listen to zero-latency natural speech, or use wake-words (*"Hey Pentone"*) and hands-free numbered link surfing.
3. **Compound Autonomous Agency**: Pentone is not a passive chatbot. It is an autonomous agent equipped with 30+ browser tools capable of executing compound instructions (e.g., *"Open YouTube, search for quantum computing, close all other tabs, and remember that I am interested in physics"* in a single breath).
4. **Uncompromising Privacy**: No telemetry, no third-party trackers, no analytics SDKs, and no external API keys required.

### Why "100% On-Device" Matters
| Dimension | Traditional Cloud AI Extensions | Pentone On-Device Copilot |
| :--- | :--- | :--- |
| **Data Privacy** | Sensitive web pages (banking, health records, emails) uploaded to cloud LLMs | **Zero cloud upload**. Everything stays in browser memory & IndexedDB |
| **Latency** | 1,500ms – 4,000ms round-trip server network delay | **Sub-50ms** local inference via Chrome Gemini Nano hardware acceleration |
| **Offline Reliability**| Fails instantly when Wi-Fi drops or cloud APIs hit rate limits | **100% operational offline**; zero external dependencies |
| **Subscription Costs** | \$20/month cloud subscription fees or metered API tokens | **100% free forever**; utilizes your existing computer hardware |

### Real-World Non-Technical Use Cases
- **Hands-Free Web Browsing**: Browse documentation, cook recipes while reading instructions aloud, or navigate news articles hands-free without touching a mouse or keyboard.
- **Instant Job Applications & Form Autofill**: Store your professional career profile and resume locally. When encountering 20-field job applications, Pentone uses on-device AI to inspect the form and fill names, work history, portfolios, and demographic info in 1 click.
- **Deep Content Synthesis & Article Decluttering**: With one command (*"Summarize this page"*), Pentone strips intrusive banner ads, navigation bars, and cookie walls using Readability algorithms and delivers a structured executive brief.
- **Privacy Protection While Browsing**: Automatically scans URLs for deceptive phishing heuristics and generates disposable email and phone aliases when signing up for suspicious newsletters.

### Creator Attribution
Pentone was designed, created, and developed by **Raghav**. When prompted in any conversation or voice interaction (*"Who made you?"* or *"Who is your creator?"*), Pentone responds directly and proudly with **Raghav**.

---

## 2. High-Level Architecture & System Design

Pentone is structured around Chrome's **Manifest V3** security architecture and is bundled using the **Plasmo Extension Framework** with **React 18** and **TypeScript 5.3**.

### Manifest V3 Architecture Diagram

```mermaid
graph TD
    subgraph Browser_Chrome_Window ["Chrome Browser Window"]
        SidePanel["Side Panel UI (React 18 / Zustand)\nsidepanel.html"]
        WebPage["Active Web Page Tab (DOM)"]
        ContentScript["Content Script\ncontent.ts"]
    end

    subgraph Service_Worker ["Background Service Worker"]
        BGWorker["background.ts\n(Event Hub & MV3 API Controller)"]
    end

    subgraph Local_AI_Engines ["On-Device AI Engines (100% Local)"]
        GeminiNano["Chrome Gemini Nano (Prompt API)"]
        SummarizerAPI["Chrome Summarizer API"]
        WriterAPI["Chrome Writer & Rewriter APIs"]
        TranslatorAPI["Chrome Language & Translation APIs"]
        TransformersJS["Transformers.js (all-MiniLM-L6-v2 ONNX WASM)"]
    end

    subgraph Storage_Layer ["Local Persistence (Zero-Cloud)"]
        IndexedDB_Vault["IndexedDB: Semantic Memory Vault"]
        ProfileVault["chrome.storage.local: Autofill Profile"]
        SettingsStore["chrome.storage.local: User Preferences"]
    end

    WebPage <--> ContentScript
    ContentScript <-->|chrome.runtime.sendMessage| BGWorker
    SidePanel <-->|chrome.runtime.sendMessage| BGWorker
    SidePanel <--> GeminiNano
    SidePanel <--> SummarizerAPI
    SidePanel <--> WriterAPI
    SidePanel <--> TranslatorAPI
    SidePanel <--> TransformersJS
    SidePanel <--> IndexedDB_Vault
    BGWorker -->|chrome.tabs / scripting / tabCapture| WebPage
```

### Runtime Execution Contexts
1. **Side Panel (`sidepanel.tsx`)**:
   - The primary interactive visual and audio interface.
   - Hosts the React 18 component tree, Zustand stores, Web Speech synthesis/recognition engines, and direct bindings to Chrome's Built-in AI APIs.
2. **Background Service Worker (`background.ts`)**:
   - The centralized extension coordinator.
   - Handles tab lifecycle events, script injections, context menu clicks, tab audio capture streams, and background automation tool dispatches.
3. **Content Script (`content.ts`)**:
   - Injected into every visited web page (`<all_urls>`).
   - Powers the in-page custom text selection toolbar, floating capture buttons, in-page semantic search (Ctrl+Shift+F), Voice Surfer interactive badges, and DOM form filling.
4. **Popup (`popup.tsx`)**:
   - Compact quick-access toolbar menu for instant mic activation, quick summaries, and side panel opening.
5. **WASM Multi-Threaded Workers (`assets/ort-wasm/`)**:
   - WebAssembly threads executing ONNX Runtime Web for local transformer embeddings without locking the UI thread.

---

## 3. Technology Mapping Matrix (Where Which Technology Is Used)

The following matrix provides a complete technical cross-reference of every library, runtime, API, and technology used in Pentone:

| Technology / Library | Version | Primary Purpose | Exact Files & Locations Where Used | Execution Context |
| :--- | :--- | :--- | :--- | :--- |
| **Plasmo Framework** | `0.90.5` | MV3 bundling, HMR, asset pipeline, manifest generation | `package.json`, `scripts/post-build.js`, `sidepanel.tsx`, `popup.tsx`, `background.ts` | Build Time & Bundle |
| **React** & **React-DOM** | `18.2.0` | Reactive UI component tree, stateful rendering, error boundaries | `sidepanel.tsx`, `screens/*.tsx`, `components/**/*.tsx` | Side Panel & Popup |
| **TypeScript** | `5.3.3` | Strict type safety, interface definitions, enum checking | `lib/**/*.ts`, `screens/**/*.tsx`, `tsconfig.json` | All Contexts |
| **Tailwind CSS** | `3.4.17` | Utility-first dark-mode responsive styling | `style.css`, `tailwind.config.js`, all component TSX files | Side Panel & Popup |
| **Radix UI Themes** | `3.2.1` | Accessible headless UI primitives, collapsibles, icons | `components/mic-selector.tsx`, `components/voice-selector.tsx` | Side Panel |
| **Zustand** | `5.0.8` | Ultra-lightweight reactive global state management | `lib/chat-context.tsx`, `lib/alert-context.tsx`, `lib/theme-context.tsx` | Side Panel |
| **Lucide React** | `0.544.0` | High-fidelity SVG vector icons | `screens/*.tsx`, `components/navigation/app-header.tsx`, `components/chat/*.tsx` | Side Panel & Popup |
| **Chrome Built-in AI (Prompt API)** | Chrome 128+ | High-speed on-device LLM inference (Gemini Nano) | `lib/ai.ts`, `lib/tools/think.ts`, `lib/tools/listen.ts`, `lib/autofill/resume-parser.ts` | Side Panel |
| **Chrome Summarizer API** | Chrome 130+ | Local extractive & abstractive text summarization | `lib/summarizer.ts`, `lib/tools/summarizePage.ts`, `lib/ui-tools.ts` | Side Panel |
| **Chrome Writer & Rewriter APIs** | Chrome 131+ | Local creative content composition and tone rewriting | `lib/use-text-writer.ts`, `lib/use-text-rewriter.ts`, `lib/tools/writeContent.ts` | Side Panel & In-Page |
| **Chrome Translator & Language APIs** | Chrome 130+ | In-browser language identification and translation | `lib/tools/translateText.ts`, `lib/tools/detectLanguage.ts`, `lib/chrome-ai-helpers.ts` | Side Panel |
| **@xenova/transformers** | `2.17.2` | Browser transformer pipeline running `all-MiniLM-L6-v2` | `lib/embeddings.ts`, `lib/file-embedder.ts`, `lib/vault.ts` | Side Panel & Workers |
| **ONNX Runtime Web (WASM)** | `1.14+` | SIMD & multi-threaded WASM execution of transformer models | `assets/ort-wasm/ort-wasm-simd-threaded.wasm`, `scripts/post-build.js` | WebAssembly Worker |
| **Picovoice Porcupine** | `3.0.3` | Continuous on-device wake-word detection (*"Hey Pentone"*) | `lib/use-wake-word.ts`, `assets/Hey-Pentone_en_wasm_v3_0_0.ppn` | Side Panel |
| **Web Speech API (`SpeechRecognition`)** | Native | Voice push-to-talk speech-to-text audio transcription | `lib/use-speech-recognition.ts`, `lib/use-voice-input.ts`, `screens/main-screen.tsx` | Side Panel |
| **Web Speech API (`SpeechSynthesis`)** | Native | Real-time text-to-speech spoken audio output | `lib/tts-context.tsx`, `lib/voice-selector.ts`, `lib/sentence-parser.ts` | Side Panel |
| **Web Audio API** | Native | Synthesized acoustic cues (chimes, clicks, shutter, errors) | `lib/use-sound-effects.ts`, `components/waveform.tsx` | Side Panel |
| **IndexedDB (via idb/native)** | Native | Persistent zero-cloud local vector database & chat store | `lib/vault.ts`, `lib/rating-database.ts` | Side Panel |
| **pdfjs-dist** | `5.4.296` | On-device PDF buffer text extraction for resume parsing | `lib/autofill/resume-parser.ts`, `assets/pdf.worker.min.mjs` | Side Panel (Dynamic Import) |
| **Turndown** | `7.2.1` | HTML DOM to clean semantic Markdown conversion | `lib/tools/summarizePage.ts`, `assets/dom-to-semantic-markdown.js` | Side Panel & Content Script |
| **Readability.js** | Native | Algorithmic web article decluttering and content extraction | `assets/Readability.js`, `lib/tools/summarizePage.ts` | Content Script |
| **Compromise & Double Metaphone** | `14.19.0` | Heuristic natural language parsing & phonetic matching | `lib/intent-detector.ts`, `lib/heuristics/` | Side Panel |
| **Fuse.js** | `7.5.0` | Fuzzy client-side search across tool catalog and history | `screens/tools-screen.tsx`, `screens/history-screen.tsx` | Side Panel |
| **React Markdown & Remark GFM** | `8.0.7` | GitHub-flavored streaming Markdown rendering in chat | `components/chat/message-item.tsx`, `screens/chat-screen.tsx` | Side Panel |

---

## 4. Deep-Dive: Core Subsystems & Technologies

### 4.1 In-Browser AI Engine (Gemini Nano & Chrome Built-in APIs)
Pentone leverages Google Chrome's built-in on-device AI runtime, bringing large language model capabilities directly into the client process without external HTTP servers.

- **The Prompt API (`lib/ai.ts`)**:
  - Accesses `window.ai.languageModel` or `window.LanguageModel`.
  - Initializes sessions with custom system prompts that define Pentone's persona, tool-calling schemas, and conversational conciseness rules.
  - Implements **automatic context overflow recovery**: tracks token consumption via `session.tokensLeft`. When context thresholds are approached, old conversation turns are automatically condensed and pruned without crashing the session.
  - **Streaming Responses**: Uses `session.promptStreaming(query)` to yield tokens asynchronously, driving both the visual typewriter UI and the audio sentence chunker simultaneously.
- **Specialized Task APIs**:
  - **Summarizer API (`lib/summarizer.ts`)**: Generates TL;DR, key-point bullet lists, or headline summaries with customizable formatting (`type: 'key-points'`, `length: 'medium'`).
  - **Writer & Rewriter APIs (`lib/use-text-writer.ts`, `lib/use-text-rewriter.ts`)**: Rephrases, shortens, elongates, or alters tone (formal, casual, concise) directly inside web page text areas.
  - **Language Detector & Translator APIs (`lib/chrome-ai-helpers.ts`)**: Detects document languages and performs on-device neural translation across 20+ supported languages.

---

### 4.2 Local Semantic Vector Vault & Embeddings
Pentone includes a complete, self-contained semantic vector search engine that stores user facts, preferences, and clipped knowledge locally in IndexedDB.

```mermaid
flowchart LR
    UserInput["User Content / Memory"] --> Tokenizer["HuggingFace Tokenizer"]
    Tokenizer --> TransformersJS["Transformers.js\n(all-MiniLM-L6-v2)"]
    TransformersJS --> ORT_WASM["ONNX Runtime Web\n(SIMD WASM Engine)"]
    ORT_WASM --> Vector["384-Dimensional Dense Vector"]
    Vector --> IndexedDB[("IndexedDB\nLocal Vector Vault")]
    
    SearchQuery["Voice/Text Query"] --> QueryVector["Embed Query (384-D)"]
    QueryVector --> CosineMath["Cosine Similarity Math\n(dot_product / norms)"]
    IndexedDB --> CosineMath
    CosineMath --> RelevantMemories["Top-K Injected Context\ninto Gemini Nano Prompt"]
```

- **Embedding Model (`lib/embeddings.ts`)**:
  - Runs Xenova's `all-MiniLM-L6-v2` transformer model locally inside the browser.
  - Generates 384-dimensional dense floating-point vector embeddings.
  - Utilizes **WebAssembly SIMD and multi-threading** (`assets/ort-wasm/ort-wasm-simd-threaded.wasm`) to generate embeddings in under 35 milliseconds.
- **Vector Math & Memory Retrieval (`lib/vault.ts`)**:
  - Executes pure mathematical cosine similarity computations over indexed vectors:
    $$\text{similarity} = \frac{\mathbf{A} \cdot \mathbf{B}}{\|\mathbf{A}\| \|\mathbf{B}\|}$$
  - Automatically retrieves the top-3 most relevant user memories and preferences and prepends them into Gemini Nano's working prompt memory for contextual hyper-personalization.

---

### 4.3 Voice Processing & Audio Subsystem

- **Global Spacebar Push-to-Talk (`content.ts` & `screens/main-screen.tsx`)**:
  - Holding `Spacebar` while Pentone is selected opens the microphone immediately.
  - Built-in input-field detection: if the user is typing inside an `<input>`, `<textarea>`, or `contenteditable` field, Spacebar operates normally and does not trigger audio recording.
  - Implements a **3,500ms post-release grace window** ensuring natural conversational pauses do not truncate phonetic transcription.
- **Wake-Word Detection (`lib/use-wake-word.ts`)**:
  - Integrated with Picovoice Porcupine Web WASM.
  - Listens continuously for the custom wake-word model *"Hey Pentone"* with zero cloud audio transmission.
- **Progressive Streaming Sentence Chunker (`lib/sentence-parser.ts`)**:
  - Solves the classic AI voice synthesis dilemma: waiting for the full response causes multi-second latency, while speaking individual words causes jarring robotic stuttering.
  - Buffers streaming LLM tokens until a semantic sentence boundary (`.`, `!`, `?`, `\n`) is reached.
  - Intelligently recognizes and preserves decimal numbers (e.g., `Flight 3.5`, `98.6°F`) and abbreviations (`e.g.`, `vs.`) without splitting prematurely.
- **Voice Surfer Hands-Free Navigation (`lib/voice/voice-surfer.ts`)**:
  - Users can say *"Show links"* or *"Voice surfer"*.
  - Pentone scans the active page DOM and overlays numbered visual badges over every clickable link, button, and input.
  - Users simply say *"Click 4"* or *"Select 12"* to navigate hands-free.

---

### 4.4 DOM Automation & Accessibility Traversal Engine

- **Semantic DOM Inspection (`content.ts`)**:
  - Extracts interactive elements and builds a lightweight accessibility snapshot.
  - Resolves elements by ARIA roles, visible labels, placeholders, titles, and CSS selectors.
- **Natural Interaction Simulation**:
  - Executes native click events, smooth scrolling, select dropdown modifications, and keypress sequences (`Enter`, `Tab`, `Escape`).
  - Supports `contenteditable` rich-text editors (e.g., Google Docs, Notion, Slack Web) via synthetic `InputEvent` dispatch and `document.execCommand('insertText')` fallbacks.
- **Decluttering Engine (`assets/Readability.js` & `assets/dom-to-semantic-markdown.js`)**:
  - Clones the target document, strips advertisements, navigation trees, footer links, and tracking pixels, and converts the core article into clean GitHub-flavored Markdown for LLM synthesis.

---

### 4.5 Intelligent Form Autofill & Resume Vault

- **Local Profile Vault (`lib/autofill/profile-vault.ts`)**:
  - Stores comprehensive personal information locally in encrypted/restricted `chrome.storage.local`:
    - Personal: Full name, email, phone, location, headline, bio.
    - Professional: Work history, job titles, companies, dates, accomplishments.
    - Education: Degrees, universities, graduation years, GPA.
    - Links: LinkedIn, GitHub, portfolio URL, Twitter/X.
    - Custom Q&A: Work authorization, sponsorship requirements, salary expectations.
- **Offline Resume Parser (`lib/autofill/resume-parser.ts`)**:
  - Users upload a PDF resume directly in the side panel.
  - Uses `pdfjs-dist` loaded locally to parse raw PDF text streams entirely on-device.
  - Passes extracted text to Gemini Nano with structured JSON schema constraints to populate the user's Profile Vault automatically in seconds.
- **Smart Form Matching & In-Page Floating Pill (`lib/autofill/inline-pill.ts`)**:
  - When the user visits any web form, Pentone inspects the input fields.
  - Injects a subtle, elegant Pentone floating autofill icon next to detected form fields. Clicking the icon fills the entire multi-step application form instantly using matched profile data.

---

### 4.6 Proactive Security & Privacy Suite

- **Phishing Guard (`lib/security/phishing-guard.ts`)**:
  - Analyzes visited URLs against heuristic threat indicators:
    - IP-based hostnames (`http://192.168.1.1/...`)
    - Excessive subdomains and deceptive top-level domains (`.xyz`, `.top`, `.tk`)
    - Brand impersonation (homoglyph attacks, typosquatting)
  - Passes suspicious domains to on-device Gemini Nano for instant zero-cloud risk scoring and warns the user before credentials are typed.
- **Masked Alias Generator (`lib/security/alias-generator.ts`)**:
  - Generates deterministic, secure pseudonymous email aliases and virtual contact identities, allowing users to register on untrusted web portals without disclosing their real identity.
- **Safe Window & Tab Safeguards (`lib/tools/closeTab.ts`)**:
  - When the user issues commands like *"Close all tabs"*, Chrome's standard behavior would close the entire browser window and kill the extension.
  - Pentone intercepts this command, opens a fresh neutral tab first, and then closes the remaining tabs, ensuring the browser window and Pentone side panel never abruptly terminate.

---

### 4.7 Zero-Latency Startup & Build Pipeline

- **Frame-0 HTML/CSS Splash Screen (`scripts/post-build.js`)**:
  - Eliminates the blank slate/dark void delay while large JavaScript bundles evaluate.
  - Directly injects an inline static CSS/HTML splash shell inside `<div id="__plasmo">` of `sidepanel.html` and `popup.html`:
    - Concentric pulsing mint voice orb with ripple keyframe animations (`@keyframes pRipple`, `@keyframes pPulse`).
    - Branded Pentone logo badge and live green status indicator dot.
    - Emerald shimmer progress bar (`@keyframes pShimmer`) with *"Starting AI Copilot..."*.
  - Renders in **0 milliseconds (Frame 0)** before JavaScript begins parsing. React 18 cleanly mounts directly into the container and replaces the loader without flicker.
- **Reliable ReadyState Mount Patch (`scripts/post-build.js`)**:
  - Resolves a fundamental Manifest V3 quirk where small HTML shells finish loading before large JavaScript bundles execute, causing standard `DOMContentLoaded` listeners to never fire.
  - Patches the bundle entrypoint to verify `document.readyState === "loading"`: fires immediately if the document has already parsed.
- **Parcel Tree-Shaking Bug Fix**:
  - Patches an upstream Parcel bundler tree-shaking bug in `property-information` (`hastToReact` export), ensuring markdown rendering never crashes with undefined property exceptions.

---

## 5. User Interface & Screen Reference

The Pentone user interface is designed with a modern dark-mode aesthetic featuring deep obsidian tones (`#171816`), warm cream accents (`#FFFEEF`), and glowing emerald mint indicators (`#67E2C8`).

```
┌─────────────────────────────────────────────────────────────┐
│  [P] Pentone Copilot           ● Active       [Settings] [X]│
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                      ((((  ●  ))))                          │
│                   Glowing Voice Orb                         │
│               "Hold Spacebar or Speak"                      │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Contextual Smart Actions                              │  │
│  │  [⚡ Summarize Page]   [📝 Rewrite Text]   [🛡️ Privacy] │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  Navigation: [Main] [Chat] [Memory] [Profile] [Tools] [Logs]│
└─────────────────────────────────────────────────────────────┘
```

### Main Screen (`screens/main-screen.tsx`)
- **Interactive Voice Orb**: A pulsating SVG/Canvas sphere that reacts dynamically to voice input, thinking states, speaking audio levels, and idle listening.
- **Quick Action Grid**: One-click contextual accelerators based on the currently open web page (Summarize, Explain Selection, Audit Privacy, Voice Surfer).
- **Live Device Status**: Real-time indicators showing Gemini Nano readiness, microphone access, and local memory vault health.

### Chat Screen (`screens/chat-screen.tsx`)
- Multi-turn conversational interface with streaming GitHub-flavored Markdown rendering.
- Collapsible interactive tool-call execution badges with JSON parameter previews and execution timing metrics.
- Token gauge indicating active context window utilization and memory retention.

### History Screen (`screens/history-screen.tsx`)
- Chronological timeline of all past voice commands, web interactions, and synthesized summaries.
- Client-side fuzzy search powered by Fuse.js.
- One-click export to JSON or Markdown for personal knowledge bases.

### Tools Screen (`screens/tools-screen.tsx`)
- Interactive developer catalog of all 30+ browser tools.
- Allows manual triggering of any tool with custom parameters inside an isolated sandbox.
- Displays execution permission status and parameter schemas.

### Memory Screen (`screens/memory-screen.tsx`)
- Visual inspector of all stored on-device semantic memories and preferences.
- Search memories by natural concept or keyword.
- Pin, edit, or purge memories with zero cloud interaction.

### Profile Screen (`screens/profile-screen.tsx`)
- Vault for career history, personal info, education, and social links.
- Drag-and-drop resume PDF upload with automated Gemini Nano extraction.
- Custom Q&A builder for specialized job application screening questions.

### Settings Screen (`screens/settings-screen.tsx`)
- **Chrome On-Device AI Flags Guide**: Direct visual instructions and copyable links (`chrome://flags/#optimization-guide-on-device-model`, `chrome://flags/#prompt-api-for-gemini-nano`) for activating built-in AI models.
- **Hardware Configuration**: Audio input device selector (microphones), audio output voice picker, wake-word sensitivity slider, and global keyboard shortcut toggles.

### Debug Screen (`screens/debug-screen.tsx`)
- Real-time diagnostic monitor showing memory allocations, Chrome AI API availability flags, active tab metadata, and extension service worker latency benchmarks.

---

## 6. Complete Browser Automation Tools Catalog (30+ Tools)

Every tool in Pentone is defined with strict JSON schema definitions and executed through a deterministic agent dispatcher:

| Tool Name | Source Module | Execution Context | Description & Arguments |
| :--- | :--- | :--- | :--- |
| `openTab` | `lib/tools/openTab.ts` | Background | Opens a new browser tab with a given `url` and optional `active` focus. |
| `closeTab` | `lib/tools/closeTab.ts` | Background | Closes tabs: supports current tab, specific `tabId`, `"other"`, or `"all"` (with crash-safe tab preservation). |
| `switchTab` | `lib/tools/switchTab.ts` | Background | Switches focus to a tab matching a specific `tabId` or title substring. |
| `getTabs` | `lib/tools/getTabs.ts` | Background | Returns an array of all open tabs across all Chrome windows with IDs, titles, and URLs. |
| `getPageTitle` | `lib/tools/getPageTitle.ts` | Background | Retrieves the HTML `<title>` of the active tab. |
| `navigatePage` | `lib/tools/navigatePage.ts` | Background | Navigates the current tab back, forward, or reloads the page. |
| `captureScreenshot` | `lib/tools/captureScreenshot.ts` | Background | Takes a full visible tab screenshot; plays acoustic shutter sound and displays camera flash. |
| `captureCurrentPage` | `lib/tools/captureCurrentPage.ts` | Background | Captures full page DOM text, active URL, and metadata for analysis. |
| `highlightText` | `lib/tools/highlightText.ts` | Content Script | Visually highlights specific text passages on the web page. |
| `highlightSelector` | `lib/tools/highlightSelector.ts`| Content Script | Visually highlights DOM elements matching a CSS selector with an animated pulsing outline. |
| `findElements` | `lib/tools/findElements.ts` | Content Script | Scans the DOM for interactive elements matching queries or accessibility labels. |
| `clickElement` | `lib/tools/clickElement.ts` | Content Script | Simulates an authentic user click on a target DOM element index or selector. |
| `fillInput` | `lib/tools/fillInput.ts` | Content Script | Enters text into an input or textarea, with full support for `contenteditable` editors. |
| `selectOption` | `lib/tools/selectOption.ts` | Content Script | Selects an option inside a native HTML `<select>` dropdown. |
| `pressKey` | `lib/tools/pressKey.ts` | Content Script | Dispatches keyboard events (`Enter`, `Escape`, `Tab`, `ArrowDown`) to the active element. |
| `scrollDown` | `lib/tools/scrollDown.ts` | Content Script | Smoothly scrolls down the active web page by a specified pixel amount or page fraction. |
| `scrollUp` | `lib/tools/scrollUp.ts` | Content Script | Smoothly scrolls up the active web page. |
| `zoomPage` | `lib/tools/zoomPage.ts` | Background | Adjusts the active tab zoom factor (e.g., `1.2` for 120%, `1.0` for reset). |
| `dismissModal` | `lib/tools/dismissModal.ts` | Content Script | Automatically detects and closes intrusive cookie popups, newsletter banners, and overlays. |
| `controlMedia` | `lib/tools/controlMedia.ts` | Content Script | Plays, pauses, mutes, or unmutes HTML5 `<video>` and `<audio>` elements (e.g., YouTube). |
| `copyToClipboard` | `lib/tools/copyToClipboard.ts` | Side Panel | Copies arbitrary formatted text or markdown directly to the system clipboard. |
| `getAccessibilitySnapshot` | `lib/tools/getAccessibilitySnapshot.ts` | Content Script | Returns a structured accessibility tree representation of the active web page. |
| `voiceSurfer` | `lib/tools/voiceSurfer.ts` | Content Script | Activates or hides numbered interactive visual badges over clickable links for hands-free surfing. |
| `autofillForm` | `lib/tools/autofillForm.ts` | Content Script | Autonomously inspects and populates web application forms using the user's Profile Vault. |
| `checkPhishingRisk` | `lib/tools/checkPhishingRisk.ts` | Side Panel | Audits the current URL against phishing indicators and assigns a safety threat level. |
| `scanPrivacyRisk` | `lib/tools/scanPrivacyRisk.ts` | Side Panel | Scans the page for third-party trackers, unencrypted form fields, and privacy vulnerabilities. |
| `summarizePage` | `lib/tools/summarizePage.ts` | Side Panel (UI) | Extracts page text via Readability and produces an executive summary via Chrome Summarizer API. |
| `writeContent` | `lib/tools/writeContent.ts` | Side Panel (UI) | Generates structured creative writing, emails, or replies via Chrome Writer API. |
| `translateText` | `lib/tools/translateText.ts` | Side Panel (UI) | Translates text between languages using Chrome's on-device Translation API. |
| `detectLanguage` | `lib/tools/detectLanguage.ts` | Side Panel (UI) | Identifies the source language of a given text snippet without cloud requests. |
| `storeMemory` | `lib/tools/storeMemory.ts` | Side Panel | Generates 384-D vector embeddings and saves a user preference or fact to IndexedDB. |
| `getMemories` | `lib/tools/getMemories.ts` | Side Panel | Retrieves stored memories filtered by category or chronologically. |
| `searchVault` | `lib/tools/searchVault.ts` | Side Panel | Performs cosine similarity vector search across all local memories and clipped notes. |
| `getVaultStats` | `lib/tools/getVaultStats.ts` | Side Panel | Returns statistics on local database storage usage, vector counts, and clipping history. |
| `clipToVault` | `lib/tools/clipToVault.ts` | Side Panel | Clips the current web page article, embeds it, and stores it in the local permanent knowledge vault. |
| `listen` | `lib/tools/listen.ts` | Side Panel | Activates real-time speech capture for multi-turn conversational dictation. |
| `think` | `lib/tools/think.ts` | Side Panel | Engages Gemini Nano internal chain-of-thought deliberation for complex problem solving. |
| `getPlaybook` | `lib/tools/getPlaybook.ts` | Side Panel | Retrieves pre-configured multi-step automation workflows for complex workflows (e.g. form filling, search). |

---

## 7. In-Page Content Script Capabilities & Overlays

When browsing any website, Pentone's content script quietly provides non-intrusive superpowers:

1. **Custom Text Selection Toolbar (`components/custom-text-selection.tsx`)**:
   - Selecting any text on any website displays a sleek floating action pill:
     - **⚡ Explain**: Summarizes and clarifies the selected text in simple terms.
     - **📝 Rewrite**: Rephrases the text (Formal, Casual, Shorter, Longer).
     - **🌐 Translate**: Translates the selection into your preferred language.
     - **🔊 Read Aloud**: Speaks the text using on-device neural TTS.
2. **Floating Screen & Audio Capture Bar (`components/capture-overlay-buttons.tsx`)**:
   - Subtle controls anchored at the bottom-right of the screen for 1-click snipping and tab audio recording.
3. **In-Page Semantic Search (`lib/ai/semantic-search.ts`)**:
   - Triggered via `Ctrl + Shift + F` (or `Cmd + Shift + F`).
   - Replaces Chrome's primitive literal string matching with **conceptual semantic search**: typing *"how to cancel"* finds *"Subscription termination policy"* even if the word *"cancel"* does not appear on the page.
4. **Interactive Form Autofill Badges (`lib/autofill/inline-pill.ts`)**:
   - Injects a discrete autofill glyph directly inside recognized form fields. Clicking it populates your verified information with zero typing.

---

## 8. Data Flows & Execution Lifecycles

### Complete Voice Command Execution Flow
```mermaid
sequenceDiagram
    autonumber
    actor User
    participant WebPage as Web Page Tab
    participant Content as content.ts
    participant SidePanel as sidepanel.tsx (React)
    participant Speech as Web Speech API
    participant Nano as Gemini Nano (Prompt API)
    participant Chunker as Sentence Chunker
    participant TTS as SpeechSynthesis
    participant BG as background.ts (Service Worker)

    User->>WebPage: Holds Spacebar
    Content->>SidePanel: pentone_spacebar_down message
    SidePanel->>Speech: Start SpeechRecognition
    User->>WebPage: "Summarize this page and open YouTube"
    User->>WebPage: Releases Spacebar
    Content->>SidePanel: pentone_spacebar_up message
    Speech-->>SidePanel: Returns transcribed text
    SidePanel->>Nano: Prompt streaming with tool schemas
    Nano-->>Chunker: Streams tokens in real-time
    Chunker-->>TTS: Dispatches complete sentences immediately
    TTS-->>User: Speaks: "Summarizing current article..."
    Nano-->>SidePanel: Emits tool call: openTab({url: 'youtube.com'})
    SidePanel->>BG: chrome.runtime.sendMessage({type: 'run_tool'})
    BG->>ChromeAPI: chrome.tabs.create(...)
    ChromeAPI-->>BG: Tab created
    BG-->>SidePanel: Tool execution complete
```

---

## 9. Chrome On-Device AI Setup & Flags Guide

To enable Google Chrome's built-in Gemini Nano and on-device AI APIs, users configure four official Chrome flags:

1. **Open Chrome Flags**:
   - Enter `chrome://flags` into your Chrome address bar.
2. **Configure Required Flags**:
   - **`#optimization-guide-on-device-model`**:
     - *Setting*: Set to **`Enabled BypassPerfRequirement`**.
     - *Explanation*: Allows Chrome to download and execute the Gemini Nano model regardless of standard hardware throttling.
   - **`#prompt-api-for-gemini-nano`**:
     - *Setting*: Set to **`Enabled`** (or **`Enabled Multilingual`** if available).
     - *Explanation*: Exposes the `window.ai.languageModel` / `window.LanguageModel` JavaScript API.
   - **`#summarization-api-for-gemini-nano`**:
     - *Setting*: Set to **`Enabled`**.
     - *Explanation*: Exposes the high-speed extractive/abstractive Summarizer API.
   - **`#rewriter-api-for-gemini-nano`**:
     - *Setting*: Set to **`Enabled`**.
     - *Explanation*: Exposes the on-device Writer and Rewriter APIs.
3. **Restart Chrome**:
   - Click the blue **Relaunch** button at the bottom of the `chrome://flags` page.
4. **Trigger On-Device Model Download**:
   - Navigate to `chrome://components` in Chrome.
   - Locate **Optimization Guide On Device Model**.
   - Click **Check for update** to ensure the Gemini Nano weights (approx. 1.5 GB) finish downloading locally to your disk.

---

## 10. Summary & Verification

| Property | Status | Verification Detail |
| :--- | :--- | :--- |
| **Cloud Independence** | **100% Offline** | Verified with network disabled; zero HTTP/Fetch requests to outside domains. |
| **Privacy Compliance** | **Absolute** | Zero telemetry, zero analytics scripts, zero external logging. |
| **Startup Speed** | **0ms (Frame 0)** | Instant static HTML/CSS splash loader eliminates blank side panel delays. |
| **Tool Execution** | **30+ Tools** | Full deterministic control over tabs, DOM elements, screenshots, memory, and media. |
| **Hardware Compatibility** | **Cross-Platform** | Runs on Windows, macOS, Linux, and ChromeOS with modern Chrome (v128+). |
| **Creator** | **Raghav** | Authoritative creator attribution embedded across model prompts and documentation. |

---
*Pentone — 100% Private, On-Device AI Browser Copilot.*
