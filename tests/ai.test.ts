import { test, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('../lib/prompts/system-prompt', () => ({ getSystemPrompt: async () => 'System prompt' }))
import { ensureSession, streamResponse, interrupt, destroySession, isModelReady, isMultimodalUnsupportedError, setConversationContext, preloadModel } from '../lib/ai'
const session = { destroy: vi.fn(), promptStreaming: vi.fn(), inputUsage: 20 }
let model: any
beforeEach(() => {
  destroySession(); session.destroy.mockClear()
  session.promptStreaming.mockImplementation(async function* () { yield 'Hello'; yield ' world' })
  model = { availability: vi.fn(async () => 'available'), create: vi.fn(async () => session) }
  ;(window as any).LanguageModel = model
})
afterEach(() => { destroySession(); delete (window as any).LanguageModel })
test('100 concurrent initializations share one session', async () => {
  const sessions = await Promise.all(Array.from({ length: 100 }, () => ensureSession()))
  expect(sessions.every(s => s === session)).toBe(true); expect(model.create).toHaveBeenCalledTimes(1)
})

test('startup warmup leaves first-use downloads to the setup flow', async () => {
  model.availability.mockResolvedValue('downloadable')
  expect(await preloadModel()).toBe(false)
  expect(model.create).not.toHaveBeenCalled()
})
test('destroy during creation disposes the late session', async () => {
  let finish: Function = () => {}
  model.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = ensureSession(); const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(model.create).toHaveBeenCalledTimes(1))
  destroySession(); finish(session); await rejection
  expect(isModelReady()).toBe(false); expect(session.destroy).toHaveBeenCalledTimes(1)
})
test('interrupt during initialization never starts a prompt', async () => {
  let finish: Function = () => {}
  model.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = streamResponse('hello', vi.fn()); const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(model.create).toHaveBeenCalledTimes(1))
  interrupt(); finish(session); await rejection
  expect(session.promptStreaming).not.toHaveBeenCalled()
})
test('aborted and quota exceptions are not unsupported media', () => {
  expect(isMultimodalUnsupportedError(new DOMException('aborted', 'AbortError'))).toBe(false)
  expect(isMultimodalUnsupportedError(new DOMException('quota exceeded', 'QuotaExceededError'))).toBe(false)
})
test('unsupported media reports its limitation and never prompts a fake review', async () => {
  model.availability.mockImplementation(async (opts: any) => opts.expectedInputs ? 'unavailable' : 'available')
  const output = vi.fn(); await streamResponse('describe it', output, 'data:image/png;base64,AA==')
  expect(output).toHaveBeenCalledWith(expect.stringContaining('cannot analyze'))
  expect(session.promptStreaming).not.toHaveBeenCalled()
})
test('summary is supplied to the newly created session', async () => {
  setConversationContext('User requested example.com')
  await ensureSession()
  expect(model.create.mock.calls[0][0].initialPrompts[0].content).toContain('User requested example.com')
})

test('native capability rejection produces a media notice without an uncaught exception', async () => {
  model.availability.mockImplementation(async (opts: any) => {
    if (opts.expectedInputs) throw new DOMException('Model capability is not available.', 'NotAllowedError')
    return 'available'
  })
  const output = vi.fn()
  await streamResponse('listen to this file', output, 'data:audio/wav;base64,AA==')
  expect(output).toHaveBeenCalledWith(expect.stringContaining('cannot analyze'))
  expect(session.promptStreaming).not.toHaveBeenCalled()
})

test('unknown media availability never attempts to create a media session', async () => {
  model.availability.mockImplementation(async (opts: any) => opts.expectedInputs ? undefined : 'available')
  await streamResponse('inspect', vi.fn(), 'data:image/png;base64,AA==')
  expect(model.create).toHaveBeenCalledTimes(1)
})
