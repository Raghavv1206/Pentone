import { useState, useRef, useCallback, useEffect } from 'react'
import { MicrophonePermissionError } from './errors'
import { useMediaDevice } from './media-device-context'
import { E2E_TEST_CONFIG } from './e2e-config'
import { readConversationLanguage, speechLocaleFor } from './language-preferences'
import { waitForSetup } from './bounded-operation'
import { prepareLocalSpeech, SpeechSetupNotice, type SpeechSetupOptions } from './local-speech'

interface UseSpeechRecognitionReturn {
  isListening: boolean
  isStarting: boolean
  speechStatus: string | null
  transcript: string
  startListening: (onAutoEnd?: (transcript: string) => void, onError?: (error: Error) => void, options?: Pick<SpeechSetupOptions, 'installLocale'>) => Promise<void>
  stopListening: () => Promise<string>
}

let testPhraseIndex = 0

export const useSpeechRecognition = (): UseSpeechRecognitionReturn => {
  const { selectedMicId } = useMediaDevice()
  const [isListening, setIsListening] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [speechStatus, setSpeechStatus] = useState<string | null>(null)
  const setupRef = useRef<AbortController | null>(null)
  const [transcript, setTranscript] = useState("")
  const recognitionRef = useRef<any>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const onAutoEndRef = useRef<((transcript: string) => void) | null>(null)
  const transcriptRef = useRef<string>("")
  const isListeningRef = useRef<boolean>(false)
  const silenceTimerRef = useRef<number | null>(null)
  const selectedMicIdRef = useRef<string | null>(null)
  const startGeneration = useRef(0)
  
  // Keep ref in sync with latest selectedMicId
  selectedMicIdRef.current = selectedMicId

  const stopListening = useCallback(async (): Promise<string> => {
    startGeneration.current++
    setupRef.current?.abort()
    setupRef.current = null
    setIsStarting(false)
    setSpeechStatus(null)
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }

    // CRITICAL: Synchronously clear auto-end callback to prevent race conditions with recognition.onend
    onAutoEndRef.current = null

    if (recognitionRef.current) {
      // In test mode, mark as stopped so the async loop stops
      if (recognitionRef.current.isTestMode) {
        recognitionRef.current.stopped = true
        recognitionRef.current = null
      } else {
        try {
          recognitionRef.current.onstart = null
          recognitionRef.current.onend = null
          recognitionRef.current.onresult = null
          recognitionRef.current.onerror = null
          recognitionRef.current.stop()
        } catch {}
        recognitionRef.current = null
      }
    }
    
    // Clean up any stray media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop())
      mediaStreamRef.current = null
    }
    
    isListeningRef.current = false
    setIsListening(false)

    // Read from ref first (immediate accuracy), then fallback to state
    const currentTranscript = (transcriptRef.current || transcript).trim()
    transcriptRef.current = ""
    setTranscript("")
    return currentTranscript
  }, [transcript])

  const startListening = useCallback(async (onAutoEnd?: (transcript: string) => void, onError?: (error: Error) => void, options?: Pick<SpeechSetupOptions, 'installLocale'>) => {
    if (setupRef.current || recognitionRef.current || isListeningRef.current) return
    const generation = ++startGeneration.current
    // Clear any existing silence timer
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }

    // Store the callback
    onAutoEndRef.current = onAutoEnd || null
    
    // TEST MODE: Use predefined phrases for e2e testing
    if (E2E_TEST_CONFIG.TEST_MODE_ENABLED) {
      isListeningRef.current = true
      setIsListening(true)
      setTranscript("")
      transcriptRef.current = ""
      
      // Get the next test phrase
      let currentPhrase = E2E_TEST_CONFIG.TEST_PHRASES[testPhraseIndex % E2E_TEST_CONFIG.TEST_PHRASES.length]
      testPhraseIndex++
      
      // Normalize phrase like real STT: lowercase, remove special chars except spaces
      currentPhrase = currentPhrase.toLowerCase().replace(/[^a-z0-9\s]/g, '')
      
      console.log(`[E2E Test Mode] Using test phrase: "${currentPhrase}"`)
      
      // Store test recognition in ref BEFORE starting async operations
      recognitionRef.current = { 
        isTestMode: true,
        phrase: currentPhrase,
        stopped: false
      }
      
      // Wait before starting (simulates processing time)
      await new Promise(resolve => setTimeout(resolve, E2E_TEST_CONFIG.INITIAL_DELAY))
      
      // Check if stopped during initial delay
      if (!recognitionRef.current || recognitionRef.current.stopped) {
        return
      }
      
      // Simulate progressive recognition by streaming words
      const words = currentPhrase.split(' ').filter(w => w.length > 0)
      let accumulatedText = ''
      
      for (let i = 0; i < words.length; i++) {
        await new Promise(resolve => setTimeout(resolve, E2E_TEST_CONFIG.WORD_DELAY))
        if (!recognitionRef.current || recognitionRef.current.stopped) break
        
        accumulatedText += (i > 0 ? ' ' : '') + words[i]
        setTranscript(accumulatedText)
        transcriptRef.current = accumulatedText
      }
      
      // Auto-end after the phrase is complete
      await new Promise(resolve => setTimeout(resolve, E2E_TEST_CONFIG.AUTO_END_DELAY))
      
      if (recognitionRef.current && !recognitionRef.current.stopped) {
        isListeningRef.current = false
        setIsListening(false)
        
        const captured = transcriptRef.current.trim()
        if (onAutoEndRef.current && captured) {
          transcriptRef.current = ""
          setTranscript("")
          const cb = onAutoEndRef.current
          onAutoEndRef.current = null
          cb(captured)
        }
        
        recognitionRef.current = null
      }
      
      return
    }
    
    // Never silently send microphone audio to an online recognition service.
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    
    if (!SpeechRecognition) {
      throw new SpeechSetupNotice('This browser does not support on-device speech recognition. Update Chrome to use the microphone; text commands remain available.')
    }

    // Clean up any stale active recognition instance before creating a new one
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort()
      } catch {}
      recognitionRef.current = null
    }

    const recognition = new SpeechRecognition()
    if (!('processLocally' in recognition) || typeof SpeechRecognition.available !== 'function') {
      throw new SpeechSetupNotice('This browser does not support on-device speech recognition. Update Chrome to use the microphone; text commands remain available.')
    }
    recognition.processLocally = true
    const setup = new AbortController()
    setupRef.current = setup
    setIsStarting(true)
    let prepared = false
    try {
      const language = await waitForSetup(readConversationLanguage(), setup.signal)
      setup.signal.throwIfAborted()
      recognition.lang = await prepareLocalSpeech(SpeechRecognition, speechLocaleFor(language), {
        ...options,
        signal: setup.signal,
        onStatus: status => { if (generation === startGeneration.current) setSpeechStatus(status) }
      })
      prepared = true
      window.dispatchEvent(new Event('pentone:local-setup-changed'))
    } catch (error) {
      if (generation !== startGeneration.current || setup.signal.aborted) return
      onAutoEndRef.current = null
      throw error
    } finally {
      if (setupRef.current === setup) {
        setupRef.current = null
        setIsStarting(prepared)
        setSpeechStatus(prepared ? 'Opening microphone…' : null)
      }
    }
    if (generation !== startGeneration.current || setup.signal.aborted) return
    recognition.continuous = true
    recognition.interimResults = true

    recognition.onstart = () => {
      if (recognitionRef.current !== recognition) return
      setIsStarting(false)
      setSpeechStatus(null)
      isListeningRef.current = true
      setIsListening(true)
      setTranscript("")
      transcriptRef.current = ""
    }

    recognition.onresult = (event: any) => {
      if (recognitionRef.current !== recognition) return
      let finalTranscript = ''
      let interimTranscript = ''

      for (let i = 0; i < event.results.length; i++) {
        const item = event.results[i]
        if (item.isFinal) {
          finalTranscript += item[0].transcript + ' '
        } else {
          interimTranscript += item[0].transcript
        }
      }

      const currentTranscript = (finalTranscript + interimTranscript).trim()
      setTranscript(currentTranscript)
      transcriptRef.current = currentTranscript

      // Silence detection: automatically finalize and send when user pauses speaking
      if (silenceTimerRef.current) {
        window.clearTimeout(silenceTimerRef.current)
        silenceTimerRef.current = null
      }

      if (currentTranscript) {
        const lastResult = event.results[event.results.length - 1]
        // Faster 1000ms pause if last word chunk was finalized; 1500ms if still interim
        const timeoutMs = lastResult?.isFinal ? 1000 : 1500

        silenceTimerRef.current = window.setTimeout(async () => {
          if (isListeningRef.current && transcriptRef.current.trim()) {
            const textToSend = transcriptRef.current.trim()
            const cb = onAutoEndRef.current
            onAutoEndRef.current = null
            await stopListening()
            if (cb && textToSend) {
              cb(textToSend)
            }
          }
        }, timeoutMs)
      }
    }

    recognition.onerror = (event: any) => {
      if (recognitionRef.current !== recognition || event.error === 'no-speech') return
      setIsStarting(false)
      setSpeechStatus(null)
      onAutoEndRef.current = null
      transcriptRef.current = ''
      setTranscript('')
      if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
      isListeningRef.current = false
      setIsListening(false)
      mediaStreamRef.current?.getTracks().forEach(track => track.stop())
      mediaStreamRef.current = null
      if (event.error === 'aborted') return
      const error = event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? new MicrophonePermissionError()
        : new Error(`Speech recognition failed: ${event.error || 'unknown error'}`)
      onError?.(error)
    }

    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return
      setIsStarting(false)
      setSpeechStatus(null)
      recognitionRef.current = null
      mediaStreamRef.current?.getTracks().forEach(track => track.stop())
      mediaStreamRef.current = null
      isListeningRef.current = false
      setIsListening(false)
      
      if (silenceTimerRef.current) {
        window.clearTimeout(silenceTimerRef.current)
        silenceTimerRef.current = null
      }
      
      // If recognition ended and we have a callback, call it with the current transcript
      const cb = onAutoEndRef.current
      onAutoEndRef.current = null
      const captured = transcriptRef.current.trim()
      if (cb && captured) {
        transcriptRef.current = ""
        setTranscript("")
        cb(captured)
      }
    }

    recognitionRef.current = recognition
    try {
      const deviceId = selectedMicIdRef.current
      if (deviceId && deviceId !== 'default') {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } }, video: false })
        if (recognitionRef.current !== recognition) { stream.getTracks().forEach(track => track.stop()); return }
        mediaStreamRef.current = stream
        const track = stream.getAudioTracks()[0]
        if (!track || track.readyState !== 'live') throw new Error('Selected microphone is unavailable')
        recognition.start(track)
      } else recognition.start()
    } catch (e: any) {
      if (generation !== startGeneration.current) return
      setIsStarting(false)
      setSpeechStatus(null)
      if (recognitionRef.current === recognition) recognitionRef.current = null
      mediaStreamRef.current?.getTracks().forEach(track => track.stop())
      mediaStreamRef.current = null
      onAutoEndRef.current = null
      throw e?.name === 'NotAllowedError' ? new MicrophonePermissionError() : e
    }
  }, [stopListening])

  useEffect(() => () => {
    startGeneration.current++
    setupRef.current?.abort()
    setupRef.current = null
    onAutoEndRef.current = null
    if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current)
    if (recognitionRef.current) {
      recognitionRef.current.onstart = null
      recognitionRef.current.onend = null
      recognitionRef.current.onresult = null
      recognitionRef.current.onerror = null
      recognitionRef.current.stopped = true
      try { recognitionRef.current.abort?.() } catch {}
    }
    mediaStreamRef.current?.getTracks().forEach(track => track.stop())
  }, [])

  return {
    isListening,
    isStarting,
    speechStatus,
    transcript,
    startListening,
    stopListening
  }
}
