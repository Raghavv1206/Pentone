import React, { useMemo, useState, useEffect, useRef } from "react"
import { 
  Mic, Square, Paperclip, X, ShieldCheck, 
  Volume2, VolumeX, AlertTriangle, Loader2, Sparkles, ArrowRight
} from "lucide-react"
import { useVoiceInput } from "../lib/use-voice-input"
import { useFullDuplexVoice } from "../lib/audio/use-full-duplex-voice"
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
import { isModelReady } from "../lib/ai"

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
  const [modelDownload, setModelDownload] = useState<ModelDownloadState>(getModelDownloadState())

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
    : state.isWarmingUp
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
    if (state.isSummarizing) return
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

  const computedStatusDot = 
    (voiceModel === 'push_to_talk' && fullDuplex.pttState === 'LISTENING') || isListening
      ? 'listening'
      : (state.isProcessing || fullDuplex.pttState === 'PROCESSING' || fullDuplex.pttState === 'EXECUTING')
      ? 'processing'
      : fullDuplex.pttState === 'ERROR'
      ? 'error'
      : 'ready'

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
                    if (fullDuplex.pttState === 'PROCESSING' || fullDuplex.pttState === 'EXECUTING') return
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
                  disabled={fullDuplex.pttState === 'PROCESSING' || fullDuplex.pttState === 'FINALIZING' || fullDuplex.pttState === 'TRANSCRIBING' || fullDuplex.pttState === 'EXECUTING'}
                  className={`px-6 py-3 rounded-full font-sans text-xs font-semibold tracking-wide flex items-center gap-2.5 transition-all shadow-sm select-none ${
                    (fullDuplex.pttState === 'LISTENING' || fullDuplex.pttState === 'RECORDING' || fullDuplex.pttState === 'PRESS_PENDING')
                      ? 'bg-rose-600 text-white shadow-rose-500/40 scale-105 animate-pulse'
                      : (fullDuplex.pttState === 'PROCESSING' || fullDuplex.pttState === 'FINALIZING' || fullDuplex.pttState === 'TRANSCRIBING')
                      ? 'bg-amber-600 text-white cursor-wait'
                      : fullDuplex.pttState === 'EXECUTING'
                      ? 'bg-[#005447] text-white cursor-wait'
                      : fullDuplex.pttState === 'CANCELLED'
                      ? 'bg-[#F3F1DF] dark:bg-[#22231F] text-rose-600 dark:text-rose-400 border border-rose-300 dark:border-rose-800'
                      : fullDuplex.pttState === 'ERROR'
                      ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800'
                      : 'bg-[#E9D2FF] hover:bg-[#DEBEFF] dark:bg-[#CDB0F3] dark:hover:bg-[#BF9DE8] text-[#191919] dark:text-[#171816] border border-[#D5B8F6] active:scale-95'
                  }`}
                  title="Hold spacebar or click and hold to speak"
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

          {/* Spoken text / Assistant status */}
          {!isListening && (currentSentence || lastDisplayedSentence) && (
            <div className="mt-4 max-w-md text-center px-4 py-2 rounded-2xl bg-[#F3F1DF]/70 dark:bg-[#22231F]/70 border border-[#DDDCCB] dark:border-[#373832] animate-fadeIn">
              <div className={`font-display text-sm ${getTextColor(waveformState)}`}>
                {currentSentence || lastDisplayedSentence}
              </div>
            </div>
          )}
          
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
