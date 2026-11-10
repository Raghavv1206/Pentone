import { useEffect } from 'react'
import { create } from 'zustand'
import * as z from 'zod'
import { getLanguageModelAPI, getWriterAPI, getRewriterAPI, getSummarizerAPI, getTranslatorAPI, getLanguageDetectorAPI } from './chrome-ai-helpers'
import { localSpeechLocales, prepareLocalSpeech, SpeechSetupNotice } from './local-speech'
import { getRecommendedSpeechLocale } from './voice-selector'
import { browserPermissions, browserTranslationLanguages, setupCatalog, translationLanguages, type SetupItem, type SetupStatus } from './setup-catalog'

const preferencesKey = 'pentone_setup_languages'
const languagesSchema = z.array(z.string().refine(value => Object.hasOwn(translationLanguages, value))).max(5)
interface SetupState {
  items: SetupItem[]
  languages: string[]
  initialized: boolean
  checking: boolean
  busy: boolean
  message: string
  focusId: string | null
}
const defaults = browserTranslationLanguages(typeof navigator === 'undefined' ? [] : navigator.languages || [navigator.language])
export const useSetupStore = create<SetupState>(() => ({
  items: setupCatalog(defaults), languages: defaults, initialized: false, checking: false, busy: false, message: '', focusId: null
}))
let refreshJob: Promise<void> | null = null
let revision = 0
let controller: AbortController | null = null
const inspected = new Map<string, ReturnType<typeof nativeResource>>()
const patchItem = (id: string, patch: Partial<SetupItem>) => useSetupStore.setState(state => ({ items: state.items.map(item => item.id === id ? { ...item, ...patch } : item) }))

export function focusSetup(id: string) { useSetupStore.setState({ focusId: id }) }
export function missingSetup(items: SetupItem[]) {
  return items.filter(item => (item.essential || (['image', 'audio'].includes(item.id) && ['downloadable', 'downloading', 'error'].includes(item.status))) && item.status !== 'ready' && item.status !== 'checking')
}

function nativeResource(id: string): { api: any; options: Record<string, unknown> } | null {
  const language = { outputLanguage: 'en', expectedInputLanguages: ['en'], expectedContextLanguages: ['en'] }
  if (id === 'prompt') return { api: getLanguageModelAPI(), options: { expectedOutputs: [{ type: 'text', languages: ['en'] }], outputLanguage: 'en' } }
  if (id === 'writer') return { api: getWriterAPI(), options: { ...language, tone: 'neutral', format: 'plain-text', length: 'medium' } }
  if (id === 'rewriter') return { api: getRewriterAPI(), options: { ...language, tone: 'as-is', format: 'plain-text', length: 'as-is' } }
  if (id === 'summarizer') return { api: getSummarizerAPI(), options: { ...language, type: 'key-points', format: 'plain-text', length: 'medium' } }
  if (id === 'detector') return { api: getLanguageDetectorAPI(), options: {} }
  if (id === 'image' || id === 'audio') return { api: getLanguageModelAPI(), options: { expectedInputs: [{ type: 'text' }, { type: id }], expectedOutputs: [{ type: 'text', languages: ['en'] }] } }
  if (id.startsWith('translate-')) {
    const [, sourceLanguage, targetLanguage] = id.split('-')
    return { api: getTranslatorAPI(), options: { sourceLanguage, targetLanguage } }
  }
  return null
}

// Native APIs can remain pending after cancellation. Bound UI waits, and let
// callers destroy late sessions without allowing them to change current state.
export function waitForSetup<T>(operation: Promise<T>, signal?: AbortSignal, timeoutMs = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const finish = (callback: (value: any) => void, value: any) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); callback(value) }
    const abort = () => finish(reject, new DOMException('Setup cancelled', 'AbortError'))
    const timer = setTimeout(() => finish(reject, new Error('This step is taking longer than expected. Check your connection and retry.')), timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    operation.then(value => finish(resolve, value), error => finish(reject, error))
    if (signal?.aborted) abort()
  })
}

function normalizeAvailability(value: unknown): SetupStatus {
  if (value === 'available' || value === 'readily') return 'ready'
  if (value === 'downloadable' || value === 'after-download') return 'downloadable'
  if (value === 'downloading') return 'downloading'
  return 'unsupported'
}
async function nativeAvailability(resource: NonNullable<ReturnType<typeof nativeResource>>) {
  const { api, options } = resource
  if (typeof api?.create !== 'function') return 'unsupported' as const
  if (typeof api.availability === 'function') return normalizeAvailability(await api.availability(options))
  if (typeof api.capabilities === 'function') return normalizeAvailability((await api.capabilities(options))?.available)
  return 'unsupported' as const
}

// Check actual cached assets, not the old pentone_embedding_cached boolean.
export async function embeddingFilesCached(): Promise<boolean> {
  if (typeof caches === 'undefined' || !(await caches.has('transformers-cache'))) return false
  const cache = await caches.open('transformers-cache')
  const base = 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/'
  const files = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx']
  const matches = await Promise.all(files.map(file => cache.match(base + file)))
  return matches.every(response => response?.ok)
}

async function inspectItem(item: SetupItem): Promise<Partial<SetupItem>> {
  const resource = nativeResource(item.id)
  if (resource) {
    const status = await nativeAvailability(resource)
    inspected.set(item.id, resource)
    return { status, detail: status === 'unsupported' ? 'Not supported by this Chrome version, device or language configuration. Open the setup help below.' : undefined }
  }
  if (item.id === 'embedding') return { status: await embeddingFilesCached() ? 'ready' : 'downloadable' }
  if (item.id === 'speech') {
    const api = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!api?.available || !('processLocally' in new api())) return { status: 'unsupported', detail: 'Update Chrome to a version with on-device speech support.' }
    let candidate: Partial<SetupItem> = { status: 'unsupported', detail: 'No supported local speech pack for your language.' }
    for (const locale of localSpeechLocales(getRecommendedSpeechLocale())) {
      const state = await api.available({ langs: [locale], processLocally: true })
      if (state === 'available') return { status: 'ready', detail: locale }
      if ((state === 'downloadable' || state === 'downloading') && candidate.status === 'unsupported') candidate = { status: normalizeAvailability(state), installLocale: locale, detail: locale }
    }
    return candidate
  }
  if (item.id === 'microphone') {
    const permission = await navigator.permissions.query({ name: 'microphone' as PermissionName })
    return { status: permission.state === 'granted' ? 'ready' : 'action', detail: permission.state === 'denied' ? 'Microphone access is blocked. Enable it in Chrome site settings.' : 'Approve the microphone prompt in a separate Pentone tab.' }
  }
  if (item.id === 'voice') {
    const voices = window.speechSynthesis?.getVoices().filter(voice => voice.localService && voice.lang.toLowerCase().startsWith('en')) || []
    return { status: voices.length ? 'ready' : 'action', detail: voices.length ? `${voices.length} local English voice(s) available` : 'Install an English speech voice in your computer’s language/speech settings, then reopen Chrome.' }
  }
  if (item.id === 'wakeword') {
    const { loadSettings } = await import('./settings')
    const saved = await loadSettings()
    return { status: 'action', detail: saved.picovoiceAccessKey?.trim() ? 'AccessKey saved. Activation is checked when you enable hands-free listening.' : 'Optional: add your Picovoice AccessKey in Audio & Speech settings. Voice buttons work without it.' }
  }
  const permission = item.id.replace('permission-', '')
  if (Object.hasOwn(browserPermissions, permission)) return { status: await chrome.permissions.contains({ permissions: [permission as keyof typeof browserPermissions] }) ? 'ready' : 'action' }
  return { status: 'unsupported' }
}

export function refreshSetup(): Promise<void> {
  if (controller) {
    const current = revision
    // Permission and OS voice changes should be visible during long downloads.
    return Promise.all(useSetupStore.getState().items.filter(item => ['microphone', 'voice', 'wakeword'].includes(item.id) || item.id.startsWith('permission-')).map(async item => {
      try {
        const result = await waitForSetup(inspectItem(item))
        if (current === revision) patchItem(item.id, result)
      } catch { /* Keep the previous actionable status until the next check. */ }
    })).then(() => {})
  }
  if (refreshJob) return refreshJob
  const current = ++revision
  inspected.clear()
  useSetupStore.setState({ checking: true })
  const job = (async () => {
    try {
        const saved = await waitForSetup(chrome.storage.local.get(preferencesKey))
        const parsed = languagesSchema.safeParse(saved[preferencesKey])
        const languages = parsed.success ? [...new Set(parsed.data)] : defaults
        if (languages.join(',') !== useSetupStore.getState().languages.join(',')) useSetupStore.setState({ languages, items: setupCatalog(languages) })
    } catch { /* Browser-language defaults remain usable when storage is unavailable. */ }
    await Promise.all(useSetupStore.getState().items.map(async item => {
      try {
        const result = await waitForSetup(inspectItem(item))
        if (current === revision) {
          const latest = useSetupStore.getState().items.find(value => value.id === item.id)
          // Returning from Chrome's permission tab triggers a focus refresh.
          // Keep a failed download's actionable retry message until it is ready.
          if (!(latest?.status === 'error' && ['downloadable', 'downloading'].includes(result.status || ''))) patchItem(item.id, result)
        }
      } catch {
        if (current === revision) patchItem(item.id, { status: 'error', detail: 'Could not check this item. Check again or retry setup.' })
      }
    }))
    if (current === revision) useSetupStore.setState({ initialized: true })
  })().finally(() => {
    if (refreshJob === job) { refreshJob = null; useSetupStore.setState({ checking: false }) }
  })
  refreshJob = job
  return job
}

export async function setSetupLanguages(languages: string[]) {
  if (controller || useSetupStore.getState().checking) return
  const valid = languagesSchema.parse([...new Set(languages)])
  // Install the new catalog before the storage-change event can refresh it.
  const previous = useSetupStore.getState()
  inspected.clear()
  useSetupStore.setState({ languages: valid, items: setupCatalog(valid), initialized: false })
  try { await chrome.storage.local.set({ [preferencesKey]: valid }) }
  catch (error) { useSetupStore.setState({ languages: previous.languages, items: previous.items, initialized: previous.initialized }); throw error }
  await refreshSetup()
}

async function installItem(item: SetupItem, signal: AbortSignal, current: number) {
  const update = (patch: Partial<SetupItem>) => { if (!signal.aborted && current === revision) patchItem(item.id, patch) }
  update({ status: 'downloading', progress: undefined, detail: 'Preparing on-device resources…' })
  try {
    const resource = inspected.get(item.id)
    if (resource) {
      // availability was checked with these exact options before enabling the
      // button. Invoke create immediately so the click's activation is retained.
      const creation = resource.api.create({ ...resource.options, signal, monitor(monitor: EventTarget) {
        monitor.addEventListener('downloadprogress', (event: any) => {
          const fraction = event.total > 0 ? event.loaded / event.total : event.loaded
          if (Number.isFinite(fraction)) update({ progress: Math.round(Math.max(0, Math.min(1, fraction)) * 100) })
        })
      } })
      const released = Promise.resolve(creation).then(async session => { await session?.destroy?.() })
      await waitForSetup(released, signal, 600000)
    } else if (item.id === 'speech') {
      const api = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      await prepareLocalSpeech(api, getRecommendedSpeechLocale(), { signal, installLocale: item.status === 'downloading' ? undefined : item.installLocale, onStatus: detail => update({ detail }) })
    } else if (item.id === 'embedding') {
      const { prepareEmbeddings } = await import('./embeddings')
      signal.throwIfAborted()
      await waitForSetup(prepareEmbeddings(progress => update({ progress }), signal), signal, 600000)
    } else throw new Error('Check availability before trying setup again.')
    signal.throwIfAborted()
    const verified = await waitForSetup(inspectItem(item), signal)
    if (verified.status !== 'ready') throw new Error('Preparation finished, but the resource is not ready yet. Check again or retry.')
    update({ ...verified, progress: undefined })
  } catch (error: any) {
    if (signal.aborted || current !== revision) return
    const needsClick = ['NotAllowedError', 'SecurityError'].includes(error?.name)
    update({ status: 'error', progress: undefined,
      detail: needsClick ? 'Chrome needs a fresh click. Select Retry for this item.' : error instanceof Error ? error.message : 'Setup did not finish. Retry this item.',
      ...(error instanceof SpeechSetupNotice && error.installLocale ? { installLocale: error.installLocale } : {}) })
  }
}

export function installSetup(ids?: string[]): Promise<void> {
  const state = useSetupStore.getState()
  if (controller || state.checking || !state.initialized) return Promise.resolve()
  const items = state.items.filter(item => (!ids || ids.includes(item.id)) &&
    ['downloadable', 'downloading', 'error'].includes(item.status) &&
    (inspected.get(item.id)?.api?.create || item.id === 'speech' || item.id === 'embedding'))
  if (!items.length) { useSetupStore.setState({ message: 'No automatic downloads are pending. Review any items marked Needs attention.' }); return Promise.resolve() }
  const active = new AbortController()
  controller = active
  const current = ++revision
  useSetupStore.setState({ busy: true, message: 'Preparing supported resources. You can leave this screen or cancel setup.' })
  // Start browser-managed downloads in the initiating user gesture. Chrome
  // deduplicates its shared model files; temporary sessions are always destroyed.
  return Promise.all(items.map(item => installItem(item, active.signal, current))).then(() => {
    if (!active.signal.aborted) useSetupStore.setState({ message: 'Automatic setup finished. Review the checklist for any remaining steps.' })
  }).finally(() => {
    if (controller === active) { controller = null; useSetupStore.setState({ busy: false }) }
  })
}

export function cancelSetup() {
  if (!controller) return
  controller.abort()
  controller = null
  revision++
  useSetupStore.setState(state => ({ busy: false, message: 'Setup cancelled. Chrome may finish an active download; the microphone will not start.',
    items: state.items.map(item => item.status === 'downloading' ? { ...item, status: 'downloadable', progress: undefined, detail: 'Cancelled. Check again or resume setup.' } : item) }))
}

export function useLocalSetup() {
  const state = useSetupStore()
  useEffect(() => {
    const refresh = () => { void refreshSetup() }
    refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener('pentone:local-setup-changed', refresh)
    window.speechSynthesis?.addEventListener?.('voiceschanged', refresh)
    const storageChanged = (_changes: unknown, area: string) => { if (area === 'local') refresh() }
    chrome.storage?.onChanged?.addListener(storageChanged)
    chrome.permissions?.onAdded?.addListener(refresh)
    chrome.permissions?.onRemoved?.addListener(refresh)
    let permission: PermissionStatus | undefined
    let disposed = false
    navigator.permissions?.query({ name: 'microphone' as PermissionName }).then(status => {
      if (!disposed) { permission = status; permission.addEventListener('change', refresh) }
    }).catch(() => {})
    return () => {
      disposed = true
      window.removeEventListener('focus', refresh)
      window.removeEventListener('pentone:local-setup-changed', refresh)
      window.speechSynthesis?.removeEventListener?.('voiceschanged', refresh)
      chrome.storage?.onChanged?.removeListener(storageChanged)
      chrome.permissions?.onAdded?.removeListener(refresh)
      chrome.permissions?.onRemoved?.removeListener(refresh)
      permission?.removeEventListener('change', refresh)
    }
  }, [])
  return state
}
