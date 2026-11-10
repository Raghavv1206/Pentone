import React, { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from 'react'
import { splitIntoSentences } from './sentence-parser'
import { isModelRefusal } from './intent-detector'
import { normalizeForSpeech } from './tts-normalizer'
import { selectBestSpeechVoice } from './voice-selector'

interface TTSContextValue {
  selectedVoiceUri: string | null
  availableVoices: SpeechSynthesisVoice[]
  setSelectedVoiceUri: (uri: string) => void
  speak: (text: string) => void
  stop: () => void
  isSpeaking: boolean
  previewVoice: (uri: string) => Promise<boolean>
  handleNewText: (text: string, forceSpeak?: boolean) => void
  currentSentence: string
  queueLength: number
  audioEnabled: boolean
  setAudioEnabled: (enabled: boolean) => void
  isReady: boolean
  waitUntilReady: () => Promise<void>
}

const TTSContext = createContext<TTSContextValue | null>(null)

// Global set preventing V8 GC from garbage-collecting speaking utterances in Chrome
const activeUtterances = new Set<SpeechSynthesisUtterance>()

// Estimate speaking duration in ms based on text length
// Normal speaking rate is ~12-15 chars/sec; give plenty of headroom so TTS never cuts off
const estimateSpeakingDuration = (text: string): number => {
  const baseTime = text.length * 150 // 150ms per character
  const minTime = 3000 // Minimum 3 seconds
  const maxTime = 60000 // Maximum 60 seconds
  return Math.min(Math.max(baseTime, minTime), maxTime)
}


export const TTSProvider = ({ children }: { children: ReactNode }) => {
  const [selectedVoiceUri, setSelectedVoiceUri] = useState<string | null>(null)
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([])
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [currentSentence, setCurrentSentence] = useState<string>('')
  const [queueLength, setQueueLength] = useState(0)
  const [audioEnabled, setAudioEnabled] = useState(true)
  
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const sentenceQueueRef = useRef<string[]>([])
  const isProcessingQueueRef = useRef(false)
  const timeoutRef = useRef<number | null>(null)
  const lastSpokenSentencesRef = useRef<string[]>([])
  const currentTextRef = useRef<string>('')
  const isInitialMount = useRef(true)
  const keepAliveRef = useRef<number | null>(null)
  const previewResolveRef = useRef<((value: boolean) => void) | null>(null)
  const readyWaitersRef = useRef(new Set<() => void>())

  const loadVoices = useCallback(() => {
    console.log('[TTS] Loading voices...')
    const voices = window.speechSynthesis.getVoices().filter(voice => voice.localService === true)
    console.log('[TTS] Available voices:', voices.length, voices.map(v => v.name))
    setAvailableVoices(voices)
    
    // Load from storage or set default
    chrome.storage.local.get(['tts_voice_uri'], (result) => {
      if (result.tts_voice_uri) {
        console.log('[TTS] Stored voice URI:', result.tts_voice_uri)
        const voiceExists = voices.find(v => v.voiceURI === result.tts_voice_uri)
        if (voiceExists) {
          console.log('[TTS] Using stored voice:', voiceExists.name)
          setSelectedVoiceUri(result.tts_voice_uri)
          return
        }
      }
      
      if (voices.length > 0) {
        const bestVoice = selectBestSpeechVoice(voices)
        if (bestVoice) {
          console.log('[TTS] Auto-selected optimal natural voice:', bestVoice.name, '(', bestVoice.lang, ')')
          setSelectedVoiceUri(bestVoice.voiceURI)
        } else {
          setSelectedVoiceUri(voices[0].voiceURI)
        }
      }
    })
  }, [])

  // Load audio preference immediately on mount
  useEffect(() => {
    chrome.storage.local.get(['tts_audio_enabled'], (result) => {
      if (result.tts_audio_enabled !== undefined) {
        console.log('[TTS] Loaded audio enabled from storage:', result.tts_audio_enabled)
        setAudioEnabled(result.tts_audio_enabled)
      }
    })
  }, [])

  useEffect(() => {
    console.log('[TTS] TTSProvider mounted')
    console.log('[TTS] speechSynthesis available:', 'speechSynthesis' in window)
    loadVoices()
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices)
    return () => {
      console.log('[TTS] TTSProvider unmounting')
      window.speechSynthesis.removeEventListener('voiceschanged', loadVoices)
    }
  }, [loadVoices])

  // Save to storage when voice changes
  useEffect(() => {
    if (selectedVoiceUri) {
      chrome.storage.local.set({ tts_voice_uri: selectedVoiceUri })
    }
  }, [selectedVoiceUri])

  // Save to storage when audio enabled changes (skip initial mount)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }
    console.log('[TTS] Saving audio enabled to storage:', audioEnabled)
    chrome.storage.local.set({ tts_audio_enabled: audioEnabled })
  }, [audioEnabled])

  const stop = useCallback(() => {
    console.log('[TTS] Stopping all speech and clearing queue')
    if (utteranceRef.current) {
      utteranceRef.current.onend = null
      utteranceRef.current.onerror = null
      utteranceRef.current.onstart = null
    }
    window.speechSynthesis.cancel()
    activeUtterances.clear()
    if (keepAliveRef.current !== null) window.clearInterval(keepAliveRef.current)
    keepAliveRef.current = null
    previewResolveRef.current?.(false)
    previewResolveRef.current = null
    readyWaitersRef.current.forEach(resolve => resolve())
    readyWaitersRef.current.clear()
    
    // Clear timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    
    // Clear queue and state
    sentenceQueueRef.current = []
    isProcessingQueueRef.current = false
    setIsSpeaking(false)
    setCurrentSentence('')
    setQueueLength(0)
    utteranceRef.current = null
    currentTextRef.current = ''
    lastSpokenSentencesRef.current = []

    // Ensure Chrome's SpeechSynthesis engine is resumed after cancel
    // (prevents engine stuttering and single-word lockups on subsequent utterances)
    try {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume()
      }
    } catch {}
  }, [])

  useEffect(() => () => stop(), [stop])

  const processNextInQueue = useCallback(() => {
    console.log('[TTS] processNextInQueue - Queue length:', sentenceQueueRef.current.length)
    
    // If already processing, do not interrupt active utterance
    if (isProcessingQueueRef.current) {
      console.log('[TTS] Already processing an utterance, waiting for onend')
      return
    }

    // If queue is empty, mark idle
    if (sentenceQueueRef.current.length === 0) {
      console.log('[TTS] Queue empty - idle')
      utteranceRef.current = null
      readyWaitersRef.current.forEach(resolve => resolve())
      readyWaitersRef.current.clear()
      isProcessingQueueRef.current = false
      setIsSpeaking(false)
      setCurrentSentence('')
      setQueueLength(0)
      return
    }
    
    // Get next sentence
    let sentence = sentenceQueueRef.current.shift()!
    setQueueLength(sentenceQueueRef.current.length)
    isProcessingQueueRef.current = true
    
    console.log('[TTS] Speaking sentence:', sentence.substring(0, 50))
    
    // Clean and normalize text for TTS - expand acronyms, numbers, pronunciation lexicon, prosodic commas
    const cleanedSentence = normalizeForSpeech(sentence)
    
    // If the sentence had only emojis/symbols and no speakable text, move to next sentence immediately
    if (!cleanedSentence) {
      console.log('[TTS] Sentence contained only emojis or whitespace, skipping to next')
      isProcessingQueueRef.current = false
      processNextInQueue()
      return
    }
    
    setCurrentSentence(cleanedSentence)
    setIsSpeaking(true)
    
    const utterance = new SpeechSynthesisUtterance(cleanedSentence)
    const localVoice = availableVoices.find(v => v.voiceURI === selectedVoiceUri && v.localService) || availableVoices.find(v => v.localService)
    if (!localVoice) {
      console.warn('[TTS] No local voice available; speech is disabled to preserve on-device processing')
      stop()
      return
    }
    utterance.voice = localVoice
    
    // Set volume based on audioEnabled (0 = muted, 1 = full volume)
    utterance.volume = audioEnabled ? 1 : 0
    
    // Set voice
    if (selectedVoiceUri) {
      const voice = availableVoices.find(v => v.voiceURI === selectedVoiceUri)
      if (voice) {
        utterance.voice = voice
      } else {
        console.warn('[TTS] Selected voice not found:', selectedVoiceUri)
      }
    }
    
    // Calculate generous timeout fallback (so speech never gets cut off mid-sentence)
    const estimatedDuration = estimateSpeakingDuration(sentence)
    const timeoutDuration = Math.max(estimatedDuration * 3 + 10000, 20000)
    
    console.log('[TTS] Estimated duration:', estimatedDuration, 'ms, safety timeout:', timeoutDuration, 'ms')
    
    // Setup timeout fallback strictly in case onend doesn't fire at all
    timeoutRef.current = window.setTimeout(() => {
      if (utteranceRef.current !== utterance) return
      utterance.onend = null; utterance.onerror = null
      window.speechSynthesis.cancel()
      if (keepAliveRef.current !== null) window.clearInterval(keepAliveRef.current)
      console.warn('[TTS] Safety timeout reached - moving to next sentence')
      activeUtterances.delete(utterance)
      isProcessingQueueRef.current = false
      processNextInQueue()
    }, timeoutDuration)
    
    utterance.onend = () => {
      if (utteranceRef.current !== utterance) return
      if (keepAliveRef.current !== null) window.clearInterval(keepAliveRef.current)
      console.log('[TTS] Utterance ended successfully')
      activeUtterances.delete(utterance)
      
      // Clear timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      
      isProcessingQueueRef.current = false
      processNextInQueue()
    }
    
    utterance.onerror = (event) => {
      if (utteranceRef.current !== utterance) return
      if (keepAliveRef.current !== null) window.clearInterval(keepAliveRef.current)
      activeUtterances.delete(utterance)
      if (event.error !== 'canceled' && event.error !== 'interrupted') {
        console.warn('[TTS] Utterance notice:', event.error)
      }
      
      // Clear timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      
      // If speech was canceled or interrupted, HALT the queue immediately!
      // Calling processNextInQueue() here caused fragmented single-word stutters after interruption.
      if (event.error === 'canceled' || event.error === 'interrupted') {
        console.log('[TTS] Utterance canceled or interrupted - halting speech queue')
        stop()
        sentenceQueueRef.current = []
        isProcessingQueueRef.current = false
        setIsSpeaking(false)
        setCurrentSentence('')
        setQueueLength(0)
        return
      }

      // Move to next sentence on standard non-interruption error
      isProcessingQueueRef.current = false
      processNextInQueue()
    }
    
    utteranceRef.current = utterance
    activeUtterances.add(utterance)
    
    try {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume()
      }
      window.speechSynthesis.speak(utterance)
      console.log('[TTS] speechSynthesis.speak() called')

      // Chrome SpeechSynthesis keep-alive: pulse pause/resume if speech exceeds 10s to prevent engine cutoff
      keepAliveRef.current = window.setInterval(() => {
        if (window.speechSynthesis.speaking && activeUtterances.has(utterance)) {
          window.speechSynthesis.pause()
          window.speechSynthesis.resume()
        } else {
          window.clearInterval(keepAliveRef.current!)
        }
      }, 10000)
    } catch (error) {
      console.error('[TTS] Failed to call speak():', error)
      activeUtterances.delete(utterance)
      
      // Clear timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      
      isProcessingQueueRef.current = false
      processNextInQueue()
    }
  }, [selectedVoiceUri, availableVoices, audioEnabled])

  const speak = useCallback((text: string) => {
    console.log('[TTS] speak() called (legacy support) - redirecting to queue')
    
    if (!text.trim()) {
      console.log('[TTS] Empty text, not speaking')
      return
    }
    
    // Stop current speech and clear queue
    stop()
    
    // Split into sentences and add to queue
    const sentences = splitIntoSentences(text)
    sentenceQueueRef.current = sentences
    setQueueLength(sentences.length)
    
    console.log('[TTS] Added', sentences.length, 'sentences to queue')
    
    // Start processing
    processNextInQueue()
  }, [stop, processNextInQueue])

  const previewVoice = useCallback((uri: string): Promise<boolean> => {
    const voice = availableVoices.find(v => v.voiceURI === uri)
    if (!voice) return Promise.resolve(false)
    stop()
    return new Promise(resolve => {
      previewResolveRef.current = resolve
      const utterance = new SpeechSynthesisUtterance('Hello, this is a voice preview.')
      utterance.voice = voice
      utteranceRef.current = utterance
      activeUtterances.add(utterance)
      isProcessingQueueRef.current = true
      const finish = (success: boolean) => {
        if (utteranceRef.current !== utterance) return
        previewResolveRef.current = null
        stop()
        resolve(success)
      }
      utterance.onstart = () => { if (utteranceRef.current === utterance) setIsSpeaking(true) }
      utterance.onend = () => finish(true)
      utterance.onerror = () => finish(false)
      timeoutRef.current = window.setTimeout(() => finish(false), 10000)
      try { window.speechSynthesis.speak(utterance) } catch { finish(false) }
    })
  }, [availableVoices, stop])

  const handleNewText = useCallback((text: string, forceSpeak: boolean = false) => {
    console.log('[TTS] handleNewText() called with:', text.substring(0, 100), 'forceSpeak:', forceSpeak)
    
    if (!text || !text.trim()) {
      return
    }

    const trimmed = text.trim()

    // Never speak bracketed status tokens like [INTERRUPTED], [TOOL RESULT], etc.
    if (/^\[(?:INTERRUPTED|TOOL RESULT|REFERENCE|SYSTEM|ERROR).*?\]$/i.test(trimmed)) {
      console.log('[TTS] Ignoring status token from spoken output:', trimmed)
      return
    }

    // Suppress LLM base model refusals from audio output
    if (isModelRefusal(trimmed)) {
      console.warn('[TTS] Suppressed model refusal from spoken output:', trimmed)
      return
    }

    // If forceSpeak is true, skip sentence extraction and queue the sentence directly
    if (forceSpeak) {
      console.log('[TTS] Force speak mode - queuing sentence directly:', trimmed)
      sentenceQueueRef.current.push(trimmed)
      setQueueLength(sentenceQueueRef.current.length)
      
      // If not already processing, start the queue
      if (!isProcessingQueueRef.current) {
        console.log('[TTS] Starting queue processing')
        processNextInQueue()
      }
      return
    }

    // If text is same as current in streaming mode, do nothing
    if (text === currentTextRef.current) {
      return
    }

    currentTextRef.current = text
    
    const newSentences = splitIntoSentences(text)
    console.log('[TTS] Extracted sentences:', newSentences.length)
    console.log('[TTS] Last spoken sentences:', lastSpokenSentencesRef.current.length)
    
    // Find new sentences that haven't been spoken yet or queued
    const unspokenSentences = newSentences.filter(
      sentence => !lastSpokenSentencesRef.current.includes(sentence)
    )
    
    console.log('[TTS] New unspoken sentences:', unspokenSentences.length)

    if (unspokenSentences.length > 0) {
      // Add new sentences to the queue
      console.log('[TTS] Adding', unspokenSentences.length, 'sentences to queue')
      sentenceQueueRef.current.push(...unspokenSentences)
      setQueueLength(sentenceQueueRef.current.length)
      
      // Update tracking
      lastSpokenSentencesRef.current = newSentences
      
      // If not already processing, start the queue
      if (!isProcessingQueueRef.current) {
        console.log('[TTS] Starting queue processing')
        processNextInQueue()
      } else {
        console.log('[TTS] Queue already processing, sentences added')
      }
    } else {
      console.log('[TTS] No new sentences to add to queue')
    }
  }, [processNextInQueue])

  // Reset tracking when text becomes empty (new conversation)
  useEffect(() => {
    if (currentTextRef.current === '') {
      lastSpokenSentencesRef.current = []
    }
  }, [])

  // Compute ready state - true when nothing is speaking or queued
  const isReady = !isSpeaking && queueLength === 0

  const waitUntilReady = useCallback((): Promise<void> => {
    if (!isProcessingQueueRef.current && sentenceQueueRef.current.length === 0) return Promise.resolve()
    return new Promise(resolve => { readyWaitersRef.current.add(resolve) })
  }, [])

  return (
    <TTSContext.Provider value={{ 
      selectedVoiceUri, 
      availableVoices, 
      setSelectedVoiceUri, 
      speak, 
      stop,
      isSpeaking,
      previewVoice,
      handleNewText,
      currentSentence,
      queueLength,
      audioEnabled,
      setAudioEnabled,
      isReady,
      waitUntilReady
    }}>
      {children}
    </TTSContext.Provider>
  )
}

export const useTTS = () => {
  const context = useContext(TTSContext)
  if (!context) {
    throw new Error('useTTS must be used within TTSProvider')
  }
  return context
}

