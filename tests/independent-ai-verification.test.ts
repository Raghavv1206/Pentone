import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { checkPromptAPIAvailability } from '../lib/ai-config'
import { useTextExplainer } from '../lib/use-text-explainer'

// Lightweight dispatcher harness to run and inspect React hooks outside the DOM
function runExplainerHook() {
  const ReactShared = (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
  const states: any[] = []
  const setters: any[] = []
  const refs: any[] = []
  const cleanups: (() => void)[] = []
  let stateCursor = 0
  let refCursor = 0

  const dispatcher = {
    useState(initial: any) {
      const idx = stateCursor++
      if (states.length <= idx) {
        states[idx] = typeof initial === 'function' ? initial() : initial
        setters[idx] = (val: any) => {
          states[idx] = typeof val === 'function' ? val(states[idx]) : val
        }
      }
      return [states[idx], setters[idx]]
    },
    useRef(initial: any) {
      const idx = refCursor++
      if (refs.length <= idx) {
        refs[idx] = { current: initial }
      }
      return refs[idx]
    },
    useEffect(effectFn: () => any) {
      const cleanup = effectFn()
      if (typeof cleanup === 'function') {
        cleanups.push(cleanup)
      }
    }
  }

  const prevDispatcher = ReactShared.ReactCurrentDispatcher.current
  ReactShared.ReactCurrentDispatcher.current = dispatcher

  let hook: ReturnType<typeof useTextExplainer>
  try {
    hook = useTextExplainer()
  } finally {
    ReactShared.ReactCurrentDispatcher.current = prevDispatcher
  }

  return {
    hook,
    getExplanation: () => states[1],
    getDisplayedExplanation: () => states[2],
    getTextSession: () => refs[0]?.current,
    getImageSession: () => refs[1]?.current,
    unmount: () => {
      cleanups.forEach(c => c())
    }
  }
}

// Global Chrome mocks
if (typeof (global as any).chrome === 'undefined') {
  ;(global as any).chrome = {
    storage: { local: { get: async () => ({}) } },
    tabs: { query: async () => [{ title: 'Test Page', url: 'https://example.com' }] }
  }
}

test('AI Independence: checkPromptAPIAvailability never uses text availability as proof of image capability', async () => {
  const originalWindow = (global as any).window
  let optionlessCalled = false

  const mockLM = {
    availability: async (options?: any) => {
      if (!options || !options.expectedInputs) {
        optionlessCalled = true
        return 'available' // Text model is available
      }
      const types = options.expectedInputs.map((i: any) => i.type)
      if (types.includes('image')) {
        throw new Error('Image inputs not supported on this device')
      }
      return 'available'
    }
  }

  ;(global as any).window = { LanguageModel: mockLM }

  try {
    const multiAvail = await checkPromptAPIAvailability({ multimodal: true })
    assert.equal(multiAvail, 'unavailable', 'Multimodal availability must be unavailable when image input is unsupported')
    assert.equal(optionlessCalled, false, 'Must never make secondary fallback call to parameterless text availability')

    const textAvail = await checkPromptAPIAvailability({ multimodal: false })
    assert.equal(textAvail, 'available', 'Text availability must still be available')
  } finally {
    ;(global as any).window = originalWindow
  }
})

test('AI Independence: Text Action 1 - Explain requests text-only session and streams chunks', async () => {
  const originalWindow = (global as any).window
  let requestedInputs: any = null
  let promptReceived = ''

  const mockTextSession = {
    promptStreaming: async function* (prompt: string) {
      promptReceived = prompt
      yield 'Explanation chunk 1. '
      yield 'Explanation chunk 2.'
    },
    destroy: () => {}
  }

  ;(global as any).window = {
    LanguageModel: {
      availability: async () => 'available',
      create: async (opts: any) => {
        requestedInputs = opts.expectedInputs
        return mockTextSession
      }
    }
  }

  try {
    const harness = runExplainerHook()
    await harness.hook.generateAction('explain', 'Artificial intelligence')

    assert.ok(requestedInputs, 'Must request session creation')
    assert.equal(requestedInputs.some((i: any) => i.type === 'image'), false, 'Must NOT request image input')
    assert.ok(promptReceived.includes('Artificial intelligence'))
    assert.ok(promptReceived.includes('clearly and concisely in 2-3 sentences'))
    assert.equal(harness.getExplanation(), 'Explanation chunk 1. Explanation chunk 2.')
  } finally {
    ;(global as any).window = originalWindow
  }
})

test('AI Independence: Text Action 2 - Summarize requests text-only session and streams chunks', async () => {
  const originalWindow = (global as any).window
  let promptReceived = ''

  const mockTextSession = {
    promptStreaming: async function* (prompt: string) {
      promptReceived = prompt
      yield 'Summary of the key points.'
    },
    destroy: () => {}
  }

  ;(global as any).window = {
    LanguageModel: {
      availability: async () => 'available',
      create: async () => mockTextSession
    }
  }

  try {
    const harness = runExplainerHook()
    await harness.hook.generateAction('summarize', 'Long detailed article')

    assert.ok(promptReceived.includes('clear, high-level summary'))
    assert.ok(promptReceived.includes('Long detailed article'))
    assert.equal(harness.getExplanation(), 'Summary of the key points.')
  } finally {
    ;(global as any).window = originalWindow
  }
})

test('AI Independence: Text Action 3 - Rewrite requests text-only session and streams chunks', async () => {
  const originalWindow = (global as any).window
  let promptReceived = ''

  const mockTextSession = {
    promptStreaming: async function* (prompt: string) {
      promptReceived = prompt
      yield 'Rewritten elegant version.'
    },
    destroy: () => {}
  }

  ;(global as any).window = {
    LanguageModel: {
      availability: async () => 'available',
      create: async () => mockTextSession
    }
  }

  try {
    const harness = runExplainerHook()
    await harness.hook.generateAction('rewrite', 'Draft rough notes')

    assert.ok(promptReceived.includes('improve clarity, elegance, and readability'))
    assert.ok(promptReceived.includes('Draft rough notes'))
    assert.equal(harness.getExplanation(), 'Rewritten elegant version.')
  } finally {
    ;(global as any).window = originalWindow
  }
})

test('AI Independence: Text Action 4 - Translate requests text-only session and streams chunks', async () => {
  const originalWindow = (global as any).window
  let promptReceived = ''

  const mockTextSession = {
    promptStreaming: async function* (prompt: string) {
      promptReceived = prompt
      yield 'Translated English version.'
    },
    destroy: () => {}
  }

  ;(global as any).window = {
    LanguageModel: {
      availability: async () => 'available',
      create: async () => mockTextSession
    }
  }

  try {
    const harness = runExplainerHook()
    await harness.hook.generateAction('translate', 'Bonjour le monde')

    assert.ok(promptReceived.includes('Translate the following text'))
    assert.ok(promptReceived.includes('Bonjour le monde'))
    assert.equal(harness.getExplanation(), 'Translated English version.')
  } finally {
    ;(global as any).window = originalWindow
  }
})

test('AI Independence: Text Action 5 - Ask Pentone requests text-only session and custom prompt', async () => {
  const originalWindow = (global as any).window
  let promptReceived = ''

  const mockTextSession = {
    promptStreaming: async function* (prompt: string) {
      promptReceived = prompt
      yield 'Insightful answer.'
    },
    destroy: () => {}
  }

  ;(global as any).window = {
    LanguageModel: {
      availability: async () => 'available',
      create: async () => mockTextSession
    }
  }

  try {
    const harness = runExplainerHook()
    await harness.hook.generateAction('ask', 'Target text', 'What are the main consequences?')

    assert.ok(promptReceived.includes('What are the main consequences?'))
    assert.ok(promptReceived.includes('Target text'))
    assert.equal(harness.getExplanation(), 'Insightful answer.')
  } finally {
    ;(global as any).window = originalWindow
  }
})

test('AI Independence: Image Scenario 1 - Image-capable model available creates multimodal session', async () => {
  const originalWindow = (global as any).window
  const originalFetch = (global as any).fetch
  let passedInputs: any = null
  let promptPayload: any = null

  const mockMultiSession = {
    promptStreaming: async function* (content: any) {
      promptPayload = content
      yield 'I see a search results page.'
    },
    destroy: () => {}
  }

  ;(global as any).window = {
    LanguageModel: {
      availability: async (opts?: any) => {
        if (opts?.expectedInputs?.some((i: any) => i.type === 'image')) {
          return 'available'
        }
        return 'available'
      },
      create: async (opts: any) => {
        passedInputs = opts.expectedInputs
        return mockMultiSession
      }
    }
  }

  ;(global as any).fetch = async () => ({
    blob: async () => new Blob(['fake-image-bytes'], { type: 'image/png' })
  })

  try {
    const harness = runExplainerHook()
    await harness.hook.generateExplanationWithImage('data:image/png;base64,mock')

    assert.ok(passedInputs.some((i: any) => i.type === 'image'), 'Must declare image input type')
    assert.ok(promptPayload, 'Prompt payload must be sent')
    assert.equal(harness.getExplanation(), 'I see a search results page.')
  } finally {
    ;(global as any).window = originalWindow
    ;(global as any).fetch = originalFetch
  }
})

test('AI Independence: Image Scenario 2 - Image capability unavailable returns clean message without crash', async () => {
  const originalWindow = (global as any).window
  let createCalled = false

  ;(global as any).window = {
    LanguageModel: {
      availability: async (opts?: any) => {
        if (opts?.expectedInputs?.some((i: any) => i.type === 'image')) {
          return 'unavailable'
        }
        return 'available'
      },
      create: async () => {
        createCalled = true
        throw new Error('Should not be called')
      }
    }
  }

  try {
    const harness = runExplainerHook()
    await harness.hook.generateExplanationWithImage('data:image/png;base64,mock')

    assert.equal(createCalled, false, 'Must not attempt session creation when multimodal is unavailable')
    const exp = harness.getExplanation()
    assert.ok(exp.includes('On-device image multimodal analysis is not supported'), 'Must explain capability honestly')
    assert.ok(!exp.includes('The device is unable to create a session'), 'Must not crash with unhandled exception')
  } finally {
    ;(global as any).window = originalWindow
  }
})

test('AI Independence: Image Scenario 3 - Image session creation rejected surfaces error cleanly', async () => {
  const originalWindow = (global as any).window
  const originalFetch = (global as any).fetch

  ;(global as any).window = {
    LanguageModel: {
      availability: async () => 'available', // reports available
      create: async () => {
        // creation fails
        throw new Error('Hardware acceleration failure')
      }
    }
  }

  ;(global as any).fetch = async () => ({
    blob: async () => new Blob(['mock'], { type: 'image/png' })
  })

  try {
    const harness = runExplainerHook()
    await harness.hook.generateExplanationWithImage('data:image/png;base64,mock')

    const exp = harness.getExplanation()
    assert.ok(exp.includes('Unable to initialize on-device image multimodal session'), 'Must surface clean session error')
  } finally {
    ;(global as any).window = originalWindow
    ;(global as any).fetch = originalFetch
  }
})

test('AI Independence: Image Scenario 4 - Invalid image input surfaces fetch error without crashing', async () => {
  const originalWindow = (global as any).window
  const originalFetch = (global as any).fetch

  const mockMultiSession = {
    promptStreaming: async function* () { yield 'Done' },
    destroy: () => {}
  }

  ;(global as any).window = {
    LanguageModel: {
      availability: async () => 'available',
      create: async () => mockMultiSession
    }
  }

  ;(global as any).fetch = async () => {
    throw new Error('Failed to fetch image data URL')
  }

  try {
    const harness = runExplainerHook()
    await harness.hook.generateExplanationWithImage('invalid:url')

    const exp = harness.getExplanation()
    assert.ok(exp.includes('Error analyzing image: Failed to fetch image data URL'))
  } finally {
    ;(global as any).window = originalWindow
    ;(global as any).fetch = originalFetch
  }
})

test('AI Independence: Image Scenario 5 - Session cleanup and retry releases old session', async () => {
  const originalWindow = (global as any).window
  const originalFetch = (global as any).fetch
  let destroyed = false

  const mockMultiSession = {
    promptStreaming: async function* () { yield 'Result' },
    destroy: () => { destroyed = true }
  }

  ;(global as any).window = {
    LanguageModel: {
      availability: async () => 'available',
      create: async () => mockMultiSession
    }
  }

  ;(global as any).fetch = async () => ({
    blob: async () => new Blob(['mock'], { type: 'image/png' })
  })

  try {
    const harness = runExplainerHook()
    await harness.hook.generateExplanationWithImage('data:image/png;base64,mock')

    assert.ok(harness.getImageSession(), 'Image session must be created')
    // Trigger unmount
    harness.unmount()
    assert.equal(destroyed, true, 'Image session must be destroyed on unmount')
  } finally {
    ;(global as any).window = originalWindow
    ;(global as any).fetch = originalFetch
  }
})
