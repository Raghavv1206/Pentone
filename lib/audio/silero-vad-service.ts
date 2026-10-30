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

export interface VADCallbacks {
  onSpeechStart?: () => void
  onSpeechRealStart?: () => void
  onSpeechEnd?: (audio: Float32Array) => void
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

      // Resolve local extension asset URLs
      const isExtension = typeof chrome !== 'undefined' && !!chrome.runtime?.getURL
      const baseAssetPath = isExtension ? chrome.runtime.getURL('assets/') : '/assets/'

      const vadOptions: Partial<RealTimeVADOptions> = {
        model: 'legacy',
        baseAssetPath,
        onnxWASMBasePath: baseAssetPath,
        positiveSpeechThreshold: this.options.positiveSpeechThreshold ?? 0.5,
        negativeSpeechThreshold: this.options.negativeSpeechThreshold ?? 0.35,
        minSpeechMs: this.options.minSpeechMs ?? 100,
        redemptionMs: this.options.redemptionMs ?? 250,
        preSpeechPadMs: this.options.preSpeechPadMs ?? 160,
        
        // Feed audio from our persistent audio pipeline
        getStream: async () => {
          return this.pipeline.acquire()
        },

        onSpeechStart: () => {
          console.log('[SileroVAD] Speech onset detected (onSpeechStart)')
          this.callbacks.onSpeechStart?.()
        },

        onSpeechRealStart: () => {
          console.log('[SileroVAD] Speech validated (onSpeechRealStart)')
          this.callbacks.onSpeechRealStart?.()
        },

        onSpeechEnd: (audio: Float32Array) => {
          console.log(`[SileroVAD] Utterance complete (onSpeechEnd) - ${audio.length} samples (${(audio.length / 16000).toFixed(2)}s)`)
          this.callbacks.onSpeechEnd?.(audio)
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
