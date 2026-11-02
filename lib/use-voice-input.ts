import { useState, useRef, useCallback, useEffect } from 'react'
import { useChatContext } from './chat-context'
import { useAlert, openPermissionsPage, openAIFlagsPage } from './alert-context'
import { useTTS } from './tts-context'
import { useMediaDevice } from './media-device-context'
import { PersistentAudioPipeline } from './audio/persistent-audio-pipeline'
import { WhisperASRService } from './audio/whisper-asr-service'
import { loadSettings } from './settings'
import {
  isMicHardwareBusy,
  setMicHardwareBusy,
  releaseMicHardwareLock
} from './audio/mic-hardware-state'
export { isMicHardwareBusy, releaseMicHardwareLock }
import {
  isAIModelError,
  isMicrophoneError
} from './errors'

interface UseVoiceInputReturn {
  isListening: boolean
  transcript: string
  handleMicClick: () => void
  cancelListening: () => void
}

export const useVoiceInput = (): UseVoiceInputReturn => {
  const { sendMessage } = useChatContext()
  const { showAlert } = useAlert()
  const { isSpeaking, stop: stopTTS } = useTTS()
  const { selectedMicId } = useMediaDevice()

  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')

  const pipelineRef = useRef<PersistentAudioPipeline | null>(null)
  const audioChunksRef = useRef<Float32Array[]>([])
  const unsubscribeChunkRef = useRef<(() => void) | null>(null)
  const selectedMicIdRef = useRef<string | null>(null)
  const isListeningRef = useRef<boolean>(false)

  selectedMicIdRef.current = selectedMicId
  isListeningRef.current = isListening

  const cleanupAudioCapture = useCallback(() => {
    setMicHardwareBusy(false)
    if (unsubscribeChunkRef.current) {
      try {
        unsubscribeChunkRef.current()
      } catch (e) {
        console.warn('[VoiceInput] Error unsubscribing chunk listener:', e)
      }
      unsubscribeChunkRef.current = null
    }
    if (pipelineRef.current) {
      try {
        pipelineRef.current.release()
      } catch (e) {
        console.warn('[VoiceInput] Error releasing audio pipeline:', e)
      }
      pipelineRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      cleanupAudioCapture()
    }
  }, [cleanupAudioCapture])

  const cancelListening = useCallback(() => {
    console.log('[VoiceInput] Cancelling local voice capture')
    cleanupAudioCapture()
    try {
      WhisperASRService.getInstance().cancel()
    } catch {}
    audioChunksRef.current = []
    setIsListening(false)
    setTranscript('')
  }, [cleanupAudioCapture])

  const startLocalRecording = useCallback(async () => {
    console.log('[VoiceInput] Starting local on-device audio recording with PersistentAudioPipeline...')
    cleanupAudioCapture()
    audioChunksRef.current = []
    setTranscript('')

    const pipeline = new PersistentAudioPipeline({
      deviceId: selectedMicIdRef.current,
      sampleRate: 16000
    })
    pipelineRef.current = pipeline

    await pipeline.acquire(selectedMicIdRef.current)
    setMicHardwareBusy(true)

    unsubscribeChunkRef.current = pipeline.onAudioChunk((chunk: Float32Array) => {
      if (chunk && chunk.length > 0) {
        audioChunksRef.current.push(new Float32Array(chunk))
      }
    })

    setIsListening(true)
  }, [cleanupAudioCapture])

  const stopAndTranscribe = useCallback(async () => {
    console.log('[VoiceInput] Stopping local audio recording and initiating local Whisper ASR...')
    setIsListening(false)
    cleanupAudioCapture()

    const chunks = audioChunksRef.current
    audioChunksRef.current = []

    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0)
    if (totalLength < 1600) {
      console.log('[VoiceInput] Audio buffer too brief for transcription (<100ms); ignoring.')
      return
    }

    const mergedBuffer = new Float32Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      mergedBuffer.set(chunk, offset)
      offset += chunk.length
    }

    try {
      const settings = await loadSettings().catch(() => null)
      const modelId = settings?.whisperModel || WhisperASRService.DEFAULT_MODEL_ID
      const language = settings?.speechLanguage || 'en-IN'

      const whisper = WhisperASRService.getInstance()
      const transcription = await whisper.transcribe(mergedBuffer, { modelId, language })

      if (transcription && transcription.text && transcription.text.trim()) {
        const recognized = transcription.text.trim()
        console.log(`[VoiceInput] Local Whisper transcription: "${recognized}"`)
        setTranscript(recognized)
        await sendMessage(recognized)
      } else {
        console.log('[VoiceInput] Empty transcription returned from local Whisper.')
      }
    } catch (error: any) {
      if (error?.name === 'TranscriptionCancelledError') {
        console.log('[VoiceInput] Transcription cancelled by user')
        return
      }
      console.error('[VoiceInput] Local Whisper ASR error:', error)
      showAlert('error', 'Speech Recognition Error', error.message || 'Local Whisper speech recognition failed')
    }
  }, [cleanupAudioCapture, sendMessage, showAlert])

  const handleMicClick = useCallback(async () => {
    try {
      if (isListeningRef.current) {
        await stopAndTranscribe()
      } else {
        if (isSpeaking) {
          stopTTS()
        }
        await startLocalRecording()
      }
    } catch (error: any) {
      console.error('[VoiceInput] Error in handleMicClick:', error)
      cleanupAudioCapture()
      setIsListening(false)

      if (isMicrophoneError(error)) {
        showAlert('error', 'Microphone Permission Denied',
          'Microphone access is required for voice input.',
          {
            label: 'Open Permissions',
            onClick: openPermissionsPage
          })
      } else if (isAIModelError(error)) {
        showAlert('error', 'AI Model Not Available',
          'Enable Gemini Nano in Chrome flags and relaunch browser.',
          {
            label: 'Open Flags',
            onClick: openAIFlagsPage
          })
      } else {
        showAlert('error', 'Voice Input Error', error.message || 'An unexpected error occurred during voice capture')
      }
    }
  }, [isSpeaking, stopTTS, startLocalRecording, stopAndTranscribe, cleanupAudioCapture, showAlert])

  return {
    isListening,
    transcript,
    handleMicClick,
    cancelListening
  }
}
