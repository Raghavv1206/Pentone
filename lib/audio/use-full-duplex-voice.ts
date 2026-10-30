/**
 * Pentone Full-Duplex Conversational Voice Hook
 * 
 * Coordinates persistent microphone capture, Silero VAD, and the 8-state Barge-In Controller.
 * Provides:
 * 1. Single toggle to enable/disable persistent conversational voice mode.
 * 2. Instant barge-in: interrupts assistant speech immediately upon human speech detection.
 * 3. Real-time voice state indicator (Listening, User Speaking, Assistant Speaking, Interrupted).
 * 4. Automatic hardware cleanup on Side Panel unmount or voice mode disable.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { PersistentAudioPipeline, type AudioMetrics } from './persistent-audio-pipeline'
import { SileroVADService } from './silero-vad-service'
import { BargeInController, type VoiceState } from './barge-in-controller'
import { WhisperASRService } from './whisper-asr-service'
import { ASROrchestrator } from './asr-intent-orchestrator'
import { useTTS } from '../tts-context'
import { useChatContext } from '../chat-context'
import { useMediaDevice } from '../media-device-context'
import { loadSettings } from '../settings'

export interface FullDuplexVoiceReturn {
  isFullDuplexEnabled: boolean
  voiceState: VoiceState
  volumeLevel: number
  toggleVoiceMode: () => Promise<void>
  muteImmediately: () => void
  error: string | null
}

export const useFullDuplexVoice = (): FullDuplexVoiceReturn => {
  const [isFullDuplexEnabled, setIsFullDuplexEnabled] = useState(false)
  const [voiceState, setVoiceState] = useState<VoiceState>('DISABLED')
  const [volumeLevel, setVolumeLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const { selectedMicId } = useMediaDevice()
  const { isSpeaking, stop: stopTTS } = useTTS()
  const { sendMessage, interruptChat } = useChatContext()
  const orchestratorRef = useRef(new ASROrchestrator())
  const activeSpeechTurnRef = useRef<number>(0)

  // References to keep instances alive across renders
  const pipelineRef = useRef<PersistentAudioPipeline | null>(null)
  const vadServiceRef = useRef<SileroVADService | null>(null)
  const controllerRef = useRef<BargeInController | null>(null)

  // Track assistant speaking status for state machine synchronization
  const isSpeakingRef = useRef(isSpeaking)
  isSpeakingRef.current = isSpeaking

  // Initialize Barge-In Controller
  if (!controllerRef.current) {
    controllerRef.current = new BargeInController({
      onStateChange: (newState) => {
        setVoiceState(newState)
      },
      onInterrupt: () => {
        console.log('[FullDuplexVoice] Interruption action: cancelling TTS, cancelling in-flight Whisper, and aborting turn...')
        activeSpeechTurnRef.current++
        WhisperASRService.getInstance().cancel()
        orchestratorRef.current.resetDedupe()
        stopTTS()
        interruptChat()
      },
      onSpeechEnd: async (audioBuffer) => {
        const turnId = ++activeSpeechTurnRef.current
        console.log(`[FullDuplexVoice] [Turn ${turnId}] Transcribing speech utterance buffer with local Whisper...`)
        try {
          const whisper = WhisperASRService.getInstance()
          const settings = await loadSettings().catch(() => null)
          const modelId = settings?.whisperModel || WhisperASRService.DEFAULT_MODEL_ID

          // Pre-transcription check
          if (turnId !== activeSpeechTurnRef.current) {
            console.log(`[FullDuplexVoice] [Turn ${turnId}] Turn invalidated before Whisper started. Discarding.`)
            controllerRef.current?.readyToListen()
            return
          }

          const transcription = await whisper.transcribe(audioBuffer, { modelId })

          // Post-transcription validity check
          if (turnId !== activeSpeechTurnRef.current) {
            console.log(`[FullDuplexVoice] [Turn ${turnId}] Turn superseded during transcription. Discarding output: "${transcription.text}"`)
            controllerRef.current?.readyToListen()
            return
          }
          
          if (!transcription.text) {
            console.log(`[FullDuplexVoice] [Turn ${turnId}] Empty transcription, returning to listening`)
            controllerRef.current?.readyToListen()
            return
          }

          console.log(`[FullDuplexVoice] [Turn ${turnId}] Recognized text: "${transcription.text}"`)
          const processed = orchestratorRef.current.processTranscript(transcription.text)

          if (processed.isDuplicate) {
            console.log(`[FullDuplexVoice] [Turn ${turnId}] Ignoring duplicate utterance`)
            controllerRef.current?.readyToListen()
            return
          }

          // Final pre-dispatch validity check
          if (turnId !== activeSpeechTurnRef.current) {
            console.log(`[FullDuplexVoice] [Turn ${turnId}] Turn superseded before dispatch. Discarding output: "${processed.effectiveQuery}"`)
            controllerRef.current?.readyToListen()
            return
          }

          if (processed.shouldClarify && processed.clarificationPrompt) {
            console.log(`[FullDuplexVoice] [Turn ${turnId}] Spoken command ambiguous, routing clarification to agent:`, processed.clarificationPrompt)
            await sendMessage(processed.originalTranscript)
            controllerRef.current?.readyToListen()
            return
          }

          console.log(`[FullDuplexVoice] [Turn ${turnId}] Dispatching command to agent:`, processed.effectiveQuery)
          await sendMessage(processed.effectiveQuery)
          controllerRef.current?.readyToListen()
        } catch (err: any) {
          if (err.name === 'TranscriptionCancelledError' || err.message?.includes('cancelled')) {
            console.log(`[FullDuplexVoice] [Turn ${turnId}] Transcription cancelled cleanly: ${err.message}`)
          } else {
            console.warn(`[FullDuplexVoice] [Turn ${turnId}] Transcription or agent dispatch error:`, err)
          }
          controllerRef.current?.readyToListen()
        }
      },
      onError: (err) => {
        setError(err.message)
      }
    })
  }

  // Sync assistant speaking transitions with controller
  useEffect(() => {
    if (!controllerRef.current) return

    if (isSpeaking) {
      controllerRef.current.handleAssistantSpeechStart()
    } else {
      controllerRef.current.handleAssistantSpeechEnd()
    }
  }, [isSpeaking])

  // Cleanup helper
  const teardownAudio = useCallback(async () => {
    console.log('[FullDuplexVoice] Tearing down full-duplex audio session...')
    activeSpeechTurnRef.current++
    WhisperASRService.getInstance().cancel()
    stopTTS()
    interruptChat()
    if (vadServiceRef.current) {
      await vadServiceRef.current.destroy()
      vadServiceRef.current = null
    }

    if (pipelineRef.current) {
      pipelineRef.current.release()
      pipelineRef.current = null
    }

    if (controllerRef.current) {
      controllerRef.current.disableVoiceMode()
    }

    setVolumeLevel(0)
    setIsFullDuplexEnabled(false)
  }, [])

  // Immediate mute control
  const muteImmediately = useCallback(() => {
    console.log('[FullDuplexVoice] Immediate mute requested')
    teardownAudio().catch(e => console.warn('[FullDuplexVoice] Teardown error:', e))
  }, [teardownAudio])

  // Toggle voice mode
  const toggleVoiceMode = useCallback(async () => {
    if (isFullDuplexEnabled) {
      await teardownAudio()
      return
    }

    try {
      setError(null)
      console.log('[FullDuplexVoice] Enabling persistent full-duplex voice mode...')

      // 1. Initialize persistent audio pipeline
      const pipeline = new PersistentAudioPipeline({
        deviceId: selectedMicId,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 16000
      })
      pipelineRef.current = pipeline

      // Volume monitoring for UI waveform
      pipeline.onMetrics((metrics: AudioMetrics) => {
        setVolumeLevel(metrics.volume)
      })

      // 2. Acquire mic stream once
      await pipeline.acquire()

      // 3. Initialize Silero VAD
      const controller = controllerRef.current!
      controller.enableVoiceMode()

      const vadService = new SileroVADService(
        pipeline,
        {
          onSpeechStart: () => controller.handleSpeechStart(),
          onSpeechRealStart: () => console.log('[FullDuplexVoice] Speech validated'),
          onSpeechEnd: (audio) => controller.handleSpeechEnd(audio),
          onVADMisfire: () => controller.handleVADMisfire(),
          onError: (err) => controller.handleError(err)
        },
        {
          positiveSpeechThreshold: 0.5,
          negativeSpeechThreshold: 0.35,
          minSpeechMs: 100,
          redemptionMs: 250,
          preSpeechPadMs: 160
        }
      )
      vadServiceRef.current = vadService

      // Start VAD monitoring
      await vadService.start()
      controller.readyToListen()

      // Background pre-warm Whisper ASR pipeline so first utterance executes immediately
      WhisperASRService.getInstance().initialize().catch(e => {
        console.warn('[FullDuplexVoice] Whisper background pre-warm:', e)
      })

      setIsFullDuplexEnabled(true)
      console.log('[FullDuplexVoice] Full-duplex persistent listening enabled successfully')
    } catch (err: any) {
      console.error('[FullDuplexVoice] Failed to enable full-duplex mode:', err)
      setError(err.message || 'Failed to initialize voice capture')
      await teardownAudio()
    }
  }, [isFullDuplexEnabled, selectedMicId, teardownAudio])

  // Handle device switching seamlessly
  useEffect(() => {
    if (isFullDuplexEnabled && pipelineRef.current && selectedMicId) {
      pipelineRef.current.switchDevice(selectedMicId).catch(err => {
        console.warn('[FullDuplexVoice] Device switch error:', err)
      })
    }
  }, [selectedMicId, isFullDuplexEnabled])

  // Clean up on component unmount (e.g. Side Panel closure)
  useEffect(() => {
    return () => {
      console.log('[FullDuplexVoice] Unmount detected, cleaning up persistent audio tracks...')
      if (pipelineRef.current) {
        pipelineRef.current.release()
      }
      if (vadServiceRef.current) {
        vadServiceRef.current.destroy()
      }
    }
  }, [])

  return {
    isFullDuplexEnabled,
    voiceState,
    volumeLevel,
    toggleVoiceMode,
    muteImmediately,
    error
  }
}
