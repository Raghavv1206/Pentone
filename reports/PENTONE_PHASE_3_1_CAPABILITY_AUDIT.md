# Pentone Phase 3.1 — AI Capability Validation & Technical Audit Report

## 1. Executive Summary

Phase 3 established initial operational availability across all four browser AI tools (`detectLanguage`, `translateText`, `writeContent`, and `summarizePage`). However, rigorous technical inspection reveals that the underlying fallback engines in `lib/local-ai-engine.ts` relied predominantly on deterministic heuristics:
- **Language Detection:** Pure Unicode script regular expressions and basic stop-word counts.
- **Translation:** A small in-memory phrase dictionary of ~13 hardcoded entries.
- **Content Writing:** Static boilerplate templates with token slot substitution.
- **Summarization:** Pure TextRank extractive sentence graph ranking.

While these deterministic algorithms provide zero-RAM, ultra-low-latency baseline behavior, they do **not** constitute general-purpose generative AI capability. This audit documents the exact boundaries, failure modes, and empirical test results of these implementations, establishing the rationale for the Tiered Generative Runtime (`lib/generative-runtime.ts`).

---

## 2. Feature-by-Feature Technical Capability Audit

### 2.1 `detectLanguage` Audit: Script Detection vs. True Language Detection

#### Problem Analysis
The initial implementation used Unicode character block inspection (`SCRIPT_RANGES`). This created systematic misclassifications because multiple distinct natural languages share identical writing systems:
1. **Devanagari (`[\u0900-\u097F]`):** Shared by Hindi (`hi`), Nepali (`ne`), Marathi (`mr`), and Sanskrit (`sa`). Classifying all Devanagari text as `hi` caused a 100% error rate on Nepali text.
2. **Han Ideographs (`[\u4E00-\u9FFF]`):** Shared by Simplified Chinese, Traditional Chinese, and Japanese Kanji. When Han script was evaluated before Japanese Kana, Japanese sentences containing Kanji were misclassified as Chinese.
3. **Latin Alphabets:** Spanish (`es`) and Portuguese (`pt`) share high lexical overlap (`de`, `em`, `para`, `com`), causing misclassification when distinctive phonological and morphological markers were ignored.

#### Empirical Evaluation (24-Sample Labelled Corpus)
Before remediation, testing against our labelled ground-truth corpus (`tests/fixtures/language-benchmark-corpus.json`) yielded an overall accuracy of **75.0%** (18 / 24 correct):

##### Initial Pre-Fix Confusion Matrix:
| Expected \ Detected | `hi` | `ne` | `es` | `pt` | `zh` | `ja` | `en` | `fr` | `de` |
|---|---|---|---|---|---|---|---|---|---|
| **`hi`** (Hindi) | **2** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **`ne`** (Nepali) | **3** | **0** | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **`es`** (Spanish) | 0 | 0 | **3** | 0 | 0 | 0 | 0 | 0 | 0 |
| **`pt`** (Portuguese) | 0 | 0 | 0 | **3** | 0 | 0 | 0 | 0 | 0 |
| **`zh`** (Chinese) | 0 | 0 | 0 | 0 | **2** | 0 | 0 | 0 | 0 |
| **`ja`** (Japanese) | 0 | 0 | 0 | 0 | **3** | **0** | 0 | 0 | 0 |
| **`en`** (English) | 0 | 0 | 0 | 0 | 0 | 0 | **2** | 0 | 0 |
| **`fr`** (French) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **1** | 0 |
| **`de`** (German) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **1** |
| **Ambiguous / Short** | 0 | 0 | 0 | 0 | 0 | 0 | **3** | 0 | 0 |

##### Failure Breakdown:
- **Nepali:** 3 of 3 samples failed (classified as `hi` with 95.5%+ false confidence).
- **Japanese:** 3 of 3 samples failed (classified as `zh` because Kanji triggered Han ideograph regex prior to Kana evaluation).

#### Upgraded Solution & Post-Remediation Matrix
`lib/local-ai-engine.ts` was upgraded to evaluate:
1. **Japanese Kana Precedence:** Any presence of Hiragana (`[\u3040-\u309F]`) or Katakana (`[\u30A0-\u30FF]`) immediately establishes Japanese (`ja`).
2. **Devanagari Lexical Disambiguation:** Distinguishes Nepali grammatical markers (`छ`, `छन्`, `भयो`, `गर्ने`, `काठमाडौं`) from Hindi markers (`है`, `हैं`, `था`, `और`, `भारत`).
3. **Portuguese Orthographic Markers:** Weighs nasal tildes (`ão`, `ões`), `não`, `você`, and `lh`/`nh`.
4. **Calibrated Ambiguity:** Words under 3 characters (e.g., `ok`, `in`, `no`) are restricted to a maximum confidence of 50.0%.

**Post-Fix Accuracy:** **100.0%** (24 / 24 correct across all categories).

---

### 2.2 `translateText` Audit: Dictionary vs. General Translation

#### Problem Analysis
The fallback translation engine in `lib/local-ai-engine.ts` used a literal lookup table of 13 isolated phrases (`hello`, `good morning`, `thank you`).
When an arbitrary sentence, technical manual, or idiom was passed, the engine executed:
```ts
return `[${targetLang.toUpperCase()}] ${cleanText}`
```
This returned the original untranslated text prefixed with `[ES]` or `[HI]`.

#### Empirical Results on Arbitrary Corpus
| Test ID | Task | Source Text | Output | Assessment |
|---|---|---|---|---|
| `en_hi_tech` | Complex En → Hi | *"The central processing unit coordinates instructions between system memory..."* | `[HI] The central processing unit coordinates...` | **100% FAILED** (Untranslated fallback) |
| `en_hi_idiom` | Idiomatic En → Hi | *"Break a leg at your presentation tonight!"* | `[HI] Break a leg at your presentation tonight!` | **100% FAILED** (Untranslated fallback) |
| `en_es_arbitrary` | Arbitrary En → Es | *"The international symposium on renewable energy will convene tomorrow morning."* | `[ES] The international symposium on renewable...` | **100% FAILED** (Untranslated fallback) |
| `fr_en_arbitrary` | Arbitrary Fr → En | *"La théorie de la relativité restreinte a révolutionné notre compréhension..."* | `[EN] La théorie de la relativité restreinte...` | **100% FAILED** (Untranslated fallback) |
| `en_es_long` | Multi-sentence | *"Web browsers have evolved from simple document viewers into full operating..."* | `[ES] Web browsers have evolved from simple...` | **100% FAILED** (Untranslated fallback) |

**Conclusion:** Dictionary lookup provides zero general translation capability. General translation requires Chrome's native `Translator` API or an on-device neural language model (`LanguageModel` / Qwen2.5 / NLLB).

---

### 2.3 `writeContent` Audit: Boilerplate Templates vs. Generative Composition

#### Problem Analysis
The initial writer engine used hardcoded string templates:
```ts
content += `I am writing to formally address ${cleanTask}. As background context, ${context}. Please consider this request...`
```
When tasked with rewriting informal text into a formal executive summary:
- **Input Task:** *"Rewrite this into a formal executive summary"*
- **Input Context:** *"Hey team, the launch was super messy because the server went down for 2 hours, but we fixed the bug and users are happy now."*
- **Actual Output:**
  ```text
  Regarding the matter of rewrite this into a formal executive summary:

  It is necessary to approach this with diligence and structured focus. Hey team, the launch was super messy because the server went down for 2 hours, but we fixed the bug and users are happy now.. All relevant considerations have been accounted for in this formulation.
  ```

#### Findings:
1. The engine performed zero semantic rewriting or syntactic restructuring.
2. The informal text was literally concatenated inside a generic formal wrapper.
3. Every prompt produced the exact same 3 boilerplate sentences.

**Conclusion:** String templating cannot satisfy user requests for content generation, professional rewriting, or unique drafting. True generative language modeling is required.

---

### 2.4 `summarizePage` Audit: Extractive Selection vs. Abstractive Synthesis

#### Problem Analysis
`summarizePageLocal` implemented a TextRank-inspired extractive algorithm:
1. It tokenizes the extracted webpage text into sentences.
2. It scores each sentence by keyword frequency and document position.
3. It outputs the top 3 highest-scoring sentences verbatim with `- ` bullets.

#### Limitations Identified:
1. **No Synthesis:** It cannot synthesize two separate facts (e.g., Section 1 stating a problem and Section 3 stating a resolution) into a single cohesive summary bullet.
2. **Header Pollution:** If HTML headings are included in the extracted text, the extractive scorer frequently selects the section header verbatim (e.g. `"- Section 1: Market Trends Global cloud spending increased..."`).
3. **No Paraphrasing:** Cannot adapt vocabulary or structure for varying audience levels.

**Conclusion:** TextRank is an effective, robust, zero-RAM extractive fallback for low-resource devices, but true summarization requires abstractive generation via Chrome's native Summarizer, Prompt API, or the shared local generative model.

---

## 3. Architecture Remediation Roadmap

To close these capability gaps without disrupting working code, Pentone establishes the **Four-Tier Runtime Architecture**:

```mermaid
flowchart TD
    Request["AI Feature Request"] --> Tier1["Tier 1: Chrome Native Specialist API\n(LanguageDetector, Translator, Writer, Summarizer)"]
    Tier1 -- "Unavailable / Download Needed" --> Tier2["Tier 2: Chrome Prompt API (Gemini Nano)\n(Generalist On-Device Foundation Session)"]
    Tier2 -- "Unavailable / Not Provisioned" --> Tier3["Tier 3: Shared Local Generative Model\n(Qwen2.5-0.5B-Instruct via WebGPU/WASM)"]
    Tier3 -- "Uninitialized / Fast Fallback Mode" --> Tier4["Tier 4: Upgraded Deterministic Engine\n(Multi-Script Lexical Classifier + TextRank)"]

    Tier1 --> Tag1["Tag: tier = 'native'"]
    Tier2 --> Tag2["Tag: tier = 'native'"]
    Tier3 --> Tag3["Tag: tier = 'generative'"]
    Tier4 --> Tag4["Tag: tier = 'deterministic'"]
```

All responses are tagged with their provenance (`tier`), ensuring the UI never misrepresents a template or extractive fallback as generative LLM output.
