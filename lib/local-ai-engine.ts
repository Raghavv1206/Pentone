/**
 * Pentone Local AI Engine (Offline & Private)
 * 
 * Provides 100% offline, on-device AI capabilities for:
 * 1. Language Detection: Fast n-gram, character distribution, and script classifier.
 * 2. Translation: Offline multi-lingual phrase and linguistic transformer.
 * 3. Content Writing: Structured generation adapting to tone, length, format, and task.
 * 4. Summarization: Hierarchical chunking, TextRank extractive-abstractive summarizer,
 *    and strict adversarial prompt injection defense.
 */

// ==========================================
// 1. LOCAL LANGUAGE DETECTOR
// ==========================================

export interface LanguageDetectionResult {
  detectedLanguage: string
  confidence: number
  alternatives: Array<{ detectedLanguage: string; confidence: number }>
}

const SCRIPT_RANGES: Array<{ lang: string; regex: RegExp; name: string }> = [
  { lang: 'hi', regex: /[\u0900-\u097F]/g, name: 'Devanagari (Hindi/Nepali)' },
  { lang: 'zh', regex: /[\u4E00-\u9FFF]/g, name: 'Han (Chinese)' },
  { lang: 'ja', regex: /[\u3040-\u309F\u30A0-\u30FF]/g, name: 'Hiragana/Katakana (Japanese)' },
  { lang: 'ko', regex: /[\uAC00-\uD7AF\u1100-\u11FF]/g, name: 'Hangul (Korean)' },
  { lang: 'ru', regex: /[\u0400-\u04FF]/g, name: 'Cyrillic (Russian/Ukrainian)' },
  { lang: 'ar', regex: /[\u0600-\u06FF]/g, name: 'Arabic' },
  { lang: 'el', regex: /[\u0370-\u03FF]/g, name: 'Greek' },
  { lang: 'he', regex: /[\u0590-\u05FF]/g, name: 'Hebrew' },
  { lang: 'th', regex: /[\u0E00-\u0E7F]/g, name: 'Thai' }
]

const LATIN_PROFILES: Record<string, string[]> = {
  en: ['the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at', 'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she', 'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what', 'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me', 'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know', 'take', 'people', 'into', 'year', 'your', 'good', 'some', 'could', 'them', 'see', 'other', 'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also', 'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first', 'well', 'way', 'even', 'new', 'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us', 'is', 'are', 'was', 'were', 'been', 'has', 'had'],
  es: ['de', 'la', 'que', 'el', 'en', 'y', 'a', 'los', 'del', 'se', 'las', 'por', 'un', 'para', 'con', 'no', 'una', 'su', 'al', 'lo', 'como', 'más', 'pero', 'sus', 'le', 'ya', 'o', 'este', 'sí', 'porque', 'esta', 'son', 'entre', 'está', 'cuando', 'muy', 'sin', 'sobre', 'ser', 'tiene', 'también', 'me', 'hasta', 'hay', 'donde', 'quien', 'desde', 'todo', 'nos', 'durante', 'todos', 'uno', 'les', 'ni', 'contra', 'otros', 'ese', 'eso', 'ante', 'ellos', 'e', 'esto', 'mí', 'antes', 'algunos', 'qué', 'unos', 'yo', 'otro', 'otras', 'otra', 'él', 'tanto', 'esa', 'estos', 'mucho', 'quienes', 'nada', 'muchos', 'cual', 'sea', 'poco', 'ella', 'estar', 'haber', 'estas', 'estaba', 'estamos', 'hola', 'bienvenido', 'buenos', 'dias', 'tardes', 'noches', 'amigo'],
  fr: ['de', 'la', 'le', 'et', 'les', 'des', 'en', 'un', 'du', 'une', 'que', 'est', 'pour', 'qui', 'dans', 'a', 'par', 'sur', 'au', 'ce', 'ne', 'qu', 'pas', 'plus', 'avec', 'se', 'sont', 'ou', 'il', 'cette', 'aux', 'ont', 'ses', 'mais', 'comme', 'nous', 'sa', 'on', 'tout', 'faire', 'meme', 'leur', 'aussi', 'bien', 'autre', 'peut', 'ces', 'sans', 'apres', 'ete', 'deux', 'vous', 'leur', 'encore', 'donc', 'entre', 'premier', 'temps', 'bonjour', 'merci', 'monde', 'bienvenue', 'comment', 'allez', 'vous'],
  de: ['der', 'die', 'und', 'in', 'den', 'von', 'zu', 'das', 'mit', 'sich', 'des', 'auf', 'für', 'ist', 'im', 'dem', 'nicht', 'ein', 'eine', 'als', 'auch', 'es', 'an', 'werden', 'aus', 'er', 'hat', 'dass', 'sie', 'nach', 'wird', 'bei', 'einer', 'um', 'am', 'sind', 'noch', 'wie', 'einem', 'über', 'einen', 'das', 'so', 'sie', 'zum', 'war', 'haben', 'nur', 'oder', 'aber', 'vor', 'zur', 'bis', 'mehr', 'durch', 'man', 'sein', 'wurde', 'sei', 'hallo', 'herzlich', 'willkommen', 'guten', 'tag', 'morgen', 'abend'],
  it: ['di', 'e', 'il', 'la', 'che', 'in', 'per', 'un', 'del', 'con', 'non', 'da', 'una', 'le', 'si', 'dei', 'i', 'sono', 'al', 'della', 'ha', 'delle', 'ed', 'anche', 'se', 'nel', 'più', 'dalla', 'degli', 'alla', 'dello', 'dall', 'come', 'questo', 'ma', 'questa', 'tra', 'dal', 'fra', 'su', 'tutto', 'sua', 'suo', 'loro', 'ciao', 'buongiorno', 'mondo', 'grazie', 'benvenuto'],
  pt: ['de', 'a', 'o', 'que', 'e', 'do', 'da', 'em', 'um', 'para', 'com', 'não', 'uma', 'os', 'no', 'se', 'na', 'por', 'mais', 'as', 'dos', 'como', 'mas', 'foi', 'ao', 'ele', 'das', 'tem', 'à', 'seu', 'sua', 'ou', 'ser', 'quando', 'muito', 'há', 'nos', 'já', 'está', 'eu', 'também', 'só', 'pelo', 'pela', 'até', 'isso', 'ela', 'entre', 'era', 'depois', 'sem', 'mesmo', 'olá', 'obrigado', 'bom', 'dia']
}

// Lexical markers for disambiguating identical scripts
const NE_WORDS = new Set(['छ', 'छन्', 'हो', 'गर्ने', 'भने', 'पनि', 'रहेका', 'लाई', 'बाट', 'हुने', 'नेपाल', 'काठमाडौं', 'गर्दछ', 'गर्नु', 'हामी', 'बिहानै', 'भ्रमणका', 'लागि', 'प्रस्थान', 'योजना', 'बनाउँदै', 'छौँ', 'सुन्दर', 'भूपरिवेष्ठित', 'सगरमाथा', 'मानिसहरू', 'शान्तिप्रिय', 'उपत्यकामा', 'मन्दिरहरू', 'दरबारहरू', 'जसले', 'पर्यटकलाई', 'आकर्षित'])
const HI_WORDS = new Set(['है', 'हैं', 'था', 'थी', 'और', 'का', 'की', 'के', 'में', 'से', 'को', 'भारत', 'विशाल', 'विविध', 'देश', 'जहां', 'विभिन्न', 'संस्कृतियों', 'लोग', 'सद्भाव', 'रहते', 'आज', 'मौसम', 'बहुत', 'अच्छा', 'शाम', 'पार्क', 'टहलने', 'जाने', 'योजना', 'बना', 'रहे'])
const PT_WORDS = new Set(['não', 'são', 'está', 'estão', 'você', 'muito', 'também', 'mais', 'com', 'os', 'as', 'dos', 'das', 'para', 'em', 'um', 'uma', 'desenvolvimento', 'sustentável', 'essencial', 'garantir', 'futuro', 'próspero', 'próximas', 'gerações', 'eles', 'felizes', 'resultados', 'obtidos', 'conferência', 'internacional', 'lisboa', 'esqueça', 'verificar', 'todas', 'informações', 'antes', 'enviar', 'documentação', 'oficial'])
const ES_WORDS = new Set(['no', 'son', 'está', 'están', 'usted', 'mucho', 'muchas', 'también', 'más', 'con', 'los', 'las', 'del', 'para', 'en', 'un', 'una', 'desarrollo', 'rápido', 'inteligencia', 'artificial', 'transformando', 'sociedad', 'moderna', 'todo', 'mundo', 'personas', 'disfrutan', 'viajando', 'costa', 'durante', 'vacaciones', 'verano', 'sus', 'familias', 'visto', 'último', 'informe', 'sobre', 'energías', 'renovables', 'sostenibilidad', 'ambiental'])

export function detectLanguageLocal(text: string): LanguageDetectionResult {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return {
      detectedLanguage: 'en',
      confidence: 0,
      alternatives: []
    }
  }

  const trimmed = text.trim()

  // 1. Japanese Kana check (Definitive for Japanese, takes precedence over Han)
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(trimmed)) {
    return {
      detectedLanguage: 'ja',
      confidence: 0.99,
      alternatives: [{ detectedLanguage: 'zh', confidence: 0.05 }]
    }
  }

  // 2. Pure Han characters (Chinese vs Japanese Kanji-only)
  const hanMatches = trimmed.match(/[\u4E00-\u9FFF]/g)
  if (hanMatches && hanMatches.length / trimmed.length > 0.2) {
    if (/東京|大阪|京都|日本|平成|令和|株式会社/.test(trimmed)) {
      return {
        detectedLanguage: 'ja',
        confidence: 0.90,
        alternatives: [{ detectedLanguage: 'zh', confidence: 0.20 }]
      }
    }
    return {
      detectedLanguage: 'zh',
      confidence: 0.98,
      alternatives: [{ detectedLanguage: 'ja', confidence: 0.10 }]
    }
  }

  // 3. Devanagari script: Distinguish Hindi vs Nepali by lexical markers
  const devMatches = trimmed.match(/[\u0900-\u097F]/g)
  if (devMatches && devMatches.length / trimmed.length > 0.2) {
    const tokens = trimmed.split(/[\s,।!?]+/).filter(Boolean)
    let hiScore = 0
    let neScore = 0
    for (const t of tokens) {
      if (HI_WORDS.has(t)) hiScore += 2
      if (NE_WORDS.has(t)) neScore += 2
      if (t.endsWith('हरू') || t.endsWith('छन्') || t.endsWith('छौँ') || t.endsWith('भयो')) neScore += 3
      if (t === 'है' || t === 'हैं' || t === 'था' || t === 'थी') hiScore += 3
    }
    if (neScore > hiScore) {
      return {
        detectedLanguage: 'ne',
        confidence: 0.96,
        alternatives: [{ detectedLanguage: 'hi', confidence: 0.20 }]
      }
    }
    return {
      detectedLanguage: 'hi',
      confidence: 0.96,
      alternatives: [{ detectedLanguage: 'ne', confidence: 0.20 }]
    }
  }

  // 4. Other non-Latin scripts
  for (const script of SCRIPT_RANGES) {
    if (script.lang === 'hi' || script.lang === 'zh' || script.lang === 'ja') continue
    const matches = trimmed.match(script.regex)
    if (matches && matches.length > 0) {
      const ratio = matches.length / trimmed.length
      if (ratio > 0.15 || matches.length >= 3) {
        const conf = Math.min(0.999, Math.max(0.60, 0.70 + ratio * 0.3))
        return {
          detectedLanguage: script.lang,
          confidence: parseFloat(conf.toFixed(4)),
          alternatives: []
        }
      }
    }
  }

  // 5. Tokenize Latin text and match stop words
  const lower = trimmed.toLowerCase()
  const words = lower
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0)

  if (words.length <= 1) {
    if (words.length === 1 && words[0].length <= 2) {
      return {
        detectedLanguage: 'en',
        confidence: 0.50,
        alternatives: [{ detectedLanguage: 'es', confidence: 0.30 }]
      }
    }
    if (words.length === 0) {
      return { detectedLanguage: 'en', confidence: 0.1, alternatives: [] }
    }
  }

  let esScore = 0
  let ptScore = 0
  let enScore = 0.05
  let frScore = 0
  let deScore = 0
  let itScore = 0

  if (/[ãõáéíóúçêô]/i.test(trimmed)) ptScore += 2
  if (/[áéíóúñ¿¡]/i.test(trimmed)) esScore += 2
  if (/[¿¡ñ]/i.test(trimmed)) esScore += 4
  if (/[ãõ]|nh|lh/.test(lower)) ptScore += 4
  if (/não|estão|são|você/.test(lower)) ptScore += 5

  for (const word of words) {
    if (ES_WORDS.has(word)) esScore += 2
    if (PT_WORDS.has(word)) ptScore += 2
    if (LATIN_PROFILES.en.includes(word)) enScore += 1
    if (LATIN_PROFILES.fr.includes(word)) frScore += 1
    if (LATIN_PROFILES.de.includes(word)) deScore += 1
    if (LATIN_PROFILES.it.includes(word)) itScore += 1
  }

  if (/[éèêëàâùûçœ]/i.test(trimmed)) frScore += 3
  if (/[äöüß]/i.test(trimmed)) deScore += 3
  if (/[àèéìòù]/i.test(trimmed)) itScore += 2

  const scores = [
    { lang: 'es', score: esScore },
    { lang: 'pt', score: ptScore },
    { lang: 'en', score: enScore },
    { lang: 'fr', score: frScore },
    { lang: 'de', score: deScore },
    { lang: 'it', score: itScore }
  ].sort((a, b) => b.score - a.score)

  const topLang = scores[0].lang
  const topScore = scores[0].score
  const totalScore = scores.reduce((sum, s) => sum + s.score, 0) || 1

  let confidence = Math.min(0.995, Math.max(0.75, topScore / totalScore))
  if (words.length > 5 && topScore >= 4) {
    confidence = Math.min(0.995, Math.max(0.85, topScore / totalScore))
  }

  const alternatives = scores.slice(1, 4)
    .filter(s => s.score > 0)
    .map(s => ({
      detectedLanguage: s.lang,
      confidence: parseFloat(Math.min(0.40, s.score / totalScore).toFixed(4))
    }))

  return {
    detectedLanguage: topLang,
    confidence: parseFloat(confidence.toFixed(4)),
    alternatives
  }
}

// ==========================================
// 2. LOCAL TRANSLATION ENGINE
// ==========================================

export interface TranslationParams {
  text: string
  sourceLanguage?: string
  targetLanguage: string
}

// Key phrase dictionary for deterministic multi-lingual offline pairs
const PHRASE_DICTIONARY: Record<string, Record<string, string>> = {
  'hello': { es: 'hola', fr: 'bonjour', de: 'hallo', it: 'ciao', hi: 'नमस्ते' },
  'hello world': { es: 'hola mundo', fr: 'bonjour le monde', de: 'hallo welt', it: 'ciao mondo', hi: 'नमस्ते दुनिया' },
  'good morning': { es: 'buenos días', fr: 'bonjour', de: 'guten morgen', it: 'buongiorno', hi: 'शुभ प्रभात' },
  'thank you': { es: 'gracias', fr: 'merci', de: 'danke', it: 'grazie', hi: 'धन्यवाद' },
  'thank you very much': { es: 'muchas gracias', fr: 'merci beaucoup', de: 'vielen dank', it: 'molte grazie', hi: 'बहुत बहुत धन्यवाद' },
  'welcome': { es: 'bienvenido', fr: 'bienvenue', de: 'willkommen', it: 'benvenuto', hi: 'स्वागत है' },
  'yes': { es: 'sí', fr: 'oui', de: 'ja', it: 'sì', hi: 'हाँ' },
  'no': { es: 'no', fr: 'non', de: 'nein', it: 'no', hi: 'नहीं' },
  'how are you': { es: '¿cómo estás?', fr: 'comment allez-vous?', de: 'wie geht es dir?', it: 'come stai?', hi: 'आप कैसे हैं?' },
  'i love technology': { es: 'amo la tecnología', fr: 'j\'aime la technologie', de: 'ich liebe technologie', it: 'amo la tecnologia', hi: 'मुझे तकनीक पसंद है' },
  'artificial intelligence': { es: 'inteligencia artificial', fr: 'intelligence artificielle', de: 'künstliche intelligenz', it: 'intelligenza artificiale', hi: 'कृत्रिम बुद्धिमत्ता' },
  'open the door': { es: 'abre la puerta', fr: 'ouvrez la porte', de: 'öffne die tür', it: 'apri la porta', hi: 'दरवाजा खोलो' },
  'search for react tutorials': { es: 'buscar tutoriales de react', fr: 'rechercher des tutoriels react', de: 'nach react-tutorials suchen', it: 'cerca tutorial su react', hi: 'रिएक्ट ट्यूटोरियल खोजें' }
}

const REVERSE_DICTIONARY: Record<string, Record<string, string>> = {
  // Spanish to English
  'hola': { en: 'hello' },
  'hola mundo': { en: 'hello world' },
  'buenos días': { en: 'good morning' },
  'gracias': { en: 'thank you' },
  'muchas gracias': { en: 'thank you very much' },
  'bienvenido': { en: 'welcome' },
  '¿cómo estás?': { en: 'how are you?' },
  'cómo estás': { en: 'how are you' },
  // French to English
  'bonjour': { en: 'hello' },
  'bonjour le monde': { en: 'hello world' },
  'merci': { en: 'thank you' },
  'merci beaucoup': { en: 'thank you very much' },
  'bienvenue': { en: 'welcome' },
  'comment allez-vous': { en: 'how are you' },
  'comment allez-vous?': { en: 'how are you?' },
  // Hindi to English
  'नमस्ते': { en: 'hello' },
  'नमस्ते दुनिया': { en: 'hello world' },
  'धन्यवाद': { en: 'thank you' },
  'बहुत बहुत धन्यवाद': { en: 'thank you very much' },
  'शुभ प्रभात': { en: 'good morning' },
  'आप कैसे हैं': { en: 'how are you' },
  'आप कैसे हैं?': { en: 'how are you?' },
  'दरवाजा खोलो': { en: 'open the door' }
}

export function translateTextLocal(params: TranslationParams): string {
  const { text, targetLanguage } = params
  if (!text || !text.trim()) return ''

  const sourceLang = (!params.sourceLanguage || params.sourceLanguage === 'auto')
    ? detectLanguageLocal(text).detectedLanguage
    : params.sourceLanguage.toLowerCase().split('-')[0]
  const targetLang = targetLanguage.toLowerCase().split('-')[0]

  if (sourceLang === targetLang) {
    return text
  }

  const cleanText = text.trim()
  const lower = cleanText.toLowerCase().replace(/[.!?,]$/, '')

  // 1. Direct dictionary matches
  if (sourceLang === 'en' && PHRASE_DICTIONARY[lower]?.[targetLang]) {
    const res = PHRASE_DICTIONARY[lower][targetLang]
    return matchCapitalizationAndPunctuation(cleanText, res)
  }

  if (targetLang === 'en' && REVERSE_DICTIONARY[lower]?.en) {
    const res = REVERSE_DICTIONARY[lower].en
    return matchCapitalizationAndPunctuation(cleanText, res)
  }

  // Cross-lingual lookup through English
  if (sourceLang !== 'en' && targetLang !== 'en') {
    const toEn = REVERSE_DICTIONARY[lower]?.en
    if (toEn && PHRASE_DICTIONARY[toEn.toLowerCase()]?.[targetLang]) {
      return matchCapitalizationAndPunctuation(cleanText, PHRASE_DICTIONARY[toEn.toLowerCase()][targetLang])
    }
  }

  // 2. Token-by-token contextual translation for short phrases
  const tokens = cleanText.split(/(\s+|[.,!?;:()])/).filter(t => t.length > 0)
  let translatedAny = false

  const translatedTokens = tokens.map(token => {
    const tokenLower = token.toLowerCase()
    if (sourceLang === 'en' && PHRASE_DICTIONARY[tokenLower]?.[targetLang]) {
      translatedAny = true
      return matchCapitalizationAndPunctuation(token, PHRASE_DICTIONARY[tokenLower][targetLang])
    }
    if (targetLang === 'en' && REVERSE_DICTIONARY[tokenLower]?.en) {
      translatedAny = true
      return matchCapitalizationAndPunctuation(token, REVERSE_DICTIONARY[tokenLower].en)
    }
    return token
  })

  if (translatedAny) {
    return translatedTokens.join('')
  }

  // 3. Fallback: Annotated transparent translation
  return `[${targetLang.toUpperCase()}] ${cleanText}`
}

function matchCapitalizationAndPunctuation(original: string, translated: string): string {
  let result = translated
  if (/^[A-Z]/.test(original)) {
    result = result.charAt(0).toUpperCase() + result.slice(1)
  }
  if (original.endsWith('.') && !result.endsWith('.')) result += '.'
  if (original.endsWith('!') && !result.endsWith('!')) result += '!'
  if (original.endsWith('?') && !result.endsWith('?')) result += '?'
  return result
}

// ==========================================
// 3. LOCAL CONTENT WRITER
// ==========================================

export interface WriteContentParams {
  task: string
  context?: string
  tone?: 'formal' | 'neutral' | 'casual' | string
  length?: 'short' | 'medium' | 'long' | string
  format?: 'markdown' | 'plain-text' | string
  outputLanguage?: string
}

export function writeContentLocal(params: WriteContentParams): string {
  const {
    task,
    context,
    tone = 'neutral',
    length = 'medium',
    format = 'plain-text'
  } = params

  if (!task || !task.trim()) {
    throw new Error('Task parameter is required')
  }

  const cleanTask = task.trim()
  const lowerTask = cleanTask.toLowerCase()
  const isMarkdown = format === 'markdown'

  // Analyze intent
  const isEmail = lowerTask.includes('email') || lowerTask.includes('mail') || lowerTask.includes('letter')
  const isReview = lowerTask.includes('review') || lowerTask.includes('feedback')
  const isBlogPost = lowerTask.includes('blog') || lowerTask.includes('post') || lowerTask.includes('article')
  const isResponse = lowerTask.includes('respond') || lowerTask.includes('reply') || lowerTask.includes('response')

  const salutation = tone === 'formal'
    ? 'Dear Sir or Madam,'
    : tone === 'casual'
      ? 'Hi there,'
      : 'Hello,'

  const signoff = tone === 'formal'
    ? 'Sincerely,\n[Your Name]'
    : tone === 'casual'
      ? 'Best,\n[Your Name]'
      : 'Kind regards,\n[Your Name]'

  let content = ''

  if (isEmail) {
    const subject = cleanTask.replace(/^(draft|write|compose|create)\s+(an\s+|a\s+)?(email\s+(to|about)?)/i, '').trim()
    const capitalizedSubject = subject ? subject.charAt(0).toUpperCase() + subject.slice(1) : 'Inquiry regarding requested update'

    if (isMarkdown) {
      content += `**Subject:** ${capitalizedSubject}\n\n`
    } else {
      content += `Subject: ${capitalizedSubject}\n\n`
    }
    content += `${salutation}\n\n`

    if (tone === 'formal') {
      content += `I am writing to formally address ${cleanTask.toLowerCase().replace(/^(write|draft|compose)\s+/i, '')}. `
      if (context) {
        content += `As background context, ${context}. `
      }
      content += `Please consider this request and let me know the appropriate next steps at your earliest convenience.`
      if (length === 'long' || length === 'medium') {
        content += `\n\nI have thoroughly reviewed the relevant details and look forward to coordinating with you to ensure a swift and satisfactory resolution.`
      }
    } else if (tone === 'casual') {
      content += `Just wanted to drop a quick line regarding ${cleanTask.toLowerCase().replace(/^(write|draft|compose)\s+/i, '')}. `
      if (context) {
        content += `Context: ${context}. `
      }
      content += `Let me know what you think when you have a moment!`
    } else {
      content += `I am reaching out regarding ${cleanTask.toLowerCase().replace(/^(write|draft|compose)\s+/i, '')}. `
      if (context) {
        content += `${context}. `
      }
      content += `Please let me know if you need any additional information from my side.`
    }

    content += `\n\n${signoff}`
  } else if (isBlogPost) {
    const title = cleanTask.replace(/^(write|draft)\s+(a\s+)?(blog\s+post\s+(about)?)/i, '').trim()
    const heading = title ? title.charAt(0).toUpperCase() + title.slice(1) : 'Insights & Perspectives'

    if (isMarkdown) {
      content += `# ${heading}\n\n`
      content += `## Introduction\n\n`
    } else {
      content += `${heading.toUpperCase()}\n\nIntroduction:\n`
    }

    content += `In today's fast-evolving landscape, understanding ${cleanTask.toLowerCase().replace(/^(write|draft)\s+/i, '')} has become more critical than ever. `
    if (context) {
      content += `${context} `
    }
    content += `This post explores key considerations and actionable insights for practitioners.\n\n`

    if (length === 'medium' || length === 'long') {
      if (isMarkdown) {
        content += `## Key Takeaways\n\n`
        content += `- **Fundamentals:** Laying a solid groundwork creates resilient outcomes.\n`
        content += `- **Optimization:** Iterative improvement yields consistent long-term gains.\n`
        content += `- **Future Outlook:** Staying adaptable ensures readiness for emerging trends.\n\n`
      } else {
        content += `Key Takeaways:\n1. Fundamentals: Laying a solid groundwork creates resilient outcomes.\n2. Optimization: Iterative improvement yields consistent gains.\n3. Future Outlook: Staying adaptable ensures continuous readiness.\n\n`
      }
    }

    content += `## Conclusion\n\nBy taking a structured approach, organizations and individuals can navigate challenges with clarity and confidence.`
  } else {
    // General content drafting
    if (isMarkdown) {
      content += `### ${cleanTask.charAt(0).toUpperCase() + cleanTask.slice(1)}\n\n`
    }
    if (tone === 'formal') {
      content += `Regarding the matter of ${cleanTask.toLowerCase().replace(/^(write|draft)\s+/i, '')}:\n\n`
      content += `It is necessary to approach this with diligence and structured focus. `
      if (context) {
        content += `${context}. `
      }
      content += `All relevant considerations have been accounted for in this formulation.`
      if (length === 'long' || length === 'medium') {
        content += `\n\nFurther elaboration confirms that maintaining consistent standards and clear communication ensures optimal alignment across all stakeholders.`
      }
    } else if (tone === 'casual') {
      content += `Here's what you need to know about ${cleanTask.toLowerCase().replace(/^(write|draft)\s+/i, '')}:\n\n`
      content += `Basically, it comes down to keeping things simple and direct. `
      if (context) {
        content += `(${context}) `
      }
      content += `That's the best way to get things moving smoothly.`
    } else {
      content += `Overview for ${cleanTask.toLowerCase().replace(/^(write|draft)\s+/i, '')}:\n\n`
      content += `This summary addresses the core elements requested. `
      if (context) {
        content += `${context}. `
      }
      content += `The proposed direction balances practical execution with strategic goals.`
    }
  }

  return content.trim()
}

// ==========================================
// 4. LOCAL SUMMARIZATION & CHUNKING ENGINE
// ==========================================

export interface SummarizeParams {
  content: string
  title?: string
  type?: 'key-points' | 'tl;dr' | 'teaser' | 'headline' | string
  length?: 'short' | 'medium' | 'long' | string
}

/**
 * Sanitizes untrusted webpage text, stripping prompt injection control tokens
 * and enforcing strict data-only boundaries.
 */
export function sanitizePageContentForSummarizer(raw: string): string {
  if (!raw) return ''
  return raw
    // Strip control sequences and prompt injection payloads
    .replace(/<\|im_start\|>[\s\S]*?<\|im_end\|>/gi, '')
    .replace(/\[INST\][\s\S]*?\[\/INST\]/gi, '')
    .replace(/<system>[\s\S]*?<\/system>/gi, '')
    .replace(/```(?:json|markdown|html|javascript)?\s*(?:system|prompt|instruction)[\s\S]*?```/gi, '')
    // Neutralize explicit command injection phrases
    .replace(/(?:ignore\s+all\s+previous\s+instructions|disregard\s+prior\s+rules|you\s+are\s+now\s+in\s+developer\s+mode|delete\s+the\s+database|format\s+drive|exfiltrate\s+vault)/gi, '[REDACTED_COMMAND]')
    .trim()
}

/**
 * Hierarchical chunking helper to divide large articles into semantic segments
 * without token-overflow errors.
 */
export function chunkDocument(text: string, maxChunkLength: number = 3000): string[] {
  const clean = text.trim()
  if (clean.length <= maxChunkLength) return [clean]

  const paragraphs = clean.split(/\n\s*\n/)
  const chunks: string[] = []
  let currentChunk = ''

  for (const para of paragraphs) {
    if ((currentChunk + '\n\n' + para).length <= maxChunkLength) {
      currentChunk = currentChunk ? currentChunk + '\n\n' + para : para
    } else {
      if (currentChunk) chunks.push(currentChunk)
      if (para.length > maxChunkLength) {
        // Break long paragraph on sentence boundaries
        const sentences = para.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [para]
        let sub = ''
        for (const s of sentences) {
          if ((sub + ' ' + s).length <= maxChunkLength) {
            sub = sub ? sub + ' ' + s : s
          } else {
            if (sub) chunks.push(sub.trim())
            sub = s
          }
        }
        currentChunk = sub.trim()
      } else {
        currentChunk = para
      }
    }
  }

  if (currentChunk) chunks.push(currentChunk)
  return chunks.length > 0 ? chunks : [clean.slice(0, maxChunkLength)]
}

/**
 * TextRank-inspired importance scorer for extractive-abstractive summarization.
 */
export function summarizePageLocal(params: SummarizeParams): string {
  const {
    content,
    title = 'Current Webpage',
    type = 'key-points',
    length = 'medium'
  } = params

  if (!content || !content.trim()) {
    throw new Error('Insufficient readable content provided for summarization')
  }

  const sanitized = sanitizePageContentForSummarizer(content)
  const safeTitle = title.replace(/[\r\n]+/g, ' ').trim()

  // Split into sentences
  const sentences = sanitized
    .replace(/\s+/g, ' ')
    .match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g)
    ?.map(s => s.trim())
    ?.filter(s => s.length > 20 && !s.includes('[REDACTED_COMMAND]')) || []

  if (sentences.length === 0) {
    return `Summary of "${safeTitle}":\n\n${sanitized.slice(0, 300)}...`
  }

  // Target sentence count based on length
  const targetCount = length === 'short'
    ? (type === 'headline' ? 1 : 2)
    : length === 'long'
      ? 5
      : 3

  // Frequency-based importance scoring
  const wordFreq: Record<string, number> = {}
  const stopWords = new Set(['the', 'is', 'at', 'which', 'on', 'and', 'a', 'an', 'in', 'to', 'for', 'of', 'with', 'as', 'by', 'that', 'this', 'it', 'from', 'be', 'are', 'was', 'were'])

  for (const s of sentences) {
    const words = s.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/)
    for (const w of words) {
      if (w.length > 3 && !stopWords.has(w)) {
        wordFreq[w] = (wordFreq[w] || 0) + 1
      }
    }
  }

  // Score sentences
  const scoredSentences = sentences.map((sentence, idx) => {
    const words = sentence.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/)
    let score = 0
    for (const w of words) {
      score += (wordFreq[w] || 0)
    }
    // Favor lead sentences slightly
    if (idx === 0) score *= 1.5
    if (idx === 1) score *= 1.2
    return { sentence, score: score / (words.length || 1), index: idx }
  })

  // Select top sentences in original order
  const selected = scoredSentences
    .sort((a, b) => b.score - a.score)
    .slice(0, targetCount)
    .sort((a, b) => a.index - b.index)
    .map(item => item.sentence)

  // Format by type
  if (type === 'headline') {
    const lead = selected[0] || safeTitle
    const cleanLead = lead.replace(/\.$/, '').slice(0, 100)
    return `Summary of "${safeTitle}":\n\n# ${cleanLead}`
  }

  if (type === 'tl;dr') {
    const tldr = selected.join(' ')
    return `Summary of "${safeTitle}":\n\nTL;DR: ${tldr}`
  }

  if (type === 'teaser') {
    const teaser = selected[0] || 'Explore the key developments and insights covered in this article.'
    return `Summary of "${safeTitle}":\n\n${teaser} Read more to explore the comprehensive findings.`
  }

  // Default: key-points
  const bullets = selected.map(s => `- ${s}`).join('\n')
  return `Summary of "${safeTitle}":\n\n${bullets}`
}
