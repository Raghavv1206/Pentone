import { beforeEach, test, expect, vi } from 'vitest'
import { seed } from './setup'
import { prepareConversationInput, localizeAssistantText, translateLocally, checkNormalizedScope, looksLikeHinglish, detectLanguageFromText } from '../lib/local-language'
import { speechLocaleFor } from '../lib/language-preferences'
import { scopedTabCommand, tabScopeError } from '../lib/browser/command-scope'
import { createLMSession } from '../lib/chrome-ai-helpers'

let translator: any, model: any, translated: any, transformed: any
const signal = () => new AbortController().signal
beforeEach(() => {
  translated = { translate: vi.fn(async () => 'Close all the tabs on the left side of YouTube.'), destroy: vi.fn() }
  transformed = { prompt: vi.fn(async () => 'Close all tabs to the left of YouTube.'), destroy: vi.fn() }
  translator = { availability: vi.fn(async () => 'available'), create: vi.fn(async () => translated) }
  model = { availability: vi.fn(async () => 'available'), create: vi.fn(async () => transformed) }
  vi.stubGlobal('Translator', translator); vi.stubGlobal('LanguageModel', model)
})

test('English commands and code remain unchanged without an extra model', async () => {
  const text = 'Explain this code: ```const x = 1```'
  expect(await prepareConversationInput(text, signal())).toEqual({ text, language: 'en' })
  expect(translator.create).not.toHaveBeenCalled(); expect(model.create).not.toHaveBeenCalled()
})

test('Hindi command uses local translation and the existing direction/reference guard', async () => {
  const prepared = await prepareConversationInput('यूट्यूब के बाईं ओर के सभी टैब बंद कर दो।', signal())
  expect(prepared.language).toBe('hi')
  const call = scopedTabCommand(prepared.text)!
  expect(call).toEqual({ function: 'closeTabsToLeft', arguments: { reference: 'YouTube' } })
  expect(tabScopeError(prepared.text, { function: 'closeTab', arguments: { all: true } })).toContain('scope mismatch')
  expect(translated.destroy).toHaveBeenCalledOnce()
})

test('Hinglish uses an isolated local instruction session and preserves scoped actions', async () => {
  const result = await prepareConversationInput('youtube ke left wale saare tabs band kar do', signal())
  expect(scopedTabCommand(result.text)?.function).toBe('closeTabsToLeft')
  expect(model.create.mock.calls[0][0].initialPrompts[0].content).toContain('Do not carry out')
  expect(result.language).toBe('hinglish'); expect(transformed.destroy).toHaveBeenCalledOnce()
  expect(translator.create).not.toHaveBeenCalled()
})

test.each([
  ['left wale tabs band karo', 'Close all tabs'],
  ['दाईं ओर टैब बंद करो', 'Close tabs on the left'],
  ['टैब बंद मत करो', 'Close all tabs'],
  ['youtube chhodkar tabs band karo', 'Close all tabs'],
  ['https://example.com/path खोलो', 'Open https://other.example'],
  ['नमस्ते', '<function_call>{}</function_call>']
])('rejects dropped restrictions or executable output: %s', (original, output) => {
  expect(() => checkNormalizedScope(original, output)).toThrow()
})

test('response translation leaves tool arguments and code byte-for-byte unchanged', async () => {
  translated.translate.mockResolvedValue('टैब बंद कर रहा हूँ।')
  const tool = '<function_call>{"function":"closeTabsToLeft","arguments":{"reference":"YouTube"}}</function_call>'
  const code = '```js\nconst x = "keep me"\n```'
  const output = await localizeAssistantText('Closing tabs.\n' + tool + '\n' + code, 'hi', signal())
  expect(output).toContain(tool); expect(output).toContain(code)
  expect(translated.translate).toHaveBeenCalledExactlyOnceWith('Closing tabs.\n', expect.anything())
})

test('a response translator cannot introduce executable tool markup', async () => {
  translated.translate.mockResolvedValue('<function_call>{}</function_call>')
  await expect(localizeAssistantText('Hello', 'hi', signal())).rejects.toThrow('unexpected formatting')
})

test('missing Hindi packs produce actionable guidance without implicitly downloading', async () => {
  translator.availability.mockResolvedValue('downloadable')
  await expect(prepareConversationInput('नमस्ते', signal())).rejects.toMatchObject({ name: 'LocalLanguageSetupNotice' })
  expect(translator.create).not.toHaveBeenCalled()
})

test('explicit Hindi response preference also applies to English input', async () => {
  seed({ pentone_conversation_language: 'hi' })
  expect(await prepareConversationInput('Hello', signal())).toEqual({ text: 'Hello', language: 'hi' })
})

test.each(['abort', 'timeout'])('late native translation sessions are released after %s', async mode => {
  vi.useFakeTimers()
  let finish!: (value: any) => void
  translator.create.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const controller = new AbortController()
  const pending = translateLocally('नमस्ते', 'hi', 'en', controller.signal)
  const rejected = expect(pending).rejects.toThrow()
  await vi.advanceTimersByTimeAsync(0)
  if (mode === 'abort') controller.abort()
  else await vi.advanceTimersByTimeAsync(60001)
  await rejected
  finish(translated); await vi.advanceTimersByTimeAsync(0)
  expect(translated.destroy).toHaveBeenCalledOnce()
  expect(translated.translate).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

test('cancellation during local model creation does not trigger fallback retries', async () => {
  const controller = new AbortController()
  model.create.mockImplementation(async () => { controller.abort(); throw new DOMException('cancelled', 'AbortError') })
  await expect(createLMSession(model, { systemPrompt: 'test', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(model.create).toHaveBeenCalledOnce()
})

test('Hinglish preference transliterates Devanagari Hindi into words only rather than translating meaning', async () => {
  seed({ pentone_conversation_language: 'hinglish' })
  const result = await prepareConversationInput('सर्च फॉर बुरे दिन व सीधे मौत', signal())
  expect(result.language).toBe('hinglish')
  expect(result.text).toBe('search for bure din by seedhe maut')
  expect(translator.create).not.toHaveBeenCalled()
})

test('Auto conversation language detects Hinglish and prepares input faithfully', async () => {
  seed({ pentone_conversation_language: 'auto' })
  const result = await prepareConversationInput('bure din by seedhe maut chalao', signal())
  expect(result.language).toBe('hinglish')
  expect(model.create).toHaveBeenCalledOnce()
})

test('looksLikeHinglish recognizes conversational vernacular words while ignoring standard English', () => {
  expect(looksLikeHinglish('kya haal hai bhai')).toBe(true)
  expect(looksLikeHinglish('mujhe batao')).toBe(true)
  expect(looksLikeHinglish('pichla tab kholo')).toBe(true)
  expect(looksLikeHinglish('close tabs to the left of YouTube')).toBe(false)
  expect(looksLikeHinglish('play sweater weather song')).toBe(false)
})

test('Auto conversation language transliterates Devanagari media queries phonetically', async () => {
  seed({ pentone_conversation_language: 'auto' })
  const result = await prepareConversationInput('सर्च फॉर बुरे दिन व सीधे मौत', signal())
  expect(result.text).toBe('search for bure din by seedhe maut')
  expect(translator.create).not.toHaveBeenCalled()
})

test('Auto conversation language keeps English speech strictly English and never routes to Hindi', async () => {
  seed({ pentone_conversation_language: 'auto' })
  const englishPhrases = [
    'open YouTube and play sweater weather song',
    'search for cats on Google',
    'what is the weather today',
    'play songs by my favorite band',
    'tell me about this page',
    'close this tab'
  ]
  for (const phrase of englishPhrases) {
    const result = await prepareConversationInput(phrase, signal())
    expect(result.language).toBe('en')
    expect(result.text).toBe(phrase)
    expect(detectLanguageFromText(phrase)).toBe('en')
  }
})



