/**
 * LanguageModel Session Configuration and Lifecycle Management
 * 
 * Centralized, type-safe configuration for Chrome Built-in AI (Prompt API / Gemma 4).
 * Enforces output language declarations, multimodal fallback hierarchies,
 * and clean session creation/destruction.
 */

export const DEFAULT_LANGUAGE = 'en'
export const SUPPORTED_LANGUAGES = ['de', 'en', 'es', 'fr', 'ja'] as const
export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number]

export interface ModelInputConfig {
  type: 'text' | 'image'
  languages?: string[]
}

export interface ModelOutputConfig {
  type: 'text'
  languages: string[]
}

export interface InitialPrompt {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface SessionOptions {
  outputLanguage?: string
  expectedOutputLanguage?: string
  initialPrompts?: InitialPrompt[]
  expectedInputs: ModelInputConfig[]
  expectedOutputs: ModelOutputConfig[]
  systemPrompt?: string
  temperature?: number
  topK?: number
  monitor?: (m: any) => void
  signal?: AbortSignal
}

export type ModelAvailabilityStatus = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'timeout'
export type NormalizedModelAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'timeout'
export type BuiltInAPIAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable'

/**
 * Normalizes any Chrome Prompt API availability string to the canonical 4-state contract.
 * Strictly accepts: 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'timeout'.
 * Undocumented/legacy aliases (such as 'readily', 'after-download', 'no') or any unrecognized strings
 * strictly map to 'unavailable'. Under no circumstances does an unknown string map to 'available' or 'downloadable'.
 */
export function normalizeModelAvailability(status?: string | null): NormalizedModelAvailability {
  if (!status || typeof status !== 'string') return 'unavailable'
  const s = status.toLowerCase().trim()
  if (s === 'available') {
    return 'available'
  }
  if (s === 'downloadable') {
    return 'downloadable'
  }
  if (s === 'downloading') {
    return 'downloading'
  }
  if (s === 'timeout') {
    return 'timeout'
  }
  return 'unavailable'
}

/**
 * Normalizes any Chrome Built-in AI capability string (Summarizer, Writer, Rewriter, Translator, LanguageDetector)
 * to an explicit canonical 4-state contract: 'available' | 'downloadable' | 'downloading' | 'unavailable'.
 * Strictly returns 'unavailable' for any unknown string, alias, null, or undefined. Never treats an unknown status as 'available'.
 */
export function normalizeBuiltInAPIAvailability(status?: string | null): BuiltInAPIAvailability {
  if (!status || typeof status !== 'string') return 'unavailable'
  const s = status.toLowerCase().trim()
  if (s === 'available') {
    return 'available'
  }
  if (s === 'downloadable') {
    return 'downloadable'
  }
  if (s === 'downloading') {
    return 'downloading'
  }
  return 'unavailable'
}

export interface ModelDownloadState {
  status: 'idle' | 'checking' | 'ready' | 'downloadable' | 'downloading' | 'initializing' | 'error' | 'unsupported'
  progress: number
  error: string | null
  downloadStartTime: number | null
  downloadDurationMs: number | null
  rawAvailability?: string
  normalizedAvailability?: NormalizedModelAvailability
}

type DownloadListener = (state: ModelDownloadState) => void
const downloadListeners = new Set<DownloadListener>()

let activeDownloadState: ModelDownloadState = {
  status: 'idle',
  progress: 0,
  error: null,
  downloadStartTime: null,
  downloadDurationMs: null
}

let activeDownloadPromise: Promise<any> | null = null
let preservedSessionHolder: any = null

export function getModelDownloadState(): ModelDownloadState {
  return { ...activeDownloadState }
}

export function subscribeToModelDownload(listener: DownloadListener): () => void {
  downloadListeners.add(listener)
  // Immediate callback with current state
  listener({ ...activeDownloadState })
  return () => {
    downloadListeners.delete(listener)
  }
}

function updateDownloadState(updates: Partial<ModelDownloadState>): void {
  activeDownloadState = { ...activeDownloadState, ...updates }
  for (const listener of downloadListeners) {
    try {
      listener({ ...activeDownloadState })
    } catch (e) {
      console.warn('[AI Config] Error in download listener:', e)
    }
  }
}

export function getPreservedSession(): any {
  return preservedSessionHolder
}

export function setPreservedSession(session: any): void {
  preservedSessionHolder = session
}

export function clearPreservedSession(): void {
  if (preservedSessionHolder) {
    try {
      preservedSessionHolder.destroy?.()
    } catch (e) {
      // ignore
    }
    preservedSessionHolder = null
  }
}

let activeAvailabilityPromise: Promise<{
  raw: string
  normalized: NormalizedModelAvailability
  isTimeout?: boolean
}> | null = null

let availabilityRequestId = 0

export function resetAvailabilityCheckState(): void {
  activeAvailabilityPromise = null
  availabilityRequestId++
}

/**
 * Resets download state and clears any in-flight download references.
 * Used for testing and error recovery.
 */
export function resetModelDownloadState(): void {
  activeDownloadPromise = null
  preservedSessionHolder = null
  resetAvailabilityCheckState()
  activeDownloadState = {
    status: 'idle',
    progress: 0,
    error: null,
    downloadStartTime: null,
    downloadDurationMs: null
  }
  for (const listener of downloadListeners) {
    try {
      listener({ ...activeDownloadState })
    } catch (e) {
      // ignore
    }
  }
}

/**
 * Validate and normalize language code against Chrome Prompt API supported languages.
 */
export function normalizeLanguage(lang?: string): string {
  if (!lang) return DEFAULT_LANGUAGE
  const code = lang.toLowerCase().split('-')[0] // e.g. "en-US" -> "en"
  if (SUPPORTED_LANGUAGES.includes(code as SupportedLanguage)) {
    return code
  }
  return DEFAULT_LANGUAGE
}

/**
 * Build a canonical options object for LanguageModel session creation or availability check.
 * Guarantees that expectedOutputs ALWAYS specifies a valid supported language code.
 */
export function buildSessionOptions(params?: {
  initialPrompt?: string
  multimodal?: boolean
  languages?: string[]
  monitor?: (m: any) => void
  signal?: AbortSignal
}): SessionOptions {
  const primaryLang = normalizeLanguage(params?.languages?.[0])
  const languages = [primaryLang]

  const inputs: ModelInputConfig[] = [
    { type: 'text', languages }
  ]

  if (params?.multimodal) {
    inputs.push({ type: 'image' })
  }

  const options: SessionOptions = {
    outputLanguage: primaryLang,
    expectedOutputLanguage: primaryLang,
    expectedInputs: inputs,
    expectedOutputs: [{ type: 'text', languages }]
  }

  if (params?.initialPrompt) {
    options.systemPrompt = params.initialPrompt
    options.initialPrompts = [{ role: 'system', content: params.initialPrompt }]
  }

  if (params?.monitor) {
    options.monitor = params.monitor
  }

  if (params?.signal) {
    options.signal = params.signal
  }

  return options
}

let availabilityCheckCount = 0
let underlyingModelInitCount = 0
let promptAPIDeviceIncapable = false

export function markPromptAPIDeviceIncapable(): void {
  promptAPIDeviceIncapable = true
}

export function resetPromptAPIDeviceIncapable(): void {
  promptAPIDeviceIncapable = false
}

export function isPromptAPIDeviceIncapable(): boolean {
  return promptAPIDeviceIncapable
}

export function getPromptAPILifecycleMetrics() {
  return {
    availabilityCheckCount,
    underlyingModelInitCount
  }
}

export function resetPromptAPILifecycleMetrics(): void {
  availabilityCheckCount = 0
  underlyingModelInitCount = 0
}

/**
 * Resolves the available Chrome Prompt API provider across modern and legacy namespaces.
 * Prioritizes window.LanguageModel (modern) and falls back to window.ai.languageModel (legacy).
 */
export function resolveLanguageModelProvider(): { provider: any; isLegacy: boolean } | null {
  const scope: any = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {})
  if (scope.LanguageModel && (typeof scope.LanguageModel.create === 'function' || typeof scope.LanguageModel.availability === 'function' || typeof scope.LanguageModel.capabilities === 'function')) {
    return { provider: scope.LanguageModel, isLegacy: false }
  }
  if (scope.ai?.languageModel && (typeof scope.ai.languageModel.create === 'function' || typeof scope.ai.languageModel.capabilities === 'function' || typeof scope.ai.languageModel.availability === 'function')) {
    return { provider: scope.ai.languageModel, isLegacy: true }
  }
  return null
}

/**
 * Check Prompt API availability for the specified modality configuration.
 * Strictly checks the requested configuration without masking failures with fallback modalities.
 */
export async function checkPromptAPIAvailability(params?: {
  multimodal?: boolean
  languages?: string[]
  timeoutMs?: number
}): Promise<ModelAvailabilityStatus> {
  availabilityCheckCount++
  if (promptAPIDeviceIncapable) return 'unavailable'
  
  const resolved = resolveLanguageModelProvider()
  if (!resolved) {
    return 'unavailable'
  }

  const lm = resolved.provider
  if (typeof lm?.availability !== 'function' && typeof lm?.capabilities !== 'function') {
    return 'unavailable'
  }

  const timeoutDuration = params?.timeoutMs || 5000
  let timeoutTimer: any = null
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutTimer = setTimeout(() => reject(new Error('Prompt API availability check timed out')), timeoutDuration)
  })

  try {
    const options = buildSessionOptions(params)
    let result: any
    if (typeof lm.availability === 'function') {
      try {
        result = await Promise.race([
          lm.availability(options),
          timeoutPromise
        ])
      } catch (optionErr: any) {
        if (optionErr?.message?.includes('timed out')) {
          throw optionErr
        }
        // If passing options failed (e.g. strict schema rejection on older builds),
        // fallback to availability() without arguments ONLY if multimodal was NOT requested.
        // Multimodal requests must never fall back to text availability.
        if (!params?.multimodal) {
          try {
            result = await Promise.race([
              lm.availability({
                outputLanguage: 'en',
                expectedOutputLanguage: 'en',
                expectedOutputs: [{ type: 'text', languages: ['en'] }]
              }),
              timeoutPromise
            ])
          } catch {
            result = await Promise.race([
              lm.availability(),
              timeoutPromise
            ])
          }
        } else {
          return 'unavailable'
        }
      }
    } else if (typeof lm.capabilities === 'function') {
      const caps = await Promise.race([
        lm.capabilities(),
        timeoutPromise
      ])
      const capAvail = caps?.available
      result = capAvail === 'readily' ? 'available' : (capAvail === 'after-download' ? 'downloadable' : (capAvail || 'unavailable'))
    }

    if (result) return normalizeModelAvailability(result)
  } catch (error: any) {
    console.warn(`[AI Config] Availability check for ${params?.multimodal ? 'multimodal' : 'text'} failed:`, error)
    if (error?.message?.includes('timed out')) {
      return 'timeout'
    }
    return 'unavailable'
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer)
  }

  return 'unavailable'
}

/**
 * Create a clean LanguageModel session with verified language configuration.
 * Avoids cascading retry loops that trip Chromium's 3-crash circuit breaker.
 */
export async function createResilientSession(params: {
  initialPrompt?: string
  multimodal?: boolean
  languages?: string[]
  monitor?: (m: any) => void
  signal?: AbortSignal
}): Promise<any> {
  const resolved = resolveLanguageModelProvider()
  if (!resolved || typeof resolved.provider.create !== 'function') {
    throw new Error('Chrome Prompt API (window.LanguageModel or window.ai.languageModel) is not available in this environment')
  }

  const { provider: lm, isLegacy } = resolved
  const options = buildSessionOptions(params)

  // Single direct creation attempt with exact options
  // Do not perform rapid cascading retries that crash the utility process
  try {
    let session: any
    if (isLegacy) {
      try {
        session = await lm.create(options)
      } catch (legacyErr: any) {
        // Legacy providers may reject modern options like monitor or complex schemas
        const strippedOptions: any = {
          outputLanguage: options.outputLanguage || 'en',
          expectedOutputLanguage: options.expectedOutputLanguage || 'en'
        }
        if (options.systemPrompt) strippedOptions.systemPrompt = options.systemPrompt
        if (typeof options.temperature === 'number') strippedOptions.temperature = options.temperature
        if (typeof options.topK === 'number') strippedOptions.topK = options.topK
        if (options.signal) strippedOptions.signal = options.signal
        session = await lm.create(strippedOptions)
      }
    } else {
      try {
        session = await lm.create(options)
      } catch (createErr: any) {
        const fallbackOptions: any = {
          outputLanguage: 'en',
          expectedOutputLanguage: 'en',
          expectedOutputs: [{ type: 'text', languages: ['en'] }]
        }
        if (params.initialPrompt) {
          fallbackOptions.systemPrompt = params.initialPrompt
          fallbackOptions.initialPrompts = [{ role: 'system', content: params.initialPrompt }]
        }
        if (params.signal) fallbackOptions.signal = params.signal
        if (params.monitor) fallbackOptions.monitor = params.monitor
        session = await lm.create(fallbackOptions)
      }
    }

    underlyingModelInitCount++
    return session
  } catch (error: any) {
    if (error?.message?.includes('crashed too many times')) {
      throw new Error('The Chrome on-device AI process crashed too many times and was disabled by Chrome. Please restart Chrome (chrome://restart) to reset.')
    }
    throw error
  }
}

/**
 * Triggers or attaches to an in-flight Gemini Nano model download.
 * Deduplicates concurrent invocations and provides live progress callbacks.
 */
export async function downloadOnDeviceModel(options?: {
  onProgress?: (progress: number) => void
  initialPrompt?: string
}): Promise<any> {
  // If already ready with a preserved session, return it immediately
  if (activeDownloadState.status === 'ready' && preservedSessionHolder) {
    options?.onProgress?.(100)
    return preservedSessionHolder
  }

  // Deduplicate: If download is already in flight, attach to existing promise
  if (activeDownloadPromise) {
    if (options?.onProgress) {
      const listener: DownloadListener = (state) => {
        if (state.status === 'downloading' || state.status === 'ready') {
          options.onProgress!(state.progress)
        }
      }
      downloadListeners.add(listener)
      activeDownloadPromise.finally(() => {
        downloadListeners.delete(listener)
      })
    }
    return activeDownloadPromise
  }

  const startTime = Date.now()
  updateDownloadState({
    status: 'downloading',
    progress: activeDownloadState.progress || 0,
    error: null,
    downloadStartTime: startTime,
    downloadDurationMs: null
  })

  activeDownloadPromise = (async () => {
    try {
      const session = await createResilientSession({
        initialPrompt: options?.initialPrompt,
        multimodal: false,
        monitor: (m: any) => {
          if (m?.addEventListener) {
            m.addEventListener('downloadprogress', (e: any) => {
              let progress = 0
              if (e.total && e.total > 0) {
                progress = Math.min(100, Math.round((e.loaded / e.total) * 100))
              } else if (typeof e.loaded === 'number') {
                progress = e.loaded <= 1 ? Math.min(100, Math.round(e.loaded * 100)) : Math.min(100, Math.round(e.loaded))
              }
              updateDownloadState({ progress, status: 'downloading' })
              options?.onProgress?.(progress)
            })
          }
        }
      })

      const duration = Date.now() - startTime
      setPreservedSession(session)
      updateDownloadState({
        status: 'ready',
        progress: 100,
        downloadDurationMs: duration,
        error: null
      })
      options?.onProgress?.(100)
      return session
    } catch (err: any) {
      const errorMsg = err?.message || 'Download failed or was interrupted'
      updateDownloadState({
        status: 'error',
        error: errorMsg
      })
      throw err
    } finally {
      activeDownloadPromise = null
    }
  })()

  return activeDownloadPromise
}

/**
 * Inspects Prompt API availability and updates internal download/availability state.
 * Deduplicates in-flight checks, serializes requests with request IDs,
 * and guards against stale Promise resolutions overwriting newer results.
 */
export async function inspectPromptAPIAvailability(timeoutMs?: number): Promise<{
  raw: string
  normalized: NormalizedModelAvailability
  isTimeout?: boolean
}> {
  // Deduplicate concurrent in-flight checks
  if (activeAvailabilityPromise) {
    return activeAvailabilityPromise
  }

  const reqId = ++availabilityRequestId

  activeAvailabilityPromise = (async () => {
    try {
      const raw = await checkPromptAPIAvailability({ multimodal: false, timeoutMs })
      const normalized = normalizeModelAvailability(raw)
      const isTimeout = raw === 'timeout' || normalized === 'timeout'

      // Guard against stale asynchronous resolution: only update state if this is still the active request
      if (reqId === availabilityRequestId) {
        if (isTimeout) {
          updateDownloadState({
            rawAvailability: 'timeout',
            normalizedAvailability: 'timeout',
            status: 'error',
            error: 'Prompt API availability check timed out. Chrome AI component may still be initializing.'
          })
        } else if (normalized === 'available') {
          try {
            const probe = await verifyGeminiNanoCapability(timeoutMs)
            if (probe.sessionCreated && probe.inferencePassed) {
              updateDownloadState({
                rawAvailability: raw,
                normalizedAvailability: normalized,
                status: 'ready',
                error: null
              })
            } else {
              updateDownloadState({
                rawAvailability: raw,
                normalizedAvailability: normalized,
                status: 'error',
                error: probe.error || 'Gemini Nano session creation failed on device'
              })
            }
          } catch (e: any) {
            updateDownloadState({
              rawAvailability: raw,
              normalizedAvailability: normalized,
              status: 'error',
              error: e?.message || 'Gemini Nano verification probe failed'
            })
          }
        } else {
          updateDownloadState({
            rawAvailability: raw,
            normalizedAvailability: normalized,
            status: normalized === 'downloadable' ? 'downloadable' : (normalized === 'downloading' ? 'downloading' : 'unsupported'),
            error: null
          })
        }
      }

      return { raw, normalized, isTimeout }
    } finally {
      if (reqId === availabilityRequestId) {
        activeAvailabilityPromise = null
      }
    }
  })()

  return activeAvailabilityPromise
}


export interface GeminiNanoVerificationResult {
  apiPresent: boolean
  rawAvailability: string
  normalizedAvailability: NormalizedModelAvailability
  sessionCreated: boolean
  inferencePassed: boolean
  verified: boolean
  error: string | null
}

/**
 * Actively probes Prompt API (Gemini Nano) capability:
 * Checks API existence -> calls availability() -> attempts createResilientSession() -> runs test inference probe.
 * Does NOT treat 'readily' availability alone as proof of ready inference.
 */
export async function verifyGeminiNanoCapability(timeoutMs: number = 4000): Promise<GeminiNanoVerificationResult> {
  const resolved = resolveLanguageModelProvider()

  if (!resolved) {
    return {
      apiPresent: false,
      rawAvailability: 'unavailable',
      normalizedAvailability: 'unavailable',
      sessionCreated: false,
      inferencePassed: false,
      verified: false,
      error: 'Chrome Prompt API (window.LanguageModel or window.ai.languageModel) is not present in window'
    }
  }

  const lm = resolved.provider

  try {
    let raw: string = 'unavailable'
    if (typeof lm.availability === 'function') {
      raw = await Promise.race([
        lm.availability({ expectedOutputs: [{ type: 'text', languages: ['en'] }] }),
        new Promise<string>((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))
      ])
    } else if (typeof lm.capabilities === 'function') {
      const caps = await Promise.race([
        lm.capabilities(),
        new Promise<any>((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))
      ])
      const capAvail = caps?.available
      raw = capAvail === 'readily' ? 'available' : (capAvail === 'after-download' ? 'downloadable' : (capAvail || 'unavailable'))
    }

    const normalized = normalizeModelAvailability(raw)
    if (normalized !== 'available') {
      return {
        apiPresent: true,
        rawAvailability: String(raw),
        normalizedAvailability: normalized,
        sessionCreated: false,
        inferencePassed: false,
        verified: false,
        error: normalized === 'downloadable' ? 'Model requires downloading in Chrome' : null
      }
    }

    // Availability reported as 'available' ('readily'). Verify session creation:
    let session: any = null
    try {
      session = await Promise.race([
        createResilientSession({ multimodal: false }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Session creation timed out')), timeoutMs))
      ])
    } catch (createErr: any) {
      return {
        apiPresent: true,
        rawAvailability: String(raw),
        normalizedAvailability: 'available',
        sessionCreated: false,
        inferencePassed: false,
        verified: false,
        error: `LanguageModel reports readily available, but session creation failed: ${createErr?.message || createErr}`
      }
    }

    try {
      const probePrompt = 'ping'
      let probeRes: string = ''
      if (typeof session.prompt === 'function') {
        probeRes = await Promise.race([
          session.prompt(probePrompt),
          new Promise<string>((_, rej) => setTimeout(() => rej(new Error('Inference timed out')), timeoutMs))
        ])
      } else if (typeof session.promptStreaming === 'function') {
        const stream = session.promptStreaming(probePrompt)
        for await (const chunk of stream) {
          probeRes += chunk
          if (probeRes.length > 0) break
        }
      }

      return {
        apiPresent: true,
        rawAvailability: String(raw),
        normalizedAvailability: 'available',
        sessionCreated: true,
        inferencePassed: probeRes !== undefined && probeRes !== null,
        verified: probeRes !== undefined && probeRes !== null,
        error: null
      }
    } catch (promptErr: any) {
      return {
        apiPresent: true,
        rawAvailability: String(raw),
        normalizedAvailability: 'available',
        sessionCreated: true,
        inferencePassed: false,
        verified: false,
        error: `LanguageModel session created, but minimal inference probe failed: ${promptErr?.message || promptErr}`
      }
    } finally {
      try {
        if (session && typeof session.destroy === 'function') {
          session.destroy()
        }
      } catch (destroyErr) {
        console.warn('[AI Config] Error destroying verification session:', destroyErr)
      }
    }
  } catch (err: any) {
    return {
      apiPresent: true,
      rawAvailability: 'error',
      normalizedAvailability: 'unavailable',
      sessionCreated: false,
      inferencePassed: false,
      verified: false,
      error: err?.message || String(err)
    }
  }
}