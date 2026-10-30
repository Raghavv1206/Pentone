import test from 'node:test'
import assert from 'node:assert/strict'
import { streamResponse, destroySession } from '../lib/ai'

test('Session Lifecycle: Preserves existing text session when multimodal creation fails', async () => {
  destroySession()

  let textSessionCreated = false
  let multimodalAttempted = false
  let destroyedSessions: string[] = []

  // Mock sessions
  const mockTextSession = {
    id: 'text-session-1',
    promptStreaming: async function* (prompt: any) {
      yield 'Text response based on page context'
    },
    destroy: () => { destroyedSessions.push('text-session-1') }
  }

  const mockLM = {
    availability: async (options: any) => {
      // Both text and multimodal report available
      return 'available'
    },
    create: async (options: any) => {
      const isMulti = options.expectedInputs?.some((i: any) => i.type === 'image')
      if (isMulti) {
        multimodalAttempted = true
        throw new Error('The device is unable to create a session to run the model. Please check the result of availability() first.')
      }
      textSessionCreated = true
      return mockTextSession
    }
  }

  ;(global as any).window = { LanguageModel: mockLM }
  ;(global as any).chrome = {
    storage: { local: { get: async () => ({ agent_memories: [] }) } },
    tabs: { query: async () => [{ title: 'YouTube', url: 'https://www.youtube.com' }] }
  }

  try {
    // 1. Initial text message creates text session
    let chunks: string[] = []
    await streamResponse('open YouTube', (c) => chunks.push(c))
    assert.ok(textSessionCreated, 'Initial text session must be created')
    assert.equal(destroyedSessions.length, 0, 'Text session must not be destroyed')

    // 2. Screenshot captured, loopback invoked with image data URL
    const screenshotDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    chunks = []
    await streamResponse('what is visible', (c) => chunks.push(c), screenshotDataUrl)

    // Verify:
    assert.ok(multimodalAttempted, 'Should have attempted multimodal session creation')
    assert.equal(destroyedSessions.length, 0, 'Working text session MUST NOT be destroyed when multimodal creation fails')
    assert.ok(chunks.join('').includes('Text response based on page context'), 'Should have successfully streamed response using preserved text session')

  } finally {
    destroySession()
  }
})

test('Session Lifecycle: Successfully switches to multimodal session when supported', async () => {
  destroySession()

  let destroyedSessions: string[] = []
  let activeSessionType = ''

  const mockTextSession = {
    id: 'text-session-2',
    promptStreaming: async function* () {
      activeSessionType = 'text'
      yield 'Text response'
    },
    destroy: () => { destroyedSessions.push('text-session-2') }
  }

  const mockMultiSession = {
    id: 'multi-session-2',
    promptStreaming: async function* (input: any) {
      activeSessionType = 'multimodal'
      assert.ok(Array.isArray(input), 'Multimodal input must be an array of messages')
      yield 'Multimodal visual analysis complete'
    },
    destroy: () => { destroyedSessions.push('multi-session-2') }
  }

  const mockLM = {
    availability: async () => 'available',
    create: async (options: any) => {
      const isMulti = options.expectedInputs?.some((i: any) => i.type === 'image')
      return isMulti ? mockMultiSession : mockTextSession
    }
  }

  ;(global as any).window = { LanguageModel: mockLM }
  ;(global as any).chrome = {
    storage: { local: { get: async () => ({ agent_memories: [] }) } },
    tabs: { query: async () => [{ title: 'YouTube', url: 'https://www.youtube.com' }] }
  }
  // Mock fetch for data URL blob conversion
  ;(global as any).fetch = async () => ({
    blob: async () => new Blob(['mock-bytes'], { type: 'image/png' })
  })

  try {
    // 1. Text prompt creates text session
    let chunks: string[] = []
    await streamResponse('hello', (c) => chunks.push(c))
    assert.equal(activeSessionType, 'text')
    assert.equal(destroyedSessions.length, 0)

    // 2. Screenshot tool result switches to multimodal session
    const screenshotDataUrl = 'data:image/png;base64,iVBORw0KGgo='
    chunks = []
    await streamResponse('describe this', (c) => chunks.push(c), screenshotDataUrl)

    assert.equal(activeSessionType, 'multimodal')
    assert.ok(destroyedSessions.includes('text-session-2'), 'Old text session must be cleanly destroyed after multimodal creation succeeds')
    assert.ok(chunks.join('').includes('Multimodal visual analysis complete'))

  } finally {
    destroySession()
  }
})

test('Session Lifecycle: Concurrency lock prevents overlapping session creations', async () => {
  destroySession()

  let creationCount = 0

  const mockLM = {
    availability: async () => 'available',
    create: async () => {
      creationCount++
      // Artificial delay to simulate on-device model allocation
      await new Promise(r => setTimeout(r, 50))
      return {
        promptStreaming: async function* () { yield 'Done' },
        destroy: () => {}
      }
    }
  }

  ;(global as any).window = { LanguageModel: mockLM }
  ;(global as any).chrome = {
    storage: { local: { get: async () => ({ agent_memories: [] }) } },
    tabs: { query: async () => [{ title: 'Test', url: 'https://test.com' }] }
  }

  try {
    // Fire 3 concurrent requests simultaneously
    const p1 = streamResponse('call 1', () => {})
    const p2 = streamResponse('call 2', () => {})
    const p3 = streamResponse('call 3', () => {})

    await Promise.all([p1, p2, p3])

    assert.equal(creationCount, 1, 'Only exactly 1 session creation must occur despite concurrent callers')

  } finally {
    destroySession()
  }
})
