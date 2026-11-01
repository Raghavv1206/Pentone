import React, { useState, useEffect, useCallback, useRef } from 'react'
import { 
  Brain, AlertCircle, CheckCircle, ArrowRight, ArrowLeft, Loader2, 
  ExternalLink, Download, RefreshCw, ChevronDown, ChevronUp, Shield, Cpu, Lock, Sparkles 
} from 'lucide-react'
import { useOnboarding } from '../onboarding-provider'
import { 
  checkPromptAPIAvailability, 
  inspectPromptAPIAvailability,
  downloadOnDeviceModel, 
  subscribeToModelDownload, 
  getModelDownloadState,
  normalizeModelAvailability,
  normalizeBuiltInAPIAvailability,
  type NormalizedModelAvailability,
  type BuiltInAPIAvailability,
  type ModelDownloadState
} from '../../../lib/ai-config'
import { setAISession } from '../../../lib/ai'
import { 
  openAIFlagsPage, 
  openChromeAIDocs,
  openWriterAPIFlagsPage,
  openRewriterAPIFlagsPage,
  openTranslatorAPIFlagsPage,
  openLanguageDetectorAPIFlagsPage,
  openSummarizationAPIFlagsPage,
  openOptimizationGuideFlagsPage,
  openPermissionsPage
} from '../../../lib/alert-context'

export type ModelUIState = 
  | 'checking' 
  | 'ready' 
  | 'downloadable' 
  | 'downloading' 
  | 'initializing' 
  | 'error' 
  | 'unsupported'

interface OptionalAPIsStatus {
  writer: BuiltInAPIAvailability
  rewriter: BuiltInAPIAvailability
  summarizer: BuiltInAPIAvailability
  translator: BuiltInAPIAvailability
  languageDetector: BuiltInAPIAvailability
}

export const ModelAvailabilityStep: React.FC = () => {
  const { nextStep, prevStep, setModelAvailability } = useOnboarding()
  const [modelState, setModelState] = useState<ModelUIState>('checking')
  const [downloadProgress, setDownloadProgress] = useState<number>(0)
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [rawAvailability, setRawAvailability] = useState<string>('')
  const [showLearnMore, setShowLearnMore] = useState(false)
  const [showTroubleshooting, setShowTroubleshooting] = useState(false)
  const [showOptionalAPIs, setShowOptionalAPIs] = useState(false)
  const [isSlowCheck, setIsSlowCheck] = useState(false)

  const isMountedRef = useRef(true)
  const inFlightCheckRef = useRef(0)
  
  const [optionalAPIs, setOptionalAPIs] = useState<OptionalAPIsStatus>({
    writer: 'unavailable',
    rewriter: 'unavailable',
    summarizer: 'unavailable',
    translator: 'unavailable',
    languageDetector: 'unavailable'
  })
  const [micPermission, setMicPermission] = useState<'granted' | 'prompt' | 'denied' | 'checking'>('checking')
  const [chromeVersion, setChromeVersion] = useState<number | null>(null)
  const [extensionPermissions, setExtensionPermissions] = useState<boolean>(true)
  const [bundledAssetsReady, setBundledAssetsReady] = useState<boolean>(true)

  const checkEnvironment = useCallback(async () => {
    // 1. Chrome Version Detection
    if (typeof navigator !== 'undefined') {
      const match = navigator.userAgent.match(/Chrom(?:e|ium)\/([0-9]+)\./)
      if (match && isMountedRef.current) {
        setChromeVersion(parseInt(match[1], 10))
      }
    }

    // 2. Extension Permissions check
    if (typeof chrome !== 'undefined' && chrome.permissions?.contains) {
      try {
        const hasCore = await chrome.permissions.contains({
          permissions: ['tabs', 'activeTab', 'storage']
        })
        if (isMountedRef.current) setExtensionPermissions(hasCore)
      } catch {
        if (isMountedRef.current) setExtensionPermissions(true)
      }
    }

    // 3. Bundled WASM Asset verification
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      try {
        const wasmUrl = chrome.runtime.getURL('assets/ort-wasm-simd-threaded.wasm')
        const head = await fetch(wasmUrl, { method: 'HEAD' })
        if (isMountedRef.current) setBundledAssetsReady(head.ok)
      } catch {
        if (isMountedRef.current) setBundledAssetsReady(true)
      }
    }
  }, [])

  const checkMicPermission = useCallback(async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
        const res = await navigator.permissions.query({ name: 'microphone' as PermissionName })
        if (isMountedRef.current) {
          setMicPermission(res.state as any)
        }
      }
    } catch {
      if (isMountedRef.current) {
        setMicPermission('prompt')
      }
    }
  }, [])

  const handleGrantMicPermission = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach(t => t.stop())
        if (isMountedRef.current) {
          setMicPermission('granted')
        }
      } else {
        openPermissionsPage()
      }
    } catch {
      openPermissionsPage()
    }
  }

  // Check optional built-in Chrome AI APIs non-blockingly with timeouts
  // Never blocks setup: all optional capabilities fall back gracefully to LanguageModel / Prompt API
  const checkOptionalAPIs = useCallback(async () => {
    const status: OptionalAPIsStatus = {
      writer: 'unavailable',
      rewriter: 'unavailable',
      summarizer: 'unavailable',
      translator: 'unavailable',
      languageDetector: 'unavailable'
    }

    if (typeof window !== 'undefined') {
      const withTimeout = (p: Promise<any>, ms = 2000) => 
        Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])

      // 1. Writer API
      try {
        const writerObj = (window as any).Writer || (window as any).ai?.writer
        if (writerObj && typeof writerObj.availability === 'function') {
          const res: any = await withTimeout(writerObj.availability())
          status.writer = normalizeBuiltInAPIAvailability(res)
        }
      } catch {
        // non-blocking fallback to LanguageModel
      }

      // 2. Rewriter API
      try {
        const rewriterObj = (window as any).Rewriter || (window as any).ai?.rewriter
        if (rewriterObj && typeof rewriterObj.availability === 'function') {
          const res: any = await withTimeout(rewriterObj.availability())
          status.rewriter = normalizeBuiltInAPIAvailability(res)
        }
      } catch {
        // non-blocking fallback to LanguageModel
      }

      // 3. Summarizer API
      try {
        const summarizerObj = (window as any).Summarizer || (window as any).ai?.summarizer
        if (summarizerObj && typeof summarizerObj.availability === 'function') {
          const res: any = await withTimeout(summarizerObj.availability())
          status.summarizer = normalizeBuiltInAPIAvailability(res)
        }
      } catch {
        // non-blocking fallback to LanguageModel
      }

      // 4. Translator API (with expected language pair options)
      try {
        const translatorObj = (window as any).Translator || (window as any).ai?.translator || (window as any).translation
        if (translatorObj && typeof translatorObj.availability === 'function') {
          const res: any = await withTimeout(translatorObj.availability({ sourceLanguage: 'en', targetLanguage: 'es' }))
          status.translator = normalizeBuiltInAPIAvailability(res)
        } else if (translatorObj && typeof translatorObj.canTranslate === 'function') {
          const res: any = await withTimeout(translatorObj.canTranslate({ sourceLanguage: 'en', targetLanguage: 'es' }))
          status.translator = normalizeBuiltInAPIAvailability(res)
        }
      } catch {
        // non-blocking fallback
      }

      // 5. LanguageDetector API
      try {
        const detectorObj = (window as any).LanguageDetector || (window as any).ai?.languageDetector || (window as any).translation
        if (detectorObj && typeof detectorObj.availability === 'function') {
          const res: any = await withTimeout(detectorObj.availability())
          status.languageDetector = normalizeBuiltInAPIAvailability(res)
        } else if (detectorObj && typeof detectorObj.canDetect === 'function') {
          const res: any = await withTimeout(detectorObj.canDetect())
          status.languageDetector = normalizeBuiltInAPIAvailability(res)
        }
      } catch {
        // non-blocking fallback
      }
    }

    if (isMountedRef.current) {
      setOptionalAPIs(status)
    }
  }, [])

  // Check Prompt API availability with strict timeout and stale-event protection
  const checkAvailability = useCallback(async () => {
    const checkId = ++inFlightCheckRef.current
    setModelState('checking')
    setErrorMessage('')
    setIsSlowCheck(false)

    // Slow check timer to show user helper if Chrome is taking time
    const slowTimer = setTimeout(() => {
      if (isMountedRef.current && inFlightCheckRef.current === checkId) {
        setIsSlowCheck(true)
      }
    }, 2500)

    try {
      const { raw, normalized } = await inspectPromptAPIAvailability(5500)
      clearTimeout(slowTimer)

      // Guard against unmounted or superseded checks
      if (!isMountedRef.current || inFlightCheckRef.current !== checkId) {
        return
      }

      setRawAvailability(raw)

      // Check shared download state to preserve any active in-flight or completed download
      const shared = getModelDownloadState()

      if (shared.status === 'ready' || normalized === 'available') {
        setModelState('ready')
        setModelAvailability(true)
      } else if (shared.status === 'downloading' || normalized === 'downloading') {
        setModelState('downloading')
        setDownloadProgress(shared.progress)
        setModelAvailability(false)
      } else if (shared.status === 'error') {
        setModelState('error')
        setErrorMessage(shared.error || 'Model download was interrupted')
        setModelAvailability(false)
      } else if (normalized === 'downloadable') {
        setModelState('downloadable')
        setModelAvailability(false)
      } else {
        setModelState('unsupported')
        setModelAvailability(false)
      }
    } catch (err: any) {
      clearTimeout(slowTimer)
      if (!isMountedRef.current || inFlightCheckRef.current !== checkId) {
        return
      }
      setModelState('error')
      setErrorMessage(err?.message || 'Availability check failed or timed out.')
      setModelAvailability(false)
    }

    // Trigger non-blocking check of environment, optional APIs, and mic permission
    checkEnvironment()
    checkOptionalAPIs()
    checkMicPermission()
  }, [checkEnvironment, checkOptionalAPIs, checkMicPermission, setModelAvailability])

  useEffect(() => {
    isMountedRef.current = true

    // Subscribe to shared download state
    const unsubscribe = subscribeToModelDownload((state: ModelDownloadState) => {
      if (!isMountedRef.current) return
      if (state.status === 'downloading') {
        setModelState('downloading')
        setDownloadProgress(state.progress)
      } else if (state.status === 'ready') {
        setModelState('ready')
        setDownloadProgress(100)
        setModelAvailability(true)
      } else if (state.status === 'error') {
        setModelState('error')
        setErrorMessage(state.error || 'Model download was interrupted')
      }
    })

    // Perform initial check once on mount
    checkAvailability()

    return () => {
      isMountedRef.current = false
      unsubscribe()
    }
  }, []) // Empty dependency array: Mount once only!

  // One-click download handler
  const handleStartDownload = async () => {
    setModelState('downloading')
    setErrorMessage('')
    setDownloadProgress(0)

    try {
      const session = await downloadOnDeviceModel({
        onProgress: (pct) => {
          if (isMountedRef.current) {
            setDownloadProgress(pct)
          }
        }
      })
      if (!isMountedRef.current) return

      if (session) {
        setAISession(session)
      }
      setModelState('ready')
      setModelAvailability(true)
    } catch (err: any) {
      console.warn('[ModelAvailabilityStep] Download failed:', err)
      if (!isMountedRef.current) return
      setModelState('error')
      setErrorMessage(err?.message || 'Download was interrupted or Chrome encountered an issue.')
      setModelAvailability(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center px-4 sm:px-6 py-6 text-[#191919] dark:text-[#F5F1E7]">
      <div className="max-w-md w-full space-y-6">

        {/* State A: CHECKING */}
        {modelState === 'checking' && (
          <div className="text-center py-10 space-y-4">
            <div className="inline-flex p-4 rounded-full bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#005447] dark:text-[#67E2C8] animate-pulse">
              <Brain className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold font-display">Checking AI Model Availability...</h2>
            <p className="text-xs text-[#77776E] dark:text-[#A6A49B] max-w-xs mx-auto">
              Detecting Chrome Built-in AI (Prompt API) and hardware acceleration...
            </p>
            <div className="flex justify-center pt-2">
              <Loader2 className="w-5 h-5 animate-spin text-[#005447] dark:text-[#67E2C8]" />
            </div>

            {/* Slow check helper if Chrome takes longer than 2.5 seconds */}
            {isSlowCheck && (
              <div className="pt-4 border-t border-[#DDDCCB]/60 dark:border-[#373832]/60 max-w-xs mx-auto space-y-2 animate-fadeIn">
                <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B]">
                  Chrome is taking longer than usual to query on-device model status.
                </p>
                <div className="flex justify-center gap-2">
                  <button
                    onClick={checkAvailability}
                    className="px-2.5 py-1 text-xs rounded-lg border border-[#DDDCCB] dark:border-[#373832] hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] font-medium"
                  >
                    Retry Check
                  </button>
                  <button
                    onClick={nextStep}
                    className="px-2.5 py-1 text-xs rounded-lg bg-[#005447] text-white dark:bg-[#67E2C8] dark:text-[#171816] font-medium"
                  >
                    Continue with Voice Only
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* State B: READY (ALREADY INSTALLED) */}
        {modelState === 'ready' && (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <div className="flex justify-center mb-2">
                <div className="p-3.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  <CheckCircle className="w-8 h-8" />
                </div>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold font-display tracking-tight text-[#191919] dark:text-[#F5F1E7]">
                Gemini Nano is installed and ready
              </h2>
              <p className="text-xs text-[#77776E] dark:text-[#A6A49B] max-w-sm mx-auto">
                Chrome's on-device AI model is fully downloaded and verified for local execution.
              </p>
            </div>

            {/* Badges */}
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2.5 rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/70 dark:bg-[#22231F]/70 text-center">
                <Shield className="w-4 h-4 mx-auto text-[#005447] dark:text-[#67E2C8] mb-1" />
                <div className="text-[11px] font-bold font-sans">100% Private</div>
                <div className="text-[9px] text-[#77776E] dark:text-[#A6A49B]">Zero cloud transit</div>
              </div>
              <div className="p-2.5 rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/70 dark:bg-[#22231F]/70 text-center">
                <Cpu className="w-4 h-4 mx-auto text-[#005447] dark:text-[#67E2C8] mb-1" />
                <div className="text-[11px] font-bold font-sans">On-Device</div>
                <div className="text-[9px] text-[#77776E] dark:text-[#A6A49B]">Local NPU / GPU</div>
              </div>
              <div className="p-2.5 rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/70 dark:bg-[#22231F]/70 text-center">
                <Sparkles className="w-4 h-4 mx-auto text-[#005447] dark:text-[#67E2C8] mb-1" />
                <div className="text-[11px] font-bold font-sans">Offline Ready</div>
                <div className="text-[9px] text-[#77776E] dark:text-[#A6A49B]">Works without net</div>
              </div>
            </div>

            {/* Navigation buttons */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={prevStep}
                className="flex-1 px-4 py-2.5 rounded-xl border border-[#DDDCCB] dark:border-[#373832] hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] text-xs font-semibold font-sans transition-colors flex items-center justify-center gap-1.5"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back
              </button>
              <button
                onClick={nextStep}
                className="flex-[2] px-4 py-2.5 rounded-xl bg-[#005447] hover:bg-[#007A64] text-white dark:bg-[#67E2C8] dark:text-[#171816] dark:hover:bg-[#2DD4BF] text-xs font-bold font-sans transition-colors flex items-center justify-center gap-1.5 shadow-sm"
              >
                Next: Set up Voice
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* State C: DOWNLOADABLE (READY TO INSTALL - ONE-CLICK) */}
        {modelState === 'downloadable' && (
          <div className="space-y-5">
            <div className="text-center space-y-2">
              <div className="flex justify-center mb-2">
                <div className="p-3.5 rounded-full bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#005447] dark:text-[#67E2C8] border border-[#DDDCCB] dark:border-[#373832]">
                  <Download className="w-7 h-7" />
                </div>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold font-display tracking-tight text-[#191919] dark:text-[#F5F1E7]">
                Your private AI is ready to install
              </h2>
              <p className="text-xs text-[#77776E] dark:text-[#A6A49B] max-w-sm mx-auto leading-relaxed">
                Pentone runs an on-device AI model (Gemini Nano) directly in Chrome. Your data never leaves your computer.
              </p>
            </div>

            {/* Feature Badges */}
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2.5 rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/70 dark:bg-[#22231F]/70 text-center">
                <Cpu className="w-4 h-4 mx-auto text-[#005447] dark:text-[#67E2C8] mb-1" />
                <div className="text-[11px] font-bold font-sans">On-device only</div>
                <div className="text-[9px] text-[#77776E] dark:text-[#A6A49B]">Runs in browser</div>
              </div>
              <div className="p-2.5 rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/70 dark:bg-[#22231F]/70 text-center">
                <Lock className="w-4 h-4 mx-auto text-[#005447] dark:text-[#67E2C8] mb-1" />
                <div className="text-[11px] font-bold font-sans">Private & offline</div>
                <div className="text-[9px] text-[#77776E] dark:text-[#A6A49B]">No cloud logging</div>
              </div>
              <div className="p-2.5 rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/70 dark:bg-[#22231F]/70 text-center">
                <Download className="w-4 h-4 mx-auto text-[#005447] dark:text-[#67E2C8] mb-1" />
                <div className="text-[11px] font-bold font-sans">~1.5 GB</div>
                <div className="text-[9px] text-[#77776E] dark:text-[#A6A49B]">One-time download</div>
              </div>
            </div>

            {/* Primary Action Button */}
            <div className="space-y-2 pt-1">
              <button
                onClick={handleStartDownload}
                className="w-full py-3 px-4 rounded-xl bg-[#005447] hover:bg-[#007A64] text-white dark:bg-[#67E2C8] dark:text-[#171816] dark:hover:bg-[#2DD4BF] text-sm font-bold font-sans transition-all flex items-center justify-center gap-2 shadow-sm"
              >
                <Download className="w-4 h-4" />
                Download AI Model
              </button>
              <p className="text-[10px] text-center text-[#77776E] dark:text-[#A6A49B]">
                Downloads directly from Google Chrome. No account or API key required.
              </p>
            </div>

            {/* Collapsible "Learn how it works" */}
            <div className="border border-[#DDDCCB] dark:border-[#373832] rounded-xl overflow-hidden bg-[#F3F1DF]/40 dark:bg-[#22231F]/40">
              <button
                onClick={() => setShowLearnMore(!showLearnMore)}
                className="w-full px-3 py-2 text-left text-xs font-semibold flex items-center justify-between text-[#77776E] dark:text-[#A6A49B] hover:text-[#191919] dark:hover:text-[#F5F1E7]"
              >
                <span>Learn how it works</span>
                {showLearnMore ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              {showLearnMore && (
                <div className="px-3 pb-3 pt-1 text-[11px] text-[#77776E] dark:text-[#A6A49B] space-y-2 border-t border-[#DDDCCB]/60 dark:border-[#373832]/60">
                  <p>
                    Chrome Built-in AI runs Gemini Nano directly on your hardware using WebGPU and direct CPU execution. 
                  </p>
                  <p>
                    Because processing occurs locally, your queries, page summaries, and browser interactions never travel over the network.
                  </p>
                </div>
              )}
            </div>

            {/* Navigation footer */}
            <div className="flex gap-3 pt-1">
              <button
                onClick={prevStep}
                className="flex-1 px-4 py-2.5 rounded-xl border border-[#DDDCCB] dark:border-[#373832] hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] text-xs font-semibold font-sans transition-colors flex items-center justify-center gap-1.5"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back
              </button>
              <button
                onClick={nextStep}
                className="flex-1 px-4 py-2.5 rounded-xl border border-[#DDDCCB] dark:border-[#373832] hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] text-xs font-semibold font-sans transition-colors flex items-center justify-center gap-1.5 text-[#77776E] dark:text-[#A6A49B]"
              >
                Set up Voice First
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* State D: DOWNLOADING (IN PROGRESS) */}
        {modelState === 'downloading' && (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <div className="flex justify-center mb-2">
                <div className="p-3.5 rounded-full bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#005447] dark:text-[#67E2C8] animate-bounce">
                  <Download className="w-7 h-7" />
                </div>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold font-display tracking-tight text-[#191919] dark:text-[#F5F1E7]">
                Downloading AI model from Google Chrome...
              </h2>
              <p className="text-xs text-[#77776E] dark:text-[#A6A49B] max-w-sm mx-auto">
                This takes 1–3 minutes depending on your connection. You can continue setting up Pentone while it downloads.
              </p>
            </div>

            {/* Progress Container */}
            <div className="p-4 rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/70 dark:bg-[#22231F]/70 space-y-3">
              <div className="flex justify-between items-center text-xs font-bold font-mono">
                <span className="text-[#005447] dark:text-[#67E2C8] flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Streaming Gemini Nano weights
                </span>
                <span>{downloadProgress}%</span>
              </div>
              {/* Progress bar */}
              <div className="w-full h-2.5 bg-[#DDDCCB] dark:bg-[#373832] rounded-full overflow-hidden">
                <div 
                  className="h-full bg-[#005447] dark:bg-[#67E2C8] transition-all duration-300 rounded-full"
                  style={{ width: `${Math.max(4, downloadProgress)}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-[#77776E] dark:text-[#A6A49B] font-mono">
                <span>Safe to navigate away</span>
                <span>Background download</span>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-2 pt-2">
              <button
                onClick={nextStep}
                className="w-full py-3 px-4 rounded-xl bg-[#005447] hover:bg-[#007A64] text-white dark:bg-[#67E2C8] dark:text-[#171816] dark:hover:bg-[#2DD4BF] text-xs font-bold font-sans transition-all flex items-center justify-center gap-2 shadow-sm"
              >
                Continue Setup (Set up Voice)
                <ArrowRight className="w-4 h-4" />
              </button>
              <p className="text-[10px] text-center text-[#77776E] dark:text-[#A6A49B]">
                Your microphone and Push-to-Talk work independently while the model downloads.
              </p>
            </div>
          </div>
        )}

        {/* State E: INITIALIZING */}
        {modelState === 'initializing' && (
          <div className="text-center py-12 space-y-4">
            <div className="inline-flex p-4 rounded-full bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#005447] dark:text-[#67E2C8]">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
            <h2 className="text-xl font-bold font-display">Preparing AI Model...</h2>
            <p className="text-xs text-[#77776E] dark:text-[#A6A49B] max-w-xs mx-auto">
              Verifying execution context and initializing local session...
            </p>
          </div>
        )}

        {/* State F: DOWNLOAD ERROR / TIMEOUT */}
        {modelState === 'error' && (
          <div className="space-y-5">
            <div className="text-center space-y-2">
              <div className="flex justify-center mb-2">
                <div className="p-3.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                  <AlertCircle className="w-7 h-7" />
                </div>
              </div>
              <h2 className="text-xl font-bold font-display tracking-tight text-[#191919] dark:text-[#F5F1E7]">
                AI Model Detection / Download Issue
              </h2>
              <p className="text-xs text-[#77776E] dark:text-[#A6A49B] max-w-sm mx-auto">
                {errorMessage || 'Chrome could not complete the operation. You can retry or proceed with voice setup.'}
              </p>
            </div>

            {/* Troubleshooting Drawer */}
            <div className="border border-[#DDDCCB] dark:border-[#373832] rounded-xl overflow-hidden bg-[#F3F1DF]/40 dark:bg-[#22231F]/40">
              <button
                onClick={() => setShowTroubleshooting(!showTroubleshooting)}
                className="w-full px-3 py-2 text-left text-xs font-semibold flex items-center justify-between text-[#77776E] dark:text-[#A6A49B] hover:text-[#191919] dark:hover:text-[#F5F1E7]"
              >
                <span>Troubleshooting options</span>
                {showTroubleshooting ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              {showTroubleshooting && (
                <div className="px-3 pb-3 pt-1 text-[11px] text-[#77776E] dark:text-[#A6A49B] space-y-2 border-t border-[#DDDCCB]/60 dark:border-[#373832]/60">
                  <p>
                    • <strong>Storage Prerequisite:</strong> Chrome requires at least <strong>22 GB of free space</strong> on the storage volume containing your Chrome profile data to download Gemini Nano. (Pentone's own bundled WASM/VAD assets require ~76 MB and Whisper ASR requires ~145 MB).{' '}
                    <a 
                      href="https://developer.chrome.com/docs/ai/prompt-api" 
                      target="_blank" 
                      rel="noreferrer"
                      className="text-[#005447] dark:text-[#67E2C8] underline inline-flex items-center gap-0.5"
                    >
                      Chrome AI Documentation <ExternalLink className="w-2.5 h-2.5 inline" />
                    </a>
                  </p>
                  <p>• Verify your device is connected to the internet for the initial one-time model download.</p>
                  <p>• If Chrome's AI component process stalled, restart Chrome via <code className="font-mono text-[10px]">chrome://restart</code>.</p>
                  <p>• On Chrome 138+ (including Chrome 156), Prompt API is built into Chrome for extensions. If your device has an integrated GPU or low VRAM, an override flag may be needed: <code className="font-mono text-[10px]">chrome://flags/#optimization-guide-on-device-model</code> (Enabled BypassPerfRequirement).</p>
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="space-y-2 pt-1">
              <button
                onClick={checkAvailability}
                className="w-full py-3 px-4 rounded-xl bg-[#005447] hover:bg-[#007A64] text-white dark:bg-[#67E2C8] dark:text-[#171816] dark:hover:bg-[#2DD4BF] text-xs font-bold font-sans transition-all flex items-center justify-center gap-2 shadow-sm"
              >
                <RefreshCw className="w-4 h-4" />
                Retry Check
              </button>
              <button
                onClick={nextStep}
                className="w-full py-2.5 px-4 rounded-xl border border-[#DDDCCB] dark:border-[#373832] hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] text-xs font-semibold font-sans transition-colors flex items-center justify-center gap-1.5 text-[#77776E] dark:text-[#A6A49B]"
              >
                Continue Setup with Voice Only
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* State G: UNSUPPORTED / FLAGS NEEDED */}
        {modelState === 'unsupported' && (
          <div className="space-y-5">
            <div className="text-center space-y-2">
              <div className="flex justify-center mb-2">
                <div className="p-3.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                  <AlertCircle className="w-7 h-7" />
                </div>
              </div>
              <h2 className="text-xl font-bold font-display tracking-tight text-[#191919] dark:text-[#F5F1E7]">
                Chrome Built-in AI Activation
              </h2>
              <p className="text-xs text-[#77776E] dark:text-[#A6A49B] max-w-sm mx-auto leading-relaxed">
                {chromeVersion && chromeVersion < 128
                  ? `Installed Chrome (v${chromeVersion}) is below minimum requirement (v128+). Please update Chrome.`
                  : 'On Chrome 138+ (including Chrome 156), Prompt API is built-in. If LanguageModel is not detected or reports unavailable on your system, verify GPU acceleration or check the flags below.'}
              </p>
            </div>

            <div className="p-3.5 rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/70 dark:bg-[#22231F]/70 text-xs space-y-2.5">
              <div className="font-semibold text-xs text-[#191919] dark:text-[#F5F1E7]">
                Troubleshooting & Activation Options:
              </div>
              <ol className="list-decimal list-inside space-y-1.5 text-[11px] text-[#77776E] dark:text-[#A6A49B]">
                <li>Click <strong>Prompt API Flag</strong> below to verify the feature flag is set to <strong>Enabled</strong>.</li>
                <li>If using an integrated or lower-tier GPU, click <strong>BypassPerf Flag</strong> and set <strong>Optimization Guide On-Device Model</strong> to <strong>Enabled BypassPerfRequirement</strong>.</li>
                <li>Restart Chrome using the <strong>Relaunch</strong> button at the bottom of the flags page.</li>
                <li>Return here and click <strong>Re-check compatibility</strong>.</li>
              </ol>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={openAIFlagsPage}
                className="px-3 py-2.5 rounded-xl border border-[#DDDCCB] dark:border-[#373832] hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] text-xs font-semibold font-sans transition-colors flex items-center justify-center gap-1.5"
                title="Opens chrome://flags/#prompt-api-for-gemini-nano in a new tab"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Prompt API Flag
              </button>
              <button
                onClick={openOptimizationGuideFlagsPage}
                className="px-3 py-2.5 rounded-xl border border-[#DDDCCB] dark:border-[#373832] hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] text-xs font-semibold font-sans transition-colors flex items-center justify-center gap-1.5"
                title="Opens chrome://flags/#optimization-guide-on-device-model in a new tab"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                BypassPerf Flag
              </button>
            </div>

            <div className="pt-1 flex gap-2">
              <button
                onClick={checkAvailability}
                className="flex-1 py-2.5 px-4 rounded-xl bg-[#005447] hover:bg-[#007A64] text-white dark:bg-[#67E2C8] dark:text-[#171816] dark:hover:bg-[#2DD4BF] text-xs font-bold font-sans transition-colors flex items-center justify-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Re-check compatibility
              </button>
              <button
                onClick={nextStep}
                className="flex-1 py-2.5 px-4 rounded-xl border border-[#DDDCCB] dark:border-[#373832] hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] text-xs font-semibold font-sans transition-colors flex items-center justify-center gap-1.5 text-[#77776E] dark:text-[#A6A49B]"
              >
                Continue with Voice Only
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* System Compatibility & Capability Readiness Checker */}
        <div className="pt-3 border-t border-[#DDDCCB]/60 dark:border-[#373832]/60">
          <button
            onClick={() => setShowOptionalAPIs(!showOptionalAPIs)}
            className="w-full flex items-center justify-between text-[11px] font-semibold text-[#77776E] dark:text-[#A6A49B] hover:text-[#191919] dark:hover:text-[#F5F1E7] transition-colors py-1.5"
          >
            <span className="flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8]" />
              System Readiness & Chrome Capabilities {chromeVersion ? `(Chrome v${chromeVersion})` : ''}
            </span>
            {showOptionalAPIs ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          
          {showOptionalAPIs && (
            <div className="space-y-2 mt-2 pt-1 font-sans">
              {/* Capability Grid */}
              <div className="space-y-1.5 text-[11px]">
                {/* 1. Prompt API / Gemini Nano (Core) */}
                <div className="p-2 rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/50 dark:bg-[#22231F]/50 flex items-center justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="font-semibold text-xs text-[#191919] dark:text-[#F5F1E7]">Gemini Nano (Prompt API)</span>
                    <span className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">
                      {modelState === 'ready' 
                        ? 'Model weights loaded & session initialized' 
                        : modelState === 'downloadable' 
                          ? 'Model available from Chrome; one-click download ready' 
                          : modelState === 'downloading'
                            ? `Streaming model weights (${downloadProgress}%)`
                            : modelState === 'checking'
                              ? 'Probing Prompt API availability...'
                              : 'Built-in in Chrome 138+; verify hardware acceleration or flags'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {modelState === 'ready' ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                        <CheckCircle className="w-2.5 h-2.5" /> READY
                      </span>
                    ) : modelState === 'downloadable' ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center gap-1">
                        <Download className="w-2.5 h-2.5" /> DOWNLOADABLE
                      </span>
                    ) : modelState === 'downloading' ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center gap-1">
                        <Loader2 className="w-2.5 h-2.5 animate-spin" /> DOWNLOADING ({downloadProgress}%)
                      </span>
                    ) : modelState === 'checking' ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#DDDCCB] dark:bg-[#373832] text-[#77776E] dark:text-[#A6A49B] flex items-center gap-1">
                        <Loader2 className="w-2.5 h-2.5 animate-spin" /> CHECKING
                      </span>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center gap-1">
                          <AlertCircle className="w-2.5 h-2.5" /> ACTION REQUIRED
                        </span>
                        <button
                          onClick={openAIFlagsPage}
                          className="px-1.5 py-0.5 rounded text-[10px] font-medium border border-[#DDDCCB] dark:border-[#373832] hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] text-[#005447] dark:text-[#67E2C8] flex items-center gap-0.5"
                          title="Open chrome://flags/#prompt-api-for-gemini-nano in a new tab"
                        >
                          Flag <ExternalLink className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* 2. Optional: Summarizer API */}
                <div className="p-2 rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/50 dark:bg-[#22231F]/50 flex items-center justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="font-semibold text-xs text-[#191919] dark:text-[#F5F1E7]">Summarizer API (Optional)</span>
                    <span className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">
                      {optionalAPIs.summarizer === 'available' ? 'Summarization ready (falls back to Gemini Nano)' : 'Page summarization (falls back to Gemini Nano)'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {optionalAPIs.summarizer === 'available' ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                        <CheckCircle className="w-2.5 h-2.5" /> READY
                      </span>
                    ) : optionalAPIs.summarizer === 'downloadable' ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center gap-1">
                        <Download className="w-2.5 h-2.5" /> DOWNLOADABLE
                      </span>
                    ) : optionalAPIs.summarizer === 'downloading' ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center gap-1">
                        <Loader2 className="w-2.5 h-2.5 animate-spin" /> DOWNLOADING
                      </span>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#DDDCCB] dark:bg-[#373832] text-[#77776E] dark:text-[#A6A49B]">
                          OPTIONAL
                        </span>
                        <button
                          onClick={openSummarizationAPIFlagsPage}
                          className="px-1.5 py-0.5 rounded text-[10px] font-medium border border-[#DDDCCB] dark:border-[#373832] hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] text-[#77776E] dark:text-[#A6A49B] flex items-center gap-0.5"
                          title="Open chrome://flags/#summarization-api-for-gemini-nano in a new tab"
                        >
                          Flag <ExternalLink className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* 3. Optional: Writer API */}
                <div className="p-2 rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/50 dark:bg-[#22231F]/50 flex items-center justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="font-semibold text-xs text-[#191919] dark:text-[#F5F1E7]">Writer API (Optional)</span>
                    <span className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">
                      {optionalAPIs.writer === 'available' ? 'Drafting tool ready (falls back to Gemini Nano)' : 'Drafting assistant (falls back to Gemini Nano)'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {optionalAPIs.writer === 'available' ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                        <CheckCircle className="w-2.5 h-2.5" /> READY
                      </span>
                    ) : optionalAPIs.writer === 'downloadable' ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center gap-1">
                        <Download className="w-2.5 h-2.5" /> DOWNLOADABLE
                      </span>
                    ) : optionalAPIs.writer === 'downloading' ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center gap-1">
                        <Loader2 className="w-2.5 h-2.5 animate-spin" /> DOWNLOADING
                      </span>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#DDDCCB] dark:bg-[#373832] text-[#77776E] dark:text-[#A6A49B]">
                          OPTIONAL
                        </span>
                        <button
                          onClick={openWriterAPIFlagsPage}
                          className="px-1.5 py-0.5 rounded text-[10px] font-medium border border-[#DDDCCB] dark:border-[#373832] hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] text-[#77776E] dark:text-[#A6A49B] flex items-center gap-0.5"
                          title="Open chrome://flags/#writer-api-for-gemini-nano in a new tab"
                        >
                          Flag <ExternalLink className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* 4. Optional: Rewriter API */}
                <div className="p-2 rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/50 dark:bg-[#22231F]/50 flex items-center justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="font-semibold text-xs text-[#191919] dark:text-[#F5F1E7]">Rewriter API (Optional)</span>
                    <span className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">
                      {optionalAPIs.rewriter === 'available' ? 'Rewriting tool ready (falls back to Gemini Nano)' : 'Text rephrasing (falls back to Gemini Nano)'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {optionalAPIs.rewriter === 'available' ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                        <CheckCircle className="w-2.5 h-2.5" /> READY
                      </span>
                    ) : optionalAPIs.rewriter === 'downloadable' ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center gap-1">
                        <Download className="w-2.5 h-2.5" /> DOWNLOADABLE
                      </span>
                    ) : optionalAPIs.rewriter === 'downloading' ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center gap-1">
                        <Loader2 className="w-2.5 h-2.5 animate-spin" /> DOWNLOADING
                      </span>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#DDDCCB] dark:bg-[#373832] text-[#77776E] dark:text-[#A6A49B]">
                          OPTIONAL
                        </span>
                        <button
                          onClick={openRewriterAPIFlagsPage}
                          className="px-1.5 py-0.5 rounded text-[10px] font-medium border border-[#DDDCCB] dark:border-[#373832] hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] text-[#77776E] dark:text-[#A6A49B] flex items-center gap-0.5"
                          title="Open chrome://flags/#rewriter-api-for-gemini-nano in a new tab"
                        >
                          Flag <ExternalLink className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* 5. Optional: Translator API */}
                <div className="p-2 rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/50 dark:bg-[#22231F]/50 flex items-center justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="font-semibold text-xs text-[#191919] dark:text-[#F5F1E7]">Translator API (Optional)</span>
                    <span className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">
                      {optionalAPIs.translator === 'available' ? 'Translation model ready' : 'On-device language translation'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {optionalAPIs.translator === 'available' ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                        <CheckCircle className="w-2.5 h-2.5" /> READY
                      </span>
                    ) : optionalAPIs.translator === 'downloadable' ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center gap-1">
                        <Download className="w-2.5 h-2.5" /> DOWNLOADABLE
                      </span>
                    ) : optionalAPIs.translator === 'downloading' ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center gap-1">
                        <Loader2 className="w-2.5 h-2.5 animate-spin" /> DOWNLOADING
                      </span>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#DDDCCB] dark:bg-[#373832] text-[#77776E] dark:text-[#A6A49B]">
                          OPTIONAL
                        </span>
                        <button
                          onClick={openTranslatorAPIFlagsPage}
                          className="px-1.5 py-0.5 rounded text-[10px] font-medium border border-[#DDDCCB] dark:border-[#373832] hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] text-[#77776E] dark:text-[#A6A49B] flex items-center gap-0.5"
                          title="Open chrome://flags/#translation-api in a new tab"
                        >
                          Flag <ExternalLink className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* 6. Optional: Language Detector API */}
                <div className="p-2 rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/50 dark:bg-[#22231F]/50 flex items-center justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="font-semibold text-xs text-[#191919] dark:text-[#F5F1E7]">Language Detector API (Optional)</span>
                    <span className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">
                      {optionalAPIs.languageDetector === 'available' ? 'Language detector ready' : 'On-device language detection'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {optionalAPIs.languageDetector === 'available' ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                        <CheckCircle className="w-2.5 h-2.5" /> READY
                      </span>
                    ) : optionalAPIs.languageDetector === 'downloadable' ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center gap-1">
                        <Download className="w-2.5 h-2.5" /> DOWNLOADABLE
                      </span>
                    ) : optionalAPIs.languageDetector === 'downloading' ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center gap-1">
                        <Loader2 className="w-2.5 h-2.5 animate-spin" /> DOWNLOADING
                      </span>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#DDDCCB] dark:bg-[#373832] text-[#77776E] dark:text-[#A6A49B]">
                          OPTIONAL
                        </span>
                        <button
                          onClick={openLanguageDetectorAPIFlagsPage}
                          className="px-1.5 py-0.5 rounded text-[10px] font-medium border border-[#DDDCCB] dark:border-[#373832] hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] text-[#77776E] dark:text-[#A6A49B] flex items-center gap-0.5"
                          title="Open chrome://flags/#language-detection-api in a new tab"
                        >
                          Flag <ExternalLink className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* 7. Microphone Permission */}
                <div className="p-2 rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/50 dark:bg-[#22231F]/50 flex items-center justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="font-semibold text-xs text-[#191919] dark:text-[#F5F1E7]">Microphone Permission</span>
                    <span className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">Browser audio capture for voice and PTT</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {micPermission === 'granted' ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                        <CheckCircle className="w-2.5 h-2.5" /> READY
                      </span>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center gap-1">
                          <AlertCircle className="w-2.5 h-2.5" /> ACTION REQUIRED
                        </span>
                        <button
                          onClick={handleGrantMicPermission}
                          className="px-1.5 py-0.5 rounded text-[10px] font-medium border border-[#DDDCCB] dark:border-[#373832] hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] text-[#005447] dark:text-[#67E2C8] flex items-center gap-0.5"
                          title="Grant microphone permission"
                        >
                          Grant <ExternalLink className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* 8. Extension Core Permissions & Bundled Assets */}
                <div className="p-2 rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/50 dark:bg-[#22231F]/50 flex items-center justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="font-semibold text-xs text-[#191919] dark:text-[#F5F1E7]">Extension Permissions & Assets</span>
                    <span className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">tabs, activeTab, storage, & bundled WASM (~76 MB)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {extensionPermissions && bundledAssetsReady ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                        <CheckCircle className="w-2.5 h-2.5" /> READY
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center gap-1">
                        <AlertCircle className="w-2.5 h-2.5" /> ACTION REQUIRED
                      </span>
                    )}
                  </div>
                </div>

              </div>

              {/* Re-check Button */}
              <div className="pt-1 flex justify-end">
                <button
                  onClick={checkAvailability}
                  className="px-3 py-1.5 rounded-lg border border-[#DDDCCB] dark:border-[#373832] hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] text-[11px] font-semibold text-[#005447] dark:text-[#67E2C8] flex items-center gap-1.5 transition-colors"
                >
                  <RefreshCw className={`w-3 h-3 ${modelState === 'checking' ? 'animate-spin' : ''}`} />
                  Re-check compatibility
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
