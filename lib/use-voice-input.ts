import { useCallback, useRef } from 'react'
import { useChatContext } from './chat-context'
import { useAlert, openPermissionsPage, openAIFlagsPage } from './alert-context'
import { useSpeechRecognition } from './use-speech-recognition'
import { 
  isAIModelError, 
  isMicrophoneError, 
  isSpeechRecognitionError 
} from './errors'

interface UseVoiceInputReturn {
  isListening: boolean
  transcript: string
  handleMicClick: () => void
  startVoiceInput: () => Promise<void>
  stopVoiceInput: () => Promise<string | undefined>
}

export const useVoiceInput = (): UseVoiceInputReturn => {
  const { sendMessage } = useChatContext()
  const { showAlert } = useAlert()
  const { isListening, transcript, startListening, stopListening } = useSpeechRecognition()
  const lastActionTimeRef = useRef(0)
  const isHandlingRef = useRef(false)

  const handleError = useCallback((error: any) => {
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
  }, [showAlert])

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
  }, [isListening, startVoiceInput, stopVoiceInput, handleError])

  return {
    isListening,
    transcript,
    handleMicClick,
    startVoiceInput,
    stopVoiceInput
  }
}
