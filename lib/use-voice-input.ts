import { useCallback, useRef } from 'react'
import { useChatContext } from './chat-context'
import { useAlert, openPermissionsPage, openAIFlagsPage } from './alert-context'
import { useSpeechRecognition } from './use-speech-recognition'
import { SpeechSetupNotice } from './local-speech'
import { 
  isAIModelError, 
  isMicrophoneError, 
  isSpeechRecognitionError 
} from './errors'

interface UseVoiceInputReturn {
  isListening: boolean
  isStarting: boolean
  speechStatus: string | null
  transcript: string
  handleMicClick: () => void
  startVoiceInput: () => Promise<void>
  stopVoiceInput: () => Promise<string | undefined>
}

export const useVoiceInput = (): UseVoiceInputReturn => {
  const { sendMessage } = useChatContext()
  const { showAlert } = useAlert()
  const { isListening, isStarting, speechStatus, transcript, startListening, stopListening } = useSpeechRecognition()
  const lastActionTimeRef = useRef(0)
  const isHandlingRef = useRef(false)

  const handleError = useCallback((error: any): void => {
    if (error?.name === 'AbortError') return
    if (error instanceof SpeechSetupNotice) {
      showAlert('info', 'Microphone setup', error.message, error.installLocale ? {
        label: 'Set up microphone',
        onClick: () => {
          void startListening(text => { if (text.trim()) sendMessage(text.trim()).catch(handleError) }, handleError, { installLocale: error.installLocale }).catch(handleError)
        }
      } : undefined)
      return
    }
    console.error('[useVoiceInput] error:', error)
    if (isMicrophoneError(error)) {
      showAlert('error', 'Microphone Permission Denied',
        'Microphone access is required for voice input.',
        {
          label: 'Open Permissions',
          onClick: openPermissionsPage
        })
    } else if (isSpeechRecognitionError(error)) {
      showAlert('error', 'Speech Recognition Not Available', 
        'Your browser does not support speech recognition.')
    } else if (isAIModelError(error)) {
      showAlert('error', 'AI Model Not Available',
        'Enable Gemini Nano in Chrome flags and relaunch browser.',
        {
          label: 'Open Flags',
          onClick: openAIFlagsPage
        })
    } else {
      showAlert('error', 'Error', error?.message || 'An unexpected error occurred')
    }
  }, [showAlert, startListening, sendMessage])

  const startVoiceInput = useCallback(async () => {
    const now = Date.now()
    if (now - lastActionTimeRef.current < 150) return
    lastActionTimeRef.current = now

    try {
      await startListening(async (autoTranscript: string) => {
        if (autoTranscript && autoTranscript.trim()) {
          sendMessage(autoTranscript.trim()).catch(handleError)
        }
      }, handleError)
    } catch (err) {
      handleError(err)
    }
  }, [startListening, sendMessage, handleError])

  const stopVoiceInput = useCallback(async (): Promise<string | undefined> => {
    const now = Date.now()
    lastActionTimeRef.current = now

    try {
      const finalTranscript = await stopListening()
      if (finalTranscript && finalTranscript.trim()) {
        const text = finalTranscript.trim()
        sendMessage(text).catch(handleError)
        return text
      }
    } catch (err) {
      handleError(err)
    }
    return undefined
  }, [stopListening, sendMessage, handleError])

  const handleMicClick = useCallback(async () => {
    const now = Date.now()
    // Setup can include a first-use download. A second click must remain able
    // to cancel it while the original start promise is pending.
    if (isStarting) { await stopVoiceInput(); return }
    // Short 150ms debounce guard to reject accidental double-clicks without locking the mic
    if (isHandlingRef.current || (now - lastActionTimeRef.current < 150)) {
      return
    }
    isHandlingRef.current = true

    try {
      if (isListening) {
        await stopVoiceInput()
      } else {
        await startVoiceInput()
      }
    } catch (error: any) {
      handleError(error)
    } finally {
      // Release debounce lock quickly so subsequent interactions are never trapped
      setTimeout(() => {
        isHandlingRef.current = false
      }, 150)
    }
  }, [isListening, isStarting, startVoiceInput, stopVoiceInput, handleError])

  return {
    isListening,
    isStarting,
    speechStatus,
    transcript,
    handleMicClick,
    startVoiceInput,
    stopVoiceInput
  }
}
