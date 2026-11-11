import { useEffect, useState } from 'react'
import { getRecommendedSpeechLocale } from './voice-selector'

export const conversationLanguageKey = 'pentone_conversation_language'

export type ConversationLanguage =
  | 'auto'
  | 'en'
  | 'hi'
  | 'hinglish'
  | 'es'
  | 'fr'
  | 'de'
  | 'it'
  | 'pt'
  | 'ru'
  | 'ja'
  | 'zh'
  | 'ar'
  | 'ko'
  | 'bn'
  | 'ta'
  | 'te'
  | string

const SUPPORTED_LANGUAGES = new Set([
  'auto', 'en', 'hi', 'hinglish',
  'es', 'fr', 'de', 'it', 'pt',
  'ru', 'ja', 'zh', 'ar', 'ko',
  'bn', 'ta', 'te'
])

export function parseConversationLanguage(value: unknown): ConversationLanguage {
  if (typeof value !== 'string') return 'auto'
  const v = value.trim().toLowerCase()
  if (SUPPORTED_LANGUAGES.has(v)) return v as ConversationLanguage
  // Preserve valid custom BCP 47 language codes (e.g., 'es-MX', 'fr-CA', 'pt-PT')
  if (/^[a-z]{2,3}(-[a-z0-9]+)*$/i.test(v)) return v
  return 'auto'
}

export async function readConversationLanguage(): Promise<ConversationLanguage> {
  const saved = await chrome.storage.local.get(conversationLanguageKey)
  return parseConversationLanguage(saved[conversationLanguageKey])
}

export function speechLocaleFor(language: ConversationLanguage): string {
  const code = (language || 'auto').toLowerCase()
  if (code === 'auto') return getRecommendedSpeechLocale()
  if (code.includes('-')) return language // Already a specific regional BCP 47 locale

  switch (code) {
    case 'hi':
    case 'hinglish':
      return 'hi-IN'
    case 'bn':
      return 'bn-IN'
    case 'ta':
      return 'ta-IN'
    case 'te':
      return 'te-IN'
    case 'es':
      return 'es-ES'
    case 'fr':
      return 'fr-FR'
    case 'de':
      return 'de-DE'
    case 'it':
      return 'it-IT'
    case 'pt':
      return 'pt-BR'
    case 'ru':
      return 'ru-RU'
    case 'ja':
      return 'ja-JP'
    case 'zh':
      return 'zh-CN'
    case 'ar':
      return 'ar-SA'
    case 'ko':
      return 'ko-KR'
    case 'en':
      return getRecommendedSpeechLocale()
    default:
      return getRecommendedSpeechLocale()
  }
}

export function useConversationLanguage() {
  const [language, setLanguage] = useState<ConversationLanguage>('auto')
  useEffect(() => {
    let mounted = true
    void readConversationLanguage().then(value => { if (mounted) setLanguage(value) }).catch(() => {})
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[conversationLanguageKey]) setLanguage(parseConversationLanguage(changes[conversationLanguageKey].newValue))
    }
    chrome.storage.onChanged.addListener(changed)
    return () => { mounted = false; chrome.storage.onChanged.removeListener(changed) }
  }, [])
  const save = async (value: string) => {
    const valid = parseConversationLanguage(value)
    await chrome.storage.local.set({ [conversationLanguageKey]: valid })
    setLanguage(valid)
  }
  return { language, save }
}
