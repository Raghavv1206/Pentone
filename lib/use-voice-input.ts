import { useCallback } from 'react'
import { useChatContext } from './chat-context'
import { useAlert, openPermissionsPage, openAIFlagsPage } from './alert-context'
import { useSpeechRecognition } from './use-speech-recognition'
import { useTTS } from './tts-context'
import { 
  isAIModelError, 
  isMicrophoneError, 
  isSpeechRecognitionError 
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
  const { isListening, transcript, startListening, stopListening, cancelListening } = useSpeechRecognition()

  const handleMicClick = useCallback(async () => {
    try {
      if (isListening) {
        const finalTranscript = await stopListening()
        
        if (finalTranscript.trim()) {
          await sendMessage(finalTranscript)
        }
      } else {
        // Enforce half-duplex mutual exclusion: stop any active assistant speech before opening microphone
        if (isSpeaking) {
          stopTTS()
        }

        // Pass callback to handle auto-end (when recognition detects natural silence after speech)
        await startListening(async (autoTranscript: string) => {
          if (autoTranscript.trim()) {
            await sendMessage(autoTranscript)
          }
        })
      }
    } catch (error: any) {
      console.error('Voice input error:', error)
      
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
        showAlert('error', 'Voice Input Error', error.message || 'An unexpected error occurred during voice capture')
      }
    }
  }, [isListening, isSpeaking, stopTTS, startListening, stopListening, sendMessage, showAlert])

  return {
    isListening,
    transcript,
    handleMicClick,
    cancelListening
  }
}
