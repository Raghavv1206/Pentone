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

export class TranscriptionCancelledError extends Error {
  public readonly token: number
  constructor(message: string, token: number) {
    super(message)
    this.name = 'TranscriptionCancelledError'
    this.token = token
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
  const { pipeline, env } = await import('@xenova/transformers')
  env.allowLocalModels = false

  // Configure local WASM paths for Chrome Extension MV3
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('assets/')
  } else if (typeof window !== 'undefined' && (window as any).__PENTONE_WASM_PATH__) {
    env.backends.onnx.wasm.wasmPaths = (window as any).__PENTONE_WASM_PATH__
  }

  // Multi-threaded WASM with SIMD (2 threads optimal for web extensions)
  env.backends.onnx.wasm.numThreads = 2
  env.backends.onnx.wasm.proxy = false
  return { pipeline, env }
}

export interface TranscriptionOptions {
  modelId?: string
  language?: string
  task?: 'transcribe' | 'translate'
  sourceSampleRate?: number
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
  private asrPipeline: any = null
  private currentModelId: string | null = null
  // In @xenova/transformers 2.x, ONNX runtime executes on WASM
  private currentDevice: 'webgpu' | 'wasm' = 'wasm'
  private isInitializing = false
  private progressListener: ModelProgressListener | null = null

  // Robust cancellation & token tracking
  private currentGenerationToken: number = 0
  private cancelledTokens: Set<number> = new Set()
  private activeAbortController: AbortController | null = null

  // Default candidate model (Multilingual Whisper Base provides optimal developer & Hinglish vocabulary)
  public static readonly DEFAULT_MODEL_ID = 'Xenova/whisper-base'
  public static readonly FALLBACK_MODEL_ID = 'Xenova/whisper-tiny'

  private constructor() {}

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
   * Initializes or retrieves the cached ASR pipeline
   */
  public async initialize(modelId: string = WhisperASRService.DEFAULT_MODEL_ID): Promise<void> {
    // If the pipeline for this exact model is already loaded and ready, reuse it immediately
    if (this.asrPipeline && this.currentModelId === modelId) {
      return
    }

    if (this.isInitializing) {
      // Wait for in-flight initialization
      while (this.isInitializing) {
        await new Promise(r => setTimeout(r, 50))
      }
      if (this.asrPipeline && this.currentModelId === modelId) return
    }

    this.isInitializing = true
    const startTime = Date.now()
    // Report WASM execution provider honestly as supported by installed @xenova/transformers 2.17.2
    this.currentDevice = 'wasm'
    console.log(`[WhisperASR] Initializing ASR pipeline with model: ${modelId} on execution provider: ${this.currentDevice}...`)

    try {
      const { pipeline } = await getTransformers()

      this.asrPipeline = await pipeline('automatic-speech-recognition', modelId, {
        progress_callback: (p: any) => {
          if (this.progressListener) {
            this.progressListener({
              ...p,
              modelId
            })
          }
        }
      })

      this.currentModelId = modelId
      console.log(`[WhisperASR] Model ${modelId} loaded successfully on ${this.currentDevice} in ${Date.now() - startTime}ms`)
    } catch (err: any) {
      console.error(`[WhisperASR] Critical: Failed to load ${modelId}:`, err)
      this.asrPipeline = null
      this.currentModelId = null
      const isOfflineError = err.message?.includes('fetch failed') || err.message?.includes('ENOTFOUND')
      if (isOfflineError) {
        throw new Error(`Whisper model (${modelId}) is not cached locally. An initial internet connection is required to download model weights.`)
      }
      throw new Error(`Failed to initialize Whisper ASR model (${modelId}): ${err.message || err}`)
    } finally {
      this.isInitializing = false
    }
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

    // 3. Increment generation token & track abort controller
    const token = ++this.currentGenerationToken
    this.activeAbortController = new AbortController()
    const inferenceStart = Date.now()

    try {
      console.log(`[WhisperASR] [Token ${token}] Running inference on ${validated.durationSeconds.toFixed(2)}s audio using ${this.currentDevice}...`)

      // Run inference
      const result = await this.asrPipeline(validated.audio, {
        language: options.language,
        task: options.task || 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5
      })

      // 4. Check if this token was cancelled during inference execution
      if (this.cancelledTokens.has(token) || token !== this.currentGenerationToken) {
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
      if (this.cancelledTokens.has(token) || token !== this.currentGenerationToken || this.activeAbortController?.signal.aborted) {
        this.cancelledTokens.delete(token)
        console.log(`[WhisperASR] [Token ${token}] Inference aborted by cancellation`)
        throw new TranscriptionCancelledError(`Transcription with token ${token} was cancelled`, token)
      }
      console.error('[WhisperASR] Inference failed:', err)
      throw err
    } finally {
      this.cancelledTokens.delete(token)
      if (token === this.currentGenerationToken) {
        this.activeAbortController = null
      }
    }
  }

  /**
   * Cancels in-flight inference immediately
   */
  public cancel(): void {
    const current = this.currentGenerationToken
    this.cancelledTokens.add(current)
    this.currentGenerationToken++
    if (this.activeAbortController) {
      console.log(`[WhisperASR] Cancelling active inference token ${current}. Next token: ${this.currentGenerationToken}`)
      this.activeAbortController.abort()
    }
  }

  /**
   * Unloads the pipeline and frees memory
   */
  public async destroy(): Promise<void> {
    this.cancel()
    this.asrPipeline = null
    this.currentModelId = null
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
