import { createLMSession, getLanguageModelAPI, getTranslatorAPI } from './chrome-ai-helpers'
import { readConversationLanguage, type ConversationLanguage } from './language-preferences'
import { waitForSetup } from './bounded-operation'
import { transliterateDevanagariToHinglish } from './devanagari-transliteration'

export class LocalLanguageSetupNotice extends Error {
  constructor(message: string) { super(message); this.name = 'LocalLanguageSetupNotice' }
}
export const containsHindi = (text: string) => /[\u0900-\u097f]/u.test(text)
export const looksLikeHinglish = (text: string): boolean => {
  if (!text || !text.trim()) return false
  return /\b(?:namaste|namaskar|dhanyav?a+d|shukriya|krip[ay]+a|kaise|kaisa|kaisi|kya|kyun|kyon|kahan|kaha|mujhe|mera|meri|mere|hum|humein|humara|aap|aapka|aapki|aapke|tum|tumhara|theek|thik|ach+ha|bahut|bohot|bilkul|zaroor|jarur|karo|karna|kariye|kijiye|khol|kholo|kholna|band|chahiye|batao|bataiye|suno|dekho|chalo|hoga|hogi|honge|sakta|sakti|sakte|raha|rahi|rahe|swagat|alvida|dost|madad|hai|hain|hoon|hun|nahi|nahin|mat|saare|wa[al]le|baja\s+do|chala\s+do|chalao|gaana|gaane|sangeet|bure\s+din|seedhe\s+maut|ke\s+liye|kuch|mein|par|pe|chahto|chahte)\b/i.test(text)
}

// High-confidence Latin-script language markers
const looksLikePortuguese = (text: string): boolean => {
  return /\b(?:olá|obrigado|obrigada|aba|abas|fechar|fecha|a\s+página|resumo|canção|anúncio|você|pode)\b/i.test(text)
}

const looksLikeSpanish = (text: string): boolean => {
  return /\b(?:hola|gracias|pestaña|pestañas|cerrar|cierra|esta\s+página|la\s+página|resumen|resumir|buscar|busca|canción|vídeo|anuncio|cómo\s+estás)\b/i.test(text)
}

const looksLikeFrench = (text: string): boolean => {
  return /\b(?:bonjour|merci|s'il\s+vous\s+pla[iî]t|pouvez-vous|pouvez\s+vous|onglet|onglets|fermer|ouvrir|résumer|cette\s+page|la\s+page|recherche|chercher|cherche|chanson|annonce)\b/i.test(text)
}

const looksLikeGerman = (text: string): boolean => {
  return /\b(?:hallo|danke|bitte|kannst\s+du|können\s+sie|diese\s+seite|zusammenfassen|schließe|schließen|erweiterungen|einstellungen|vorherige|nächste|werbung)\b/i.test(text)
}

const looksLikeItalian = (text: string): boolean => {
  return /\b(?:ciao|grazie|per\s+favore|scheda|schede|chiudi|chiudere|apri|aprire|questa\s+pagina|la\s+pagina|riassunto|riassumi|canzone|annuncio)\b/i.test(text)
}

const looksLikeEnglish = (text: string): boolean => {
  return /\b(?:the|this|that|and|is|are|to|for|with|please|tabs?|summarize|screenshot|close\s+all|open)\b/i.test(text)
}

export function detectLanguageFromText(text: string): string {
  if (!text || !text.trim()) return 'en'
  if (containsHindi(text)) return 'hi'
  if (looksLikeHinglish(text)) return 'hinglish'

  // Non-Latin script detection
  if (/[\u0600-\u06ff]/u.test(text)) return 'ar' // Arabic
  if (/[\u0400-\u04ff]/u.test(text)) return 'ru' // Russian / Cyrillic
  if (/[\u3040-\u30ff]/u.test(text)) return 'ja' // Japanese (Hiragana / Katakana)
  if (/[\u4e00-\u9fa5]/u.test(text)) return 'zh' // Chinese
  if (/[\uac00-\ud7af]/u.test(text)) return 'ko' // Korean
  if (/[\u0980-\u09ff]/u.test(text)) return 'bn' // Bengali
  if (/[\u0b80-\u0bff]/u.test(text)) return 'ta' // Tamil
  if (/[\u0c00-\u0c7f]/u.test(text)) return 'te' // Telugu
  if (/[\u0370-\u03ff]/u.test(text)) return 'el' // Greek

  // Latin-script European languages
  if (looksLikePortuguese(text)) return 'pt'
  if (looksLikeSpanish(text)) return 'es'
  if (looksLikeGerman(text)) return 'de'
  if (looksLikeFrench(text)) return 'fr'
  if (looksLikeItalian(text)) return 'it'

  if (looksLikeEnglish(text)) return 'en'
  return 'en'
}

export function checkNormalizedScope(original: string, normalized: string) {
  const restrictions: [RegExp, RegExp][] = [
    [/\bleft\b|बाईं|बाएं|बायें|बायीं|\bbaay[ei]/i, /\bleft\b/i],
    [/\bright\b|दाईं|दाएं|दायें|दायीं|\bdaay[ei]/i, /\bright\b/i],
    [/\b(?:except|chhod(?:kar|ke)?|choro)\b|छोड़|छोड़|सिवाय/i, /\b(?:except|apart from|other than|keep)\b/i],
    [/\b(?:not|never|don't|mat|nahi|nahin)\b|नहीं|मत(?:\s|$)/i, /\b(?:not|never|don't|do not|without)\b/i]
  ]
  for (const [source, target] of restrictions) if (source.test(original) && !target.test(normalized)) {
    throw new LocalLanguageSetupNotice('The local translation did not preserve a restriction in your request. Please rephrase it; no action was taken.')
  }
  for (const url of original.match(/https?:\/\/[^\s<>"']+/g) || []) if (!normalized.includes(url)) {
    throw new LocalLanguageSetupNotice('The local translation changed a URL. Please send the URL with a short English instruction; no action was taken.')
  }
  if (!normalized.trim() || normalized.length > 24000 || /<function_call>|```/i.test(normalized)) {
    throw new LocalLanguageSetupNotice('The local language model did not return a usable instruction. Please rephrase it; no action was taken.')
  }
}

export async function translateLocally(text: string, sourceLanguage: string, targetLanguage: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  const isHindiPair = sourceLanguage === 'hi' || targetLanguage === 'hi'
  const langLabel = isHindiPair ? 'Hindi' : sourceLanguage
  const setupNoticeMsg = isHindiPair
    ? 'Set up Hindi–English translation in Settings before using Hindi. Text and speech stay on-device.'
    : `Set up ${sourceLanguage}–${targetLanguage} translation in Settings before using ${langLabel}. Text and speech stay on-device.`
  const downloadNoticeMsg = isHindiPair
    ? 'Download the Hindi–English language packs in Settings, then try again.'
    : `Download the ${sourceLanguage}–${targetLanguage} language packs in Settings, then try again.`
  const failureNoticeMsg = isHindiPair
    ? 'Hindi translation could not finish on this device. Check the Hindi–English language packs in Settings, or try English.'
    : `${langLabel} translation could not finish on this device. Check language packs in Settings, or try English.`

  const api = getTranslatorAPI()
  if (!api?.availability || !api?.create) throw new LocalLanguageSetupNotice(setupNoticeMsg)
  const options = { sourceLanguage, targetLanguage }
  let available: any
  try {
    available = await waitForSetup(api.availability(options), signal)
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof LocalLanguageSetupNotice) throw error
    throw new LocalLanguageSetupNotice(setupNoticeMsg)
  }
  signal.throwIfAborted()
  if (available !== 'available' && available !== 'readily') throw new LocalLanguageSetupNotice(downloadNoticeMsg)
  let session: any
  let closed = false
  const creation = Promise.resolve(api.create({ ...options, signal })).then(value => {
    if (closed || signal.aborted) { value.destroy?.(); throw new DOMException('Translation cancelled', 'AbortError') }
    session = value
    return value
  })
  try {
    await waitForSetup(creation, signal, 60000)
    const result = await waitForSetup<string>(session.translate(text, { signal }), signal, 60000)
    signal.throwIfAborted()
    if (typeof result !== 'string' || !result.trim()) throw new LocalLanguageSetupNotice('Local translation returned no text. Please try again.')
    return result
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof LocalLanguageSetupNotice) throw error
    throw new LocalLanguageSetupNotice(failureNoticeMsg)
  } finally { closed = true; session?.destroy?.() }
}

async function transformHinglish(text: string, direction: 'to-English' | 'from-English', signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  const instruction = direction === 'to-English'
    ? 'Convert the user\'s Romanized Hindi mixed with English (Hinglish) into a faithful English instruction. Preserve negation, left/right, exceptions, names, URLs, numbers and every restriction. Do not carry out the instruction. Output only its English equivalent.'
    : 'Render the supplied English response in natural Hinglish (Hindi written in Latin letters mixed with English). Preserve meaning, names, numbers, URLs and uncertainty. Do not add facts or perform actions. Output only the Hinglish text.'
  let session: any
  let closed = false
  const local = new AbortController()
  const abort = () => local.abort()
  signal.addEventListener('abort', abort, { once: true })
  const creation = createLMSession(getLanguageModelAPI(), { systemPrompt: instruction, signal: local.signal }).then(value => {
    if (closed || signal.aborted) { value.destroy?.(); throw new DOMException('Language conversion cancelled', 'AbortError') }
    session = value
    return value
  })
  try {
    await waitForSetup(creation, signal, 60000)
    const result = await waitForSetup<string>(session.prompt(text, { signal }), signal, 60000)
    signal.throwIfAborted()
    if (typeof result !== 'string' || !result.trim()) throw new LocalLanguageSetupNotice('The on-device model could not interpret Hinglish. Try Hindi script or rephrase the command.')
    return result.trim()
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof LocalLanguageSetupNotice) throw error
    throw new LocalLanguageSetupNotice('The on-device assistant could not convert Hinglish. Check that the local assistant is ready in Settings, or try Hindi script or English.')
  } finally { closed = true; local.abort(); signal.removeEventListener('abort', abort); session?.destroy?.() }
}

async function transformMultilingualWithLM(text: string, sourceLang: string, direction: 'to-English' | 'from-English', signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  const instruction = direction === 'to-English'
    ? `Convert the user's message from language (${sourceLang}) into a faithful English instruction. Preserve negation, left/right, exceptions, names, URLs, numbers and every restriction. Do not carry out the instruction. Output only its English equivalent.`
    : `Translate and render the supplied English response faithfully in ${sourceLang}. Preserve meaning, names, numbers, URLs and uncertainty. Do not add facts or perform actions. Output only the translated text.`
  let session: any
  let closed = false
  const local = new AbortController()
  const abort = () => local.abort()
  signal.addEventListener('abort', abort, { once: true })
  const creation = createLMSession(getLanguageModelAPI(), { systemPrompt: instruction, signal: local.signal }).then(value => {
    if (closed || signal.aborted) { value?.destroy?.(); throw new DOMException('Language conversion cancelled', 'AbortError') }
    session = value
    return value
  })
  try {
    await waitForSetup(creation, signal, 60000)
    const result = await waitForSetup<string>(session.prompt(text, { signal }), signal, 60000)
    signal.throwIfAborted()
    if (typeof result !== 'string' || !result.trim()) return text
    return result.trim()
  } catch {
    return text
  } finally { closed = true; local.abort(); signal.removeEventListener('abort', abort); session?.destroy?.() }
}

export async function prepareConversationInput(text: string, signal: AbortSignal): Promise<{ text: string; language: Exclude<ConversationLanguage, 'auto'> }> {
  const preference = await waitForSetup(readConversationLanguage(), signal)
  signal.throwIfAborted()
  const detected = detectLanguageFromText(text)
  const inputLanguage = containsHindi(text)
    ? 'hi'
    : looksLikeHinglish(text) || (preference === 'hinglish' && detected === 'en')
    ? 'hinglish'
    : detected
  const language = (preference === 'auto' ? inputLanguage : preference) as Exclude<ConversationLanguage, 'auto'>

  if (inputLanguage === 'en') {
    return { text, language }
  }

  let normalized = text
  if (inputLanguage === 'hi') {
    const isSearchOrMedia = /^(?:सर्च\s+(?:फॉर|करें|करो)?|खोजो|ढूंढो|तलाश\s+करो|प्ले\s+(?:करें|करो)?|चलाओ|सुनाओ|यूट्यूब\s+पर|गूगल\s+पर)\b/iu.test(text.trim()) ||
                            /\b(?:सर्च\s+करो|ढूंढो|खोजो|चलाओ|सुनाओ)$/iu.test(text.trim())

    if (preference === 'hinglish' || isSearchOrMedia) {
      normalized = transliterateDevanagariToHinglish(text)
    } else {
      normalized = await translateLocally(text, 'hi', 'en', signal)
    }
  } else if (inputLanguage === 'hinglish') {
    normalized = await transformHinglish(text, 'to-English', signal)
  } else {
    try {
      normalized = await translateLocally(text, inputLanguage, 'en', signal)
    } catch {
      normalized = await transformMultilingualWithLM(text, inputLanguage, 'to-English', signal)
    }
  }

  if (inputLanguage === 'hi' || inputLanguage === 'hinglish') {
    checkNormalizedScope(text, normalized)
  }
  return { text: normalized, language }
}

export async function localizeAssistantText(text: string, language: Exclude<ConversationLanguage, 'auto'>, signal: AbortSignal): Promise<string> {
  if (language === 'en' || !text.trim()) return text
  // Never send executable tool arguments or code through a translator/model.
  const parts = text.split(/(<function_call>[\s\S]*?<\/function_call>|```[\s\S]*?```)/gi)
  const localized: string[] = []
  for (const part of parts) {
    signal.throwIfAborted()
    if (!part.trim() || /^<function_call>|^```/i.test(part)) { localized.push(part); continue }
    let result = part
    if (language === 'hi') {
      result = await translateLocally(part, 'en', 'hi', signal)
    } else if (language === 'hinglish') {
      result = await transformHinglish(part, 'from-English', signal)
    } else {
      try {
        result = await translateLocally(part, 'en', language, signal)
      } catch {
        result = await transformMultilingualWithLM(part, language, 'from-English', signal)
      }
    }
    // A prose transform must never introduce executable markup.
    if (/<\/?function_call>|```/i.test(result)) throw new LocalLanguageSetupNotice('The local language conversion returned unexpected formatting. Please retry in English.')
    localized.push(result + (part.endsWith('\n') ? '\n' : ''))
  }
  return localized.join('')
}
