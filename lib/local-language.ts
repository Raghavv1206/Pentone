import { createLMSession, getLanguageModelAPI, getTranslatorAPI } from './chrome-ai-helpers'
import { readConversationLanguage, type ConversationLanguage } from './language-preferences'
import { waitForSetup } from './bounded-operation'

export class LocalLanguageSetupNotice extends Error {
  constructor(message: string) { super(message); this.name = 'LocalLanguageSetupNotice' }
}
export const containsHindi = (text: string) => /[\u0900-\u097f]/u.test(text)
export const looksLikeHinglish = (text: string) => /\b(?:karo|khol(?:o|na)|band\s+kar|mujhe|kaise|kya|saare|wa[al]le|batao|namaste|chahiye|hai|hain)\b/i.test(text)

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
  const api = getTranslatorAPI()
  if (!api?.availability || !api?.create) throw new LocalLanguageSetupNotice('Set up Hindi–English translation in Settings before using Hindi. Text and speech stay on-device.')
  const options = { sourceLanguage, targetLanguage }
  let available: any
  try {
    available = await waitForSetup(api.availability(options), signal)
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof LocalLanguageSetupNotice) throw error
    throw new LocalLanguageSetupNotice('Set up Hindi–English translation in Settings before using Hindi. Text and speech stay on-device.')
  }
  signal.throwIfAborted()
  if (available !== 'available' && available !== 'readily') throw new LocalLanguageSetupNotice('Download the Hindi–English language packs in Settings, then try again.')
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
    throw new LocalLanguageSetupNotice('Hindi translation could not finish on this device. Check the Hindi–English language packs in Settings, or try English.')
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

export async function prepareConversationInput(text: string, signal: AbortSignal): Promise<{ text: string; language: Exclude<ConversationLanguage, 'auto'> }> {
  const preference = await waitForSetup(readConversationLanguage(), signal)
  signal.throwIfAborted()
  const inputLanguage = containsHindi(text) ? 'hi' : looksLikeHinglish(text) || preference === 'hinglish' ? 'hinglish' : 'en'
  const language = preference === 'auto' ? inputLanguage : preference
  const normalized = inputLanguage === 'hi' ? await translateLocally(text, 'hi', 'en', signal)
    : inputLanguage === 'hinglish' ? await transformHinglish(text, 'to-English', signal) : text
  if (inputLanguage !== 'en') checkNormalizedScope(text, normalized)
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
    const result = language === 'hi' ? await translateLocally(part, 'en', 'hi', signal) : await transformHinglish(part, 'from-English', signal)
    // A prose transform must never introduce executable markup.
    if (/<\/?function_call>|```/i.test(result)) throw new LocalLanguageSetupNotice('The local language conversion returned unexpected formatting. Please retry in English.')
    localized.push(result + (part.endsWith('\n') ? '\n' : ''))
  }
  return localized.join('')
}
