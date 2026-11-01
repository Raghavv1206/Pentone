/**
 * Silero VAD Service
 * 
 * Manages neural Voice Activity Detection using Silero VAD (@ricky0123/vad-web).
 * Connects to the persistent microphone pipeline and provides real-time callbacks:
 * - onSpeechStart: Triggered at the onset of human speech (used for instant barge-in).
 * - onSpeechRealStart: Triggered when speech continues beyond the minimum frame threshold.
 * - onSpeechEnd: Triggered when the user finishes speaking, returning the Float32Array PCM audio buffer.
 * - onVADMisfire: Triggered when transient noise (< minSpeechFrames) is safely rejected.
 */

import { MicVAD, type RealTimeVADOptions } from '@ricky0123/vad-web'
import type { PersistentAudioPipeline } from './persistent-audio-pipeline'
import type { VADSpeechBoundaryInfo } from './biometric-audio-extractor'

export interface VADCallbacks {
  onSpeechStart?: () => void
  onSpeechRealStart?: () => void
  onSpeechEnd?: (audio: Float32Array, vadInfo?: VADSpeechBoundaryInfo) => void
  onVADMisfire?: () => void
  onError?: (error: Error) => void
}

export interface VADServiceOptions {
  positiveSpeechThreshold?: number // Default: 0.5
  negativeSpeechThreshold?: number // Default: 0.35
  minSpeechMs?: number // Minimum duration to count as speech (default: 100ms)
  redemptionMs?: number // Silence duration allowed before ending utterance (default: 250ms)
  preSpeechPadMs?: number // Duration prepended to audio buffer so word start is not clipped (default: 160ms)
}

export class SileroVADService {
  private vadInstance: MicVAD | null = null
  private isRunning = false
  private activeSpeechFramesCount = 0

  constructor(
    private pipeline: PersistentAudioPipeline,
    private callbacks: VADCallbacks = {},
    private options: VADServiceOptions = {}
  ) {}

  /**
   * Initializes and starts the Silero VAD instance
   */
  async start(): Promise<void> {
    if (this.vadInstance && this.isRunning) {
      console.log('[SileroVAD] Already running')
      return
    }

    try {
      console.log('[SileroVAD] Initializing Silero VAD engine...')

      // Ensure pipeline AudioContext is actively resumed
      await this.pipeline.resumeAudioContext()

      // Resolve local extension asset URLs
      const isExtension = typeof chrome !== 'undefined' && !!chrome.runtime?.getURL
      const baseAssetPath = isExtension ? chrome.runtime.getURL('assets/') : '/assets/'

      // Load verified, bundler-compatible ONNX runtime backend from @xenova/transformers
      // This completely circumvents Parcel's dynamic .mjs import interception in Chrome MV3
      let onnxBackend: any = null
      try {
        const mod: any = await import('@xenova/transformers/src/backends/onnx.js')
        onnxBackend = mod?.ONNX
        if (onnxBackend?.env?.wasm) {
          onnxBackend.env.wasm.wasmPaths = baseAssetPath
          onnxBackend.env.wasm.numThreads = 1
          onnxBackend.env.wasm.proxy = false
        }
      } catch (e) {
        console.warn('[SileroVAD] Direct transformers ONNX backend import failed:', e)
      }

      const vadOptions: Partial<RealTimeVADOptions> = {
        model: 'legacy',
        baseAssetPath,
        onnxWASMBasePath: baseAssetPath,
        audioContext: this.pipeline.getAudioContext() || undefined,
        positiveSpeechThreshold: this.options.positiveSpeechThreshold ?? 0.5,
        negativeSpeechThreshold: this.options.negativeSpeechThreshold ?? 0.35,
        minSpeechMs: this.options.minSpeechMs ?? 100,
        redemptionMs: this.options.redemptionMs ?? 250,
        preSpeechPadMs: this.options.preSpeechPadMs ?? 160,
        ortConfig: (ort: any) => {
          // Force single-threaded WASM execution inside Chrome extension environment
          if (ort?.env?.wasm) {
            ort.env.wasm.wasmPaths = baseAssetPath
            ort.env.wasm.numThreads = 1
            ort.env.wasm.proxy = false
          }
          if (onnxBackend?.InferenceSession?.create) {
            console.log('[SileroVAD] Hooking ort.InferenceSession.create to verified ONNX backend')
            ort.InferenceSession.create = async (modelData: any, options?: any) => {
              console.log('[SileroVAD] Creating InferenceSession via verified ONNX backend...')
              const sessionOptions = {
                ...options,
                logSeverityLevel: 3,
              }
              const session = await onnxBackend.InferenceSession.create(modelData, sessionOptions)
              return {
                inputNames: session.inputNames,
                outputNames: session.outputNames,
                run: async (feeds: any) => {
                  return await session.run(feeds)
                },
                release: async () => {
                  if (typeof session.release === 'function') {
                    await session.release()
                  } else if (typeof session.handler?.dispose === 'function') {
                    await session.handler.dispose()
                  }
                }
              }
            }
          }
        },
        
        // Feed audio from our persistent audio pipeline
        getStream: async () => {
          return this.pipeline.acquire()
        },
        pauseStream: async () => {
          // Never stop hardware tracks during normal conversation flow
        },
        resumeStream: async () => {
          return this.pipeline.acquire()
        },

        onSpeechStart: () => {
          this.activeSpeechFramesCount = 0
          console.log('[SileroVAD] Speech onset detected (onSpeechStart)')
          this.callbacks.onSpeechStart?.()
        },

        onSpeechRealStart: () => {
          console.log('[SileroVAD] Speech validated (onSpeechRealStart)')
          this.callbacks.onSpeechRealStart?.()
        },

        onFrameProcessed: (probabilities: any) => {
          const threshold = this.options.positiveSpeechThreshold ?? 0.5
          if (probabilities?.isSpeech >= threshold) {
            this.activeSpeechFramesCount++
          }
        },

        onSpeechEnd: (audio: Float32Array) => {
          console.log(`[SileroVAD] Utterance complete (onSpeechEnd) - ${audio.length} samples (${(audio.length / 16000).toFixed(2)}s)`)
          const preSpeechPadMs = this.options.preSpeechPadMs ?? 250
          const redemptionMs = this.options.redemptionMs ?? 450
          const vadInfo: VADSpeechBoundaryInfo = {
            preSpeechPadMs,
            redemptionMs,
            speechStartSample: Math.floor((preSpeechPadMs * 16000) / 1000),
            speechEndSample: Math.max(0, audio.length - Math.floor((redemptionMs * 16000) / 1000)),
            activeSpeechFramesCount: this.activeSpeechFramesCount,
          }
          this.callbacks.onSpeechEnd?.(audio, vadInfo)
        },

        onVADMisfire: () => {
          console.log('[SileroVAD] Transient noise rejected (onVADMisfire)')
          this.callbacks.onVADMisfire?.()
        }
      }

      this.vadInstance = await MicVAD.new(vadOptions)
      await this.vadInstance.start()
      this.isRunning = true
      console.log('[SileroVAD] Silero VAD started successfully')
    } catch (err: any) {
      console.error('[SileroVAD] Failed to initialize Silero VAD:', err)
      this.isRunning = false
      this.callbacks.onError?.(err)
      throw err
    }
  }

  /**
   * Pauses VAD processing temporarily without destroying models
   */
  async pause(): Promise<void> {
    if (this.vadInstance && this.isRunning) {
      try {
        await this.vadInstance.pause()
      } catch (e) {
        console.warn('[SileroVAD] Pause error:', e)
      }
      this.isRunning = false
      console.log('[SileroVAD] Silero VAD paused')
    }
  }

  /**
   * Destroys the VAD instance and frees WebAssembly resources
   */
  async destroy(): Promise<void> {
    if (this.vadInstance) {
      try {
        await this.vadInstance.destroy()
      } catch (e) {
        console.warn('[SileroVAD] Destroy error:', e)
      }
      this.vadInstance = null
      this.isRunning = false
      console.log('[SileroVAD] Silero VAD destroyed')
    }
  }

  getIsRunning(): boolean {
    return this.isRunning
  }
}
