/**
 * Intelligent Voice Selector for Web Speech Synthesis & Recognition
 * 
 * Automatically prioritizes high-fidelity Natural/Online neural voices over
 * legacy robotic desktop voices (e.g. Microsoft David Desktop SAPI5), and
 * dynamically biases toward Indian English (en-IN) when appropriate.
 */

export function isIndianLocale(): boolean {
  try {
    if (new Date().getTimezoneOffset() === -330) {
      return true
    }
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
    if (timeZone.includes('Calcutta') || timeZone.includes('Kolkata') || timeZone.includes('Asia/Colombo') || timeZone.toLowerCase().includes('india')) {
      return true
    }
    const userLanguages = typeof navigator !== 'undefined' ? (navigator.languages || [navigator.language]) : []
    return userLanguages.some(l => l.toLowerCase().includes('en-in') || l.toLowerCase().includes('hi-in') || l.toLowerCase().startsWith('hi'))
  } catch {
    return false
  }
}

/**
 * Returns the recommended ASR recognition locale.
 * For Indian users in Auto mode, defaults to 'en-IN' (Indian English) which transcribes in Latin script,
 * accurately capturing both English and Romanized Hinglish speech without forcing Devanagari output.
 * For global users, respects their preferred browser language.
 */
export function getRecommendedSpeechLocale(): string {
  try {
    if (typeof navigator !== 'undefined') {
      const userLanguages = navigator.languages || [navigator.language]
      for (const lang of userLanguages) {
        if (!lang) continue
        const lower = lang.toLowerCase()
        if (lower.startsWith('es')) return 'es-ES'
        if (lower.startsWith('fr')) return 'fr-FR'
        if (lower.startsWith('de')) return 'de-DE'
        if (lower.startsWith('it')) return 'it-IT'
        if (lower.startsWith('pt')) return 'pt-BR'
        if (lower.startsWith('ja')) return 'ja-JP'
        if (lower.startsWith('zh')) return 'zh-CN'
        if (lower.startsWith('ru')) return 'ru-RU'
        if (lower.startsWith('ar')) return 'ar-SA'
        if (lower.startsWith('ko')) return 'ko-KR'
        if (lower.startsWith('bn')) return 'bn-IN'
        if (lower.startsWith('ta')) return 'ta-IN'
        if (lower.startsWith('te')) return 'te-IN'
        if (lower.includes('in') || lower.startsWith('hi')) return 'en-IN'
        if (lower.startsWith('en')) return lower.includes('gb') ? 'en-GB' : (lower.includes('in') ? 'en-IN' : 'en-US')
      }
    }
    if (isIndianLocale()) {
      return 'en-IN'
    }
  } catch {}
  return isIndianLocale() ? 'en-IN' : 'en-US'
}

export function isHindiVoice(voice: SpeechSynthesisVoice): boolean {
  const lang = (voice.lang || '').toLowerCase()
  const name = (voice.name || '').toLowerCase()
  return lang.startsWith('hi') || name.includes('hindi') || name.includes('kalpana') || name.includes('hemant')
}

/**
 * Asynchronously waits for speechSynthesis voices to become available.
 * In Chromium, window.speechSynthesis.getVoices() initially returns [] synchronously
 * on extension reload until the OS voices are populated and 'voiceschanged' fires.
 */
export async function getLoadedVoices(timeoutMs = 800): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !window.speechSynthesis) {
    return []
  }
  const current = window.speechSynthesis.getVoices?.() || []
  if (current.length > 0 || typeof window.speechSynthesis.addEventListener !== 'function') {
    return current
  }

  return new Promise<SpeechSynthesisVoice[]>(resolve => {
    let resolved = false
    let timer: any = null
    let timeout: any = null

    const finish = () => {
      if (resolved) return
      resolved = true
      if (timer) clearInterval(timer)
      if (timeout) clearTimeout(timeout)
      window.speechSynthesis?.removeEventListener?.('voiceschanged', finish)
      if (window.speechSynthesis && window.speechSynthesis.onvoiceschanged === finish) {
        window.speechSynthesis.onvoiceschanged = null
      }
      resolve(window.speechSynthesis?.getVoices?.() || [])
    }

    window.speechSynthesis.addEventListener('voiceschanged', finish, { once: true })
    try {
      window.speechSynthesis.onvoiceschanged = finish
    } catch {}
    timer = setInterval(() => {
      const v = window.speechSynthesis?.getVoices?.()
      if (v && v.length > 0) finish()
    }, 20)
    timeout = setTimeout(finish, timeoutMs)
  })
}

export function isIndianVoice(voice: SpeechSynthesisVoice): boolean {
  const lang = (voice.lang || '').toLowerCase().replace('_', '-')
  const name = (voice.name || '').toLowerCase()
  return (
    lang === 'en-in' ||
    lang.startsWith('hi') ||
    name.includes('india') ||
    name.includes('hindi') ||
    name.includes('heera') ||
    name.includes('ravi') ||
    name.includes('kalpana') ||
    name.includes('hemant') ||
    name.includes('neerja') ||
    name.includes('prabhat') ||
    name.includes('swara')
  )
}

export function isDavidVoice(voice: SpeechSynthesisVoice): boolean {
  return (voice.name || '').toLowerCase().includes('david')
}

/**
 * Priority voices for Hindi output.
 */
const PRIORITY_HINDI_VOICES = [
  'microsoft kalpana',
  'microsoft hemant',
  'microsoft swara',
  'microsoft madhur',
  'google हिन्दी',
  'google hindi',
  'hindi'
]

/**
 * Priority neural and natural voices for major global languages.
 */
const PRIORITY_MULTILINGUAL_VOICES: Record<string, string[]> = {
  es: ['google español', 'microsoft helena', 'microsoft laura', 'microsoft sabina', 'monica', 'paulino'],
  fr: ['google français', 'microsoft hortense', 'microsoft paul', 'microsoft julie', 'amelie', 'thomas'],
  de: ['google deutsch', 'microsoft hedda', 'microsoft stefan', 'anna', 'martin'],
  it: ['google italiano', 'microsoft elsa', 'microsoft cosimo', 'alice'],
  pt: ['google português', 'microsoft maria', 'microsoft daniel', 'luciana'],
  ru: ['google русский', 'microsoft svetlana', 'microsoft dmitry', 'milena'],
  ja: ['google 日本語', 'microsoft nanami', 'microsoft keita', 'kyoko', 'otohe'],
  zh: ['google 普通话', 'microsoft xiaoxiao', 'microsoft yunxi', 'tingting'],
  ar: ['google العربية', 'microsoft shakira', 'microsoft hamed', 'maged', 'tarik'],
  ko: ['google 한국의', 'microsoft sunhi', 'microsoft injoon', 'yuna'],
  bn: ['google বাংলা', 'microsoft bashkar', 'microsoft tanushree', 'bangla', 'bengali'],
  ta: ['google தமிழ்', 'microsoft valluvar', 'tamil'],
  te: ['google తెలుగు', 'microsoft mohan', 'telugu']
}

/**
 * High-fidelity Neural / Natural voices preferred across OS platforms.
 */
const PRIORITY_ENGLISH_VOICES = [
  'google indian english',
  'microsoft heera',
  'microsoft ravi',
  'microsoft neerja',
  'microsoft prabhat',
  'google us english',
  'google uk english female',
  'google uk english male',
  'microsoft jenny - natural',
  'microsoft mark - natural',
  'microsoft guy - natural',
  'microsoft aria - natural',
  'samantha',
  'karen',
  'daniel'
]

/**
 * Ranks and selects the highest quality voice for a specific language or conversation mode.
 * Automatically chooses the best voice so Hindi and other languages are never mangled by Microsoft David.
 */
export function selectBestVoiceForLanguage(
  voices: SpeechSynthesisVoice[],
  targetLanguage: string = 'en',
  options?: { prefersIndian?: boolean; conversationLang?: string }
): SpeechSynthesisVoice | null {
  if (!voices || voices.length === 0) return null

  const prefersIndian = options?.prefersIndian ?? isIndianLocale()
  const normalizedLang = (targetLanguage || 'en').toLowerCase().split('-')[0]
  const isHinglish = targetLanguage === 'hinglish' || options?.conversationLang === 'hinglish'

  // --- HINDI (hi / hi-IN) ---
  if (normalizedLang === 'hi') {
    const hindiVoices = voices.filter(isHindiVoice)
    for (const name of PRIORITY_HINDI_VOICES) {
      const match = hindiVoices.find(v => v.name.toLowerCase().includes(name))
      if (match) return match
    }
    if (hindiVoices.length > 0) return hindiVoices[0]
    return null
  }

  // --- HINGLISH ---
  if (isHinglish || normalizedLang === 'hinglish') {
    // Prefer Indian English voice first (optimal for Latin-script Hindi words)
    const indianVoices = voices.filter(v => isIndianVoice(v) && !isDavidVoice(v))
    const enInVoice = indianVoices.find(v => v.lang.toLowerCase().includes('in') && !v.lang.toLowerCase().startsWith('hi'))
    if (enInVoice) return enInVoice

    // Next try Hindi voice
    const hiVoice = indianVoices.find(isHindiVoice)
    if (hiVoice) return hiVoice

    if (indianVoices.length > 0) return indianVoices[0]

    // Natural / non-desktop English voice
    const naturalEnglish = voices.find(v => 
      v.lang.toLowerCase().startsWith('en') && 
      !v.name.toLowerCase().includes('desktop') && 
      !isDavidVoice(v)
    )
    if (naturalEnglish) return naturalEnglish

    // Desktop English voice avoiding David (e.g. Zira)
    const ziraOrOther = voices.find(v => v.lang.toLowerCase().startsWith('en') && !isDavidVoice(v))
    if (ziraOrOther) return ziraOrOther

    return voices.find(v => !isDavidVoice(v)) || voices[0]
  }

  // --- OTHER SPECIFIC LANGUAGES (es, fr, de, it, pt, ja, zh, etc.) ---
  if (normalizedLang !== 'en') {
    const langMatches = voices.filter(v => v.lang.toLowerCase().split('-')[0] === normalizedLang)
    if (langMatches.length > 0) {
      const priorities = PRIORITY_MULTILINGUAL_VOICES[normalizedLang] || []
      for (const pref of priorities) {
        const match = langMatches.find(v => v.name.toLowerCase().includes(pref) && !isDavidVoice(v))
        if (match) return match
      }
      const natural = langMatches.find(v => 
        !v.name.toLowerCase().includes('desktop') ||
        v.name.toLowerCase().includes('natural') ||
        v.name.toLowerCase().includes('neural') ||
        v.name.toLowerCase().includes('google')
      )
      return natural || langMatches[0]
    }
  }

  // --- ENGLISH (en) ---
  // 1. If Indian locale or conversation is Indian-biased, search for natural Indian English voices first
  if (prefersIndian || options?.conversationLang === 'hinglish' || options?.conversationLang === 'hi') {
    const indianVoices = voices.filter(v => isIndianVoice(v) && !isDavidVoice(v))
    const naturalIndian = indianVoices.find(v => 
      !v.name.toLowerCase().includes('desktop') || 
      v.name.toLowerCase().includes('natural') || 
      v.name.toLowerCase().includes('google')
    )
    if (naturalIndian) return naturalIndian
    if (indianVoices.length > 0) return indianVoices[0]
  }

  // 2. High-fidelity Neural / Online voices
  for (const preferred of PRIORITY_ENGLISH_VOICES) {
    const match = voices.find(v => v.name.toLowerCase().includes(preferred) && !isDavidVoice(v))
    if (match) return match
  }

  // 3. Fallback to any non-desktop English voice (avoids robotic SAPI5 Microsoft David)
  const nonDesktopEnglish = voices.find(v => 
    v.lang.toLowerCase().startsWith('en') && 
    !v.name.toLowerCase().includes('desktop') &&
    !isDavidVoice(v)
  )
  if (nonDesktopEnglish) return nonDesktopEnglish

  // 4. Desktop English voices: strictly prefer clear voices (Zira / Mark) over David
  const ziraVoice = voices.find(v => v.name.toLowerCase().includes('zira'))
  if (ziraVoice) return ziraVoice

  const anyNonDavidEnglish = voices.find(v => v.lang.toLowerCase().startsWith('en') && !isDavidVoice(v))
  if (anyNonDavidEnglish) return anyNonDavidEnglish

  // 5. Any English voice
  const anyEnglish = voices.find(v => v.lang.toLowerCase().startsWith('en'))
  if (anyEnglish) return anyEnglish

  // 6. Ultimate fallback
  return voices[0]
}

/**
 * Ranks and selects the highest quality voice from available SpeechSynthesis voices.
 */
export function selectBestSpeechVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  return selectBestVoiceForLanguage(voices, 'en')
}
