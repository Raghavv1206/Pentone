import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { 
  Brain, AlertCircle, CheckCircle, ArrowRight, Loader2, 
  ExternalLink, Mic, CheckCircle2, Sparkles, Volume2, ShieldCheck, Zap, RefreshCw, Download 
} from 'lucide-react'
import { useOnboarding } from '../onboarding-provider'
import { 
  openAIFlagsPage, 
  openOptimizationGuideFlagsPage, 
  openAllRequiredFlags, 
  openSummarizationAPIFlagsPage, 
  openChromeAIDocs 
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
  const [isVoiceListening, setIsVoiceListening] = useState(false)
  const [voiceDetectedText, setVoiceDetectedText] = useState<string | null>(null)
  
  const isCheckingRef = useRef(false)
  const recognitionRef = useRef<any>(null)

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

  // One-click mic request
  const handleRequestMic = async () => {
    setIsRequestingMic(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach(track => track.stop())
      setMicState('granted')
      setMicPermission(true)
    } catch (e: any) {
      console.warn('[Onboarding] Mic permission request error:', e)
      setMicState('denied')
      setMicPermission(false)
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
          const session = await LM.create({
            monitor(m: any) {
              m.addEventListener('downloadprogress', (e: any) => {
                const progress = Math.round((e.loaded / (e.total || 1)) * 100) || Math.round(e.loaded * 100)
                setDownloadProgress(prev => ({ ...prev, promptAPI: Math.min(progress, 100) }))
              })
            }
          })
          updatedStatus.promptAPI = 'available'
          setApiStatus({ ...updatedStatus })
          session.destroy?.()
        } catch (e) {
          console.warn('[Onboarding] Prompt API download error:', e)
        }
      }

      // 2. Download Summarizer API if needed
      if (status.summarizationAPI === 'after-download' && Summarizer) {
        setCurrentlyDownloading('Summarization API')
        try {
          const summarizer = await Summarizer.create({
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
          updatedStatus.summarizationAPI = 'available'
          setApiStatus({ ...updatedStatus })
          summarizer.destroy?.()
        } catch (e) {
          console.warn('[Onboarding] Summarizer download error:', e)
        }
      }

      // 3. Pre-cache Embedding Model (Transformers.js all-MiniLM-L6-v2)
      setCurrentlyDownloading('Vault Embedding Model (all-MiniLM-L6-v2)')
      try {
        const { pipeline, env } = await import('@xenova/transformers')
        env.allowLocalModels = false
        env.backends.onnx.wasm.numThreads = 1

        await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
          progress_callback: (p: any) => {
            if (p.status === 'progress' && p.progress) {
              const percent = Math.round(p.progress)
              setDownloadProgress(prev => ({ ...prev, embeddingModel: percent }))
            }
          }
        })
        setEmbeddingModelDownloaded(true)
        setDownloadProgress(prev => ({ ...prev, embeddingModel: 100 }))
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          chrome.storage.local.set({ pentone_embedding_cached: true })
        }
      } catch (e) {
        console.warn('[Onboarding] Embedding model pre-cache error:', e)
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

  // Check model availability across all APIs - Explains what is needed without auto-downloading
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

      // Prompt API check
      if (!LM) {
        newStatus.promptAPI = 'unavailable'
        setErrorMessage('Prompt API not detected. Enable Chrome flags to activate Gemini Nano.')
      } else {
        try {
          let avail: string | undefined
          if (typeof LM.availability === 'function') {
            avail = await LM.availability()
          } else if (typeof LM.capabilities === 'function') {
            const caps = await LM.capabilities()
            avail = caps?.available
          }

          if (avail === 'readily' || avail === 'available') {
            newStatus.promptAPI = 'available'
          } else if (avail === 'after-download' || avail === 'downloadable') {
            newStatus.promptAPI = 'after-download'
          } else {
            newStatus.promptAPI = 'unavailable'
            setErrorMessage('Prompt API unavailable. Ensure Optimization Guide flag is enabled.')
          }
        } catch {
          newStatus.promptAPI = 'unavailable'
          setErrorMessage('Prompt API flag is required in chrome://flags.')
        }
      }

      // Writer API check
      if (Writer && typeof Writer.availability === 'function') {
        try {
          const a = await Writer.availability()
          newStatus.writerAPI = (a === 'readily' || a === 'available') ? 'available' : (a === 'after-download' || a === 'downloadable') ? 'after-download' : 'unavailable'
        } catch {
          newStatus.writerAPI = 'unavailable'
        }
      } else {
        newStatus.writerAPI = 'unavailable'
      }

      // Rewriter API check
      if (Rewriter && typeof Rewriter.availability === 'function') {
        try {
          const a = await Rewriter.availability()
          newStatus.rewriterAPI = (a === 'readily' || a === 'available') ? 'available' : (a === 'after-download' || a === 'downloadable') ? 'after-download' : 'unavailable'
        } catch {
          newStatus.rewriterAPI = 'unavailable'
        }
      } else {
        newStatus.rewriterAPI = 'unavailable'
      }

      // Summarizer API check
      if (Summarizer && typeof Summarizer.availability === 'function') {
        try {
          const a = await Summarizer.availability()
          newStatus.summarizationAPI = (a === 'readily' || a === 'available') ? 'available' : (a === 'after-download' || a === 'downloadable') ? 'after-download' : 'unavailable'
        } catch {
          newStatus.summarizationAPI = 'unavailable'
        }
      } else {
        newStatus.summarizationAPI = 'unavailable'
      }

      // Translation API check
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

  // Continuous speech recognition listening for user saying "download"
  useEffect(() => {
    if (modelState !== 'ready_to_download' || micState !== 'granted') {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort() } catch {}
        recognitionRef.current = null
      }
      setIsVoiceListening(false)
      return
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      return
    }

    try {
      const recognition = new SpeechRecognition()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = 'en-US'

      recognition.onstart = () => {
        setIsVoiceListening(true)
      }

      recognition.onresult = (event: any) => {
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const text = event.results[i][0].transcript.trim().toLowerCase()
          console.log('[Onboarding Voice] Heard:', text)
          if (
            text.includes('download') || 
            text.includes('start') || 
            text.includes('load') || 
            text.includes('yes') || 
            text.includes('proceed') || 
            text.includes('ok')
          ) {
            setVoiceDetectedText(`Heard: "${text}"`)
            try { recognition.stop() } catch {}
            setTimeout(() => {
              triggerDownload()
            }, 300)
            break
          }
        }
      }

      recognition.onerror = (e: any) => {
        console.warn('[Onboarding Voice] Recognition notice:', e?.error)
      }

      recognition.onend = () => {
        if (modelState === 'ready_to_download' && micState === 'granted' && !voiceDetectedText) {
          try { recognition.start() } catch {}
        } else {
          setIsVoiceListening(false)
        }
      }

      recognition.start()
      recognitionRef.current = recognition
    } catch (e) {
      console.warn('[Onboarding Voice] Could not start speech recognition:', e)
    }

    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort() } catch {}
        recognitionRef.current = null
      }
    }
  }, [modelState, micState, voiceDetectedText, triggerDownload])

  const canProceed = modelState === 'available' || apiStatus.promptAPI === 'available'

  // Calculate estimated download size
  const totalDownloadSize = useMemo(() => {
    let mb = 0
    if (apiStatus.promptAPI === 'after-download') mb += 1500
    if (!embeddingModelDownloaded) mb += 23
    return mb >= 1000 ? `~${(mb / 1000).toFixed(1)} GB` : `~${mb} MB`
  }, [apiStatus.promptAPI, embeddingModelDownloaded])

  const handleLaunch = () => {
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
            {/* Voice Command Banner */}
            {micState === 'granted' ? (
              <div className={`flex items-center justify-center gap-2 py-2 px-3 rounded-xl border text-xs transition-all ${
                voiceDetectedText 
                  ? 'bg-emerald-100 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                  : 'bg-[#E9D2FF]/30 dark:bg-[#CDB0F3]/15 border-[#D5B8F6]/60 dark:border-[#513E6B]/60 text-[#005447] dark:text-[#67E2C8]'
              }`}>
                {voiceDetectedText ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span className="font-semibold">{voiceDetectedText} — Starting download...</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-3.5 h-3.5 animate-pulse text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span className="font-medium">
                      Voice ready: Say <strong>"download"</strong> or click below
                    </span>
                  </>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] text-xs">
                <span className="text-[11px] text-[#77776E] dark:text-[#A6A49B]">
                  Enable microphone to say <strong>"download"</strong>
                </span>
                <button
                  onClick={handleRequestMic}
                  className="px-2.5 py-1 text-[10px] font-semibold rounded-lg bg-[#005447] hover:bg-[#003F36] dark:bg-[#67E2C8] dark:hover:bg-[#52C5AD] text-white dark:text-[#171816] transition-colors"
                >
                  Allow Mic
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
                <p className="font-semibold">Chrome Built-in AI Flags Required</p>
                <p className="text-[11px] leading-relaxed opacity-90">
                  Chrome on-device Gemini Nano must be enabled in your browser flags to run local intelligence without API keys.
                </p>
              </div>
            </div>

            {/* 1-Click Action Button to open both flags */}
            <button
              onClick={openAllRequiredFlags}
              className="w-full py-2.5 px-4 rounded-xl font-sans text-xs font-bold bg-[#005447] hover:bg-[#003F36] dark:bg-[#67E2C8] dark:hover:bg-[#52C5AD] text-white dark:text-[#171816] transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99]"
            >
              <Zap className="w-3.5 h-3.5 shrink-0" />
              <span>Open All Required Flags (1-Click)</span>
              <ExternalLink className="w-3.5 h-3.5 opacity-80 shrink-0 ml-1" />
            </button>

            {/* Specific Flags Helper Links */}
            <div className="space-y-2 pt-1 text-[11px] w-full min-w-0">
              <div className="p-2.5 rounded-xl bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] flex items-center justify-between gap-2 min-w-0">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-[#191919] dark:text-[#F5F1E7] truncate">1. Optimization Guide Model</p>
                  <p className="text-[10px] text-[#77776E] dark:text-[#A6A49B] truncate">Set to: <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold">Enabled BypassPerfRequirement</span></p>
                </div>
                <button
                  onClick={openOptimizationGuideFlagsPage}
                  className="px-2.5 py-1 rounded-lg bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#191919] dark:text-[#F5F1E7] text-[10px] font-medium hover:opacity-80 transition-opacity flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  <span>Open Flag</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </button>
              </div>

              <div className="p-2.5 rounded-xl bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] flex items-center justify-between gap-2 min-w-0">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-[#191919] dark:text-[#F5F1E7] truncate">2. Prompt API for Gemini Nano</p>
                  <p className="text-[10px] text-[#77776E] dark:text-[#A6A49B] truncate">Set to: <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold">Enabled</span></p>
                </div>
                <button
                  onClick={openAIFlagsPage}
                  className="px-2.5 py-1 rounded-lg bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#191919] dark:text-[#F5F1E7] text-[10px] font-medium hover:opacity-80 transition-opacity flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  <span>Open Flag</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </button>
              </div>

              <div className="p-2.5 rounded-xl bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] flex items-center justify-between gap-2 min-w-0">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-[#191919] dark:text-[#F5F1E7] truncate">3. Summarizer & Writer Flags</p>
                  <p className="text-[10px] text-[#77776E] dark:text-[#A6A49B] truncate">Optional on-device features</p>
                </div>
                <button
                  onClick={openSummarizationAPIFlagsPage}
                  className="px-2.5 py-1 rounded-lg bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#191919] dark:text-[#F5F1E7] text-[10px] font-medium hover:opacity-80 transition-opacity flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  <span>Open Flag</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </button>
              </div>
            </div>

            <p className="text-[10px] text-[#77776E] dark:text-[#A6A49B] text-center pt-1">
              ⚡ After enabling flags, click <strong>Relaunch</strong> in Chrome. Pentone will auto-detect and proceed!
            </p>
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

        {/* Integrated Microphone Access Card */}
        <div className="pt-2 border-t border-[#DDDCCB] dark:border-[#373832] w-full min-w-0">
          <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <Mic className="w-4 h-4 text-[#005447] dark:text-[#67E2C8] shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-[#191919] dark:text-[#F5F1E7] truncate">Microphone Permission</p>
                <p className="text-[10px] text-[#77776E] dark:text-[#A6A49B] truncate">Required for voice commands & saying "download"</p>
              </div>
            </div>

            {micState === 'granted' ? (
              <span className="px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-[10px] font-mono font-semibold flex items-center gap-1 shrink-0">
                <CheckCircle2 className="w-3 h-3" /> Granted
              </span>
            ) : (
              <button
                onClick={handleRequestMic}
                disabled={isRequestingMic}
                className="px-3 py-1.5 rounded-lg bg-[#005447] hover:bg-[#003F36] dark:bg-[#67E2C8] dark:hover:bg-[#52C5AD] text-white dark:text-[#171816] text-[11px] font-semibold transition-all disabled:opacity-50 shrink-0 cursor-pointer"
              >
                {isRequestingMic ? 'Checking...' : 'Allow Mic'}
              </button>
            )}
          </div>
        </div>
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
            {/* The Download Button: User clicks or says "download" to start */}
            <button
              onClick={triggerDownload}
              className="w-full py-3.5 px-6 rounded-2xl font-sans text-sm font-bold tracking-wide flex items-center justify-center gap-2 bg-[#005447] text-white hover:bg-[#003F36] dark:bg-[#67E2C8] dark:text-[#171816] dark:hover:bg-[#52C5AD] shadow-md transition-all active:scale-[0.99] cursor-pointer"
            >
              <Download className="w-4 h-4 shrink-0" />
              <span>Start Download ({totalDownloadSize})</span>
            </button>

            <div className="flex items-center justify-between gap-2 px-1 pt-0.5">
              <div className="text-[11px] text-[#77776E] dark:text-[#A6A49B] flex items-center gap-1">
                <Mic className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                <span>Or say <strong>"download"</strong></span>
              </div>
              <button
                onClick={handleLaunch}
                className="text-xs font-medium text-[#77776E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] hover:underline flex items-center gap-1 py-1 px-2 rounded-lg hover:bg-[#EBE7D0]/60 dark:hover:bg-[#2A2B26]/60 transition-colors cursor-pointer"
              >
                <span>Skip & Launch</span>
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
            {/* The primary active button: Opens all required flags in 1 click! */}
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
