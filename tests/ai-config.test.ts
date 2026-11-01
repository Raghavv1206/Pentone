import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  normalizeLanguage,
  buildSessionOptions,
  checkPromptAPIAvailability,
  createResilientSession
} from '../lib/ai-config'
import { getSystemPrompt } from '../lib/prompts/system-prompt'

test('AI Config: Default language is English and matches supported code list', () => {
  assert.equal(DEFAULT_LANGUAGE, 'en')
  assert.ok(SUPPORTED_LANGUAGES.includes('en'))
  assert.ok(SUPPORTED_LANGUAGES.includes('de'))
  assert.ok(SUPPORTED_LANGUAGES.includes('es'))
  assert.ok(SUPPORTED_LANGUAGES.includes('fr'))
  assert.ok(SUPPORTED_LANGUAGES.includes('ja'))
})

test('AI Config: Language normalization maps variants to supported BCP-47 prefixes', () => {
  assert.equal(normalizeLanguage('en-US'), 'en')
  assert.equal(normalizeLanguage('en-GB'), 'en')
  assert.equal(normalizeLanguage('de-DE'), 'de')
  assert.equal(normalizeLanguage('ja-JP'), 'ja')
  assert.equal(normalizeLanguage('unsupported-XX'), 'en')
  assert.equal(normalizeLanguage(undefined), 'en')
})

test('AI Config: buildSessionOptions ALWAYS includes expectedOutputs with supported language', () => {
  // Test empty options
  const defaultOpts = buildSessionOptions()
  assert.ok(defaultOpts.expectedOutputs)
  assert.equal(defaultOpts.expectedOutputs.length, 1)
  assert.equal(defaultOpts.expectedOutputs[0].type, 'text')
  assert.deepEqual(defaultOpts.expectedOutputs[0].languages, ['en'])

  // Test multimodal options
  const multiOpts = buildSessionOptions({ multimodal: true })
  assert.equal(multiOpts.expectedInputs.length, 2)
  assert.equal(multiOpts.expectedInputs[0].type, 'text')
  assert.equal(multiOpts.expectedInputs[1].type, 'image')
  assert.deepEqual(multiOpts.expectedOutputs[0].languages, ['en'])

  // Test custom language
  const deOpts = buildSessionOptions({ languages: ['de'] })
  assert.deepEqual(deOpts.expectedOutputs[0].languages, ['de'])
})

test('AI Config: checkPromptAPIAvailability returns available when multimodal is supported', async () => {
  let passedOptions: any = null

  const mockLM = {
    availability: async (options: any) => {
      passedOptions = options
      return 'available'
    }
  }

  const originalWindow = (global as any).window
  ;(global as any).window = { LanguageModel: mockLM }

  try {
    const result = await checkPromptAPIAvailability({ multimodal: true })
    assert.equal(result, 'available')
    assert.ok(passedOptions)
    assert.ok(passedOptions.expectedInputs.some((i: any) => i.type === 'image'), 'Must declare image input')
    assert.deepEqual(passedOptions.expectedOutputs[0].languages, ['en'])
  } finally {
    ;(global as any).window = originalWindow
  }
})

test('AI Config: Multimodal availability failure returns "unavailable" without falling back to text availability', async () => {
  let checkedTypes: string[][] = []

  const mockLM = {
    availability: async (options?: any) => {
      if (!options || !options.expectedInputs) {
        // In real Chrome, parameterless availability checks text model and returns 'available'
        return 'available'
      }
      const types = options.expectedInputs.map((i: any) => i.type)
      checkedTypes.push(types)
      // Throw or return 'unavailable' on multimodal
      if (types.includes('image')) {
        throw new Error('Image input not supported on this device')
      }
      return 'available' // Text only would be available
    }
  }

  const originalWindow = (global as any).window
  ;(global as any).window = { LanguageModel: mockLM }

  try {
    const result = await checkPromptAPIAvailability({ multimodal: true })
    // Must return 'unavailable' and NOT fall back to 'available' from text!
    assert.equal(result, 'unavailable')
    assert.equal(checkedTypes.length, 1, 'Must not make secondary fallback call to text availability')
    assert.deepEqual(checkedTypes[0], ['text', 'image'])
  } finally {
    ;(global as any).window = originalWindow
  }
})

test('AI Config: createResilientSession creates session cleanly without cascading retries', async () => {
  let callCount = 0
  let passedOptions: any = null

  const mockLM = {
    create: async (options: any) => {
      callCount++
      passedOptions = options
      return { id: 'mock-session', destroy: () => {} }
    }
  }

  const originalWindow = (global as any).window
  ;(global as any).window = { LanguageModel: mockLM }

  try {
    const session = await createResilientSession({
      initialPrompt: 'System instructions',
      multimodal: false
    })

    assert.ok(session)
    assert.equal(session.id, 'mock-session')
    assert.equal(callCount, 1, 'Must execute exactly one creation attempt without retry loops')
    assert.ok(passedOptions.expectedOutputs)
    assert.deepEqual(passedOptions.expectedOutputs[0].languages, ['en'])
  } finally {
    ;(global as any).window = originalWindow
  }
})

test('AI Config: createResilientSession surfaces actionable error when circuit breaker trips', async () => {
  const mockLM = {
    create: async () => {
      throw new Error('The model process crashed too many times for this version.')
    }
  }

  const originalWindow = (global as any).window
  ;(global as any).window = { LanguageModel: mockLM }

  try {
    await assert.rejects(async () => {
      await createResilientSession({ initialPrompt: 'test' })
    }, /crashed too many times and was disabled by Chrome.*chrome:\/\/restart/i)
  } finally {
    ;(global as any).window = originalWindow
  }
})

test('AI Config: Gracefully handles environments where LanguageModel is missing', async () => {
  const originalWindow = (global as any).window
  ;(global as any).window = {}

  try {
    const availability = await checkPromptAPIAvailability()
    assert.equal(availability, 'unavailable')

    await assert.rejects(async () => {
      await createResilientSession({ initialPrompt: 'test' })
    }, /not available in this environment/i)
  } finally {
    ;(global as any).window = originalWindow
  }
})

test('Prompt Budget: Static system prompt is compact and well below 1500 tokens', async () => {
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
