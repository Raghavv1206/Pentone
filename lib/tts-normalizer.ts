import nlp from 'compromise'
import numbersPlugin from 'compromise-numbers'

// Initialize compromise with numbers plugin
nlp.plugin(numbersPlugin)

/**
 * Phonetic respelling dictionary for proper nouns, creator names,
 * and technical terms so browser TTS synthesizers pronounce them naturally.
 */
export const PRONUNCIATION_LEXICON: Record<string, string> = {
  // Creator attribution (enforces natural Indian pronunciation [rɑːɡʱəʋ])
  'Raghav': 'Raaghav',
  'raghav': 'Raaghav',
  
  // Extension branding (prevents "pen-tony" or "pent-one")
  'Pentone': 'Pen-tone',
  'pentone': 'Pen-tone',
  
  // AI and technical terms
  'Gemini': 'Jem-ih-nye',
  'Wasm': 'Waz-um',
  'OAuth': 'Oh-Auth',
  'arXiv': 'Archive',
  'repo': 'ree-po',
  'repos': 'ree-pos',
  'regex': 'rej-ex',
  'GitHub': 'Git-Hub',
  'YouTube': 'You-Tube',
  'Hinglish': 'Hing-glish',
  'DevTools': 'Dev-Tools',
  'Kubernetes': 'Koo-ber-net-ees',
  'PostgreSQL': 'Post-gres-Q-L',
  'nginx': 'Engine-X',
  'sudo': 'soo-doo',
  'async': 'ay-sync',
  'boolean': 'bool-ee-an'
}

/**
 * Technical acronyms that should be hyphenated so TTS pronounces
 * individual letters clearly rather than mumbling them as single words.
 */
const ACRONYMS_TO_HYPHENATE = [
  'AI', 'URL', 'API', 'UI', 'UX', 'STT', 'TTS', 'LLM', 'VAD',
  'HTML', 'CSS', 'SDK', 'CLI', 'ID', 'OS', 'SQL', 'JSON', 'PDF',
  'FAQ', 'GUI', 'DOM', 'CSP', 'RAM', 'ROM', 'CPU', 'GPU', 'PR'
]

const ACRONYM_REGEX = new RegExp(`\\b(${ACRONYMS_TO_HYPHENATE.join('|')})\\b`, 'g')

/**
 * Expands common Latin, technical, and conversational abbreviations into spoken words.
 */
const ABBREVIATIONS: Record<string, string> = {
  'e.g.': 'for example',
  'e.g': 'for example',
  'i.e.': 'that is',
  'i.e': 'that is',
  'etc.': 'etcetera',
  'etc': 'etcetera',
  'vs.': 'versus',
  'vs': 'versus',
  'approx.': 'approximately',
  'approx': 'approximately',
  'w/o': 'without',
  'w/': 'with',
  'dept.': 'department',
  'min.': 'minutes',
  'sec.': 'seconds'
}

/**
 * Normalizes and formats raw LLM output or action status into clean,
 * naturally pronounceable spoken English for speech synthesis.
 */
export function normalizeForSpeech(rawText: string): string {
  if (!rawText || !rawText.trim()) return ''

  // 1. Strip markdown formatting and emojis
  let text = rawText
    .replace(/```[^`]*```/g, '') // Remove code blocks
    .replace(/`([^`]+)`/g, '$1') // Convert inline code to text
    .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold
    .replace(/\*(.*?)\*/g, '$1') // Remove italics/bullets
    .replace(/_{1,2}(.*?)_{1,2}/g, '$1') // Remove underscores
    .replace(/~{1,2}(.*?)~{1,2}/g, '$1') // Remove strikethrough
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // Convert [text](url) to text
    .replace(/^#{1,6}\s+/gm, '') // Remove markdown headers
    .replace(/^[\*\-\+]\s+/gm, '') // Remove bullet points at line starts
    .replace(/^\d+\.\s+/gm, '') // Remove numbered list markers at line starts
    .replace(/\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu, '') // Strip emojis

  // Hindi voices handle their own numbers and pronunciation; English NLP would
  // rewrite Hindi/mixed text into the wrong spoken language.
  // Replace Purna Viram (। and ॥) with period for natural breath pauses in TTS engines.
  if (/[\u0900-\u097f]/u.test(text)) {
    return text
      .replace(/[।॥]/g, '. ')
      .replace(/₹\s*(\d+(?:\.\d+)?)/g, '$1 rupees')
      .replace(/\s+/g, ' ')
      .trim()
  }

  // Non-Latin scripts (CJK, Arabic, Cyrillic) handle their own numbers and pronunciation.
  // Normalize full-width and regional punctuation into breath pauses for TTS engines.
  if (/[\u3040-\u30ff\u4e00-\u9fa5\uac00-\ud7af\u0600-\u06ff\u0400-\u04ff]/u.test(text)) {
    return text
      .replace(/[。]/g, '. ')
      .replace(/[、]/g, ', ')
      .replace(/[？]/g, '? ')
      .replace(/[！]/g, '! ')
      .replace(/[؟]/g, '? ')
      .replace(/[،]/g, ', ')
      .replace(/[।॥]/g, '. ')
      .replace(/¥\s*(\d+(?:\.\d+)?)/g, '$1 yen')
      .replace(/₩\s*(\d+(?:\.\d+)?)/g, '$1 won')
      .replace(/₽\s*(\d+(?:\.\d+)?)/g, '$1 rubles')
      .replace(/€\s*(\d+(?:\.\d+)?)/g, '$1 euros')
      .replace(/£\s*(\d+(?:\.\d+)?)/g, '$1 pounds')
      .replace(/\$\s*(\d+(?:\.\d+)?)/g, '$1 dollars')
      .replace(/\s+/g, ' ')
      .trim()
  }

  // 2. Normalize internal browser URLs & external links & emails
  text = text
    .replace(/chrome:\/\/extensions\/?/gi, 'Chrome extensions page')
    .replace(/chrome:\/\/settings\/?/gi, 'Chrome settings page')
    .replace(/chrome:\/\/flags\/?/gi, 'Chrome flags page')
    .replace(/chrome:\/\/downloads\/?/gi, 'Chrome downloads page')
    .replace(/chrome:\/\/history\/?/gi, 'Chrome history page')
    .replace(/([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, '$1 at $2')
    .replace(/https?:\/\/(?:www\.)?([a-zA-Z0-9.-]+)\/?[\w\-_./?%&=]*/gi, '$1')

  // 3. Expand currency symbols, percentages, and software versions
  text = text
    .replace(/₹\s*(\d+(?:\.\d+)?)/g, '$1 rupees')
    .replace(/\bRs\.?\s*(\d+(?:\.\d+)?)/gi, '$1 rupees')
    .replace(/\$\s*(\d+(?:\.\d+)?)/g, '$1 dollars')
    .replace(/€\s*(\d+(?:\.\d+)?)/g, '$1 euros')
    .replace(/£\s*(\d+(?:\.\d+)?)/g, '$1 pounds')
    .replace(/¥\s*(\d+(?:\.\d+)?)/g, '$1 yen')
    .replace(/₩\s*(\d+(?:\.\d+)?)/g, '$1 won')
    .replace(/₽\s*(\d+(?:\.\d+)?)/g, '$1 rubles')
    .replace(/(\d+(?:\.\d+)?)\s*%/g, '$1 percent')
    .replace(/\bv(\d+(?:\.\d+)+)\b/gi, 'version $1')

  // 4. Hyphenate uppercase acronyms so TTS utters each letter and compromise does not treat acronyms as Roman numerals (e.g. CLI -> zero)
  text = text.replace(ACRONYM_REGEX, (match) => {
    return match.split('').join('-')
  })

  // 5. Expand numbers and currency using compromise (for English only)
  // Non-English languages (Spanish, French, German, Italian, etc.) have native number pronunciation
  // and must never have English words ("fifty", "three") injected into them.
  const isForeignLanguage = /\b(?:hola|gracias|pestaña|pestañas|cerrar|cierra|bonjour|merci|onglet|onglets|hallo|danke|schließe|schließen|ciao|grazie|scheda|schede|olá|obrigado|aba|abas)\b/i.test(text)
  if (!isForeignLanguage) {
    try {
      const doc = nlp(text)
      // Convert numbers to spoken words (e.g. 50 -> fifty, 3.5 -> three point five)
      doc.numbers().toText()
      text = doc.text()
    } catch (err) {
      console.warn('[tts-normalizer] compromise numbers failed, fallback to raw text:', err)
    }
  }

  // 6. Expand common abbreviations cleanly (e.g. / i.e. / etc.)
  text = text
    .replace(/\be\.g\.,?\s*/gi, 'for example, ')
    .replace(/\be\.g\b/gi, 'for example')
    .replace(/\bi\.e\.,?\s*/gi, 'that is, ')
    .replace(/\bi\.e\b/gi, 'that is')
    .replace(/\betc\.,?\s*/gi, 'etcetera, ')
    .replace(/\betc\b/gi, 'etcetera')
    .replace(/\bvs\.,?\s*/gi, 'versus ')
    .replace(/\bvs\b/gi, 'versus ')
    .replace(/\bapprox\.,?\s*/gi, 'approximately ')
    .replace(/\bapprox\b/gi, 'approximately ')
    .replace(/\bw\/o\b/gi, 'without')
    .replace(/\bw\/\b/gi, 'with')
    .replace(/\bdept\.,?\s*/gi, 'department ')
    .replace(/\bdept\b/gi, 'department ')
    .replace(/\bmin\.,?\s*/gi, 'minutes ')
    .replace(/\bsec\.,?\s*/gi, 'seconds ')

  // 6. Apply phonetic respelling lexicon for proper nouns and domain branding
  for (const [word, phonetic] of Object.entries(PRONUNCIATION_LEXICON)) {
    const regex = new RegExp(`\\b${word}\\b`, 'g')
    text = text.replace(regex, phonetic)
  }

  // 7. Ensure vocal transition markers have comma pauses for natural prosody
  text = text.replace(/\b(First|Second|Third|Finally|Additionally|In summary|Overall)\s+(?![,\.])/g, '$1, ')

  // 8. Collapse whitespace and trim
  return text.replace(/\s+/g, ' ').trim()
}
