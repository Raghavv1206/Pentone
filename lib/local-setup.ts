import { useEffect } from 'react'
import { create } from 'zustand'
import * as z from 'zod'
import { getLanguageModelAPI, getWriterAPI, getRewriterAPI, getSummarizerAPI, getTranslatorAPI, getLanguageDetectorAPI, checkLanguageModelAvailability } from './chrome-ai-helpers'
import { localSpeechLocales, prepareLocalSpeech, SpeechSetupNotice } from './local-speech'
import { getRecommendedSpeechLocale } from './voice-selector'
import { conversationLanguageKey, parseConversationLanguage } from './language-preferences'
import { waitForSetup } from './bounded-operation'
export { waitForSetup } from './bounded-operation'
import { browserPermissions, browserTranslationLanguages, setupCatalog, translationLanguages, type SetupItem, type SetupStatus } from './setup-catalog'

const preferencesKey = 'pentone_setup_languages'
const languagesSchema = z.array(z.string().refine(value => Object.hasOwn(translationLanguages, value))).max(5)
interface SetupState {
  items: SetupItem[]
  languages: string[]
  initialized: boolean
  checking: boolean
  busy: boolean
  savingLanguages: boolean
  message: string
  focusId: string | null
}
const defaults = browserTranslationLanguages(typeof navigator === 'undefined' ? [] : navigator.languages || [navigator.language])
export const useSetupStore = create<SetupState>(() => ({
  items: setupCatalog(defaults), languages: defaults, initialized: false, checking: false, busy: false, savingLanguages: false, message: '', focusId: null
}))
let refreshJob: Promise<void> | null = null
let revision = 0
let controller: AbortController | null = null
let lastCheckedAt = 0
const optionalStatuses = new Map<string, Partial<SetupItem>>()
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
  if (id === 'image') return { api: getLanguageModelAPI(), options: { expectedInputs: [{ type: 'text', languages: ['en'] }, { type: 'image' }], expectedOutputs: [{ type: 'text', languages: ['en'] }] } }
  if (id === 'audio') return null // Chrome Prompt API does not support audio files; audio input is handled by Web Speech
  if (id.startsWith('translate-')) {
    const [, sourceLanguage, targetLanguage] = id.split('-')
    return { api: getTranslatorAPI(), options: { sourceLanguage, targetLanguage } }
  }
  return null
}

// Native APIs can remain pending after cancellation. Bound UI waits, and let
// callers destroy late sessions without allowing them to change current state.
function normalizeAvailability(value: unknown): SetupStatus {
  if (value === 'available' || value === 'readily') return 'ready'
  if (value === 'downloadable' || value === 'after-download') return 'downloadable'
  if (value === 'downloading') return 'downloading'
  return 'unsupported'
}
async function nativeAvailability(resource: NonNullable<ReturnType<typeof nativeResource>>) {
  const { api, options } = resource
  if (typeof api?.create !== 'function') return 'unsupported' as const
  try {
    if (typeof api.availability === 'function') {
      try {
        const checkPromise = Promise.resolve(api.availability(options)).catch(err => {
          if (isUnavailableCapability(err)) return 'unsupported'
          throw err
        })
        const res = await checkPromise
        if (res === 'unsupported') return 'unsupported' as const
        return normalizeAvailability(res)
      } catch (err: any) {
        if (isUnavailableCapability(err)) return 'unsupported' as const
        try {
          const fallbackPromise = Promise.resolve(api.availability()).catch(fErr => {
            if (isUnavailableCapability(fErr)) return 'unsupported'
            throw fErr
          })
          const fallbackRes = await fallbackPromise
          if (fallbackRes === 'unsupported') return 'unsupported' as const
          return normalizeAvailability(fallbackRes)
        } catch (fallbackErr: any) {
          if (isUnavailableCapability(fallbackErr)) return 'unsupported' as const
          throw fallbackErr
        }
      }
    }
    if (typeof api.capabilities === 'function') {
      try {
        const capsPromise = Promise.resolve(api.capabilities(options)).catch(err => {
          if (isUnavailableCapability(err)) return null
          throw err
        })
        const caps = await capsPromise
        if (!caps) return 'unsupported' as const
        return normalizeAvailability(caps.available)
      } catch (err: any) {
        if (isUnavailableCapability(err)) return 'unsupported' as const
        try {
          const fallbackCaps = await Promise.resolve(api.capabilities()).catch(fErr => {
            if (isUnavailableCapability(fErr)) return null
            throw fErr
          })
          if (!fallbackCaps) return 'unsupported' as const
          return normalizeAvailability(fallbackCaps.available)
        } catch (fallbackErr: any) {
          if (isUnavailableCapability(fallbackErr)) return 'unsupported' as const
          throw fallbackErr
        }
      }
    }
  } catch (err: any) {
    if (isUnavailableCapability(err)) return 'unsupported' as const
    throw err
  }
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

async function inspectItem(item: SetupItem, current = revision): Promise<Partial<SetupItem>> {
  if (item.id === 'image' || item.id === 'audio') {
    const status = optionalStatuses.get(item.id)
    if (status && ['ready', 'downloadable', 'downloading'].includes(status.status || '') && current === revision) inspected.set(item.id, nativeResource(item.id))
    return status || { status: 'action', detail: 'Optional browser capability. Check support only when you want to use this feature.' }
  }
  const resource = nativeResource(item.id)
  if (resource) {
    const status = await nativeAvailability(resource)
    if (current === revision) inspected.set(item.id, resource)
    return { status, detail: status === 'unsupported' ? (item.id === 'prompt' ? 'Requires Prompt API enabled in chrome://flags and at least 20 GB free disk space. Open help below.' : 'Not supported by this Chrome version, device or language configuration. Open the setup help below.') : undefined }
  }
  if (item.id === 'embedding') return { status: await embeddingFilesCached() ? 'ready' : 'downloadable' }
  if (item.id === 'speech' || item.id === 'speech-hi') {
    const api = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!api?.available || !('processLocally' in new api())) return { status: 'unsupported', detail: 'Update Chrome to a version with on-device speech support.' }
    let candidate: Partial<SetupItem> = { status: 'unsupported', detail: 'No supported local speech pack for your language.' }
    try {
      for (const locale of localSpeechLocales(item.id === 'speech-hi' ? 'hi-IN' : getRecommendedSpeechLocale())) {
        const state = await api.available({ langs: [locale], processLocally: true })
        if (state === 'available') return { status: 'ready', detail: locale }
        if ((state === 'downloadable' || state === 'downloading') && candidate.status === 'unsupported') candidate = { status: normalizeAvailability(state), installLocale: locale, detail: locale }
      }
    } catch {
      return { status: 'unsupported', detail: 'Local speech recognition is not supported on this device.' }
    }
    return candidate
  }
  if (item.id === 'microphone') {
    const permission = await navigator.permissions.query({ name: 'microphone' as PermissionName })
    return { status: permission.state === 'granted' ? 'ready' : 'action', detail: permission.state === 'denied' ? 'Microphone access is blocked. Enable it in Chrome site settings.' : 'Approve the microphone prompt in a separate Pentone tab.' }
  }
  if (item.id === 'voice' || item.id === 'voice-hi') {
    const language = item.id === 'voice-hi' ? 'hi' : 'en'
    const name = language === 'hi' ? 'Hindi' : 'English'
    const voices = window.speechSynthesis?.getVoices().filter(voice => voice.localService && voice.lang.toLowerCase().startsWith(language)) || []
    const saved = await chrome.storage.local.get(conversationLanguageKey)
    const mode = parseConversationLanguage(saved[conversationLanguageKey])
    return { status: voices.length ? 'ready' : 'action', essential: language === 'en' || mode === 'hi', detail: voices.length ? `${voices.length} local ${name} voice(s) available` : `Install a ${name} speech voice in your computer’s language/speech settings, then reopen Chrome.` }
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

export function refreshSetup(force = true): Promise<void> {
  if (useSetupStore.getState().savingLanguages) return Promise.resolve()
  if (controller) {
    const current = revision
    // Permission and OS voice changes should be visible during long downloads.
    return Promise.all(useSetupStore.getState().items.filter(item => ['microphone', 'voice', 'voice-hi', 'wakeword'].includes(item.id) || item.id.startsWith('permission-')).map(async item => {
      try {
        const result = await waitForSetup(inspectItem(item))
        if (current === revision) patchItem(item.id, result)
      } catch { /* Keep the previous actionable status until the next check. */ }
    })).then(() => {})
  }
  if (refreshJob) return refreshJob
  if (!force && useSetupStore.getState().initialized && Date.now() - lastCheckedAt < 30000) return Promise.resolve()
  const current = ++revision
  inspected.clear()
  useSetupStore.setState({ checking: true })
  const job = (async () => {
    try {
        const saved = await waitForSetup(chrome.storage.local.get(preferencesKey))
        if (current !== revision) return
        const parsed = languagesSchema.safeParse(saved[preferencesKey])
        const languages = parsed.success ? [...new Set(['hi', ...parsed.data])].slice(0, 5) : defaults
        if (languages.join(',') !== useSetupStore.getState().languages.join(',')) useSetupStore.setState({ languages, items: setupCatalog(languages) })
    } catch { /* Browser-language defaults remain usable when storage is unavailable. */ }
    if (current !== revision) return
    await Promise.all(useSetupStore.getState().items.map(async item => {
      try {
        const result = await waitForSetup(inspectItem(item, current))
        if (current === revision) {
          const latest = useSetupStore.getState().items.find(value => value.id === item.id)
          // Returning from Chrome's permission tab triggers a focus refresh.
          // Keep a failed download's actionable retry message until it is ready.
          if (!(latest?.status === 'error' && ['downloadable', 'downloading'].includes(result.status || ''))) patchItem(item.id, result)
        }
      } catch (error) {
        if (current === revision) patchItem(item.id, isUnavailableCapability(error)
          ? { status: 'unsupported', detail: 'This model capability is unavailable in this browser or on this device.' }
          : { status: 'error', detail: 'Could not check this item. Check again or retry setup.' })
      }
    }))
    if (current === revision) { lastCheckedAt = Date.now(); useSetupStore.setState({ initialized: true }) }
  })().catch(err => {
    if (!isUnavailableCapability(err)) console.warn('[local-setup] Refresh check error:', err)
  }).finally(() => {
    if (refreshJob === job) { refreshJob = null; useSetupStore.setState({ checking: false }) }
  })
  refreshJob = job
  return job
}

export async function setSetupLanguages(languages: string[]) {
  if (controller) throw new Error('Finish or cancel the current downloads before adding languages.')
  if (useSetupStore.getState().savingLanguages) throw new Error('Your previous language choice is still being saved.')
  const valid = languagesSchema.parse([...new Set(['hi', ...languages])])
  // Install the new catalog before the storage-change event can refresh it.
  const previous = useSetupStore.getState()
  revision++
  refreshJob = null
  inspected.clear()
  useSetupStore.setState({ languages: valid, items: setupCatalog(valid), initialized: false, checking: false, savingLanguages: true })
  try { await waitForSetup(chrome.storage.local.set({ [preferencesKey]: valid })) }
  catch (error) { useSetupStore.setState({ languages: previous.languages, items: previous.items, initialized: previous.initialized }); throw error }
  finally { useSetupStore.setState({ savingLanguages: false }) }
  void refreshSetup().catch(() => {})
}

export function isUnavailableCapability(error: any): boolean {
  if (!error) return false
  const msg = String(error?.message || error?.name || error || '')
  return error?.name === 'NotSupportedError' ||
    /model capability is not available|model adaptation.*not available|unable to create a session|not supported|unsupported/i.test(msg)
}

export async function checkOptionalSetup(id: string): Promise<void> {
  if (!['image', 'audio'].includes(id) || controller) return
  patchItem(id, { status: 'checking', detail: 'Checking this optional capability…' })
  let result: Partial<SetupItem>
  if (id === 'audio') {
    // Chrome's Gemini Nano Prompt API does not support audio file inputs.
    // Probing LanguageModel with { type: 'audio' } causes Chromium's Blink layer
    // to reject with "DOMException: Model capability is not available."
    result = {
      status: 'unsupported',
      detail: 'This browser Prompt API does not support audio-file understanding. Text chat, image analysis and microphone voice commands work independently.'
    }
    optionalStatuses.set(id, result)
    patchItem(id, result)
    return
  }

  const resource = nativeResource(id)
  if (!resource || !resource.api) {
    result = { status: 'unsupported', detail: 'Image understanding is not available in this browser.' }
    optionalStatuses.set(id, result)
    patchItem(id, result)
    return
  }

  try {
    const baseAvail = await checkLanguageModelAvailability(resource.api)
    if (baseAvail === 'no') {
      result = { status: 'unsupported', detail: 'Image understanding requires Gemini Nano to be enabled and ready.' }
      optionalStatuses.set(id, result)
      patchItem(id, result)
      return
    }
    const status = await waitForSetup(nativeAvailability(resource))
    result = { status, detail: status === 'unsupported' ? 'This browser does not offer image capability. Text chat and microphone commands work independently.' : undefined }
    if (status !== 'unsupported') inspected.set(id, resource)
  } catch (error) {
    result = { status: isUnavailableCapability(error) ? 'unsupported' : 'error', detail: 'Image capability is unavailable on this device.' }
  }
  optionalStatuses.set(id, result)
  patchItem(id, result)
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
    } else if (item.id === 'speech' || item.id === 'speech-hi') {
      const api = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      await prepareLocalSpeech(api, item.id === 'speech-hi' ? 'hi-IN' : getRecommendedSpeechLocale(), { signal, installLocale: item.status === 'downloading' ? undefined : item.installLocale, onStatus: detail => update({ detail }) })
    } else if (item.id === 'embedding') {
      const { prepareEmbeddings } = await import('./embeddings')
      signal.throwIfAborted()
      await waitForSetup(prepareEmbeddings(progress => update({ progress }), signal), signal, 600000)
    } else throw new Error('Check availability before trying setup again.')
    signal.throwIfAborted()
    const verified = item.id === 'image' || item.id === 'audio'
      ? { status: await waitForSetup(nativeAvailability(resource!), signal) }
      : await waitForSetup(inspectItem(item), signal)
    if (verified.status !== 'ready') throw new Error('Preparation finished, but the resource is not ready yet. Check again or retry.')
    update({ ...verified, progress: undefined })
    if (item.id === 'image' || item.id === 'audio') optionalStatuses.set(item.id, verified)
  } catch (error: any) {
    if (signal.aborted || current !== revision) return
    if (isUnavailableCapability(error)) {
      const result = { status: 'unsupported' as const, progress: undefined, detail: 'This model capability is unavailable on this browser/device. Other supported features remain usable.' }
      update(result)
      if (item.id === 'image' || item.id === 'audio') optionalStatuses.set(item.id, result)
      return
    }
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
    (inspected.get(item.id)?.api?.create || item.id === 'speech' || item.id === 'speech-hi' || item.id === 'embedding'))
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
    const refresh = () => { void refreshSetup(false).catch(() => {}) }
    const changed = () => { void refreshSetup().catch(() => {}) }
    refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener('pentone:local-setup-changed', changed)
    window.speechSynthesis?.addEventListener?.('voiceschanged', changed)
    const storageChanged = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && [preferencesKey, conversationLanguageKey, 'pentone_settings', 'tts_voice_uri'].some(key => Object.hasOwn(changes, key))) changed()
    }
    chrome.storage?.onChanged?.addListener(storageChanged)
    chrome.permissions?.onAdded?.addListener(changed)
    chrome.permissions?.onRemoved?.addListener(changed)
    let permission: PermissionStatus | undefined
    let disposed = false
    navigator.permissions?.query({ name: 'microphone' as PermissionName }).then(status => {
      if (!disposed) { permission = status; permission.addEventListener('change', changed) }
    }).catch(() => {})
    return () => {
      disposed = true
      window.removeEventListener('focus', refresh)
      window.removeEventListener('pentone:local-setup-changed', changed)
      window.speechSynthesis?.removeEventListener?.('voiceschanged', changed)
      chrome.storage?.onChanged?.removeListener(storageChanged)
      chrome.permissions?.onAdded?.removeListener(changed)
      chrome.permissions?.onRemoved?.removeListener(changed)
      permission?.removeEventListener('change', changed)
    }
  }, [])
  return state
}
