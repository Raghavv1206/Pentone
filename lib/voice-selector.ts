/**
 * Intelligent Voice Selector for Web Speech Synthesis & Recognition
 * 
 * Automatically prioritizes high-fidelity Natural/Online neural voices over
 * legacy robotic desktop voices (e.g. Microsoft David Desktop SAPI5), and
 * dynamically biases toward Indian English (en-IN) when appropriate.
 */

export function isIndianLocale(): boolean {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
    if (timeZone.includes('Calcutta') || timeZone.includes('Kolkata') || timeZone.includes('Asia/Colombo')) {
      return true
    }
    const userLanguages = typeof navigator !== 'undefined' ? (navigator.languages || [navigator.language]) : []
    return userLanguages.some(l => l.toLowerCase().includes('en-in') || l.toLowerCase().includes('hi-in') || l.toLowerCase().startsWith('hi'))
  } catch {
    return false
  }
}

/**
 * Returns the recommended ASR recognition locale ('en-IN' for Indian English speakers, else 'en-US')
 */
export function getRecommendedSpeechLocale(): string {
  return isIndianLocale() ? 'en-IN' : 'en-US'
}

export function isHindiVoice(voice: SpeechSynthesisVoice): boolean {
  const lang = (voice.lang || '').toLowerCase()
  const name = (voice.name || '').toLowerCase()
  return lang.startsWith('hi') || name.includes('hindi') || name.includes('kalpana') || name.includes('hemant')
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

    return voices[0]
  }

  // --- OTHER SPECIFIC LANGUAGES (es, fr, de, it, pt, ja, zh, etc.) ---
  if (normalizedLang !== 'en') {
    const langMatches = voices.filter(v => v.lang.toLowerCase().split('-')[0] === normalizedLang)
    if (langMatches.length > 0) {
      const natural = langMatches.find(v => !v.name.toLowerCase().includes('desktop'))
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
