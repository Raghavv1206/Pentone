import React, { useMemo, useState, useEffect, useRef } from "react"
import { 
  Mic, Square, Paperclip, X, ShieldCheck, 
  Volume2, VolumeX, AlertTriangle, Loader2, Sparkles, ArrowRight, RefreshCw,
  Cpu, Download, CheckCircle2
} from "lucide-react"
import { useVoiceInput } from "../lib/use-voice-input"
import { useFullDuplexVoice } from "../lib/audio/use-full-duplex-voice"
import { WhisperASRService } from "../lib/audio/whisper-asr-service"
import { loadSettings } from "../lib/settings"
import { voiceDiagnosticTracker, type TurnDiagnosticRecord } from "../lib/audio/voice-diagnostic-tracker"
import { useChatContext } from "../lib/chat-context"
import { useTTS } from "../lib/tts-context"
import { useSoundEffects } from "../lib/use-sound-effects"
import { useOnboarding } from "../components/onboarding/onboarding-provider"
import { OnboardingFlow } from "../components/onboarding/onboarding-flow"
import { OnboardingRedirect } from "../components/onboarding/onboarding-redirect"
import { MicSelector } from "../components/mic-selector"
import { VoiceSelector } from "../components/voice-selector"
import { Waveform } from "../components/waveform"
import { RatingButtons } from "../components/rating-buttons"
import { AppHeader } from "../components/navigation/app-header"
import { parseToolCall } from "../lib/tools"
import { stripInternalReasoning, getFriendlyActionStatus } from "../lib/reasoning-sanitizer"
import { getCompleteSentences } from "../lib/sentence-parser"
import { embedFiles } from "../lib/file-embedder"
import { type Screen } from "../lib/config"
import { subscribeToModelDownload, getModelDownloadState, type ModelDownloadState } from "../lib/ai-config"
import { isModelReady, preloadSession } from "../lib/ai"
import { generativeRuntime, type ModelRuntimeState } from "../lib/generative-runtime"
import { useModelProvisioning } from "../lib/model-provisioning-context"

interface MainScreenProps {
  onNavigateToDebug: () => void
  onNavigateToSettings: () => void
  onNavigate?: (screen: Screen) => void
  fullHeight?: boolean
}

export const MainScreen = ({ 
  onNavigateToDebug, 
  onNavigateToSettings, 
  onNavigate,
  fullHeight = false 
}: MainScreenProps) => {
  const { state: onboardingState, isPopup } = useOnboarding()
  const { isListening, transcript, handleMicClick } = useVoiceInput()
  const fullDuplex = useFullDuplexVoice()
  const [voiceModel, setVoiceModel] = useState<'push_to_talk' | 'wake_word' | 'full_duplex'>('push_to_talk')

  useEffect(() => {
    loadSettings().then(s => {
      if (s.voiceInteractionModel) {
        setVoiceModel(s.voiceInteractionModel as any)
      }
    })

    const listener = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName === 'local' && (changes.pentone_settings?.newValue || changes.marionette_settings?.newValue)) {
        const s = changes.pentone_settings?.newValue || changes.marionette_settings?.newValue
        if (s.voiceInteractionModel) {
          setVoiceModel(s.voiceInteractionModel as any)
        }
      }
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [])

  const { state, sendMessage, resetChat, rateMessage, isInitialLoadComplete, interruptChat, dispatch } = useChatContext()
  const { handleNewText, stop, currentSentence, isSpeaking, audioEnabled, setAudioEnabled } = useTTS()
  const soundEffects = useSoundEffects()
  const [textInput, setTextInput] = useState("")
  const [latestVoiceTurn, setLatestVoiceTurn] = useState<TurnDiagnosticRecord | null>(null)
  const modelProv = useModelProvisioning()
  const [modelDownload, setModelDownload] = useState<ModelDownloadState>(getModelDownloadState())
  const [engineState, setEngineState] = useState<ModelRuntimeState>(generativeRuntime.getState())

  // Core model files presence and integrity verification in CacheStorage
  const isCoreProvisioned = Boolean(
    modelProv.modelsCached?.qwen && 
    modelProv.modelsCached?.embeddings && 
    modelProv.modelsCached?.whisper
  )

  // Track Whisper ASR and text model runtime readiness in memory
  const [isWhisperReady, setIsWhisperReady] = useState(() => WhisperASRService.getInstance().isReady())
  const [isTextModelReady, setIsTextModelReady] = useState(() => isModelReady() || generativeRuntime.isModelResident())

  useEffect(() => {
    const checkRuntimes = () => {
      const whisperOk = WhisperASRService.getInstance().isReady()
      const textOk = isModelReady() || generativeRuntime.isModelResident()
      setIsWhisperReady(whisperOk)
      setIsTextModelReady(textOk)
    }
    checkRuntimes()
    const timer = setInterval(checkRuntimes, 1000)
    return () => clearInterval(timer)
  }, [])

  // Capability-specific runtime readiness:
  // Text runtime: SmolLM resident in Web Worker/pipeline and ready, or active Prompt API session
  const isTextRuntimeReady = Boolean(
    (isCoreProvisioned && generativeRuntime.isModelResident() && (engineState.status === 'ready' || engineState.status === 'generating')) ||
    isTextModelReady ||
    isModelReady()
  )

  // Voice runtime: text model ready AND Whisper ASR model cached and initialized in memory
  const isVoiceRuntimeReady = Boolean(
    isTextRuntimeReady &&
    (isWhisperReady || WhisperASRService.getInstance().isReady())
  )

  // Explicit core readiness: provisioned in cache AND both text and voice runtimes ready
  const isCoreReady = Boolean(isCoreProvisioned && isTextRuntimeReady && isVoiceRuntimeReady)

  // Track auto-preloading on extension startup
  const [isAutoPreloading, setIsAutoPreloading] = useState(false)
  const autoPreloadTriggeredRef = useRef(false)

  // Model loading state: active if chat state is warming up or auto-preloading until runtimes are fully ready
  const isModelLoading = Boolean(state.isWarmingUp || isAutoPreloading)

  // Automatically preload and warm up models on extension open
  useEffect(() => {
    if (autoPreloadTriggeredRef.current) return

    // If both runtimes are already resident and active, mark ready and return
    if (isModelReady() && WhisperASRService.getInstance().isReady()) {
      setIsWhisperReady(true)
      setIsTextModelReady(true)
      return
    }

    autoPreloadTriggeredRef.current = true
    setIsAutoPreloading(true)
    dispatch({ type: 'SET_WARMING_UP', payload: true })
    console.log('[MainScreen] Automatically preloading models on extension open...')

    const finishPreload = () => {
      const whisperOk = WhisperASRService.getInstance().isReady()
      const textOk = isModelReady() || generativeRuntime.isModelResident()
      setIsWhisperReady(whisperOk)
      setIsTextModelReady(textOk)
      setIsAutoPreloading(false)
      dispatch({ type: 'SET_WARMING_UP', payload: false })
    }

    // Generous safety timeout: never leave UI in warm-up state past 30 seconds
    const safetyTimer = setTimeout(() => {
      console.log('[MainScreen] Preload safety timeout reached; releasing warmup state.')
      finishPreload()
    }, 30000)

    Promise.allSettled([
      preloadSession({
        onWarmingUp: () => dispatch({ type: 'SET_WARMING_UP', payload: true }),
        onWarmupComplete: () => { setIsTextModelReady(true) }
      }),
      WhisperASRService.getInstance().initialize().catch((err) => {
        console.warn('[MainScreen] Whisper auto-preload warning:', err?.message)
      })
    ]).then(() => {
      clearTimeout(safetyTimer)
      console.log('[MainScreen] Models automatically loaded and ready.')
      finishPreload()
    }).catch((err) => {
      clearTimeout(safetyTimer)
      console.warn('[MainScreen] Model auto-preload notice:', err)
      finishPreload()
    })

    return () => clearTimeout(safetyTimer)
  }, [dispatch])

  useEffect(() => {
    const unsub = generativeRuntime.subscribe((st) => {
      setEngineState({ ...st })
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    const unsub = subscribeToModelDownload((st) => {
      setModelDownload({ ...st })
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    const turns = voiceDiagnosticTracker.getRecentTurns()
    if (turns.length > 0) {
      setLatestVoiceTurn(turns[0])
    }
    const unsubscribe = voiceDiagnosticTracker.subscribe((rec) => {
      setLatestVoiceTurn({ ...rec })
    })
    return () => {
      unsubscribe()
    }
  }, [])
  
  // Track last spoken assistant message to avoid replaying
  const lastSpokenTextRef = useRef<string>('')
  const wasSpeakingRef = useRef(false)
  
  // Track last displayed sentence to keep showing it when queue empties
  const [lastDisplayedSentence, setLastDisplayedSentence] = useState<string>('')
  
  // File embedder state
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [isEmbedding, setIsEmbedding] = useState(false)
  const [embedSuccess, setEmbedSuccess] = useState<string | null>(null)
  const dragCounterRef = useRef(0)
  
  // Get latest context count
  const latestContextCount = useMemo(() => {
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const msg = state.messages[i]
      if (msg.contextCount !== undefined) {
        return msg.contextCount
      }
    }
    return 0
  }, [state.messages])
  
  // Mark initial load complete and record existing assistant messages
  useEffect(() => {
    if (isInitialLoadComplete && lastSpokenTextRef.current === '') {
      for (let i = state.messages.length - 1; i >= 0; i--) {
        const msg = state.messages[i]
        if (
          msg.role === 'assistant' && 
          !msg.isInternal && 
          !msg.content.startsWith('[TOOL RESULT]') &&
          !msg.content.startsWith('[CONTEXT SUMMAR') &&
          !msg.content.startsWith('[INTERRUPTED]')
        ) {
          const textBeforeToolCall = msg.content.split('<function_call>')[0].trim()
          const cleanText = stripInternalReasoning(textBeforeToolCall || msg.content)
          const text = getCompleteSentences(cleanText)
          lastSpokenTextRef.current = text
          break
        }
      }
    }
  }, [isInitialLoadComplete, state.messages.length])

  // Get latest assistant message that's not a tool result
  const latestResponse = useMemo(() => {
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const msg = state.messages[i]
      if (
        msg.role === 'assistant' && 
        !msg.isInternal && 
        msg.messageType !== 'summary' &&
        msg.messageType !== 'tool_result' &&
        msg.messageType !== 'status' &&
        msg.messageType !== 'error' &&
        !msg.content.startsWith('[TOOL RESULT]') &&
        !msg.content.startsWith('[TOOL RECOVERY') &&
        !msg.content.startsWith('[CONTEXT SUMMAR') &&
        !msg.content.startsWith('[INTERRUPTED]') &&
        !msg.content.startsWith('Error:')
      ) {
        const toolCall = parseToolCall(msg.content)
        const isThinkTool = toolCall?.function === 'think'
        const effectiveToolCall = isThinkTool ? null : toolCall
        
        let contentToSplit = msg.content
        const codeBlockMatch = contentToSplit.match(/```(?:tool_code|tool_call|function_call|json)\s*\n?(.*?)```/s)
        if (codeBlockMatch) {
          contentToSplit = codeBlockMatch[1]
        }
        
        const rawTextBefore = contentToSplit.split('<function_call>')[0].trim()
        const cleanTextBefore = stripInternalReasoning(rawTextBefore)
        const cleanFull = stripInternalReasoning(msg.content)
        
        let displayText = cleanTextBefore
        if (!displayText && msg.content.includes('<function_call>')) {
          displayText = ''
        } else if (!displayText && !effectiveToolCall) {
          displayText = cleanFull
        }
        
        return {
          id: msg.id,
          text: displayText ? getCompleteSentences(displayText) : '',
          toolCall: effectiveToolCall,
          spokenLine: effectiveToolCall ? getFriendlyActionStatus(effectiveToolCall.function, effectiveToolCall.arguments) : null,
          rating: msg.rating
        }
      }
    }
    return { id: '', text: '', toolCall: null, spokenLine: null, rating: null }
  }, [state.messages])

  // TTS effect
  useEffect(() => {
    if (!isInitialLoadComplete) return
    if (latestResponse.text === lastSpokenTextRef.current) return
    
    if (latestResponse.text) {
      lastSpokenTextRef.current = latestResponse.text
      handleNewText(latestResponse.text)
    } else if (latestResponse.spokenLine) {
      lastSpokenTextRef.current = latestResponse.spokenLine
      handleNewText(latestResponse.spokenLine, true)
    }
  }, [isInitialLoadComplete, latestResponse.text, latestResponse.spokenLine, handleNewText])

  useEffect(() => {
    if (currentSentence) {
      setLastDisplayedSentence(currentSentence)
    }
  }, [currentSentence])

  useEffect(() => {
    if (wasSpeakingRef.current && !isSpeaking && !state.isProcessing && audioEnabled) {
      if (latestResponse.text || latestResponse.spokenLine) {
        soundEffects.play('warmup')
      }
    }
    wasSpeakingRef.current = isSpeaking
  }, [isSpeaking, state.isProcessing, latestResponse.text, latestResponse.spokenLine, audioEnabled, soundEffects])

  const isFullDuplexActive = voiceModel === 'full_duplex' && fullDuplex.isFullDuplexEnabled
  const isFullDuplexListening = isFullDuplexActive && (fullDuplex.voiceState === 'LISTENING' || fullDuplex.voiceState === 'USER_SPEAKING')
  const isPttListening = voiceModel === 'push_to_talk' && (fullDuplex.pttState === 'LISTENING' || fullDuplex.pttState === 'RECORDING' || fullDuplex.pttState === 'PRESS_PENDING')
  const isPttProcessing = voiceModel === 'push_to_talk' && (fullDuplex.pttState === 'PROCESSING' || fullDuplex.pttState === 'FINALIZING' || fullDuplex.pttState === 'TRANSCRIBING')
  const isPttExecuting = voiceModel === 'push_to_talk' && fullDuplex.pttState === 'EXECUTING'

  const waveformState = (isListening || isFullDuplexListening || isPttListening)
    ? 'listening'
    : (isSpeaking || (isFullDuplexActive && fullDuplex.voiceState === 'ASSISTANT_SPEAKING'))
    ? 'speaking'
    : state.isSummarizing
    ? 'summarizing'
    : isModelLoading
    ? 'warming'
    : (state.executingTool || isPttExecuting)
    ? 'tool'
    : (state.isProcessing || (isFullDuplexActive && fullDuplex.voiceState === 'PROCESSING') || isPttProcessing)
    ? 'thinking'
    : 'idle'

  // Push-to-Talk keyboard shortcuts: Spacebar (hold to talk) & Escape (cancel)
  useEffect(() => {
    if (voiceModel !== 'push_to_talk') return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isModelLoading) return
      if (e.code === 'Escape') {
        fullDuplex.cancelPtt('User pressed Escape')
      } else {
        fullDuplex.handleKeyDown(e)
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      fullDuplex.handleKeyUp(e)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [voiceModel, fullDuplex.handleKeyDown, fullDuplex.handleKeyUp, fullDuplex.cancelPtt])

  // Safeguards: Handle pointer release, lost capture, window blur, and document visibility loss
  useEffect(() => {
    if (voiceModel !== 'push_to_talk') return

    const handleGlobalPointerUp = () => {
      fullDuplex.stopPtt('pointer')
    }

    const handleBlur = () => {
      fullDuplex.handleBlurOrVisibilityChange(true)
    }

    const handleVisibilityChange = () => {
      if (document.hidden) {
        fullDuplex.handleBlurOrVisibilityChange(true)
      }
    }

    window.addEventListener('pointerup', handleGlobalPointerUp)
    window.addEventListener('pointercancel', handleGlobalPointerUp)
    window.addEventListener('mouseup', handleGlobalPointerUp)
    window.addEventListener('touchend', handleGlobalPointerUp)
    window.addEventListener('blur', handleBlur)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('pointerup', handleGlobalPointerUp)
      window.removeEventListener('pointercancel', handleGlobalPointerUp)
      window.removeEventListener('mouseup', handleGlobalPointerUp)
      window.removeEventListener('touchend', handleGlobalPointerUp)
      window.removeEventListener('blur', handleBlur)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [voiceModel, fullDuplex.stopPtt, fullDuplex.handleBlurOrVisibilityChange])

  const getTextColor = (state: typeof waveformState) => {
    switch (state) {
      case 'listening': return 'text-rose-500 font-medium'
      case 'speaking': return 'text-[#005447] dark:text-[#67E2C8] font-medium'
      case 'warming': return 'text-amber-500 font-medium'
      case 'thinking': return 'text-indigo-500 dark:text-indigo-400 font-medium'
      case 'tool': return 'text-[#CDB0F3] font-medium'
      case 'summarizing': return 'text-amber-500 font-medium'
      case 'idle': return 'text-[#77776E] dark:text-[#A6A49B]'
      default: return 'text-[#191919] dark:text-[#F5F1E7]'
    }
  }

  const handleTextSubmit = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && textInput.trim()) {
      if (state.isProcessing || isSpeaking) {
        handleInterrupt()
      }
      
      const input = textInput.trim()
      setTextInput("")
      await sendMessage(input)
    }
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDraggingFiles(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDraggingFiles(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    setIsDraggingFiles(false)
    dragCounterRef.current = 0
    if (isEmbedding) return
    
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return
    
    setIsEmbedding(true)
    try {
      const results = await embedFiles(files)
      const successCount = results.filter(r => r.success).length
      if (successCount > 0) {
        setEmbedSuccess(`Embedded ${successCount} file${successCount > 1 ? 's' : ''}`)
        setTimeout(() => setEmbedSuccess(null), 3000)
      }
    } catch (error) {
      console.error('Error embedding files:', error)
    } finally {
      setIsEmbedding(false)
    }
  }

  const handleOpenSidePanel = async () => {
    try {
      await chrome.sidePanel.open({ windowId: (await chrome.windows.getCurrent()).id })
      window.close()
    } catch (error) {
      console.error('Failed to open sidepanel:', error)
    }
  }

  const handleInterrupt = () => {
    stop()
    interruptChat()
    soundEffects.stopAll()
  }

  const handleWaveformClick = () => {
    if (state.isSummarizing || isModelLoading) return
    if (state.isProcessing || isSpeaking || (voiceModel === 'full_duplex' && fullDuplex.voiceState === 'ASSISTANT_SPEAKING')) {
      handleInterrupt()
      return
    }

    soundEffects.play('listening')
    if (voiceModel === 'full_duplex') {
      fullDuplex.toggleVoiceMode()
    } else {
      handleMicClick()
    }
  }

  const handleNavigation = (screen: Screen) => {
    if (onNavigate) {
      onNavigate(screen)
    } else if (screen === 'settings') {
      onNavigateToSettings()
    } else if (screen === 'diagnostics' || screen === 'debug') {
      onNavigateToDebug()
    }
  }

  const computedStatusDot: 'ready' | 'listening' | 'processing' | 'error' | 'downloading' | 'initializing' = useMemo(() => {
    // 1. Explicit error states
    if (
      engineState.status === 'error' || 
      fullDuplex.pttState === 'ERROR' ||
      modelProv.progress.state === 'failed' ||
      Boolean(modelProv.progress.error)
    ) {
      return 'error'
    }

    // 2. Active voice listening
    if (
      (voiceModel === 'push_to_talk' && (fullDuplex.pttState === 'LISTENING' || fullDuplex.pttState === 'RECORDING' || fullDuplex.pttState === 'PRESS_PENDING')) ||
      isListening ||
      (voiceModel === 'full_duplex' && fullDuplex.isFullDuplexEnabled && (fullDuplex.voiceState === 'LISTENING' || fullDuplex.voiceState === 'USER_SPEAKING'))
    ) {
      return 'listening'
    }

    // 3. Active processing, transcription, or generation
    if (
      state.isProcessing || 
      fullDuplex.pttState === 'PROCESSING' || 
      fullDuplex.pttState === 'EXECUTING' || 
      fullDuplex.pttState === 'TRANSCRIBING' || 
      fullDuplex.pttState === 'FINALIZING' || 
      engineState.status === 'generating' || 
      engineState.status === 'recovering' ||
      (voiceModel === 'full_duplex' && fullDuplex.isFullDuplexEnabled && (fullDuplex.voiceState === 'PROCESSING' || fullDuplex.voiceState === 'ASSISTANT_SPEAKING'))
    ) {
      return 'processing'
    }

    // 4. Model downloading in progress
    if (
      modelProv.progress.state === 'downloading' || 
      modelDownload.status === 'downloading' || 
      engineState.status === 'downloading'
    ) {
      return 'downloading'
    }

    // 5. Explicit voice runtime readiness (both text model and Whisper ASR resident and verified)
    if (isVoiceRuntimeReady) {
      return 'ready'
    }

    // 5b. Core text runtime ready and auto-preloading finished (e.g. ready for text interaction or Web Speech fallback)
    if (isTextRuntimeReady && !isModelLoading) {
      return 'ready'
    }

    // 5c. Core models provisioned in cache and auto-preloading complete
    if (isCoreProvisioned && !isModelLoading) {
      return 'ready'
    }

    // 6. Explicit initializing / setup-required fallback (unprovisioned, models verifying, or runtimes warming up)
    return 'initializing'
  }, [
    engineState.status,
    fullDuplex.pttState,
    fullDuplex.voiceState,
    fullDuplex.isFullDuplexEnabled,
    modelProv.progress.state,
    modelProv.progress.error,
    voiceModel,
    isListening,
    state.isProcessing,
    modelDownload.status,
    isVoiceRuntimeReady,
    isTextRuntimeReady,
    isModelLoading,
    isCoreProvisioned
  ])

  if (isPopup && !onboardingState.isComplete && onboardingState.currentStep) {
    return <OnboardingRedirect />
  }

  return (
    <>
      <OnboardingFlow />
      
      <div 
        className="relative w-full h-full min-h-0 bg-[#FFFEEF] dark:bg-[#171816] text-[#191919] dark:text-[#F5F1E7] flex flex-col overflow-hidden transition-colors duration-200" 
        style={fullHeight ? { height: '100%' } : { minHeight: '500px', maxHeight: '600px' }}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* App Header */}
        <AppHeader 
          currentScreen="main"
          onNavigate={handleNavigation}
          contextCount={latestContextCount}
          audioEnabled={audioEnabled}
          onToggleAudio={() => setAudioEnabled(!audioEnabled)}
          onOpenSidePanel={handleOpenSidePanel}
          statusDot={computedStatusDot}
        />

        {/* Model Downloading Non-blocking Banner */}
        {modelDownload.status === 'downloading' && (
          <div className="w-full bg-[#EBE7D0] dark:bg-[#2A2B26] border-b border-[#DDDCCB] dark:border-[#373832] px-4 py-2 flex items-center justify-between text-xs z-10 shrink-0 select-none">
            <div className="flex items-center gap-2 text-[#005447] dark:text-[#67E2C8] font-medium">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              <span>Voice recognition is ready. Your AI model is still downloading ({modelDownload.progress}%). You can speak once download finishes.</span>
            </div>
            <div className="w-20 h-1.5 bg-[#DDDCCB] dark:bg-[#373832] rounded-full overflow-hidden shrink-0 ml-3">
              <div 
                className="h-full bg-[#005447] dark:bg-[#67E2C8] rounded-full transition-all duration-300" 
                style={{ width: `${Math.max(5, modelDownload.progress)}%` }}
              />
            </div>
          </div>
        )}

        {/* Local AI Engine Health / Error Banner */}
        {(engineState.status === 'recovering' || (engineState.status === 'error' && engineState.error)) && (
          <div className="w-full bg-[#FFF3E0] dark:bg-[#2A1E14] border-b border-[#FFE0B2] dark:border-[#4E342E] px-4 py-2.5 flex items-center justify-between gap-2.5 text-xs z-10 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <RefreshCw className={`w-4 h-4 text-[#D84315] dark:text-[#FF8A65] shrink-0 ${engineState.status === 'recovering' ? 'animate-spin' : ''}`} />
              <div className="min-w-0">
                <div className="font-semibold text-[#BF360C] dark:text-[#FFAB91] truncate">
                  {engineState.status === 'recovering' ? 'Local AI Recovering...' : 'Local AI Engine Offline'}
                </div>
                <p className="text-[11px] text-[#D84315] dark:text-[#FF8A65] leading-tight truncate">
                  {engineState.error || (engineState.status === 'recovering' ? `Re-initializing worker (attempt ${engineState.recoveryAttempt || 1}/${engineState.maxRecoveryAttempts || 3})...` : 'Inference worker encountered an error.')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {engineState.status === 'recovering' ? (
                <button
                  onClick={() => generativeRuntime.cancelRecovery()}
                  className="px-2 py-1 text-[11px] font-medium text-[#BF360C] dark:text-[#FFAB91] hover:bg-[#FFE0B2] dark:hover:bg-[#3E2723] rounded-md transition-colors"
                  title="Cancel recovery"
                >
                  Cancel
                </button>
              ) : (
                <button
                  onClick={() => generativeRuntime.restartEngine()}
                  className="px-2 py-1 text-[11px] font-medium bg-[#D84315] dark:bg-[#FF7043] text-white rounded-md hover:bg-[#BF360C] dark:hover:bg-[#F4511E] transition-colors inline-flex items-center gap-1"
                  title="Restart engine"
                >
                  <RefreshCw className="w-3 h-3" /> Restart Engine
                </button>
              )}
            </div>
          </div>
        )}
        
        {/* Main content body */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col items-center justify-center px-4 py-5">
          {/* Editorial Display Intro */}
          <div className="text-center mb-2 select-none">
            <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-[#191919] dark:text-[#F5F1E7]">
              Speak naturally.
            </h1>
            <p className="font-sans text-xs text-[#77776E] dark:text-[#A6A49B] mt-0.5">
              Zero cloud latency · 100% private in-browser intelligence
            </p>
          </div>

          {/* Unified Model Setup Card (Displayed when core local models are not fully provisioned) */}
          {!isCoreProvisioned && (
            <div className="w-full max-w-sm sm:max-w-md mx-auto my-2 p-4 bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-2xl shadow-sm text-left animate-fadeIn">
              {modelProv.progress.state === 'downloading' ? (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 font-semibold text-[#191919] dark:text-[#F5F1E7]">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#005447] dark:text-[#67E2C8]" />
                      <span>Downloading Local AI Engine...</span>
                    </div>
                    <span className="font-mono text-xs font-bold text-[#005447] dark:text-[#67E2C8]">
                      {modelProv.progress.percent}%
                    </span>
                  </div>
                  <div className="w-full h-2 bg-[#DDDCCB] dark:bg-[#373832] rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-[#005447] dark:bg-[#67E2C8] rounded-full transition-all duration-300"
                      style={{ width: `${Math.max(5, modelProv.progress.percent)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-[#77776E] dark:text-[#A6A49B]">
                    <span className="truncate max-w-[200px] font-mono">
                      {modelProv.progress.currentFile || 'Downloading model weights...'}
                    </span>
                    <button
                      onClick={modelProv.cancelDownload}
                      className="text-rose-600 dark:text-rose-400 hover:underline shrink-0 flex items-center gap-0.5"
                    >
                      <X className="w-2.5 h-2.5" /> Cancel
                    </button>
                  </div>
                </div>
              ) : modelProv.progress.state === 'failed' || Boolean(modelProv.progress.error) ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-rose-700 dark:text-rose-300 font-semibold text-xs">
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                      <span>Model Download Interrupted</span>
                    </div>
                    <button
                      onClick={() => modelProv.retryDownload('all')}
                      className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[11px] font-medium shrink-0 flex items-center gap-1 shadow-sm"
                    >
                      <RefreshCw className="w-3 h-3" /> Retry Download
                    </button>
                  </div>
                  <p className="text-[11px] text-rose-600 dark:text-rose-400">
                    {modelProv.progress.error || 'Network error encountered during download.'}
                  </p>
                </div>
              ) : modelProv.progress.state === 'initializing' ? (
                <div className="flex items-center gap-2.5 text-xs text-[#005447] dark:text-[#67E2C8]">
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  <span className="font-medium">Initializing and verifying local AI weights in memory...</span>
                </div>
              ) : (modelProv.modelsCached?.qwen || modelProv.modelsCached?.embeddings || modelProv.modelsCached?.whisper) ? (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 font-semibold text-[#191919] dark:text-[#F5F1E7]">
                      <Cpu className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8]" />
                      <span>Local AI Setup Incomplete</span>
                    </div>
                    <span className="text-[10px] text-[#77776E] dark:text-[#A6A49B] font-mono">
                      {[modelProv.modelsCached?.qwen, modelProv.modelsCached?.embeddings, modelProv.modelsCached?.whisper].filter(Boolean).length}/3 Models
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] font-mono flex-wrap">
                    <span className={`px-2 py-0.5 rounded-full ${modelProv.modelsCached?.qwen ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300' : 'bg-[#DDDCCB] dark:bg-[#373832] text-[#77776E] dark:text-[#A6A49B]'}`}>
                      SmolLM {modelProv.modelsCached?.qwen ? '✓' : '✗'}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full ${modelProv.modelsCached?.embeddings ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300' : 'bg-[#DDDCCB] dark:bg-[#373832] text-[#77776E] dark:text-[#A6A49B]'}`}>
                      MiniLM {modelProv.modelsCached?.embeddings ? '✓' : '✗'}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full ${modelProv.modelsCached?.whisper ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300' : 'bg-[#DDDCCB] dark:bg-[#373832] text-[#77776E] dark:text-[#A6A49B]'}`}>
                      Whisper {modelProv.modelsCached?.whisper ? '✓' : '✗'}
                    </span>
                  </div>
                  <button
                    onClick={() => modelProv.downloadAllModels()}
                    className="w-full bg-[#005447] hover:bg-[#003F36] dark:bg-[#67E2C8] dark:hover:bg-[#52C5AD] text-white dark:text-[#171816] px-3.5 py-2 rounded-xl font-sans font-semibold text-xs transition-all flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Complete Missing Downloads</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Cpu className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" />
                      <span className="font-sans font-semibold text-xs sm:text-sm text-[#191919] dark:text-[#F5F1E7]">
                        Local AI Engine Required
                      </span>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#77776E] dark:text-[#A6A49B]">
                      ~200 MB
                    </span>
                  </div>
                  <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B] leading-relaxed">
                    Download Pentone's local AI engine (SmolLM-135M, all-MiniLM, and Whisper Tiny) for private voice recognition, reasoning, and browser automation.
                  </p>
                  <button
                    onClick={() => modelProv.downloadAllModels()}
                    className="w-full bg-[#005447] hover:bg-[#003F36] dark:bg-[#67E2C8] dark:hover:bg-[#52C5AD] text-white dark:text-[#171816] px-4 py-2 rounded-xl font-sans font-semibold text-xs transition-all flex items-center justify-center gap-2 shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Local AI (~200 MB)</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Centered Waveform Canvas */}
          <div className="w-full max-w-sm sm:max-w-md flex flex-col items-center justify-center my-1 cursor-pointer">
            <Waveform 
              state={waveformState} 
              onClick={state.isSummarizing ? undefined : handleWaveformClick} 
            />
          </div>

          {/* Push to Talk Primary Control */}
          {voiceModel === 'push_to_talk' && (
            <div className="mt-4 flex flex-col items-center justify-center gap-2">
              <div className="flex items-center gap-2">
                <button
                  onPointerDown={(e) => {
                    if (isModelLoading || fullDuplex.pttState === 'PROCESSING' || fullDuplex.pttState === 'EXECUTING') return
                    try {
                      e.currentTarget.setPointerCapture(e.pointerId)
                    } catch {}
                    fullDuplex.startPtt('pointer')
                  }}
                  onPointerUp={(e) => {
                    try {
                      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                        e.currentTarget.releasePointerCapture(e.pointerId)
                      }
                    } catch {}
                    fullDuplex.stopPtt('pointer')
                  }}
                  onPointerCancel={(e) => {
                    try {
                      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                        e.currentTarget.releasePointerCapture(e.pointerId)
                      }
                    } catch {}
                    fullDuplex.cancelPtt('Pointer cancelled by system')
                  }}
                  onLostPointerCapture={() => {
                    // Normal pointer release emits lostpointercapture; do NOT cancel completed interaction!
                  }}
                  disabled={isModelLoading || fullDuplex.pttState === 'PROCESSING' || fullDuplex.pttState === 'FINALIZING' || fullDuplex.pttState === 'TRANSCRIBING' || fullDuplex.pttState === 'EXECUTING'}
                  className={`px-6 py-3 rounded-full font-sans text-xs font-semibold tracking-wide flex items-center gap-2.5 transition-all shadow-sm select-none ${
                    (fullDuplex.pttState === 'LISTENING' || fullDuplex.pttState === 'RECORDING' || fullDuplex.pttState === 'PRESS_PENDING')
                      ? 'bg-rose-600 text-white shadow-rose-500/40 scale-105 animate-pulse'
                      : (fullDuplex.pttState === 'PROCESSING' || fullDuplex.pttState === 'FINALIZING' || fullDuplex.pttState === 'TRANSCRIBING')
                      ? 'bg-amber-600 text-white cursor-wait'
                      : fullDuplex.pttState === 'EXECUTING'
                      ? 'bg-[#005447] text-white cursor-wait'
                      : isModelLoading
                      ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-300 dark:border-amber-700 cursor-wait'
                      : fullDuplex.pttState === 'CANCELLED'
                      ? 'bg-[#F3F1DF] dark:bg-[#22231F] text-rose-600 dark:text-rose-400 border border-rose-300 dark:border-rose-800'
                      : fullDuplex.pttState === 'ERROR'
                      ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800'
                      : 'bg-[#E9D2FF] hover:bg-[#DEBEFF] dark:bg-[#CDB0F3] dark:hover:bg-[#BF9DE8] text-[#191919] dark:text-[#171816] border border-[#D5B8F6] active:scale-95'
                  }`}
                  title={isModelLoading ? 'Please wait, model is loading...' : 'Hold spacebar or click and hold to speak'}
                >
                  {(fullDuplex.pttState === 'LISTENING' || fullDuplex.pttState === 'RECORDING' || fullDuplex.pttState === 'PRESS_PENDING') ? (
                    <>
                      <span className="w-2.5 h-2.5 rounded-full bg-white animate-ping" />
                      <span>LISTENING... RELEASE TO SEND</span>
                    </>
                  ) : (fullDuplex.pttState === 'PROCESSING' || fullDuplex.pttState === 'FINALIZING' || fullDuplex.pttState === 'TRANSCRIBING') ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-amber-100" />
                      <span>{fullDuplex.pttState === 'TRANSCRIBING' ? 'TRANSCRIBING SPEECH...' : 'PROCESSING SPEECH...'}</span>
                    </>
                  ) : fullDuplex.pttState === 'EXECUTING' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-emerald-100" />
                      <span>EXECUTING COMMAND...</span>
                    </>
                  ) : isModelLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-amber-600 dark:text-amber-400" />
                      <span>LOADING MODEL...</span>
                    </>
                  ) : fullDuplex.pttState === 'CANCELLED' ? (
                    <span>CANCELLED</span>
                  ) : fullDuplex.pttState === 'ERROR' ? (
                    <>
                      <AlertTriangle className="w-4 h-4 text-rose-500" />
                      <span>MIC ERROR</span>
                    </>
                  ) : (
                    <>
                      <Mic className="w-4 h-4 text-[#191919] dark:text-[#171816]" />
                      <span>Hold to Speak</span>
                      <kbd className="ml-1 px-1.5 py-0.5 text-[10px] bg-white/70 dark:bg-black/20 rounded font-mono font-normal">
                        Space
                      </kbd>
                    </>
                  )}
                </button>

                {(fullDuplex.pttState === 'LISTENING' || fullDuplex.pttState === 'RECORDING' || fullDuplex.pttState === 'PRESS_PENDING') && (
                  <button
                    onClick={() => fullDuplex.cancelPtt()}
                    className="p-2.5 bg-[#F3F1DF] dark:bg-[#22231F] hover:bg-[#E8E5CE] dark:hover:bg-[#2d2e29] border border-[#DDDCCB] dark:border-[#373832] text-[#77776E] hover:text-rose-600 rounded-full transition-colors"
                    title="Cancel utterance (Esc)"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {fullDuplex.isTabAudioPlaying && (
                <div className="px-3 py-1 bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-full text-[10px] font-sans text-[#77776E] dark:text-[#A6A49B] flex items-center gap-1.5">
                  <Volume2 className="w-3 h-3 text-[#005447] dark:text-[#67E2C8] shrink-0" />
                  <span>Tab Audio Playing · Gated to intentional PTT</span>
                </div>
              )}
            </div>
          )}

          {voiceModel === 'full_duplex' && fullDuplex.isFullDuplexEnabled ? (
            <div className="mt-3 flex items-center justify-center gap-2 text-xs font-sans">
              {fullDuplex.voiceState === 'INITIALIZING' && (
                <>
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                  <span className="text-amber-600 dark:text-amber-400 font-medium">Loading voice models & warming up...</span>
                </>
              )}
              {fullDuplex.voiceState === 'CALIBRATING' && (
                <>
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-cyan-500 animate-pulse" />
                  <span className="text-cyan-600 dark:text-cyan-400 font-medium">Calibrating background noise...</span>
                </>
              )}
              {fullDuplex.voiceState === 'LISTENING' && (
                <>
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-emerald-700 dark:text-emerald-400 font-medium">Ready — listening (Speak anytime · Native AEC)</span>
                </>
              )}
              {fullDuplex.voiceState === 'USER_SPEAKING' && (
                <>
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
                  <span className="text-blue-600 dark:text-blue-400 font-medium">User Speaking... (VAD Active)</span>
                </>
              )}
              {fullDuplex.voiceState === 'PROCESSING' && (
                <>
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
                  <span className="text-amber-600 dark:text-amber-400">Processing utterance...</span>
                </>
              )}
              {fullDuplex.voiceState === 'ASSISTANT_SPEAKING' && (
                <>
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-purple-500 animate-pulse" />
                  <span className="text-purple-600 dark:text-purple-400">Pentone Speaking (Speak to Interrupt)</span>
                </>
              )}
              {fullDuplex.voiceState === 'INTERRUPTING' && (
                <>
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
                  <span className="text-rose-600 dark:text-rose-400 font-medium">Interrupted! Listening to new command...</span>
                </>
              )}
            </div>
          ) : isListening ? (
            <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-[#77776E] dark:text-[#A6A49B] font-sans">
              <span className="inline-block w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
              <span>listening... (tap waveform to finish & send)</span>
            </div>
          ) : null}

          {/* Speaker Verification HUD */}
          {voiceModel === 'full_duplex' && fullDuplex.isFullDuplexEnabled && (
            <div className="mt-2 flex items-center justify-center">
              {fullDuplex.profileState === 'PROFILE_LOADING' ? (
                <div className="px-2.5 py-1 bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-full text-[11px] font-sans text-[#77776E] dark:text-[#A6A49B] flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 text-[#77776E] animate-spin shrink-0" />
                  <span>Checking Voice Profile...</span>
                </div>
              ) : fullDuplex.profileState === 'PROFILE_DECRYPTION_FAILED' ? (
                <div className="px-2.5 py-1 bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 rounded-full text-[11px] font-sans text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3 text-rose-500 shrink-0" />
                  <span>Profile Decryption Failed</span>
                </div>
              ) : fullDuplex.profileState === 'PROFILE_STORAGE_ERROR' ? (
                <div className="px-2.5 py-1 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-full text-[11px] font-sans text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                  <span>Profile Storage Error</span>
                </div>
              ) : latestVoiceTurn?.camDecision === 'REGISTERED_USER' && latestVoiceTurn?.camScore !== undefined && latestVoiceTurn.camScore >= 0.6200 && latestVoiceTurn?.authScope === 'EXECUTE_MUTATING_ACTIONS' ? (
                <div className="px-3 py-1 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700 rounded-full text-[11px] font-sans text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5 shadow-sm">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>You (Verified · {latestVoiceTurn.camScore.toFixed(3)})</span>
                </div>
              ) : latestVoiceTurn?.detectedSpeaker === 'OVERLAPPING_SPEECH' || latestVoiceTurn?.terminalState === 'OVERLAPPING_SPEECH' ? (
                <div className="px-3 py-1 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-full text-[11px] font-sans text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span>Multiple Voices Detected</span>
                </div>
              ) : latestVoiceTurn?.detectedSpeaker === 'OTHER_SPEAKER' && latestVoiceTurn?.authScope === 'DENIED' ? (
                <div className="px-3 py-1 bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-full text-[11px] font-sans text-[#77776E] dark:text-[#A6A49B] flex items-center gap-1.5">
                  <VolumeX className="w-3.5 h-3.5 text-[#77776E] shrink-0" />
                  <span>Background Speech Ignored</span>
                </div>
              ) : (
                <div className="px-3 py-1 bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-full text-[11px] font-sans text-[#005447] dark:text-[#67E2C8] flex items-center gap-1.5 shadow-sm">
                  <Mic className="w-3.5 h-3.5 shrink-0" />
                  <span>Universal Voice Active (Wiener Filter Denoised)</span>
                </div>
              )}
            </div>
          )}

          {/* Transcript while listening */}
          {transcript && isListening && (
            <div className="mt-4 max-w-md text-center px-4 py-2 rounded-2xl bg-[#F3F1DF]/70 dark:bg-[#22231F]/70 border border-[#DDDCCB] dark:border-[#373832] animate-fadeIn">
              <div className={`font-display text-sm ${getTextColor(waveformState)}`}>
                "{transcript}"
              </div>
            </div>
          )}

          {/* Spoken text / Assistant status / Whisper transcript */}
          {!isListening && (isModelLoading || currentSentence || lastDisplayedSentence || latestVoiceTurn?.whisperText) && (
            <div className="mt-4 max-w-md text-center px-4 py-2 rounded-2xl bg-[#F3F1DF]/70 dark:bg-[#22231F]/70 border border-[#DDDCCB] dark:border-[#373832] animate-fadeIn space-y-1">
              {latestVoiceTurn?.whisperText && (
                <div className="text-xs text-[#77776E] dark:text-[#A6A49B] truncate">
                  Heard: <span className="font-medium text-[#191919] dark:text-[#F5F1E7]">"{latestVoiceTurn.whisperText}"</span>
                </div>
              )}
              {(isModelLoading || currentSentence || lastDisplayedSentence) && (
                <div className={`font-display text-sm ${getTextColor(waveformState)}`}>
                  {isModelLoading ? 'Loading model...' : (currentSentence || lastDisplayedSentence)}
                </div>
              )}
            </div>
          )}

          {/* AI Response Error Display */}
          {(() => {
            const lastMsg = state.messages[state.messages.length - 1]
            const isErrMsg = lastMsg && (lastMsg.messageType === 'error' || lastMsg.content?.startsWith('ERROR:'))
            if (!isErrMsg) return null
            const cleanErr = lastMsg.content.replace(/^ERROR:\s*/, '')
            return (
              <div className="mt-3 max-w-md text-center px-3 py-1.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-300 text-xs animate-fadeIn">
                <span className="font-semibold">AI Error: </span>{cleanErr}
              </div>
            )
          })()}
          
          {/* Rating buttons */}
          {!state.isProcessing && !state.isInToolLoop && !state.isSummarizing && latestResponse.text && latestResponse.id && (
            <div className="mt-4 flex flex-col items-center justify-center gap-1">
              <span className="text-[10px] text-[#77776E] dark:text-[#A6A49B] font-sans">Rate response</span>
              <RatingButtons 
                messageId={latestResponse.id}
                currentRating={latestResponse.rating}
                onRate={rateMessage}
                size="md"
              />
            </div>
          )}
        </div>
        
        {/* File Embedding Overlay */}
        {(isDraggingFiles || isEmbedding || embedSuccess) && (
          <div className="absolute inset-0 z-50 flex items-center justify-center backdrop-blur-md bg-[#191919]/40 dark:bg-black/60 transition-all duration-300">
            <div className="bg-[#FFFEEF] dark:bg-[#22231F] border-2 border-dashed border-[#005447] dark:border-[#67E2C8] rounded-2xl p-10 text-center shadow-xl">
              {isEmbedding ? (
                <>
                  <div className="w-12 h-12 border-3 border-[#005447] dark:border-[#67E2C8] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                  <p className="font-display text-base font-semibold text-[#191919] dark:text-[#F5F1E7]">Embedding files into memory...</p>
                </>
              ) : embedSuccess ? (
                <>
                  <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto mb-2">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <p className="font-display text-base font-semibold text-[#191919] dark:text-[#F5F1E7]">{embedSuccess}</p>
                </>
              ) : (
                <>
                  <div className="w-10 h-10 rounded-full bg-[#E9D2FF] dark:bg-[#CDB0F3]/30 text-[#191919] dark:text-[#CDB0F3] flex items-center justify-center mx-auto mb-2">
                    <Paperclip className="w-5 h-5" />
                  </div>
                  <p className="font-display text-base font-semibold text-[#191919] dark:text-[#F5F1E7]">Drop files to embed</p>
                  <p className="text-xs text-[#77776E] dark:text-[#A6A49B] mt-1 font-sans">PDF, TXT, Markdown, HTML, JSON</p>
                </>
              )}
            </div>
          </div>
        )}

        {/* Bottom Bar: Device Selectors & Text Input */}
        <div className="flex-shrink-0 p-3 border-t border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF]/90 dark:bg-[#171816]/90 backdrop-blur-md">
          {/* Reference indicator */}
          {state.reference && (
            <div className="mb-2.5 flex flex-col gap-1.5 px-3 py-2 bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-xl text-xs font-sans">
              <div className="flex items-center gap-2">
                <Paperclip size={13} className="text-[#005447] dark:text-[#67E2C8] shrink-0" />
                <span className="text-[#191919] dark:text-[#F5F1E7] flex-1 truncate font-medium">
                  {state.reference.image ? 'Screenshot attached' : state.reference.audio ? 'Audio attached' : `"${state.reference.text.substring(0, 48)}${state.reference.text.length > 48 ? '...' : ''}"`}
                </span>
                <button
                  onClick={() => {
                    dispatch({ type: 'SET_REFERENCE', payload: null })
                    chrome.storage.local.remove('chat_reference')
                  }}
                  className="text-[#77776E] hover:text-[#191919] dark:hover:text-[#F5F1E7] transition-colors p-0.5 rounded"
                >
                  <X size={13} />
                </button>
              </div>
              
              {state.reference.image && (
                <img 
                  src={state.reference.image} 
                  alt="Reference screenshot" 
                  className="max-w-full max-h-24 rounded-lg border border-[#DDDCCB] dark:border-[#373832] object-cover"
                />
              )}
              
              {state.reference.audio && (
                <audio 
                  src={state.reference.audio} 
                  controls 
                  className="w-full h-7 mt-1"
                />
              )}
            </div>
          )}
          
          {/* Mic and Voice Selectors */}
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div className="flex-1 min-w-[130px]">
              <MicSelector />
            </div>
            <div className="flex-1 min-w-[130px]">
              <VoiceSelector />
            </div>
          </div>

          {/* Quick Input Pill */}
          <div className="relative flex items-center">
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={handleTextSubmit}
              disabled={state.isProcessing || state.isSummarizing}
              placeholder="Type an instruction or question..."
              className="w-full bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-full pl-4 pr-10 py-2 text-xs font-sans text-[#191919] dark:text-[#F5F1E7] placeholder-[#77776E] dark:placeholder-[#A6A49B] focus:outline-none focus:border-[#005447] dark:focus:border-[#67E2C8] focus:ring-1 focus:ring-[#005447] dark:focus:ring-[#67E2C8] transition-all disabled:opacity-50"
            />
            <button
              onClick={() => {
                if (textInput.trim() && !state.isProcessing) {
                  sendMessage(textInput.trim())
                  setTextInput('')
                }
              }}
              disabled={!textInput.trim() || state.isProcessing}
              className="absolute right-1.5 p-1.5 rounded-full bg-[#005447] hover:bg-[#003F36] text-white disabled:opacity-30 disabled:pointer-events-none transition-all"
            >
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
