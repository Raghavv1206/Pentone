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

/**
 * Ranks and selects the highest quality voice from available SpeechSynthesis voices.
 */
export function selectBestSpeechVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices || voices.length === 0) return null

  const prefersIndian = isIndianLocale()

  // 1. If Indian locale or en-IN preferred, search for natural Indian English voices first
  if (prefersIndian) {
    const indianVoices = voices.filter(v => 
      v.lang.toLowerCase().replace('_', '-') === 'en-in' ||
      v.name.toLowerCase().includes('india') ||
      v.name.toLowerCase().includes('heera') ||
      v.name.toLowerCase().includes('ravi')
    )

    // Prefer online/natural/google voices over legacy desktop
    const naturalIndian = indianVoices.find(v => 
      !v.name.toLowerCase().includes('desktop') || 
      v.name.toLowerCase().includes('natural') || 
      v.name.toLowerCase().includes('google')
    )
    if (naturalIndian) return naturalIndian
    if (indianVoices.length > 0) return indianVoices[0]
  }

  // 2. High-fidelity Neural / Online voices preferred across OS platforms
  const priorityVoiceNames = [
    'google indian english',
    'microsoft heera',
    'microsoft ravi',
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

  for (const preferred of priorityVoiceNames) {
    const match = voices.find(v => v.name.toLowerCase().includes(preferred))
    if (match) return match
  }

  // 3. Fallback to any non-desktop English voice (avoids robotic SAPI5 Microsoft David)
  const nonDesktopEnglish = voices.find(v => 
    v.lang.toLowerCase().startsWith('en') && 
    !v.name.toLowerCase().includes('desktop')
  )
  if (nonDesktopEnglish) return nonDesktopEnglish

  // 4. Any English voice
  const anyEnglish = voices.find(v => v.lang.toLowerCase().startsWith('en'))
  if (anyEnglish) return anyEnglish

  // 5. Ultimate fallback
  return voices[0]
}
