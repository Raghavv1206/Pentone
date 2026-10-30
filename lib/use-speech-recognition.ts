import { useState, useRef, useCallback, useEffect } from 'react'
import { MicrophonePermissionError, SpeechRecognitionUnavailableError } from './errors'
import { useMediaDevice } from './media-device-context'
import { E2E_TEST_CONFIG } from './e2e-config'
import { loadSettings } from './settings'

interface UseSpeechRecognitionReturn {
  isListening: boolean
  transcript: string
  startListening: (onAutoEnd?: (transcript: string) => void) => Promise<void>
  stopListening: () => Promise<string>
  cancelListening: () => void
}

let testPhraseIndex = 0

// Silence timeout: allow 2.5 seconds of natural pause before completing an utterance
const SILENCE_TIMEOUT_MS = 2500

// Module-level lock for half-duplex hardware synchronization
let isSpeechRecognitionActive = false
export function isMicHardwareBusy(): boolean {
  return isSpeechRecognitionActive
}
export function releaseMicHardwareLock(): void {
  isSpeechRecognitionActive = false
}

export const useSpeechRecognition = (): UseSpeechRecognitionReturn => {
  const { selectedMicId } = useMediaDevice()
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState("")
  
  const recognitionRef = useRef<any>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const onAutoEndRef = useRef<((transcript: string) => void) | null>(null)
  const transcriptRef = useRef<string>("")
  const selectedMicIdRef = useRef<string | null>(null)
  
  // Robust session lifecycle refs
  const isSessionActiveRef = useRef(false)
  const isEngineRunningRef = useRef(false)
  const accumulatedFinalTextRef = useRef<string>("")
  const interimTextRef = useRef<string>("")
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const restartCountRef = useRef(0)
  const restartDelayTimerRef = useRef<NodeJS.Timeout | null>(null)
  const selectedLanguageRef = useRef<string>('en-IN')
  
  // Sync selected mic
  selectedMicIdRef.current = selectedMicId

  // Load language preference from settings
  useEffect(() => {
    loadSettings().then(settings => {
      if (settings.speechLanguage) {
        selectedLanguageRef.current = settings.speechLanguage
      }
    })

    const listener = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName === 'local' && (changes.pentone_settings?.newValue || changes.marionette_settings?.newValue)) {
        const s = changes.pentone_settings?.newValue || changes.marionette_settings?.newValue
        if (s.speechLanguage) {
          selectedLanguageRef.current = s.speechLanguage
        }
      }
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [])

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
  }

  const cleanupAudioStream = () => {
    if (mediaStreamRef.current) {
      try {
        mediaStreamRef.current.getTracks().forEach(track => {
          track.stop()
        })
      } catch (e) {
        console.warn('[Speech Recognition] Error stopping media tracks:', e)
      }
      mediaStreamRef.current = null
    }
  }

  // Internal helper to create and start a native SpeechRecognition engine
  const startRecognitionEngine = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      throw new SpeechRecognitionUnavailableError()
    }

    try {
      const recognition = new SpeechRecognition()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = selectedLanguageRef.current || 'en-IN'

      recognition.onstart = () => {
        console.log('[Speech Recognition] Engine started in language:', recognition.lang)
        isEngineRunningRef.current = true
        isSpeechRecognitionActive = true
        restartCountRef.current = 0
      }

      recognition.onresult = (event: any) => {
        clearSilenceTimer()
        
        let newFinalizedChunk = ''
        let currentInterim = ''

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i]
          const piece = res[0]?.transcript || ''
          if (res.isFinal) {
            newFinalizedChunk += (newFinalizedChunk ? ' ' : '') + piece.trim()
          } else {
            currentInterim += (currentInterim ? ' ' : '') + piece.trim()
          }
        }

        if (newFinalizedChunk) {
          const prev = accumulatedFinalTextRef.current
          accumulatedFinalTextRef.current = prev ? `${prev} ${newFinalizedChunk}` : newFinalizedChunk
        }

        interimTextRef.current = currentInterim
        
        const combined = [accumulatedFinalTextRef.current, currentInterim].filter(Boolean).join(' ').trim()
        setTranscript(combined)
        transcriptRef.current = combined

        // Set natural pause silence timer only if we have non-empty spoken words
        if (combined.length > 0 && isSessionActiveRef.current) {
          silenceTimerRef.current = setTimeout(() => {
            console.log('[Speech Recognition] Natural pause timeout (2.5s silence) reached. Finalizing utterance.')
            if (isSessionActiveRef.current && transcriptRef.current.trim()) {
              const fullText = transcriptRef.current.trim()
              stopListening().then(() => {
                if (onAutoEndRef.current) {
                  onAutoEndRef.current(fullText)
                  onAutoEndRef.current = null
                }
              })
            }
          }, SILENCE_TIMEOUT_MS)
        }
      }

      recognition.onerror = (event: any) => {
        console.warn('[Speech Recognition] Engine error:', event.error)
        
        if (event.error === 'not-allowed' || event.error === 'permission-denied') {
          isSessionActiveRef.current = false
          isSpeechRecognitionActive = false
          setIsListening(false)
          cleanupAudioStream()
          throw new MicrophonePermissionError()
        }
        
        // 'no-speech' is expected during pauses when continuous = true; do not cancel user session
        if (event.error === 'no-speech') {
          return
        }
      }

      recognition.onend = () => {
        console.log('[Speech Recognition] Engine onend fired. Session active status:', isSessionActiveRef.current)
        isEngineRunningRef.current = false
        isSpeechRecognitionActive = false

        // Do NOT restart if user ended session or is inactive
        if (isSessionActiveRef.current) {
          if (restartCountRef.current < 5) {
            restartCountRef.current++
            console.log(`[Speech Recognition] Unexpected engine termination; recovering session (attempt ${restartCountRef.current}/5)...`)
            
            if (restartDelayTimerRef.current) clearTimeout(restartDelayTimerRef.current)
            restartDelayTimerRef.current = setTimeout(() => {
              if (isSessionActiveRef.current && !isEngineRunningRef.current) {
                try {
                  startRecognitionEngine()
                } catch (reErr) {
                  console.error('[Speech Recognition] Failed to restart engine:', reErr)
                }
              }
            }, 200)
          } else {
            console.warn('[Speech Recognition] Max restart attempts reached. Ending session gracefully.')
            stopListening()
          }
        }
      }

      recognitionRef.current = recognition
      recognition.start()
    } catch (err) {
      isEngineRunningRef.current = false
      isSpeechRecognitionActive = false
      throw err
    }
  }, [])

  const startListening = useCallback(async (onAutoEnd?: (transcript: string) => void) => {
    onAutoEndRef.current = onAutoEnd || null
    isSessionActiveRef.current = true
    accumulatedFinalTextRef.current = ""
    interimTextRef.current = ""
    setTranscript("")
    transcriptRef.current = ""
    restartCountRef.current = 0
    clearSilenceTimer()

    // 1. Microphone access & device verification probe
    // Note: We probe mic permission and immediately stop probe tracks so Windows does NOT
    // stay in Communications Audio Mode during speech recognition!
    try {
      const constraints: MediaStreamConstraints = {
        audio: selectedMicIdRef.current ? { deviceId: { exact: selectedMicIdRef.current } } : true
      }
      console.log('[Speech Recognition] Verifying mic access:', selectedMicIdRef.current || 'default')
      const probeStream = await navigator.mediaDevices.getUserMedia(constraints)
      probeStream.getTracks().forEach(track => track.stop())
    } catch (error: any) {
      isSessionActiveRef.current = false
      isSpeechRecognitionActive = false
      setIsListening(false)
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        throw new MicrophonePermissionError()
      }
      throw error
    }

    // 2. TEST MODE SUPPORT
    if (E2E_TEST_CONFIG.TEST_MODE_ENABLED) {
      setIsListening(true)
      isSpeechRecognitionActive = true
      let currentPhrase = E2E_TEST_CONFIG.TEST_PHRASES[testPhraseIndex % E2E_TEST_CONFIG.TEST_PHRASES.length]
      testPhraseIndex++
      currentPhrase = currentPhrase.toLowerCase().replace(/[^a-z0-9\s]/g, '')
      
      console.log(`[E2E Test Mode] Using test phrase: "${currentPhrase}"`)
      recognitionRef.current = { 
        isTestMode: true,
        phrase: currentPhrase,
        stopped: false
      }

      await new Promise(resolve => setTimeout(resolve, E2E_TEST_CONFIG.INITIAL_DELAY))
      if (!recognitionRef.current || recognitionRef.current.stopped) return

      const words = currentPhrase.split(' ').filter(w => w.length > 0)
      let accumulatedText = ''
      for (let i = 0; i < words.length; i++) {
        await new Promise(resolve => setTimeout(resolve, E2E_TEST_CONFIG.WORD_DELAY))
        if (!recognitionRef.current || recognitionRef.current.stopped) break
        accumulatedText += (i > 0 ? ' ' : '') + words[i]
        setTranscript(accumulatedText)
        transcriptRef.current = accumulatedText
      }

      await new Promise(resolve => setTimeout(resolve, E2E_TEST_CONFIG.AUTO_END_DELAY))
      if (recognitionRef.current && !recognitionRef.current.stopped) {
        setIsListening(false)
        isSessionActiveRef.current = false
        isSpeechRecognitionActive = false
        cleanupAudioStream()
        if (onAutoEndRef.current && transcriptRef.current) {
          onAutoEndRef.current(transcriptRef.current)
          setTranscript("")
          transcriptRef.current = ""
          onAutoEndRef.current = null
        }
        recognitionRef.current = null
      }
      return
    }

    // 3. PRODUCTION MODE: Start recognition engine
    setIsListening(true)
    isSpeechRecognitionActive = true
    startRecognitionEngine()
  }, [startRecognitionEngine])

  const stopListening = useCallback(async (): Promise<string> => {
    console.log('[Speech Recognition] Explicit stop requested; waiting for hardware release...')
    isSessionActiveRef.current = false
    clearSilenceTimer()
    if (restartDelayTimerRef.current) clearTimeout(restartDelayTimerRef.current)

    // Deterministic hardware release: Wait until speech recognition actually fires onend
    const hardwareReleasePromise = new Promise<void>((resolve) => {
      const rec = recognitionRef.current
      if (!rec || rec.isTestMode || !isEngineRunningRef.current) {
        resolve()
        return
      }

      let settled = false
      const finish = () => {
        if (!settled) {
          settled = true
          resolve()
        }
      }

      const prevOnEnd = rec.onend
      rec.onend = (ev: any) => {
        if (prevOnEnd) {
          try { prevOnEnd(ev) } catch {}
        }
        finish()
      }

      try {
        rec.stop()
      } catch (e) {
        finish()
      }

      // Safety timeout: Chromium recognition services finish onend within 300ms
      setTimeout(finish, 350)
    })

    await hardwareReleasePromise

    recognitionRef.current = null
    isEngineRunningRef.current = false
    isSpeechRecognitionActive = false
    cleanupAudioStream()

    const finalResult = transcriptRef.current.trim()
    setIsListening(false)
    console.log('[Speech Recognition] Hardware release complete; final transcript:', finalResult)
    return finalResult
  }, [])

  const cancelListening = useCallback(() => {
    console.log('[Speech Recognition] Cancel requested; discarding transcript')
    isSessionActiveRef.current = false
    isSpeechRecognitionActive = false
    clearSilenceTimer()
    if (restartDelayTimerRef.current) clearTimeout(restartDelayTimerRef.current)

    if (recognitionRef.current) {
      if (recognitionRef.current.isTestMode) {
        recognitionRef.current.stopped = true
        recognitionRef.current = null
      } else {
        try {
          recognitionRef.current.abort ? recognitionRef.current.abort() : recognitionRef.current.stop()
        } catch (e) {}
        recognitionRef.current = null
      }
    }

    isEngineRunningRef.current = false
    cleanupAudioStream()
    accumulatedFinalTextRef.current = ""
    interimTextRef.current = ""
    setTranscript("")
    transcriptRef.current = ""
    onAutoEndRef.current = null
    setIsListening(false)
  }, [])

  return {
    isListening,
    transcript,
    startListening,
    stopListening,
    cancelListening
  }
}
