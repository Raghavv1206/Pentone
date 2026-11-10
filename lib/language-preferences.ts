import { useEffect, useState } from 'react'
import { getRecommendedSpeechLocale } from './voice-selector'

export const conversationLanguageKey = 'pentone_conversation_language'
export type ConversationLanguage = 'auto' | 'en' | 'hi' | 'hinglish'
export function parseConversationLanguage(value: unknown): ConversationLanguage {
  return value === 'en' || value === 'hi' || value === 'hinglish' ? value : 'auto'
}
export async function readConversationLanguage(): Promise<ConversationLanguage> {
  const saved = await chrome.storage.local.get(conversationLanguageKey)
  return parseConversationLanguage(saved[conversationLanguageKey])
}
export function speechLocaleFor(language: ConversationLanguage): string {
  return language === 'hi' || language === 'hinglish' ? 'hi-IN' : getRecommendedSpeechLocale()
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
