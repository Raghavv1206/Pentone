import test from 'node:test'
import assert from 'node:assert/strict'
import { spec as storeMemorySpec } from '../lib/tools/storeMemory'
import storeMemory from '../lib/tools/storeMemory'
import { SYSTEM_PROMPT_TEMPLATE, getSystemPrompt } from '../lib/prompts/system-prompt'
import { DEFAULT_SETTINGS, type PentoneSettings, type MarionetteSettings } from '../lib/settings'

test('Voice Settings: Default speech recognition language is en-IN (Hinglish / Indian English)', () => {
  assert.equal(DEFAULT_SETTINGS.speechLanguage, 'en-IN')
})

test('Memory Guardrail: storeMemory tool-level validation rejects single words and names (e.g. "Meghnath")', async () => {
  // Mock chrome.storage for test
  ;(global as any).chrome = {
    storage: {
      local: {
        get: async () => ({ agent_memories: [] }),
        set: async () => {}
      }
    }
  }

  // Single word / name
  const res1 = await storeMemory({ content: 'Meghnath' })
  assert.equal(res1.success, false)
  assert.match(res1.error || '', /rejected.*single word|lacks sufficient factual context/i)

  // Another single word
  const res2 = await storeMemory({ content: 'YouTube' })
  assert.equal(res2.success, false)

  // Two short words
  const res3 = await storeMemory({ content: 'Hi there' })
  assert.equal(res3.success, false)
})

test('Memory Guardrail: storeMemory accepts explicit full-sentence facts or preferences', async () => {
  let savedMemories: any[] = []
  ;(global as any).chrome = {
    storage: {
      local: {
        get: async () => ({ agent_memories: [] }),
        set: async (obj: any) => {
          if (obj.agent_memories) savedMemories = obj.agent_memories
        }
      }
    }
  }

  const validFact = 'User prefers formal communication in emails'
  const res = await storeMemory({ content: validFact, tags: ['preferences'] })
  assert.equal(res.success, true)
  assert.equal(savedMemories.length, 1)
  assert.equal(savedMemories[0].content, validFact)
})

test('Memory Guardrail: storeMemory ToolSpec strictly requires explicit user commands and disallows autonomous facts', () => {
  assert.match(storeMemorySpec.description, /ONLY when the user EXPLICITLY instructs/i)
  assert.match(storeMemorySpec.description, /NEVER call this tool for names,\s*single words/i)

  // Examples must only show explicit requests
  for (const ex of storeMemorySpec.examples) {
    assert.match(ex, /Remember that|Please save|save.*in memory/i)
    assert.doesNotMatch(ex, /After helping user/i)
  }
})

test('Intent Understanding: System prompt contains rules for Hindi and Hinglish commands', () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /Isko delete kaise karunga\?/i)
  assert.match(SYSTEM_PROMPT_TEMPLATE, /Thoda ruk jao,\s*main bol raha hoon/i)
  assert.match(SYSTEM_PROMPT_TEMPLATE, /Isko hata do/i)
  assert.match(SYSTEM_PROMPT_TEMPLATE, /Is page ka summary batao/i)
  assert.match(SYSTEM_PROMPT_TEMPLATE, /YouTube par koi video chala do/i)
  assert.match(SYSTEM_PROMPT_TEMPLATE, /Abhi jo video dikh raha hai use kholo/i)
})

test('Intent Understanding: System prompt instructs model to ask for clarification on ambiguous commands', () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /Ambiguous \/ incomplete commands/i)
  assert.match(SYSTEM_PROMPT_TEMPLATE, /Ask what the user wants to play\/open\/delete/i)
})

test('Memory Guardrail: System prompt explicitly forbids storing names or single words in memory', () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /NEVER call storeMemory unless user EXPLICITLY commands/i)
  assert.match(SYSTEM_PROMPT_TEMPLATE, /NEVER convert names \(e\.g\. "Meghnath"\)/i)
})

test('Speech Lifecycle: Accumulation logic preserves finalized text across engine events without word loss', () => {
  // Simulate the accumulation algorithm used in useSpeechRecognition
  let accumulatedFinalText = ""
  let currentInterim = ""

  // Simulated Event 1: First interim chunk
  const event1 = {
    resultIndex: 0,
    results: [
      Object.assign([{ transcript: 'open' }], { isFinal: false })
    ]
  }

  for (let i = event1.resultIndex; i < event1.results.length; i++) {
    const res = event1.results[i]
    if (res.isFinal) {
      accumulatedFinalText += (accumulatedFinalText ? ' ' : '') + res[0].transcript.trim()
    } else {
      currentInterim = res[0].transcript.trim()
    }
  }
  let transcript = [accumulatedFinalText, currentInterim].filter(Boolean).join(' ')
  assert.equal(transcript, 'open')

  // Simulated Event 2: First phrase finalized
  const event2 = {
    resultIndex: 0,
    results: [
      Object.assign([{ transcript: 'open YouTube' }], { isFinal: true })
    ]
  }
  currentInterim = ""
  for (let i = event2.resultIndex; i < event2.results.length; i++) {
    const res = event2.results[i]
    if (res.isFinal) {
      accumulatedFinalText += (accumulatedFinalText ? ' ' : '') + res[0].transcript.trim()
    } else {
      currentInterim = res[0].transcript.trim()
    }
  }
  transcript = [accumulatedFinalText, currentInterim].filter(Boolean).join(' ')
  assert.equal(transcript, 'open YouTube')

  // Simulated Event 3: Engine restarts and second phrase is spoken after a pause
  // accumulatedFinalText is preserved!
  const event3 = {
    resultIndex: 0,
    results: [
      Object.assign([{ transcript: 'and click the first video' }], { isFinal: true })
    ]
  }
  currentInterim = ""
  for (let i = event3.resultIndex; i < event3.results.length; i++) {
    const res = event3.results[i]
    if (res.isFinal) {
      accumulatedFinalText += (accumulatedFinalText ? ' ' : '') + res[0].transcript.trim()
    } else {
      currentInterim = res[0].transcript.trim()
    }
  }
  transcript = [accumulatedFinalText, currentInterim].filter(Boolean).join(' ')
  assert.equal(transcript, 'open YouTube and click the first video')
})

test('Prompt Budget: System prompt with multilingual rules remains strictly below 1500 tokens', async () => {
  ;(global as any).chrome = {
    storage: { local: { get: async () => ({ agent_memories: [] }) } },
    tabs: { query: async () => [{ title: 'Example Page', url: 'https://example.com' }] }
  }

  const prompt = await getSystemPrompt()
  const charCount = prompt.length
  const estimatedTokens = Math.round(charCount / 3.5)

  assert.ok(charCount < 6000, `Character count (${charCount}) should be well below 6000`)
  assert.ok(estimatedTokens < 1500, `Estimated tokens (${estimatedTokens}) must be strictly below 1500`)
})
