/**
 * Local Whisper ASR Service
 * 
 * Manages local Whisper speech recognition using @xenova/transformers:
 * 1. Supports Xenova/whisper-tiny.en, Xenova/whisper-tiny, and Xenova/whisper-base.
 * 2. Packages & resolves local ONNX WASM binaries to eliminate remote CDN runtime dependencies.
 * 3. Enforces singleton model caching: never re-initializes or duplicates models across utterances.
 * 4. Integrates AudioResampler to guarantee standard 16kHz Float32Array PCM input.
 * 5. Robust per-transcription generation token & cancellation mechanism preventing stale instruction execution.
 * 6. Model download progress tracking and offline cache validation.
 */

import { AudioResampler } from './audio-resampler'
import { voiceDiagnosticTracker } from './voice-diagnostic-tracker'
import { modelProvisioning, WHISPER_MODEL_ID, WHISPER_MODEL_REVISION } from '../model-provisioning'

export class WhisperModelNotProvisionedError extends Error {
  constructor(message: string = 'Whisper speech recognition model assets are not provisioned in local cache. Please download Whisper Tiny in Settings.') {
    super(message)
    this.name = 'WhisperModelNotProvisionedError'
  }
}

export class TranscriptionCancelledError extends Error {
  public readonly token: number
  public readonly generationToken: number
  constructor(message: string, token: number) {
    super(message)
    this.name = 'TranscriptionCancelledError'
    this.token = token
    this.generationToken = token
  }
}

export interface ModelProgressInfo {
  status: 'initiate' | 'download' | 'progress' | 'done' | 'ready'
  name?: string
  file?: string
  progress?: number
  loaded?: number
  total?: number
  modelId: string
}

export type ModelProgressListener = (info: ModelProgressInfo) => void

// Lazy loader for Transformers.js to configure local WASM assets and prevent Node.js test environment conflicts
async function getTransformers() {
  const transformers = await import('@xenova/transformers')
  const { env } = transformers
  // Local-only browser cache configuration:
  // allowLocalModels = true enables resolution of provisioned models from CacheStorage ('transformers-cache')
  // allowRemoteModels = false strictly prohibits remote network downloads from Hugging Face CDN
  // useBrowserCache = true routes lookups to 'transformers-cache'
  env.allowLocalModels = true
  env.allowRemoteModels = false
  env.useBrowserCache = true

  // Configure local WASM paths for Chrome Extension MV3
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    const wp = chrome.runtime.getURL('assets/')
    env.backends.onnx.wasm.wasmPaths = wp.endsWith('/') ? wp : `${wp}/`
  } else if (typeof window !== 'undefined' && (window as any).__PENTONE_WASM_PATH__) {
    env.backends.onnx.wasm.wasmPaths = (window as any).__PENTONE_WASM_PATH__
  }

  // Single-threaded WASM execution: deterministic in Chrome MV3 without SharedArrayBuffer / COOP headers
  env.backends.onnx.wasm.numThreads = 1
  env.backends.onnx.wasm.proxy = false
  // Suppress benign graph optimization logs ("Removing initializer ... It is not used by any node")
  if (env.backends?.onnx) {
    (env.backends.onnx as any).logSeverityLevel = 3
  }
  return transformers
}

export interface TranscriptionOptions {
  modelId?: string
  language?: string
  task?: 'transcribe' | 'translate'
  sourceSampleRate?: number
  supersedePrevious?: boolean
  signal?: AbortSignal
  onTokenAssigned?: (token: number) => void
}

export interface TranscriptionResult {
  text: string
  durationSeconds: number
  inferenceTimeMs: number
  device: 'webgpu' | 'wasm'
  modelId: string
  generationToken: number
}

export class WhisperASRService {
  private static instance: WhisperASRService | null = null
  private static sharedPipeline: any = null
  private static sharedModelId: string | null = null
  private static sharedInitializationPromise: Promise<void> | null = null
  private static initCount = 0
  private static reuseCount = 0
  private static initializationFailedCount = 0
  private static lastInitDurationMs = 0
  public static pipelineFactoryOverride: ((modelId: string) => Promise<any>) | null = null

  private asrPipeline: any = null
  private currentModelId: string | null = null
  // In @xenova/transformers 2.x, ONNX runtime executes on WASM
  private currentDevice: 'webgpu' | 'wasm' = 'wasm'
  private isWarmedUpFlag = false
  private progressListener: ModelProgressListener | null = null

  // Instance-level initialization promise for concurrency protection
  private initializationPromise: Promise<void> | null = null

  // Robust cancellation & per-request token tracking
  private currentGenerationToken: number = 0
  private cancelledTokens: Set<number> = new Set()
  private activeControllers: Map<number, AbortController> = new Map()

  // Default candidate model is Xenova/whisper-tiny (canonical default)
  public static readonly DEFAULT_MODEL_ID = WHISPER_MODEL_ID
  public static readonly FALLBACK_MODEL_ID = WHISPER_MODEL_ID

  public constructor() {}

  public static getInstance(): WhisperASRService {
    if (!WhisperASRService.instance) {
      WhisperASRService.instance = new WhisperASRService()
    }
    return WhisperASRService.instance
  }

  /**
   * Register a progress listener for model downloads and initialization
   */
  public setProgressListener(listener: ModelProgressListener | null): void {
    this.progressListener = listener
  }

  /**
   * Checks whether the ASR service is initialized and ready for transcription.
   */
  public isReady(): boolean {
    return (this.asrPipeline !== null) || (WhisperASRService.sharedPipeline !== null)
  }

  /**
   * Initializes or retrieves the cached ASR pipeline.
   * Guarantees true singleton lifecycle:
   * 1. Concurrent callers share the exact same initialization promise.
   * 2. Already loaded pipeline is immediately reused across PTT turns.
   * 3. Failed initialization clears the promise and pipeline so clean retries are possible.
   */
  public async initialize(modelId: string = WhisperASRService.DEFAULT_MODEL_ID): Promise<void> {
    // If the shared pipeline for this exact model is already loaded and ready, reuse it immediately
    if (WhisperASRService.sharedPipeline && WhisperASRService.sharedModelId === modelId) {
      WhisperASRService.reuseCount++
      this.asrPipeline = WhisperASRService.sharedPipeline
      this.currentModelId = WhisperASRService.sharedModelId
      try {
        voiceDiagnosticTracker.recordWhisperLifecycle(0, 'WHISPER_MODEL_REUSED', undefined, WhisperASRService.reuseCount)
      } catch {}
      return
    }

    // If an initialization is already in-flight across instances, await the shared promise (no duplicate sessions)
    if (WhisperASRService.sharedInitializationPromise) {
      await WhisperASRService.sharedInitializationPromise
      this.asrPipeline = WhisperASRService.sharedPipeline
      this.currentModelId = WhisperASRService.sharedModelId
      return
    }

    const initPromise = (async () => {
      const startTime = Date.now()
      this.currentDevice = 'wasm'
      console.log(`[WhisperASR] Initializing ASR pipeline with model: ${modelId} on execution provider: ${this.currentDevice}...`)
      try {
        voiceDiagnosticTracker.recordWhisperLifecycle(0, 'WHISPER_MODEL_INITIALIZATION_STARTED')
      } catch {}

      try {
        let pipelineInstance: any
        const factory = (this as any).createPipelineInstance || WhisperASRService.pipelineFactoryOverride
        if (typeof factory === 'function') {
          pipelineInstance = await factory(modelId)
        } else {
          // Verify local provisioning status before initialization
          const isCached = await modelProvisioning.checkModelCached('whisper')
          if (!isCached) {
            throw new WhisperModelNotProvisionedError()
          }

          const transformers = await getTransformers()
          const revision = modelId === WHISPER_MODEL_ID ? WHISPER_MODEL_REVISION : 'main'

          const progressCallback = this.progressListener
            ? (p: any) => {
                if (this.progressListener) {
                  this.progressListener({
                    ...p,
                    modelId
                  })
                }
              }
            : undefined

          const pretrainedOptions: any = {
            quantized: true,
            revision,
            progress_callback: progressCallback
          }

          // Load Speech Seq2Seq pipeline with multi-revision & multi-alias resilience
          // We strictly instantiate AutomaticSpeechRecognitionPipeline with AutoModelForSpeechSeq2Seq
          // to completely avoid AutoModelForCTC fallback leak (which throws "Unsupported model type: whisper").
          const loadSeq2SeqPipeline = async (targetModel: string, targetRevision: string) => {
            const opts: any = {
              quantized: true,
              revision: targetRevision,
              progress_callback: progressCallback
            }
            const [tokenizer, processor, model] = await Promise.all([
              transformers.AutoTokenizer.from_pretrained(targetModel, opts),
              transformers.AutoProcessor.from_pretrained(targetModel, opts),
              transformers.AutoModelForSpeechSeq2Seq.from_pretrained(targetModel, opts)
            ])
            return new transformers.AutomaticSpeechRecognitionPipeline({
              task: 'automatic-speech-recognition',
              model,
              tokenizer,
              processor
            })
          }

          // Build ordered candidate pairs:
          // 1. primary modelId + canonical pinned revision (e.g. 'Xenova/whisper-tiny' + SHA)
          // 2. primary modelId + 'main' revision
          // 3. alias modelId ('openai/whisper-tiny') + pinned revision
          // 4. alias modelId + 'main' revision
          const candidates: Array<{ model: string; rev: string }> = [
            { model: modelId, rev: revision }
          ]
          if (revision !== 'main') {
            candidates.push({ model: modelId, rev: 'main' })
          }
          const altModel = modelId === 'Xenova/whisper-tiny' ? 'openai/whisper-tiny' : (modelId === 'openai/whisper-tiny' ? 'Xenova/whisper-tiny' : null)
          if (altModel) {
            candidates.push({ model: altModel, rev: revision })
            if (revision !== 'main') {
              candidates.push({ model: altModel, rev: 'main' })
            }
          }

          let lastError: any = null
          for (const cand of candidates) {
            try {
              pipelineInstance = await loadSeq2SeqPipeline(cand.model, cand.rev)
              console.log(`[WhisperASR] Successfully initialized SpeechSeq2Seq on model: ${cand.model} (rev: ${cand.rev})`)
              break
            } catch (err: any) {
              lastError = err
              console.warn(`[WhisperASR] Seq2Seq candidate (${cand.model} @ ${cand.rev}) failed:`, err?.message || err)
            }
          }

          if (!pipelineInstance) {
            throw lastError || new Error(`Failed to initialize Whisper ASR model (${modelId})`)
          }
        }

        WhisperASRService.sharedPipeline = pipelineInstance
        WhisperASRService.sharedModelId = modelId
        WhisperASRService.initCount++
        WhisperASRService.lastInitDurationMs = Date.now() - startTime
        this.asrPipeline = pipelineInstance
        this.currentModelId = modelId

        try {
          voiceDiagnosticTracker.recordWhisperLifecycle(
            0,
            'WHISPER_MODEL_INITIALIZATION_COMPLETED',
            WhisperASRService.lastInitDurationMs,
            WhisperASRService.reuseCount
          )
        } catch {}
        console.log(`[WhisperASR] Model ${modelId} loaded successfully on ${this.currentDevice} in ${WhisperASRService.lastInitDurationMs}ms (total inits: ${WhisperASRService.initCount})`)
      } catch (err: any) {
        const errorDetails = {
          name: err?.name || 'Error',
          message: err?.message || String(err),
          stack: err?.stack,
          modelId,
          stage: 'SESSION_INITIALIZATION',
          executionProvider: this.currentDevice,
          usedJSHeapSize: (typeof performance !== 'undefined' && (performance as any).memory?.usedJSHeapSize) || undefined
        }
        console.error(`[WhisperASR] Critical: Failed to load ${modelId}:`, errorDetails)
        WhisperASRService.sharedPipeline = null
        WhisperASRService.sharedModelId = null
        WhisperASRService.initializationFailedCount++
        this.asrPipeline = null
        this.currentModelId = null
        try {
          voiceDiagnosticTracker.recordWhisperLifecycle(0, 'WHISPER_MODEL_INITIALIZATION_FAILED', Date.now() - startTime)
        } catch {}
        if (err instanceof WhisperModelNotProvisionedError || err?.name === 'WhisperModelNotProvisionedError') {
          throw err
        }
        const isOfflineError = err.message?.includes('fetch failed') || err.message?.includes('ENOTFOUND')
        if (isOfflineError) {
          throw new Error(`Whisper model (${modelId}) is not cached locally. An initial internet connection is required to download model weights.`)
        }
        throw new Error(`Failed to initialize Whisper ASR model (${modelId}): ${err.message || err}`)
      } finally {
        // Clear promise so subsequent retries or model switches can cleanly initialize
        WhisperASRService.sharedInitializationPromise = null
        this.initializationPromise = null
      }
    })()

    WhisperASRService.sharedInitializationPromise = initPromise
    this.initializationPromise = initPromise

    await initPromise
  }

  /**
   * Diagnostic metrics for model persistence and reuse verification.
   */
  public getMetrics() {
    return WhisperASRService.getMetrics()
  }

  public static getMetrics() {
    return {
      initializationCount: WhisperASRService.initCount,
      initCount: WhisperASRService.initCount,
      reuseCount: WhisperASRService.reuseCount,
      initializationFailedCount: WhisperASRService.initializationFailedCount,
      lastInitDurationMs: WhisperASRService.lastInitDurationMs,
      currentModelId: WhisperASRService.sharedModelId,
      isWarmedUp: WhisperASRService.instance?.isWarmedUpFlag ?? false,
      hasActivePipeline: WhisperASRService.sharedPipeline !== null
    }
  }

  public resetMetrics(): void {
    WhisperASRService.resetMetrics()
  }

  public static resetMetrics(): void {
    WhisperASRService.initCount = 0
    WhisperASRService.reuseCount = 0
    WhisperASRService.initializationFailedCount = 0
    WhisperASRService.lastInitDurationMs = 0
  }

  public static resetInstanceForTesting(): void {
    WhisperASRService.sharedPipeline = null
    WhisperASRService.sharedModelId = null
    WhisperASRService.sharedInitializationPromise = null
    WhisperASRService.pipelineFactoryOverride = null
    WhisperASRService.resetMetrics()
    if (WhisperASRService.instance) {
      for (const ctrl of WhisperASRService.instance.activeControllers.values()) {
        try { ctrl.abort() } catch {}
      }
      WhisperASRService.instance.activeControllers.clear()
      WhisperASRService.instance.cancelledTokens.clear()
      WhisperASRService.instance.currentGenerationToken = 0
      WhisperASRService.instance.asrPipeline = null
      WhisperASRService.instance.currentModelId = null
      WhisperASRService.instance.initializationPromise = null
      WhisperASRService.instance.isWarmedUpFlag = false
    }
    WhisperASRService.instance = null
  }

  /**
   * Preloads the model and executes a dummy inference to compile WASM kernels and warm up execution graphs
   */
  public async warmup(modelId: string = WhisperASRService.DEFAULT_MODEL_ID): Promise<void> {
    if (this.isWarmedUpFlag && this.currentModelId === modelId && this.asrPipeline) {
      return
    }

    const start = Date.now()
    try {
      console.log(`[WhisperASR] Initializing and warming up model ${modelId}...`)
      await this.initialize(modelId)
      if (!this.asrPipeline) {
        throw new Error('ASR Pipeline failed to initialize')
      }

      const dummyAudio = new Float32Array(16000)
      dummyAudio[0] = 0.001
      await this.asrPipeline(dummyAudio, {
        chunk_length_s: 30,
        stride_length_s: 5,
        temperature: 0.0,
        max_new_tokens: 5
      })
      this.isWarmedUpFlag = true
      console.log(`[WhisperASR] Model ${modelId} warmed up successfully in ${Date.now() - start}ms`)
    } catch (e: any) {
      console.warn('[WhisperASR] Model warmup warning:', e?.message || e)
      if (this.asrPipeline) {
        this.isWarmedUpFlag = true
      }
    }
  }

  public isWarmedUp(): boolean {
    return this.isWarmedUpFlag && this.asrPipeline !== null
  }

  /**
   * Transcribes a raw Float32Array PCM audio buffer
   */
  public async transcribe(
    audioBuffer: Float32Array,
    options: TranscriptionOptions = {}
  ): Promise<TranscriptionResult> {
    const modelId = options.modelId || this.currentModelId || WhisperASRService.DEFAULT_MODEL_ID

    // 1. Resample and validate audio buffer
    const validated = AudioResampler.validateAndResample(audioBuffer, {
      sourceSampleRate: options.sourceSampleRate || 16000,
      targetSampleRate: 16000,
      minDurationSeconds: 0.2,
      maxDurationSeconds: 30.0
    })

    // 2. Ensure pipeline is initialized
    await this.initialize(modelId)

    if (!this.asrPipeline) {
      throw new Error('ASR Pipeline is not initialized')
    }

    // 3. Audio Pre-Processing: Peak normalization for clean log-mel filterbank extraction
    let cleanAudio = validated.audio
    let peak = 0
    for (let i = 0; i < cleanAudio.length; i++) {
      const absVal = Math.abs(cleanAudio[i])
      if (absVal > peak) peak = absVal
    }

    if (peak > 0.005 && peak < 0.70) {
      const scale = 0.82 / peak
      const normalized = new Float32Array(cleanAudio.length)
      for (let i = 0; i < cleanAudio.length; i++) {
        normalized[i] = Math.max(-1.0, Math.min(1.0, cleanAudio[i] * scale))
      }
      cleanAudio = normalized
    }

    // Language code normalization (map 'en-IN', 'en-US' -> 'english', 'hi-IN' -> 'hindi')
    let targetLanguage = options.language
    if (targetLanguage) {
      if (targetLanguage.toLowerCase().startsWith('en')) {
        targetLanguage = 'english'
      } else if (targetLanguage.toLowerCase().startsWith('hi')) {
        targetLanguage = 'hindi'
      }
    } else {
      // Default to english to prevent language identifier drifting on short commands
      targetLanguage = 'english'
    }

    // 4. Supersede prior in-flight requests if single-active-voice-turn supersession is active
    if (options.supersedePrevious !== false) {
      for (const [prevToken, prevCtrl] of this.activeControllers.entries()) {
        this.cancelledTokens.add(prevToken)
        try {
          prevCtrl.abort()
        } catch {}
        console.log(`[WhisperASR] [Token ${prevToken}] Superseded and aborted by newer request`)
      }
    }

    // 5. Increment generation token & track per-request abort controller
    const token = ++this.currentGenerationToken
    const controller = new AbortController()
    this.activeControllers.set(token, controller)

    if (options.onTokenAssigned) {
      options.onTokenAssigned(token)
    }
    if (options.signal) {
      if (options.signal.aborted) {
        controller.abort()
      } else {
        options.signal.addEventListener('abort', () => {
          this.cancel(token)
        }, { once: true })
      }
    }

    const inferenceStart = Date.now()

    try {
      console.log(`[WhisperASR] [Token ${token}] Running inference on ${validated.durationSeconds.toFixed(2)}s audio (${targetLanguage}) using ${this.currentDevice}...`)

      // Run inference with greedy decoding to suppress hallucinations
      const decodeOptions: any = {
        language: targetLanguage,
        task: options.task || 'transcribe',
        temperature: 0.0,
        repetition_penalty: 1.2,
        no_repeat_ngram_size: 3,
        max_new_tokens: 64,
        condition_on_previous_text: false,
        signal: controller.signal,
      }

      // Apply chunking only for extended audio (> 30s); short commands must not be partitioned
      if (validated.durationSeconds > 30) {
        decodeOptions.chunk_length_s = 30
        decodeOptions.stride_length_s = 5
      }

      const result = await this.asrPipeline(cleanAudio, decodeOptions)

      // 6. Check if this token was cancelled or superseded during inference execution
      const isSuperseded = options.supersedePrevious !== false && token !== this.currentGenerationToken
      if (this.cancelledTokens.has(token) || controller.signal.aborted || isSuperseded) {
        this.cancelledTokens.delete(token)
        console.log(`[WhisperASR] [Token ${token}] Discarding completed inference: generation was cancelled or superseded.`)
        throw new TranscriptionCancelledError(`Transcription with token ${token} was cancelled or superseded`, token)
      }

      const inferenceTimeMs = Date.now() - inferenceStart
      const rawText = (typeof result === 'string' ? result : result?.text || '').trim()

      console.log(`[WhisperASR] [Token ${token}] Inference completed in ${inferenceTimeMs}ms: "${rawText}"`)

      return {
        text: rawText,
        durationSeconds: validated.durationSeconds,
        inferenceTimeMs,
        device: this.currentDevice,
        modelId,
        generationToken: token
      }
    } catch (err: any) {
      if (err instanceof TranscriptionCancelledError) {
        throw err
      }
      const isSuperseded = options.supersedePrevious !== false && token !== this.currentGenerationToken
      if (this.cancelledTokens.has(token) || controller.signal.aborted || isSuperseded) {
        this.cancelledTokens.delete(token)
        console.log(`[WhisperASR] [Token ${token}] Inference aborted by cancellation`)
        throw new TranscriptionCancelledError(`Transcription with token ${token} was cancelled`, token)
      }
      console.error('[WhisperASR] Inference failed:', err)
      throw err
    } finally {
      this.cancelledTokens.delete(token)
      this.activeControllers.delete(token)
    }
  }

  /**
   * Cancels inference.
   * - If targetToken is provided: cancels and aborts only that specific transcription request.
   * - If targetToken is omitted: cancels and aborts all currently active transcription requests
   *   belonging to the active voice turn, and increments the generation token.
   */
  public cancel(targetToken?: number): void {
    if (targetToken !== undefined) {
      this.cancelledTokens.add(targetToken)
      const controller = this.activeControllers.get(targetToken)
      if (controller) {
        console.log(`[WhisperASR] Cancelling specific inference token ${targetToken}`)
        try {
          controller.abort()
        } catch {}
        this.activeControllers.delete(targetToken)
      }
      return
    }

    // Active voice turn cancellation: abort all active controllers
    const activeTokens = Array.from(this.activeControllers.keys())
    for (const [tok, ctrl] of this.activeControllers.entries()) {
      this.cancelledTokens.add(tok)
      try {
        ctrl.abort()
      } catch {}
    }
    this.activeControllers.clear()

    const current = this.currentGenerationToken
    this.cancelledTokens.add(current)
    this.currentGenerationToken++
    console.log(`[WhisperASR] Cancelled voice turn (active tokens: ${activeTokens.join(', ') || 'none'}). Advanced generation token to: ${this.currentGenerationToken}`)

    // Prevent unbounded growth of cancelledTokens by keeping only the most recent 100 entries
    if (this.cancelledTokens.size > 100) {
      const toKeep = Array.from(this.cancelledTokens).slice(-50)
      this.cancelledTokens = new Set(toKeep)
    }
  }

  public getActiveController(token: number): AbortController | undefined {
    return this.activeControllers.get(token)
  }

  public getActiveTokens(): number[] {
    return Array.from(this.activeControllers.keys())
  }

  /**
   * Unloads the pipeline and frees memory
   */
  public async destroy(): Promise<void> {
    this.cancel()
    this.asrPipeline = null
    this.currentModelId = null
    this.isWarmedUpFlag = false
    console.log('[WhisperASR] Pipeline unloaded and memory freed')
  }

  public getLoadedModelId(): string | null {
    return this.currentModelId
  }

  public getActiveDevice(): 'webgpu' | 'wasm' {
    return this.currentDevice
  }

  public getCurrentGenerationToken(): number {
    return this.currentGenerationToken
  }
}
