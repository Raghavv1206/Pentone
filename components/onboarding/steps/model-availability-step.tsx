import '../../../lib/suppress-warnings'
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { 
  Brain, AlertCircle, CheckCircle, ArrowRight, Loader2, 
  ExternalLink, Mic, CheckCircle2, Sparkles, Volume2, ShieldCheck, Zap, RefreshCw, Download,
  Copy, Check, HelpCircle, ChevronDown, ChevronUp, Info
} from 'lucide-react'
import { useOnboarding } from '../onboarding-provider'
import { preloadModel } from '../../../lib/ai'
import {
  checkLanguageModelAvailability,
  checkWriterAvailability,
  checkRewriterAvailability,
  checkSummarizerAvailability
} from '../../../lib/chrome-ai-helpers'
import { 
  openAIFlagsPage, 
  openOptimizationGuideFlagsPage, 
  openWriterFlagsPage,
  openRewriterFlagsPage,
  openAllRequiredFlags, 
  openSummarizationAPIFlagsPage, 
  openChromeAIDocs,
  openPermissionsPage,
  openMicrophonePromptTab,
  openComponentsPage,
  copyTextToClipboard
} from '../../../lib/alert-context'

type APIStatus = 'checking' | 'available' | 'unavailable' | 'after-download'

interface APIAvailability {
  promptAPI: APIStatus
  writerAPI: APIStatus
  rewriterAPI: APIStatus
  summarizationAPI: APIStatus
  translationAPI: APIStatus
}

type ModelState = 'checking' | 'ready_to_download' | 'available' | 'partial' | 'unavailable' | 'downloading' | 'error'

interface DownloadProgress {
  promptAPI: number
  writerAPI: number
  rewriterAPI: number
  summarizationAPI: number
  translationAPI: number
  embeddingModel: number
}

// Helpers to get APIs across different Chrome versions
const getLanguageModelAPI = () => 
  (window as any).LanguageModel || 
  (window as any).ai?.languageModel || 
  (window as any).ai?.assistant

const getWriterAPI = () => (window as any).Writer || (window as any).ai?.writer
const getRewriterAPI = () => (window as any).Rewriter || (window as any).ai?.rewriter
const getSummarizerAPI = () => (window as any).Summarizer || (window as any).ai?.summarizer
const getTranslatorAPI = () => (window as any).Translator || (window as any).ai?.translator || (window as any).translation

export const ModelAvailabilityStep: React.FC = () => {
  const { skipOnboarding, setModelAvailability, setMicPermission } = useOnboarding()
  const [modelState, setModelState] = useState<ModelState>('checking')
  const [apiStatus, setApiStatus] = useState<APIAvailability>({
    promptAPI: 'checking',
    writerAPI: 'checking',
    rewriterAPI: 'checking',
    summarizationAPI: 'checking',
    translationAPI: 'checking'
  })
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>({
    promptAPI: 0,
    writerAPI: 0,
    rewriterAPI: 0,
    summarizationAPI: 0,
    translationAPI: 0,
    embeddingModel: 0
  })
  const [currentlyDownloading, setCurrentlyDownloading] = useState<string | null>(null)
  const [embeddingModelDownloaded, setEmbeddingModelDownloaded] = useState(false)
  const [micState, setMicState] = useState<'checking' | 'granted' | 'prompt' | 'denied'>('checking')
  const [isRequestingMic, setIsRequestingMic] = useState(false)
  const [micPrompted, setMicPrompted] = useState(false)
  const [isVoiceListening, setIsVoiceListening] = useState(false)
  const [isHoldingVoice, setIsHoldingVoice] = useState(false)
  const [liveTranscript, setLiveTranscript] = useState('')
  const [voiceDetectedText, setVoiceDetectedText] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [showFaq, setShowFaq] = useState(false)

  const handleCopyText = useCallback(async (key: string, text: string) => {
    const success = await copyTextToClipboard(text)
    if (success) {
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 2000)
    }
  }, [])

  const copyAllFlagsCheatSheet = useCallback(() => {
    const guide = `--- Pentone Chrome Built-in AI Flags Setup ---
1. Optimization Guide Model:
   URL: chrome://flags/#optimization-guide-on-device-model
   Setting: Enabled BypassPerfRequirement

2. Prompt API for Gemini Nano:
   URL: chrome://flags/#prompt-api-for-gemini-nano
   Setting: Enabled

3. Smart Rewriter & Writer APIs:
   URL: chrome://flags/#writer-api-for-gemini-nano
   Setting: Enabled

4. Summarizer API:
   URL: chrome://flags/#summarization-api-for-gemini-nano
   Setting: Enabled

After enabling, click "Relaunch" at the bottom of Chrome. Pentone will auto-detect and proceed!`
    handleCopyText('cheat-sheet', guide)
  }, [handleCopyText])
  
  const isCheckingRef = useRef(false)
  const isListeningRef = useRef(false)
  const isHoldingVoiceRef = useRef(false)
  const isHoldingSpaceRef = useRef(false)
  const isHoldingMouseRef = useRef(false)
  const wasListeningBeforeMouseDownRef = useRef(false)
  const wasListeningBeforeSpaceRef = useRef(false)
  const isMousePushToTalkRef = useRef(false)
  const mousePressTimeRef = useRef<number>(0)
  const spacePressTimeRef = useRef<number>(0)
  const latestTranscriptRef = useRef<string>('')
  const recognitionRef = useRef<any>(null)
  const stopTimeoutRef = useRef<any>(null)
  const autoSleepTimeoutRef = useRef<any>(null)
  const releaseGraceTimeoutRef = useRef<any>(null)
  const isTriggeredRef = useRef(false)

  // Check cached status from storage on mount
  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get(['pentone_embedding_cached'], (res) => {
        if (res?.pentone_embedding_cached) {
          setEmbeddingModelDownloaded(true)
        }
      })
    }
  }, [])

  // Automatic microphone permission check
  const checkMicPermission = useCallback(async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
        const status = await navigator.permissions.query({ name: 'microphone' as PermissionName })
        if (status.state === 'granted') {
          setMicState('granted')
          setMicPermission(true)
          setMicPrompted(false)
        } else if (status.state === 'denied') {
          setMicState('denied')
          setMicPermission(false)
        } else {
          setMicState('prompt')
        }
        status.onchange = () => {
          if (status.state === 'granted') {
            setMicState('granted')
            setMicPermission(true)
            setMicPrompted(false)
          } else if (status.state === 'denied') {
            setMicState('denied')
            setMicPermission(false)
          } else {
            setMicState('prompt')
          }
        }
      } else {
        setMicState('prompt')
      }
    } catch {
      setMicState('prompt')
    }
  }, [setMicPermission])

  // One-click mic request: opens native permission prompt tab
  const handleRequestMic = async () => {
    setIsRequestingMic(true)
    try {
      openMicrophonePromptTab()
      setMicPrompted(true)
    } finally {
      setIsRequestingMic(false)
    }
  }

  // Model download pipeline - Only initiated upon explicit user command
  const downloadModels = useCallback(async (status: APIAvailability) => {
    setModelState('downloading')
    setModelAvailability(false)
    const updatedStatus = { ...status }

    try {
      const LM = getLanguageModelAPI()
      const Summarizer = getSummarizerAPI()

      // 1. Download Prompt API (Gemini Nano) if needed
      if (status.promptAPI === 'after-download' && LM) {
        setCurrentlyDownloading('Prompt API (Gemini Nano)')
        try {
          let session: any
          try {
            session = await LM.create({
              expectedOutputs: [{ type: 'text', languages: ['en'] }],
              outputLanguage: 'en',
              monitor(m: any) {
                m.addEventListener('downloadprogress', (e: any) => {
                  const progress = Math.round((e.loaded / (e.total || 1)) * 100) || Math.round(e.loaded * 100)
                  setDownloadProgress(prev => ({ ...prev, promptAPI: Math.min(progress, 100) }))
                })
              }
            })
          } catch {
            session = await LM.create({
              expectedOutputs: [{ type: 'text', languages: ['en'] }],
              outputLanguage: 'en',
              monitor(m: any) {
                m.addEventListener('downloadprogress', (e: any) => {
                  const progress = Math.round((e.loaded / (e.total || 1)) * 100) || Math.round(e.loaded * 100)
                  setDownloadProgress(prev => ({ ...prev, promptAPI: Math.min(progress, 100) }))
                })
              }
            })
          }
          updatedStatus.promptAPI = 'available'
          setApiStatus({ ...updatedStatus })
          session?.destroy?.()
        } catch (e) {
          console.warn('[Onboarding] Prompt API download error:', e)
        }
      }

      // 2. Download Summarizer API if needed
      if (status.summarizationAPI === 'after-download' && Summarizer) {
        setCurrentlyDownloading('Summarization API')
        try {
          let summarizer: any
          try {
            summarizer = await Summarizer.create({
              expectedOutputs: [{ type: 'text', languages: ['en'] }],
              outputLanguage: 'en',
              sharedContext: '',
              type: 'key-points',
              format: 'plain-text',
              length: 'medium',
              monitor(m: any) {
                m.addEventListener('downloadprogress', (e: any) => {
                  const progress = Math.round((e.loaded / (e.total || 1)) * 100) || Math.round(e.loaded * 100)
                  setDownloadProgress(prev => ({ ...prev, summarizationAPI: Math.min(progress, 100) }))
                })
              }
            })
          } catch {
            summarizer = await Summarizer.create({
              sharedContext: '',
              type: 'key-points',
              format: 'plain-text',
              length: 'medium',
              monitor(m: any) {
                m.addEventListener('downloadprogress', (e: any) => {
                  const progress = Math.round((e.loaded / (e.total || 1)) * 100) || Math.round(e.loaded * 100)
                  setDownloadProgress(prev => ({ ...prev, summarizationAPI: Math.min(progress, 100) }))
                })
              }
            })
          }
          updatedStatus.summarizationAPI = 'available'
          setApiStatus({ ...updatedStatus })
          summarizer?.destroy?.()
        } catch (e) {
          console.warn('[Onboarding] Summarizer download error:', e)
        }
      }

      // 3. Pre-cache Embedding Model (Transformers.js all-MiniLM-L6-v2)
      setCurrentlyDownloading('Vault Embedding Model (all-MiniLM-L6-v2)')
      try {
        const { pipeline, env } = await import('@xenova/transformers')
        env.allowLocalModels = false
        if (env.backends?.onnx?.wasm) {
          env.backends.onnx.wasm.numThreads = 1
          env.backends.onnx.wasm.proxy = false
          if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
            env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('assets/ort-wasm/')
          }
        }

        await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
          progress_callback: (p: any) => {
            if (p?.status === 'progress' && typeof p.progress === 'number') {
              const percent = Math.min(Math.max(Math.round(p.progress), 0), 100)
              setDownloadProgress(prev => ({ ...prev, embeddingModel: percent }))
            } else if (p?.status === 'done' || p?.status === 'ready') {
              setDownloadProgress(prev => ({ ...prev, embeddingModel: 100 }))
            }
          }
        })
        setEmbeddingModelDownloaded(true)
        setDownloadProgress(prev => ({ ...prev, embeddingModel: 100 }))
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          chrome.storage.local.set({ pentone_embedding_cached: true })
        }
      } catch (e: any) {
        console.warn('[Onboarding] Embedding model pre-cache notice:', e?.message || e)
        setEmbeddingModelDownloaded(true)
      }

      setCurrentlyDownloading(null)
      setModelState('available')
      setModelAvailability(true)
    } catch (error: any) {
      console.error('[Onboarding] Model download pipeline failed:', error)
      setCurrentlyDownloading(null)
      setModelState('error')
      setErrorMessage(`Failed to download models: ${error?.message || 'Unknown error'}`)
      setModelAvailability(false)
    }
  }, [setModelAvailability])

  // Explicit download trigger
  const triggerDownload = useCallback(() => {
    downloadModels(apiStatus)
  }, [apiStatus, downloadModels])

  // Check model availability across all APIs
  const checkModelAvailability = useCallback(async () => {
    if (isCheckingRef.current) return
    isCheckingRef.current = true

    const newStatus: APIAvailability = {
      promptAPI: 'checking',
      writerAPI: 'checking',
      rewriterAPI: 'checking',
      summarizationAPI: 'checking',
      translationAPI: 'checking'
    }

    try {
      const LM = getLanguageModelAPI()
      const Writer = getWriterAPI()
      const Rewriter = getRewriterAPI()
      const Summarizer = getSummarizerAPI()
      const Translator = getTranslatorAPI()

      // 1. Prompt API check with explicit outputLanguage
      if (!LM) {
        newStatus.promptAPI = 'unavailable'
        setErrorMessage('Prompt API not detected. Enable Chrome flags to activate Gemini Nano.')
      } else {
        try {
          const lmAvail = await checkLanguageModelAvailability(LM)
          if (lmAvail === 'available') {
            newStatus.promptAPI = 'available'
          } else if (lmAvail === 'after-download') {
            newStatus.promptAPI = 'after-download'
          } else {
            newStatus.promptAPI = 'unavailable'
            setErrorMessage('Prompt API unavailable. Ensure Optimization Guide flag is enabled in chrome://flags.')
          }
        } catch {
          newStatus.promptAPI = 'unavailable'
          setErrorMessage('Prompt API flag is required in chrome://flags.')
        }
      }

      // 2. Writer API check
      if (Writer) {
        try {
          const a = await checkWriterAvailability(Writer, { outputLanguage: 'en' })
          newStatus.writerAPI = (a === 'available') ? 'available' : (a === 'after-download') ? 'after-download' : 'unavailable'
        } catch {
          newStatus.writerAPI = 'unavailable'
        }
      } else {
        newStatus.writerAPI = 'unavailable'
      }

      // 3. Rewriter API check
      if (Rewriter) {
        try {
          const a = await checkRewriterAvailability(Rewriter, { outputLanguage: 'en' })
          newStatus.rewriterAPI = (a === 'available') ? 'available' : (a === 'after-download') ? 'after-download' : 'unavailable'
        } catch {
          newStatus.rewriterAPI = 'unavailable'
        }
      } else {
        newStatus.rewriterAPI = 'unavailable'
      }

      // 4. Summarizer API check
      if (Summarizer) {
        try {
          const a = await checkSummarizerAvailability(Summarizer, { outputLanguage: 'en' })
          newStatus.summarizationAPI = (a === 'available') ? 'available' : (a === 'after-download') ? 'after-download' : 'unavailable'
        } catch {
          newStatus.summarizationAPI = 'unavailable'
        }
      } else {
        newStatus.summarizationAPI = 'unavailable'
      }

      // 5. Translation API check
      if (Translator && typeof Translator.availability === 'function') {
        try {
          const a = await Translator.availability({ sourceLanguage: 'en', targetLanguage: 'es' })
          newStatus.translationAPI = (a === 'available') ? 'available' : (a === 'downloadable') ? 'after-download' : 'unavailable'
        } catch {
          newStatus.translationAPI = 'unavailable'
        }
      } else {
        newStatus.translationAPI = 'unavailable'
      }

      setApiStatus(newStatus)

      if (newStatus.promptAPI === 'unavailable') {
        setModelState('unavailable')
        setModelAvailability(false)
      } else {
        // Flags are enabled! Check if models are already cached vs need download
        const promptNeedsDownload = newStatus.promptAPI === 'after-download'
        const embeddingNeedsDownload = !embeddingModelDownloaded
        const summarizerNeedsDownload = newStatus.summarizationAPI === 'after-download'

        if (promptNeedsDownload || embeddingNeedsDownload || summarizerNeedsDownload) {
          // Tell user what is loading and wait for user command ('ready_to_download')
          // DO NOT auto-download!
          setModelState('ready_to_download')
          setModelAvailability(false)
        } else {
          // All models are already installed and cached
          setModelState('available')
          setModelAvailability(true)
        }
      }
    } catch (e: any) {
      setModelState('error')
      setErrorMessage(e?.message || 'Error checking Chrome Built-in AI models.')
      setModelAvailability(false)
    } finally {
      isCheckingRef.current = false
    }
  }, [embeddingModelDownloaded, setModelAvailability])

  // Mount effect: run mic and model checks immediately
  useEffect(() => {
    checkMicPermission()
    checkModelAvailability()
  }, [])

  // Auto-polling when flags are needed (detects Chrome relaunch or flag toggle instantly)
  useEffect(() => {
    if (modelState === 'unavailable' || modelState === 'checking') {
      const interval = setInterval(() => {
        checkModelAvailability()
      }, 3000)
      return () => clearInterval(interval)
    }
  }, [modelState, checkModelAvailability])

  // Helper to determine if spoken words express intent to download/start
  const isDownloadKeyword = (text: string): boolean => {
    if (!text) return false
    const lower = text.toLowerCase().trim()
    if (
      lower.includes("don't") || 
      lower.includes("do not") || 
      lower.includes("cancel") || 
      lower.includes("stop") ||
      lower.includes("abort") ||
      lower.includes("nevermind")
    ) {
      return false
    }
    const keywords = [
      'download', 'down load', 'downloads', 'downloading', 'down', 'load', 'done load',
      'dawnload', 'danload', 'donload', 'dounload', 'downlaod', 'downlode',
      'start', 'install', 'proceed', 'begin', 'setup',
      'yes', 'yeah', 'yep', 'ok', 'okay', 'go', 'continue', 'ready', 'launch',
      'run', 'fetch', 'get', 'pull', 'confirm', 'sure', 'yup', 'do it'
    ]
    const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean)
    return keywords.some(k => lower.includes(k) || tokens.includes(k))
  }

  // Synchronous immediate stop (cancels active recognizer)
  const stopListeningImmediately = useCallback(() => {
    if (autoSleepTimeoutRef.current) clearTimeout(autoSleepTimeoutRef.current)
    if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current)
    if (releaseGraceTimeoutRef.current) clearTimeout(releaseGraceTimeoutRef.current)

    isListeningRef.current = false
    isHoldingSpaceRef.current = false
    isHoldingMouseRef.current = false
    isHoldingVoiceRef.current = false
    setIsHoldingVoice(false)
    setIsVoiceListening(false)

    if (recognitionRef.current) {
      const rec = recognitionRef.current
      recognitionRef.current = null
      rec.onend = null
      rec.onerror = null
      rec.onresult = null
      try { rec.abort() } catch {}
    }
  }, [])

  // Executes the trigger when download keyword is recognized
  const handleVoiceTrigger = useCallback((recognizedText: string) => {
    if (isTriggeredRef.current) return
    isTriggeredRef.current = true
    console.log('[Onboarding Voice] Download command recognized:', recognizedText)
    setVoiceDetectedText(`Heard: "${recognizedText}"`)
    stopListeningImmediately()

    setTimeout(() => {
      triggerDownload()
    }, 250)
  }, [triggerDownload, stopListeningImmediately])

  // Soft stop / release handler: checks accumulated transcript and gives a grace period
  // for in-flight speech recognition to finalize without dropping the utterance
  const handleRelease = useCallback(() => {
    if (isTriggeredRef.current) return

    // 1. Immediate check: Did we already transcribe a match?
    const current = (latestTranscriptRef.current || liveTranscript || '').trim()
    if (current && isDownloadKeyword(current)) {
      handleVoiceTrigger(current)
      return
    }

    // 2. CRITICAL FIX: DO NOT call recognition.stop() immediately!
    // Abruptly stopping recognition on keyup flushes/discards the audio stream before Chrome can produce the final tokens.
    // Instead, leave recognition actively listening for 3500ms so in-flight speech is fully processed by Chrome's engine.
    if (releaseGraceTimeoutRef.current) clearTimeout(releaseGraceTimeoutRef.current)
    releaseGraceTimeoutRef.current = setTimeout(() => {
      if (!isTriggeredRef.current) {
        const finalCheck = (latestTranscriptRef.current || liveTranscript || '').trim()
        if (finalCheck && isDownloadKeyword(finalCheck)) {
          handleVoiceTrigger(finalCheck)
        } else {
          stopListeningImmediately()
        }
      }
    }, 3500)
  }, [liveTranscript, handleVoiceTrigger, stopListeningImmediately])

  const startListening = useCallback(async () => {
    if (modelState !== 'ready_to_download' || isTriggeredRef.current || voiceDetectedText) return
    if (isListeningRef.current) return
    if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current)
    if (autoSleepTimeoutRef.current) clearTimeout(autoSleepTimeoutRef.current)
    if (releaseGraceTimeoutRef.current) clearTimeout(releaseGraceTimeoutRef.current)

    // Side panels in Chrome MV3 cannot show permission popups.
    // If microphone access is not yet granted, open the native permission tab.
    if (micState !== 'granted') {
      setMicPrompted(true)
      openMicrophonePromptTab()
      return
    }

    isListeningRef.current = true
    setIsVoiceListening(true)
    setLiveTranscript('')
    latestTranscriptRef.current = ''

    // Auto-sleep after 25s if user stays silent
    autoSleepTimeoutRef.current = setTimeout(() => {
      if (isListeningRef.current) {
        console.log('[Onboarding Voice] Auto-sleep after 25s inactivity')
        stopListeningImmediately()
      }
    }, 25000)

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      console.warn('[Onboarding Voice] Speech recognition not supported in this environment')
      setIsVoiceListening(false)
      isListeningRef.current = false
      return
    }

    const initRecognition = () => {
      try {
        if (recognitionRef.current) {
          const old = recognitionRef.current
          recognitionRef.current = null
          old.onend = null
          old.onerror = null
          old.onresult = null
          try { old.abort() } catch {}
        }

        const recognition = new SpeechRecognition()
        recognition.continuous = true
        recognition.interimResults = true
        recognition.lang = 'en-US'
        recognition.maxAlternatives = 3

        recognition.onstart = () => {
          setIsVoiceListening(true)
        }

        recognition.onresult = (event: any) => {
          if (isTriggeredRef.current) return

          let accumulated = ''
          let foundKeyword = false
          let matchedKeywordText = ''

          for (let i = 0; i < event.results.length; ++i) {
            const res = event.results[i]
            accumulated += ' ' + res[0].transcript

            // Check all alternatives for this segment
            for (let j = 0; j < res.length; ++j) {
              const alt = res[j]?.transcript
              if (alt && isDownloadKeyword(alt)) {
                foundKeyword = true
                matchedKeywordText = alt
                break
              }
            }
          }
          const text = accumulated.trim()
          if (!text && !matchedKeywordText) return

          const bestText = matchedKeywordText || text
          latestTranscriptRef.current = bestText
          setLiveTranscript(bestText)
          console.log('[Onboarding Voice] Heard:', bestText)

          if (foundKeyword || isDownloadKeyword(text)) {
            handleVoiceTrigger(bestText)
          }
        }

        recognition.onerror = (e: any) => {
          // If aborted or normal pause (no-speech), DO NOT turn off the microphone!
          if (e?.error === 'aborted' || e?.error === 'no-speech') {
            return
          }
          if (e?.error === 'not-allowed') {
            setMicState('denied')
            setMicPrompted(true)
            stopListeningImmediately()
            return
          }
          console.warn('[Onboarding Voice] Recognition notice:', e?.error)
        }

        recognition.onend = () => {
          if (isTriggeredRef.current) return

          // Check if transcript received right as stream ended matches
          const text = latestTranscriptRef.current.trim()
          if (text && isDownloadKeyword(text)) {
            handleVoiceTrigger(text)
            return
          }

          // If user is actively holding space or mouse, restart recognition immediately
          if (isListeningRef.current && (isHoldingSpaceRef.current || isHoldingMouseRef.current)) {
            try {
              recognition.start()
            } catch {
              setTimeout(() => {
                if (isListeningRef.current && (isHoldingSpaceRef.current || isHoldingMouseRef.current)) {
                  initRecognition()
                }
              }, 100)
            }
          } else if (!isHoldingSpaceRef.current && !isHoldingMouseRef.current) {
            setIsVoiceListening(false)
          }
        }

        recognition.start()
        recognitionRef.current = recognition
      } catch (e) {
        console.warn('[Onboarding Voice] Could not start speech recognition:', e)
        setIsVoiceListening(false)
        isListeningRef.current = false
      }
    }

    initRecognition()
  }, [modelState, voiceDetectedText, micState, stopListeningImmediately, handleVoiceTrigger])

  const toggleListening = useCallback(() => {
    if (isListeningRef.current) {
      stopListeningImmediately()
    } else {
      startListening()
    }
  }, [startListening, stopListeningImmediately])

  // Push-to-talk mouse & touch controls for the Speak card
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    wasListeningBeforeMouseDownRef.current = isListeningRef.current
    mousePressTimeRef.current = Date.now()
    isHoldingMouseRef.current = true
    isHoldingVoiceRef.current = true
    setIsHoldingVoice(true)
    if (!isListeningRef.current) {
      startListening()
    }
  }, [startListening])

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    const duration = Date.now() - mousePressTimeRef.current
    isHoldingMouseRef.current = false
    isHoldingVoiceRef.current = false
    setIsHoldingVoice(false)

    if (duration > 250) {
      isMousePushToTalkRef.current = true
      handleRelease()
    }
  }, [handleRelease])

  const handleMouseLeave = useCallback(() => {
    if (isHoldingMouseRef.current) {
      const duration = Date.now() - mousePressTimeRef.current
      isHoldingMouseRef.current = false
      isHoldingVoiceRef.current = false
      setIsHoldingVoice(false)
      if (duration > 250) {
        isMousePushToTalkRef.current = true
        handleRelease()
      }
    }
  }, [handleRelease])

  const handleCardClick = useCallback((e: React.MouseEvent) => {
    if (isMousePushToTalkRef.current) {
      isMousePushToTalkRef.current = false
      return
    }
    // Quick click / tap: if already listening prior to mouse-down, toggle off
    if (wasListeningBeforeMouseDownRef.current) {
      stopListeningImmediately()
    }
  }, [stopListeningImmediately])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    wasListeningBeforeMouseDownRef.current = isListeningRef.current
    mousePressTimeRef.current = Date.now()
    isHoldingMouseRef.current = true
    isHoldingVoiceRef.current = true
    setIsHoldingVoice(true)
    if (!isListeningRef.current) {
      startListening()
    }
  }, [startListening])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const duration = Date.now() - mousePressTimeRef.current
    isHoldingMouseRef.current = false
    isHoldingVoiceRef.current = false
    setIsHoldingVoice(false)

    if (duration > 250) {
      isMousePushToTalkRef.current = true
      handleRelease()
    }
  }, [handleRelease])

  // Spacebar hold/toggle to speak listener (captures spacebar anywhere on page)
  useEffect(() => {
    if (modelState !== 'ready_to_download') return

    // Ensure sidepanel has focus so key events are received immediately
    try {
      window.focus()
    } catch {}

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement
      const isInput = activeEl && (
        activeEl.tagName === 'INPUT' || 
        activeEl.tagName === 'TEXTAREA' || 
        activeEl.tagName === 'SELECT' || 
        (activeEl as HTMLElement).isContentEditable
      )
      if (isInput) return

      if (e.code === 'Space' || e.key === ' ' || e.keyCode === 32) {
        e.preventDefault()
        if (!e.repeat) {
          isHoldingSpaceRef.current = true
          isHoldingVoiceRef.current = true
          setIsHoldingVoice(true)
          spacePressTimeRef.current = Date.now()
          wasListeningBeforeSpaceRef.current = isListeningRef.current
          if (!isListeningRef.current) {
            startListening()
          }
        }
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      const activeEl = document.activeElement
      const isInput = activeEl && (
        activeEl.tagName === 'INPUT' || 
        activeEl.tagName === 'TEXTAREA' || 
        activeEl.tagName === 'SELECT' || 
        (activeEl as HTMLElement).isContentEditable
      )
      if (isInput) return

      if (e.code === 'Space' || e.key === ' ' || e.keyCode === 32) {
        e.preventDefault()
        isHoldingSpaceRef.current = false
        isHoldingVoiceRef.current = false
        setIsHoldingVoice(false)
        const duration = Date.now() - spacePressTimeRef.current

        if (duration > 250) {
          // Push-to-talk hold completed -> process speech and trigger download!
          handleRelease()
        } else if (wasListeningBeforeSpaceRef.current) {
          // User tapped Space while it was already listening -> toggle OFF!
          stopListeningImmediately()
        }
        // If tapped briefly (<= 250ms) and wasn't listening before, stays active in toggle mode!
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('keyup', handleKeyUp, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('keyup', handleKeyUp, true)
    }
  }, [modelState, startListening, handleRelease, stopListeningImmediately])

  // Unmount cleanup
  useEffect(() => {
    return () => {
      if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current)
      if (recognitionRef.current) {
        try { recognitionRef.current.abort() } catch {}
      }
    }
  }, [])

  // canProceed is ONLY true when all models are provisioned & ready
  const canProceed = modelState === 'available'

  // Calculate estimated download size
  const totalDownloadSize = useMemo(() => {
    let mb = 0
    if (apiStatus.promptAPI === 'after-download') mb += 1500
    if (!embeddingModelDownloaded) mb += 23
    return mb >= 1000 ? `~${(mb / 1000).toFixed(1)} GB` : `~${mb} MB`
  }, [apiStatus.promptAPI, embeddingModelDownloaded])

  const handleLaunch = () => {
    preloadModel().catch(() => {})
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ pentone_onboarding_complete: true }, () => {
        skipOnboarding()
      })
    } else {
      skipOnboarding()
    }
  }

  return (
    <div className="w-full min-w-0 space-y-4 sm:space-y-5 animate-fadeIn select-none">
      {/* Editorial Headline */}
      <div className="text-center space-y-1.5 w-full min-w-0 px-2">
        <div className="flex justify-center mb-2">
          <div className="p-3 rounded-2xl bg-[#E9D2FF]/40 dark:bg-[#CDB0F3]/20 border border-[#D5B8F6] dark:border-[#513E6B]">
            <Brain className="w-8 h-8 text-[#005447] dark:text-[#67E2C8]" />
          </div>
        </div>
        <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-[#191919] dark:text-[#F5F1E7] break-words">
          Local AI Engine Setup
        </h2>
        <p className="text-xs text-[#77776E] dark:text-[#A6A49B] max-w-sm mx-auto leading-relaxed break-words">
          Pentone provisions and runs Chrome's Gemini Nano and embedding models entirely on-device for private, zero-latency intelligence.
        </p>
      </div>

      {/* Main Status & Configuration Card */}
      <div className="bg-[#F3F1DF] dark:bg-[#1E1F1C] border border-[#DDDCCB] dark:border-[#373832] rounded-2xl p-3.5 sm:p-5 space-y-3.5 sm:space-y-4 shadow-xs w-full min-w-0 break-words">
        
        {/* State 1: Checking State */}
        {modelState === 'checking' && (
          <div className="flex flex-col items-center justify-center py-5 px-3 space-y-2.5 text-center">
            <Loader2 className="w-5 h-5 animate-spin text-[#005447] dark:text-[#67E2C8]" />
            <div className="space-y-0.5">
              <p className="text-xs font-semibold text-[#191919] dark:text-[#F5F1E7]">
                Detecting Local AI Engines...
              </p>
              <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B]">
                Checking Gemini Nano, embedding runtime, and permissions
              </p>
            </div>
          </div>
        )}

        {/* State 2: Ready to Download - Tell user what is loading, then wait for "download" command */}
        {modelState === 'ready_to_download' && (
          <div className="space-y-3">
            {/* Press Space or Click to Speak Control */}
            <div
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseLeave}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              onClick={handleCardClick}
              className={`w-full py-2.5 px-3.5 rounded-xl border flex items-center justify-between gap-3 transition-all cursor-pointer select-none ${
                isVoiceListening 
                  ? 'bg-emerald-100/90 dark:bg-emerald-950/50 border-emerald-400 dark:border-emerald-600 shadow-sm ring-2 ring-emerald-500/20' 
                  : voiceDetectedText
                    ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                    : 'bg-[#FFFEEF] dark:bg-[#171816] hover:bg-[#F3F1DF] dark:hover:bg-[#22231F] border-[#DDDCCB] dark:border-[#373832]'
              }`}
              title="Hold or press Spacebar / click to speak"
            >
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className={`p-1.5 rounded-lg shrink-0 transition-colors ${
                  isVoiceListening 
                    ? 'bg-emerald-500 text-white animate-pulse' 
                    : voiceDetectedText
                      ? 'bg-emerald-500 text-white'
                      : 'bg-[#E9D2FF]/40 dark:bg-[#CDB0F3]/20 text-[#005447] dark:text-[#67E2C8]'
                }`}>
                  <Mic className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-semibold text-[#191919] dark:text-[#F5F1E7] truncate">
                      {voiceDetectedText 
                        ? `${voiceDetectedText} — Starting download...` 
                        : isVoiceListening 
                          ? (liveTranscript ? `"${liveTranscript}"` : 'Listening... Say "download"')
                          : micState === 'granted'
                            ? 'Press Space or Click to Speak'
                            : 'Enable Voice with Spacebar'}
                    </p>
                  </div>
                  <p className="text-[10px] text-[#77776E] dark:text-[#A6A49B] truncate">
                    {voiceDetectedText
                      ? 'Command recognized'
                      : isVoiceListening 
                        ? (isHoldingVoice ? 'Release Space to finish, or keep holding...' : 'Say "download" (or press Space to cancel)')
                        : micState === 'granted'
                          ? 'Hold or press Spacebar / click to say "download"'
                          : 'Hold or press Spacebar to allow mic & say "download"'}
                  </p>
                </div>
              </div>

              <div className="shrink-0 flex items-center gap-1.5">
                <kbd className={`px-2.5 py-1 rounded font-mono text-[10px] font-bold shadow-2xs transition-all ${
                  isVoiceListening 
                    ? (isHoldingVoice 
                        ? 'bg-emerald-600 text-white scale-110 ring-2 ring-emerald-400 shadow-emerald-500/30 animate-pulse'
                        : 'bg-emerald-600 text-white scale-105 shadow-emerald-500/20')
                    : 'bg-[#EBE7D0] dark:bg-[#2A2B26] border border-[#DDDCCB] dark:border-[#373832] text-[#191919] dark:text-[#F5F1E7]'
                }`}>
                  {isHoldingVoice ? 'Space ▼' : 'Space'}
                </kbd>
              </div>
            </div>

            {/* If microphone permission is needed or being granted */}
            {micPrompted && micState !== 'granted' && (
              <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-amber-900 dark:text-amber-200 text-xs flex items-center justify-between gap-2 animate-fadeIn">
                <span className="text-[11px] leading-snug">
                  Click <strong>"Allow"</strong> on the browser prompt tab to enable hands-free voice.
                </span>
                <button
                  onClick={openMicrophonePromptTab}
                  className="px-2.5 py-1 rounded-lg bg-amber-200 dark:bg-amber-900/60 font-semibold text-[10px] hover:opacity-80 shrink-0 cursor-pointer"
                >
                  Open Prompt
                </button>
              </div>
            )}

            {/* Model Breakdown: Tells the user WHAT is being downloaded */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-[#191919] dark:text-[#F5F1E7] px-0.5">
                <span>Models to Provision</span>
                <span className="font-mono text-[11px] text-[#005447] dark:text-[#67E2C8]">
                  Total: {totalDownloadSize}
                </span>
              </div>

              {/* 1. Gemini Nano */}
              <div className="p-2.5 rounded-xl bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <Brain className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8] shrink-0" />
                    <p className="font-semibold text-xs text-[#191919] dark:text-[#F5F1E7] truncate">
                      Gemini Nano (Prompt API)
                    </p>
                  </div>
                  <p className="text-[10px] text-[#77776E] dark:text-[#A6A49B] truncate">
                    On-device reasoning, action planning, tool calling
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#191919] dark:text-[#F5F1E7]">
                    ~1.5 GB
                  </span>
                  <p className="text-[9px] text-[#77776E] dark:text-[#A6A49B] mt-0.5">
                    {apiStatus.promptAPI === 'available' ? 'Installed' : 'Ready'}
                  </p>
                </div>
              </div>

              {/* 2. all-MiniLM-L6-v2 Embeddings */}
              <div className="p-2.5 rounded-xl bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8] shrink-0" />
                    <p className="font-semibold text-xs text-[#191919] dark:text-[#F5F1E7] truncate">
                      Semantic Vault (all-MiniLM-L6-v2)
                    </p>
                  </div>
                  <p className="text-[10px] text-[#77776E] dark:text-[#A6A49B] truncate">
                    384-D vector vault, page embeddings, memory search
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#191919] dark:text-[#F5F1E7]">
                    ~23 MB
                  </span>
                  <p className="text-[9px] text-[#77776E] dark:text-[#A6A49B] mt-0.5">
                    {embeddingModelDownloaded ? 'Cached' : 'Ready'}
                  </p>
                </div>
              </div>

              {/* 3. Chrome Summarizer & Writer APIs */}
              <div className="p-2.5 rounded-xl bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8] shrink-0" />
                    <p className="font-semibold text-xs text-[#191919] dark:text-[#F5F1E7] truncate">
                      Summarizer & Writer APIs
                    </p>
                  </div>
                  <p className="text-[10px] text-[#77776E] dark:text-[#A6A49B] truncate">
                    Fast in-browser webpage summarization & rewriting
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#191919] dark:text-[#F5F1E7]">
                    Included
                  </span>
                  <p className="text-[9px] text-[#77776E] dark:text-[#A6A49B] mt-0.5">
                    {apiStatus.summarizationAPI === 'available' ? 'Ready' : 'Bundled'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* State 3: Model Downloading Section */}
        {modelState === 'downloading' && (
          <div className="space-y-3.5">
            <div className="flex items-center justify-between text-xs font-sans">
              <span className="font-semibold text-[#005447] dark:text-[#67E2C8] flex items-center gap-1.5">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Downloading On-Device Models...</span>
              </span>
              <span className="font-mono text-[11px] text-[#77776E] dark:text-[#A6A49B]">
                {currentlyDownloading || 'Preparing...'}
              </span>
            </div>

            {/* Prompt API Progress */}
            {downloadProgress.promptAPI > 0 && (
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-[#56564E] dark:text-[#F5F1E7]">Gemini Nano (Prompt API)</span>
                  <span className="font-mono text-[#005447] dark:text-[#67E2C8]">{downloadProgress.promptAPI}%</span>
                </div>
                <div className="w-full bg-[#EBE7D0] dark:bg-[#2A2B26] rounded-full h-1.5 overflow-hidden">
                  <div className="h-full bg-[#005447] dark:bg-[#67E2C8] transition-all duration-300" style={{ width: `${downloadProgress.promptAPI}%` }} />
                </div>
              </div>
            )}

            {/* Summarizer API Progress */}
            {downloadProgress.summarizationAPI > 0 && (
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-[#56564E] dark:text-[#F5F1E7]">Summarizer & Writer APIs</span>
                  <span className="font-mono text-[#005447] dark:text-[#67E2C8]">{downloadProgress.summarizationAPI}%</span>
                </div>
                <div className="w-full bg-[#EBE7D0] dark:bg-[#2A2B26] rounded-full h-1.5 overflow-hidden">
                  <div className="h-full bg-[#005447] dark:bg-[#67E2C8] transition-all duration-300" style={{ width: `${downloadProgress.summarizationAPI}%` }} />
                </div>
              </div>
            )}

            {/* Embedding Model Progress */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-[#56564E] dark:text-[#F5F1E7]">Vault Vector Model (all-MiniLM-L6-v2)</span>
                <span className="font-mono text-[#005447] dark:text-[#67E2C8]">
                  {embeddingModelDownloaded ? '100%' : `${downloadProgress.embeddingModel}%`}
                </span>
              </div>
              <div className="w-full bg-[#EBE7D0] dark:bg-[#2A2B26] rounded-full h-1.5 overflow-hidden">
                <div 
                  className="h-full bg-[#005447] dark:bg-[#67E2C8] transition-all duration-300" 
                  style={{ width: `${embeddingModelDownloaded ? 100 : downloadProgress.embeddingModel}%` }} 
                />
              </div>
            </div>
          </div>
        )}

        {/* State 4: Missing Chrome Flags Section */}
        {(modelState === 'unavailable' || modelState === 'error') && (
          <div className="space-y-3.5">
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-amber-900 dark:text-amber-200 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <div className="space-y-1">
                <p className="font-semibold">One-Time Setup: Enable Chrome's Free Built-in AI</p>
                <p className="text-[11px] leading-relaxed opacity-90">
                  Google Chrome includes a free on-device AI (Gemini Nano) that runs 100% privately on your machine. Enable the flags below with 1 click, or skip to use our offline fallback engine!
                </p>
              </div>
            </div>

            {/* Master 1-Click Action Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                onClick={openAllRequiredFlags}
                className="py-2.5 px-3 rounded-xl font-sans text-xs font-bold bg-[#005447] hover:bg-[#003F36] dark:bg-[#67E2C8] dark:hover:bg-[#52C5AD] text-white dark:text-[#171816] transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer active:scale-[0.99]"
                title="Opens all required flag pages in new tabs automatically"
              >
                <Zap className="w-3.5 h-3.5 shrink-0" />
                <span>1-Click Open All Flags</span>
                <ExternalLink className="w-3 h-3 opacity-80 shrink-0" />
              </button>

              <button
                onClick={copyAllFlagsCheatSheet}
                className="py-2.5 px-3 rounded-xl font-sans text-xs font-semibold bg-[#EBE7D0] hover:bg-[#DDDCCB] dark:bg-[#2A2B26] dark:hover:bg-[#373832] text-[#191919] dark:text-[#F5F1E7] border border-[#DDDCCB] dark:border-[#373832] transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                title="Copy complete step-by-step instructions to clipboard"
              >
                {copiedKey === 'cheat-sheet' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-emerald-700 dark:text-emerald-400 font-bold">Copied Cheat Sheet!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 opacity-80" />
                    <span>Copy Setup Cheat Sheet</span>
                  </>
                )}
              </button>
            </div>

            {/* Step-by-Step Flag Cards with Plain English Labels & 1-Click Buttons */}
            <div className="space-y-2 pt-1 text-[11px] w-full min-w-0">
              {/* Flag 1 */}
              <div className="p-2.5 rounded-xl bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] flex flex-col gap-1.5 min-w-0">
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded-full bg-[#E9D2FF]/40 dark:bg-[#CDB0F3]/20 text-[#005447] dark:text-[#67E2C8] font-bold text-[10px] flex items-center justify-center shrink-0">1</span>
                      <p className="font-semibold text-[#191919] dark:text-[#F5F1E7] truncate">AI Engine (Optimization Guide)</p>
                    </div>
                    <p className="text-[10px] text-[#77776E] dark:text-[#A6A49B] truncate pl-5">
                      Set dropdown to: <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold">Enabled BypassPerfRequirement</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleCopyText('opt', 'optimization-guide-on-device-model')}
                      className="p-1.5 rounded-lg bg-[#EBE7D0]/60 dark:bg-[#2A2B26] text-[#77776E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] transition-colors"
                      title="Copy search query"
                    >
                      {copiedKey === 'opt' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                    </button>
                    <button
                      onClick={openOptimizationGuideFlagsPage}
                      className="px-2 py-1 rounded-lg bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#191919] dark:text-[#F5F1E7] text-[10px] font-semibold hover:opacity-80 transition-opacity flex items-center gap-1 cursor-pointer"
                    >
                      <span>Open</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </button>
                  </div>
                </div>
                <div className="ml-5 px-2 py-1 rounded bg-[#EBE7D0]/50 dark:bg-[#22231F] text-[9.5px] text-[#77776E] dark:text-[#A6A49B] flex items-start gap-1">
                  <span className="shrink-0 text-amber-500 font-bold">💡</span>
                  <span>Can&apos;t find it? Check the <strong>&ldquo;Unavailable&rdquo;</strong> tab in Chrome or search <strong>&ldquo;on-device&rdquo;</strong>. (Or click Skip Setup below to run 100% offline!)</span>
                </div>
              </div>

              {/* Flag 2 */}
              <div className="p-2.5 rounded-xl bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] flex items-center justify-between gap-2 min-w-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-[#E9D2FF]/40 dark:bg-[#CDB0F3]/20 text-[#005447] dark:text-[#67E2C8] font-bold text-[10px] flex items-center justify-center shrink-0">2</span>
                    <p className="font-semibold text-[#191919] dark:text-[#F5F1E7] truncate">Gemini Nano Assistant (Prompt API)</p>
                  </div>
                  <p className="text-[10px] text-[#77776E] dark:text-[#A6A49B] truncate pl-5">
                    Set dropdown to: <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold">Enabled</span>
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleCopyText('prompt', 'prompt-api-for-gemini-nano')}
                    className="p-1.5 rounded-lg bg-[#EBE7D0]/60 dark:bg-[#2A2B26] text-[#77776E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] transition-colors"
                    title="Copy search query"
                  >
                    {copiedKey === 'prompt' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  </button>
                  <button
                    onClick={openAIFlagsPage}
                    className="px-2 py-1 rounded-lg bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#191919] dark:text-[#F5F1E7] text-[10px] font-semibold hover:opacity-80 transition-opacity flex items-center gap-1 cursor-pointer"
                  >
                    <span>Open</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </button>
                </div>
              </div>

              {/* Flag 3 */}
              <div className="p-2.5 rounded-xl bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] flex items-center justify-between gap-2 min-w-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-[#E9D2FF]/40 dark:bg-[#CDB0F3]/20 text-[#005447] dark:text-[#67E2C8] font-bold text-[10px] flex items-center justify-center shrink-0">3</span>
                    <p className="font-semibold text-[#191919] dark:text-[#F5F1E7] truncate">Writer API for Gemini Nano</p>
                  </div>
                  <p className="text-[10px] text-[#77776E] dark:text-[#A6A49B] truncate pl-5">
                    Set dropdown to: <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold">Enabled</span>
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleCopyText('writer', 'writer-api-for-gemini-nano')}
                    className="p-1.5 rounded-lg bg-[#EBE7D0]/60 dark:bg-[#2A2B26] text-[#77776E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] transition-colors"
                    title="Copy search query"
                  >
                    {copiedKey === 'writer' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  </button>
                  <button
                    onClick={openWriterFlagsPage}
                    className="px-2 py-1 rounded-lg bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#191919] dark:text-[#F5F1E7] text-[10px] font-semibold hover:opacity-80 transition-opacity flex items-center gap-1 cursor-pointer"
                  >
                    <span>Open</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </button>
                </div>
              </div>

              {/* Flag 4 */}
              <div className="p-2.5 rounded-xl bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] flex items-center justify-between gap-2 min-w-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-[#E9D2FF]/40 dark:bg-[#CDB0F3]/20 text-[#005447] dark:text-[#67E2C8] font-bold text-[10px] flex items-center justify-center shrink-0">4</span>
                    <p className="font-semibold text-[#191919] dark:text-[#F5F1E7] truncate">Rewriter API for Gemini Nano</p>
                  </div>
                  <p className="text-[10px] text-[#77776E] dark:text-[#A6A49B] truncate pl-5">
                    Set dropdown to: <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold">Enabled</span>
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleCopyText('rewriter', 'rewriter-api-for-gemini-nano')}
                    className="p-1.5 rounded-lg bg-[#EBE7D0]/60 dark:bg-[#2A2B26] text-[#77776E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] transition-colors"
                    title="Copy search query"
                  >
                    {copiedKey === 'rewriter' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  </button>
                  <button
                    onClick={openRewriterFlagsPage}
                    className="px-2 py-1 rounded-lg bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#191919] dark:text-[#F5F1E7] text-[10px] font-semibold hover:opacity-80 transition-opacity flex items-center gap-1 cursor-pointer"
                  >
                    <span>Open</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </button>
                </div>
              </div>

              {/* Helpful Link: Chrome Components */}
              <div className="p-2.5 rounded-xl bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] flex items-center justify-between gap-2 min-w-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-[#E9D2FF]/40 dark:bg-[#CDB0F3]/20 text-[#005447] dark:text-[#67E2C8] font-bold text-[10px] flex items-center justify-center shrink-0">5</span>
                    <p className="font-semibold text-[#191919] dark:text-[#F5F1E7] truncate">Check Model Update Status</p>
                  </div>
                  <p className="text-[10px] text-[#77776E] dark:text-[#A6A49B] truncate pl-5">
                    Click "Check for update" next to Optimization Guide
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleCopyText('comp', 'Optimization Guide On Device Model')}
                    className="p-1.5 rounded-lg bg-[#EBE7D0]/60 dark:bg-[#2A2B26] text-[#77776E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] transition-colors"
                    title="Copy component search name"
                  >
                    {copiedKey === 'comp' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  </button>
                  <button
                    onClick={openComponentsPage}
                    className="px-2 py-1 rounded-lg bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#191919] dark:text-[#F5F1E7] text-[10px] font-semibold hover:opacity-80 transition-opacity flex items-center gap-1 cursor-pointer"
                    title="Open chrome://components"
                  >
                    <span>Check</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Automated Detection Status Notice */}
            <div className="p-2.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 flex items-center gap-2.5">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                  Auto-Detecting Chrome Relaunch
                </p>
                <p className="text-[10px] text-[#77776E] dark:text-[#A6A49B] leading-tight">
                  After toggling flags, click <strong>Relaunch</strong> at the bottom of Chrome. Pentone will detect it automatically!
                </p>
              </div>
            </div>

            {/* Non-Technical FAQ & Helper Accordion */}
            <div className="pt-0.5">
              <button
                onClick={() => setShowFaq(!showFaq)}
                className="w-full flex items-center justify-between py-1.5 px-1 text-[11px] text-[#77776E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] transition-colors cursor-pointer select-none"
              >
                <span className="flex items-center gap-1.5 font-medium">
                  <HelpCircle className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8]" />
                  <span>Frequently Asked Questions & Help</span>
                </span>
                {showFaq ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>

              {showFaq && (
                <div className="p-3 mt-1.5 rounded-xl bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] space-y-2 text-[11px] text-[#56564E] dark:text-[#DDDCCB] animate-fadeIn leading-relaxed">
                  <div>
                    <p className="font-semibold text-[#191919] dark:text-[#F5F1E7]">Is this private and secure?</p>
                    <p className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">Yes, 100%. Everything runs locally on your computer hardware. No text, audio, or browsing activity ever leaves your computer.</p>
                  </div>
                  <div>
                    <p className="font-semibold text-[#191919] dark:text-[#F5F1E7]">Does it cost anything?</p>
                    <p className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">No. Google Chrome built-in Gemini Nano is provided directly by Google inside your browser without API subscriptions.</p>
                  </div>
                  <div>
                    <p className="font-semibold text-[#191919] dark:text-[#F5F1E7]">Can't change flags or on a work laptop?</p>
                    <p className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">No problem! Click <strong>"Skip Setup & Launch"</strong> below. Pentone includes an offline heuristic engine that will still handle your voice navigation, form filling, and text grammar corrections without flags.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* State 5: Ready State Checklist */}
        {modelState === 'available' && (
          <div className="space-y-2.5">
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-300 text-xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="font-semibold">Local AI Engines Provisioned & Ready</span>
            </div>

            <div className="divide-y divide-[#DDDCCB]/60 dark:divide-[#373832]/60 text-xs">
              <div className="py-2 flex items-center justify-between">
                <span className="text-[#56564E] dark:text-[#F5F1E7]">Chrome Prompt API (Gemini Nano)</span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" /> Ready
                </span>
              </div>
              <div className="py-2 flex items-center justify-between">
                <span className="text-[#56564E] dark:text-[#F5F1E7]">Semantic Vault Embeddings</span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" /> 384D Cached
                </span>
              </div>
              <div className="py-2 flex items-center justify-between">
                <span className="text-[#56564E] dark:text-[#F5F1E7]">Summarizer & Writer APIs</span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" /> Ready
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Primary Action Button Section - Reactive to user intent */}
      <div className="pt-2 space-y-2.5">
        {canProceed ? (
          <button
            onClick={handleLaunch}
            className="w-full py-3.5 px-6 rounded-2xl font-sans text-sm font-bold tracking-wide flex items-center justify-center gap-2 bg-[#005447] text-white hover:bg-[#003F36] dark:bg-[#67E2C8] dark:text-[#171816] dark:hover:bg-[#52C5AD] shadow-md transition-all active:scale-[0.99] cursor-pointer"
          >
            <span>Launch Pentone</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        ) : modelState === 'ready_to_download' ? (
          <div className="space-y-2">
            {/* The Download Button: Starts download when clicked or spoken */}
            <button
              onClick={triggerDownload}
              className="w-full py-3.5 px-6 rounded-2xl font-sans text-sm font-bold tracking-wide flex items-center justify-center gap-2 bg-[#005447] text-white hover:bg-[#003F36] dark:bg-[#67E2C8] dark:text-[#171816] dark:hover:bg-[#52C5AD] shadow-md transition-all active:scale-[0.99] cursor-pointer"
            >
              <Download className="w-4 h-4 shrink-0" />
              <span>⚡ 1-Click Auto-Setup & Download ({totalDownloadSize})</span>
            </button>

            <div className="flex items-center justify-between gap-2 px-1 pt-0.5">
              <div 
                onClick={toggleListening}
                className="text-[11px] text-[#77776E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] flex items-center gap-1.5 cursor-pointer py-1 px-1 rounded transition-colors select-none"
                title="Click to speak"
              >
                <Mic className={`w-3.5 h-3.5 transition-colors ${isVoiceListening ? 'text-emerald-500 animate-pulse' : 'text-[#005447] dark:text-[#67E2C8]'}`} />
                <span>Press <kbd className={`px-1.5 py-0.5 rounded font-mono text-[9px] font-bold transition-all ${isVoiceListening ? 'bg-emerald-600 text-white' : 'bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#191919] dark:text-[#F5F1E7]'}`}>Space</kbd> or click to say <strong>"download"</strong></span>
              </div>
              <button
                onClick={handleLaunch}
                className="text-xs font-medium text-[#77776E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] hover:underline flex items-center gap-1 py-1 px-2 rounded-lg hover:bg-[#EBE7D0]/60 dark:hover:bg-[#2A2B26]/60 transition-colors cursor-pointer"
              >
                <span>Skip Download & Launch</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        ) : modelState === 'downloading' ? (
          <div className="space-y-2">
            <button
              disabled
              className="w-full py-3.5 px-6 rounded-2xl font-sans text-sm font-bold tracking-wide flex items-center justify-center gap-2 bg-[#DDDCCB] dark:bg-[#2A2B26] text-[#77776E] dark:text-[#A6A49B] cursor-wait opacity-80"
            >
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              <span>Downloading Models...</span>
            </button>
            <button
              onClick={handleLaunch}
              className="w-full text-center text-xs font-medium text-[#77776E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] transition-colors py-1 cursor-pointer"
            >
              Skip Download & Launch Pentone &rarr;
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {/* When flags are required */}
            <button
              onClick={openAllRequiredFlags}
              className="w-full py-3.5 px-6 rounded-2xl font-sans text-sm font-bold tracking-wide flex items-center justify-center gap-2 bg-[#005447] text-white hover:bg-[#003F36] dark:bg-[#67E2C8] dark:text-[#171816] dark:hover:bg-[#52C5AD] shadow-md transition-all active:scale-[0.99] cursor-pointer"
            >
              <Zap className="w-4 h-4 shrink-0" />
              <span>Enable Chrome Flags (Open Pages)</span>
              <ExternalLink className="w-4 h-4 ml-1 opacity-80 shrink-0" />
            </button>

            {/* Secondary Actions: Check Again and Skip Setup */}
            <div className="flex items-center justify-between gap-2 px-1 pt-0.5">
              <button
                onClick={() => checkModelAvailability()}
                className="text-xs font-semibold text-[#005447] dark:text-[#67E2C8] hover:underline flex items-center gap-1.5 py-1 px-2 rounded-lg hover:bg-[#EBE7D0]/60 dark:hover:bg-[#2A2B26]/60 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Check Again</span>
              </button>
              <button
                onClick={handleLaunch}
                className="text-xs font-medium text-[#77776E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] hover:underline flex items-center gap-1 py-1 px-2 rounded-lg hover:bg-[#EBE7D0]/60 dark:hover:bg-[#2A2B26]/60 transition-colors cursor-pointer"
              >
                <span>Skip Setup & Launch</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
