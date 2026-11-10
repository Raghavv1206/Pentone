import { beforeEach, test, expect, vi } from 'vitest'
import { chromeMock, seed } from './setup'
import { browserTranslationLanguages, setupCatalog } from '../lib/setup-catalog'

const embedding = vi.hoisted(() => ({ prepare: vi.fn() }))
vi.mock('../lib/embeddings', () => ({ prepareEmbeddings: embedding.prepare }))
let manager: typeof import('../lib/local-setup')
let native: Record<string, any>
let cacheFiles: Set<string>

beforeEach(async () => {
  vi.resetModules()
  native = {}
  for (const name of ['LanguageModel', 'Summarizer', 'Writer', 'Rewriter', 'LanguageDetector', 'Translator']) {
    const model = { status: 'available', sessions: [] as any[], availability: vi.fn(), create: vi.fn() }
    model.availability.mockImplementation(async () => model.status)
    model.create.mockImplementation(async () => { model.status = 'available'; const session = { destroy: vi.fn() }; model.sessions.push(session); return session })
    native[name] = model
    vi.stubGlobal(name, model)
  }
  vi.stubGlobal('SpeechRecognition', class {
    processLocally = false
    static available = vi.fn(async () => 'available')
    static install = vi.fn(async () => true)
  })
  vi.stubGlobal('speechSynthesis', { getVoices: () => [{ lang: 'en-US', localService: true }] })
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: vi.fn(async () => ({ state: 'granted' })) } })
  cacheFiles = new Set(['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'])
  vi.stubGlobal('caches', { has: vi.fn(async () => true), open: vi.fn(async () => ({ match: async (url: string) => cacheFiles.has(url.split('/resolve/main/')[1]) ? { ok: true } : undefined })) })
  seed({ pentone_setup_languages: [] })
  manager = await import('../lib/local-setup')
})

test('browser preferences choose non-English languages without adding an arbitrary default', () => {
  expect(browserTranslationLanguages(['en-IN', 'en-US'])).toEqual([])
  expect(browserTranslationLanguages(['hi-IN', 'en-US', 'hi', 'fr-FR'])).toEqual(['hi', 'fr'])
  const ids = setupCatalog(['hi']).map(item => item.id)
  expect(ids).toContain('translate-en-hi'); expect(ids).toContain('translate-hi-en')
  expect(new Set(ids).size).toBe(ids.length)
})

test('readiness checks never download and do not trust the old embedding boolean', async () => {
  seed({ pentone_embedding_cached: true })
  cacheFiles.delete('onnx/model_quantized.onnx')
  await manager.refreshSetup()
  expect(manager.useSetupStore.getState().items.find(item => item.id === 'embedding')?.status).toBe('downloadable')
  for (const api of Object.values(native)) expect(api.create).not.toHaveBeenCalled()
  expect(embedding.prepare).not.toHaveBeenCalled()
  expect(chromeMock.permissions.request).not.toHaveBeenCalled()
})

test('download-all starts missing models in the click and verifies/destroys each temporary session', async () => {
  for (const api of Object.values(native)) api.status = 'downloadable'
  await manager.refreshSetup()
  const pending = manager.installSetup()
  for (const name of ['LanguageModel', 'Summarizer', 'Writer', 'Rewriter', 'LanguageDetector']) expect(native[name].create).toHaveBeenCalled()
  await pending
  expect(manager.missingSetup(manager.useSetupStore.getState().items)).toEqual([])
  for (const api of Object.values(native)) for (const session of api.sessions) expect(session.destroy).toHaveBeenCalledTimes(1)
  expect(chromeMock.permissions.request).not.toHaveBeenCalled()
})

test('a failed model does not block other downloads and can be retried alone', async () => {
  native.Writer.status = 'downloadable'; native.Summarizer.status = 'downloadable'
  native.Writer.create.mockRejectedValueOnce(new DOMException('Click required', 'NotAllowedError'))
  await manager.refreshSetup(); await manager.installSetup()
  const items = manager.useSetupStore.getState().items
  expect(items.find(item => item.id === 'writer')).toMatchObject({ status: 'error', detail: expect.stringContaining('fresh click') })
  expect(items.find(item => item.id === 'summarizer')?.status).toBe('ready')
  await manager.refreshSetup()
  expect(manager.useSetupStore.getState().items.find(item => item.id === 'writer')).toMatchObject({ status: 'error', detail: expect.stringContaining('fresh click') })
  await manager.installSetup(['writer'])
  expect(native.Summarizer.create).toHaveBeenCalledTimes(1)
  expect(manager.useSetupStore.getState().items.find(item => item.id === 'writer')?.status).toBe('ready')
})

test('creation success does not mark a still-missing resource ready', async () => {
  native.Writer.status = 'downloadable'
  const destroy = vi.fn()
  native.Writer.create.mockResolvedValue({ destroy })
  await manager.refreshSetup(); await manager.installSetup(['writer'])
  expect(destroy).toHaveBeenCalledOnce()
  expect(manager.useSetupStore.getState().items.find(item => item.id === 'writer')?.status).toBe('error')
})

test('cancelled native creation destroys a late session without marking it ready', async () => {
  native.Writer.status = 'downloadable'
  let finish!: (session: any) => void
  native.Writer.create.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await manager.refreshSetup()
  const pending = manager.installSetup(['writer'])
  manager.cancelSetup()
  await pending
  const destroy = vi.fn(); finish({ destroy })
  await Promise.resolve(); await Promise.resolve()
  expect(destroy).toHaveBeenCalledOnce()
  expect(manager.useSetupStore.getState().items.find(item => item.id === 'writer')?.status).toBe('downloadable')
  expect(manager.useSetupStore.getState().busy).toBe(false)
})

test('duplicate setup clicks share the active operation', async () => {
  native.Writer.status = 'downloadable'
  let finish!: () => void
  native.Writer.create.mockImplementation(() => new Promise(resolve => { finish = () => { native.Writer.status = 'available'; resolve({ destroy: vi.fn() }) } }))
  await manager.refreshSetup()
  const first = manager.installSetup(['writer'])
  await manager.installSetup(['writer'])
  expect(native.Writer.create).toHaveBeenCalledOnce()
  finish(); await first
})

test('language changes validate input and inspect both directions before downloading', async () => {
  await manager.refreshSetup(); await manager.setSetupLanguages(['hi'])
  expect(native.Translator.availability).toHaveBeenCalledWith({ sourceLanguage: 'en', targetLanguage: 'hi' })
  expect(native.Translator.availability).toHaveBeenCalledWith({ sourceLanguage: 'hi', targetLanguage: 'en' })
  expect(native.Translator.create).not.toHaveBeenCalled()
  await expect(manager.setSetupLanguages(['../../bad'])).rejects.toThrow()
  expect(manager.useSetupStore.getState().languages).toEqual(['hi'])
})

test('online voices are not considered installed local speech output', async () => {
  vi.stubGlobal('speechSynthesis', { getVoices: () => [{ lang: 'en-US', localService: false }] })
  await manager.refreshSetup()
  expect(manager.useSetupStore.getState().items.find(item => item.id === 'voice')?.status).toBe('action')
})

test('unavailable APIs stay unsupported and are excluded from download-all', async () => {
  native.Writer.status = 'unavailable'
  await manager.refreshSetup(); await manager.installSetup()
  expect(native.Writer.create).not.toHaveBeenCalled()
  expect(manager.useSetupStore.getState().items.find(item => item.id === 'writer')?.status).toBe('unsupported')
})

test('native setup timeout releases UI wait and cancellation clears its timer', async () => {
  vi.useFakeTimers()
  const controller = new AbortController()
  const pending = manager.waitForSetup(new Promise(() => {}), controller.signal, 1000)
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort(); await rejected
  expect(vi.getTimerCount()).toBe(0)
  const timed = manager.waitForSetup(new Promise(() => {}), undefined, 1000)
  const timeout = expect(timed).rejects.toThrow('taking longer')
  await vi.advanceTimersByTimeAsync(1000); await timeout
  expect(vi.getTimerCount()).toBe(0)
})
