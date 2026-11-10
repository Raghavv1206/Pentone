import "../lib/suppress-warnings"
import React, { useMemo, useState, useEffect, useRef } from "react"
import { 
  Mic, Square, Paperclip, X, ArrowRight, Loader2, Sparkles, Volume2, 
  UploadCloud, FileText, CheckCircle2, AlertCircle, Camera, Zap,
  ChevronDown, ChevronUp, ExternalLink, AudioLines, SendHorizontal
} from "lucide-react"
import { useVoiceInput } from "../lib/use-voice-input"
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
import { getSpokenLine } from "../lib/tool-registry"
import { getCompleteSentences, splitIntoSentences, extractNextSpeechChunk } from "../lib/sentence-parser"
import { isModelRefusal } from "../lib/intent-detector"
import { embedFiles } from "../lib/file-embedder"
import { type Screen } from "../lib/config"
import { setPentoneSelected } from "../lib/selection-state"
import { 
  openAllRequiredFlags, 
  openOptimizationGuideFlagsPage, 
  openPromptAPIFlagsPage, 
  openWriterFlagsPage, 
  openRewriterFlagsPage, 
  openComponentsPage,
  useAlert
} from "../lib/alert-context"
import { getLanguageModelAPI, checkLanguageModelAvailability } from "../lib/chrome-ai-helpers"

interface MainScreenProps {
  onNavigateToDebug?: () => void
  onNavigateToSettings?: () => void
  onNavigate?: (screen: Screen) => void
  fullHeight?: boolean
}

export const MainScreen: React.FC<MainScreenProps> = ({ 
  onNavigateToDebug, 
  onNavigateToSettings, 
  onNavigate,
  fullHeight = false 
}) => {
  const { state: onboardingState, isPopup, resetOnboarding } = useOnboarding()
  const { isListening, transcript, handleMicClick, startVoiceInput, stopVoiceInput } = useVoiceInput()
  const { state, sendMessage, resetChat, rateMessage, isInitialLoadComplete, interruptChat, dispatch } = useChatContext()
  const { handleNewText, stop, currentSentence, isSpeaking, audioEnabled, setAudioEnabled } = useTTS()
  const soundEffects = useSoundEffects()
  const [textInput, setTextInput] = useState("")

  const handleNavigation = (screen: Screen) => {
    if (onNavigate) {
      onNavigate(screen)
    } else if (screen === 'settings' && onNavigateToSettings) {
      onNavigateToSettings()
    } else if ((screen === 'debug' || screen === 'diagnostics') && onNavigateToDebug) {
      onNavigateToDebug()
    }
  }

  const handleOpenSidePanel = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id && chrome.sidePanel?.open) {
          chrome.sidePanel.open({ tabId: tabs[0].id })
        }
      })
    }
  }
  
  // Track last spoken assistant message to avoid replaying
  const lastSpokenTextRef = useRef<string>('')
  const wasSpeakingRef = useRef(false)
  const spacePressTimeRef = useRef<number>(0)
  const lastProcessedIndexRef = useRef<number>(0)
  const lastSeenTextRef = useRef<string>('')
  const currentStreamingMessageIdRef = useRef<string | null>(null)
  const hasInitializedHistoryRef = useRef(false)
  const isInterruptedRef = useRef(false)
  
  // Track last displayed sentence to keep showing it when queue empties
  const [lastDisplayedSentence, setLastDisplayedSentence] = useState<string>('')
  const [isFlashingScreenshot, setIsFlashingScreenshot] = useState(false)

  // Listen for screenshot capture event to trigger immediate synchronized visual feedback in sidepanel
  useEffect(() => {
    const handleScreenshotCaptured = () => {
      setIsFlashingScreenshot(true)
      const timer = setTimeout(() => {
        setIsFlashingScreenshot(false)
      }, 350)
      return () => clearTimeout(timer)
    }

    window.addEventListener('pentone_screenshot_captured', handleScreenshotCaptured)
    return () => {
      window.removeEventListener('pentone_screenshot_captured', handleScreenshotCaptured)
    }
  }, [])
  
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
  
  // Mark initial history as already processed once on startup so we don't speak old messages
  useEffect(() => {
    if (isInitialLoadComplete && !hasInitializedHistoryRef.current) {
      hasInitializedHistoryRef.current = true
      for (let i = state.messages.length - 1; i >= 0; i--) {
        const msg = state.messages[i]
        if (msg.role === 'assistant' && !msg.content.startsWith('[TOOL RESULT]')) {
          currentStreamingMessageIdRef.current = msg.id
          lastProcessedIndexRef.current = msg.content.length
          break
        }
      }
    }
  }, [isInitialLoadComplete])

  // Get latest assistant message that's not a tool result or internal token
  const latestResponse = useMemo(() => {
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const msg = state.messages[i]
      if (msg.role === 'assistant' && !msg.content.startsWith('[TOOL RESULT]') && !msg.content.startsWith('[INTERRUPTED]')) {
        let contentToSplit = msg.content
        const codeBlockMatch = contentToSplit.match(/```(?:tool_code|tool_call|function_call|json)\s*\n?(.*?)```/s)
        if (codeBlockMatch) {
          contentToSplit = codeBlockMatch[1]
        }
        const textBeforeToolCall = contentToSplit.split('<function_call>')[0].trim()
        
        let displayText = textBeforeToolCall
        if (!displayText && msg.content.includes('<function_call>')) {
          displayText = ''
        } else if (!displayText) {
          displayText = msg.content
        }
        
        return {
          id: msg.id,
          text: displayText,
          rating: msg.rating,
          fullMessage: msg
        }
      }
    }
    return null
  }, [state.messages])

  // Feed new assistant messages to TTS during streaming
  useEffect(() => {
    if (!isInitialLoadComplete || !latestResponse) return

    // If message changed (new response), reset tracking
    if (latestResponse.id !== currentStreamingMessageIdRef.current) {
      currentStreamingMessageIdRef.current = latestResponse.id
      lastProcessedIndexRef.current = 0
      lastSeenTextRef.current = ''
      isInterruptedRef.current = false
    }

    const currentText = latestResponse.text || ''
    if (!currentText || isInterruptedRef.current) return

    // If message content was rewritten or replaced (e.g. intent interception or refusal correction), reset index
    if (
      lastProcessedIndexRef.current > currentText.length ||
      (lastSeenTextRef.current && !currentText.startsWith(lastSeenTextRef.current.slice(0, Math.min(20, lastSeenTextRef.current.length))))
    ) {
      console.log('[MainScreen TTS] Text was rewritten or replaced, resetting lastProcessedIndex to 0')
      lastProcessedIndexRef.current = 0
    }
    lastSeenTextRef.current = currentText

    // Progressively extract complete sentences and natural fluent speech chunks as they stream
    while (lastProcessedIndexRef.current < currentText.length) {
      if (isInterruptedRef.current) break
      const unqueuedText = currentText.slice(lastProcessedIndexRef.current)
      if (!unqueuedText.trim()) break

      const isFirstChunk = lastProcessedIndexRef.current === 0
      const result = extractNextSpeechChunk(unqueuedText, isFirstChunk)
      if (!result || result.consumedChars <= 0) break

      const { chunk, consumedChars } = result
      if (chunk.trim()) {
        // Suppress base-model LLM disclaimers/refusals from being spoken out loud
        if (isModelRefusal(chunk) || isModelRefusal(currentText)) {
          console.warn('[MainScreen TTS] Suppressed refusal from streaming TTS:', chunk)
          break
        }
        console.log(`[MainScreen TTS] Queuing fluent sentence chunk (len=${chunk.length}): "${chunk}"`)
        handleNewText(chunk, true)
      }
      lastProcessedIndexRef.current += consumedChars
    }
  }, [latestResponse?.text, latestResponse?.id, isInitialLoadComplete, handleNewText])

  // Flush any trailing unpunctuated text or final sentence when streaming completes
  useEffect(() => {
    if (!isInitialLoadComplete || !latestResponse) return

    // When generation completes (not processing and not waiting)
    if (!state.isProcessing && !state.isWaitingForFirstChunk && latestResponse.text) {
      // Do not flush if user interrupted or if message is internal token / refusal
      if (isInterruptedRef.current || latestResponse.text.startsWith('[INTERRUPTED]')) {
        return
      }

      const fullText = latestResponse.text
      if (lastProcessedIndexRef.current < fullText.length) {
        const remaining = fullText.slice(lastProcessedIndexRef.current).trim()
        if (remaining && !isModelRefusal(remaining)) {
          console.log('[MainScreen TTS] Flushing final remaining text to TTS:', remaining)
          handleNewText(remaining, true)
          lastProcessedIndexRef.current = fullText.length
        }
      }
    }
  }, [state.isProcessing, state.isWaitingForFirstChunk, latestResponse?.text, latestResponse?.id, isInitialLoadComplete, handleNewText])

  // Play sound effect when speech finishes
  useEffect(() => {
    if (wasSpeakingRef.current && !isSpeaking) {
      soundEffects.playSpeechEnd?.()
    }
    wasSpeakingRef.current = isSpeaking
  }, [isSpeaking, soundEffects])

  // Keep track of last non-empty sentence
  useEffect(() => {
    if (currentSentence) {
      setLastDisplayedSentence(currentSentence)
    }
  }, [currentSentence])

  // Selection state - keeps extension active for Spacebar voice input until user interacts with webpage
  const [isPentoneSelected, setIsPentoneSelected] = useState(true)

  // Track selection state and sync with storage
  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get(['pentone_selected'], (res) => {
        if (res?.pentone_selected !== undefined) {
          setIsPentoneSelected(Boolean(res.pentone_selected))
        }
      })
    }

    const handleStorageChange = (changes: any, areaName: string) => {
      if (areaName === 'local' && changes.pentone_selected !== undefined) {
        setIsPentoneSelected(Boolean(changes.pentone_selected.newValue))
      }
    }

    const claimSelection = () => {
      setIsPentoneSelected(true)
      setPentoneSelected(true).catch(() => {})
    }

    window.addEventListener('mousedown', claimSelection)
    window.addEventListener('focus', claimSelection)

    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(handleStorageChange)
      return () => {
        chrome.storage.onChanged.removeListener(handleStorageChange)
        window.removeEventListener('mousedown', claimSelection)
        window.removeEventListener('focus', claimSelection)
      }
    }

    return () => {
      window.removeEventListener('mousedown', claimSelection)
      window.removeEventListener('focus', claimSelection)
    }
  }, [])

  // Re-claim selection automatically whenever an assistant response or command finishes
  useEffect(() => {
    if (!state.isProcessing && !state.isSummarizing) {
      setIsPentoneSelected(true)
      setPentoneSelected(true).catch(() => {})
      try {
        window.focus()
      } catch {}
    }
  }, [state.isProcessing, state.isSummarizing])

  // Runtime message listener for remote Spacebar hold-to-talk from active web page
  useEffect(() => {
    const handleRuntimeMessage = (message: any, sender: any, sendResponse: (res?: any) => void) => {
      if (message.type === 'pentone_spacebar_down') {
        if (!state.isProcessing && !state.isSummarizing) {
          spacePressTimeRef.current = Date.now()
          if (!isListening) {
            startVoiceInput()
          }
        }
        sendResponse?.({ success: true })
        return true
      }
      if (message.type === 'pentone_spacebar_up') {
        const duration = typeof message.duration === 'number' ? message.duration : (Date.now() - spacePressTimeRef.current)
        if (duration > 250 && isListening) {
          stopVoiceInput()
        }
        sendResponse?.({ success: true })
        return true
      }
    }

    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(handleRuntimeMessage)
      return () => {
        chrome.runtime.onMessage.removeListener(handleRuntimeMessage)
      }
    }
  }, [isListening, state.isProcessing, state.isSummarizing, startVoiceInput, stopVoiceInput])

  // Spacebar hold/toggle to speak listener (in-window)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement
      const isInput = activeEl && (
        activeEl.tagName === 'INPUT' || 
        activeEl.tagName === 'TEXTAREA' || 
        activeEl.tagName === 'SELECT' || 
        (activeEl as HTMLElement).isContentEditable
      )
      if (isInput) return

      if (e.code === 'Space') {
        e.preventDefault()
        if (!e.repeat && !state.isProcessing && !state.isSummarizing) {
          spacePressTimeRef.current = Date.now()
          if (!isListening) {
            startVoiceInput()
          } else {
            stopVoiceInput()
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

      if (e.code === 'Space') {
        e.preventDefault()
        const duration = Date.now() - spacePressTimeRef.current
        // If held (>250ms), user was using push-to-talk: release Space sends immediately!
        // If tapped (<=250ms), keep listening and let silence detection auto-send!
        if (duration > 250 && isListening) {
          stopVoiceInput()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [isListening, state.isProcessing, state.isSummarizing, startVoiceInput, stopVoiceInput])

  // Text submit handler
  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!textInput.trim() || state.isProcessing || state.isSummarizing) return
    sendMessage(textInput.trim())
    setTextInput("")
  }

  // Waveform click handler
  const handleWaveformClick = () => {
    if (isSpeaking) {
      isInterruptedRef.current = true
      soundEffects.playSpeechInterrupted?.()
      stop()
      interruptChat()
      if (latestResponse?.text) {
        lastProcessedIndexRef.current = latestResponse.text.length
      }
    } else {
      handleMicClick()
    }
  }

  // Drag and drop handlers
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

    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return

    setIsEmbedding(true)
    setEmbedSuccess(null)

    try {
      const results = await embedFiles(files)
      const successful = results.filter(r => r.success).length
      setEmbedSuccess(`Embedded ${successful} file${successful === 1 ? '' : 's'}`)
      setTimeout(() => {
        setEmbedSuccess(null)
      }, 3000)
    } catch (error) {
      console.error('Error embedding files:', error)
    } finally {
      setIsEmbedding(false)
    }
  }

  // Compute waveform visual state
  const waveformState = useMemo<'idle' | 'listening' | 'thinking' | 'speaking'>(() => {
    if (state.isProcessing || state.isSummarizing) return 'thinking'
    if (isSpeaking) return 'speaking'
    if (isListening) return 'listening'
    return 'idle'
  }, [state.isProcessing, state.isSummarizing, isSpeaking, isListening])

  const { showAlert } = useAlert()
  const hasAlertedRef = useRef(false)
  const [isAiFlagsReady, setIsAiFlagsReady] = useState<boolean>(() => {
    return Boolean(onboardingState.modelAvailable)
  })
  const [showFlagDetails, setShowFlagDetails] = useState<boolean>(false)

  useEffect(() => {
    const checkFlags = async () => {
      try {
        const LM = getLanguageModelAPI()
        if (!LM) {
          setIsAiFlagsReady(false)
          if (!hasAlertedRef.current) {
            hasAlertedRef.current = true
            showAlert(
              'error',
              'Chrome AI Unavailable',
              'Gemini Nano is unavailable. Browser speech recognition may use an online service.',
              {
                label: 'Open Flags',
                onClick: openAllRequiredFlags
              }
            )
          }
          return
        }
        const avail = await checkLanguageModelAvailability(LM)
        const ready = avail === 'available' || avail === 'after-download'
        setIsAiFlagsReady(ready)
        if (!ready && !hasAlertedRef.current) {
          hasAlertedRef.current = true
          showAlert(
            'error',
            'Chrome AI Unavailable',
            'Gemini Nano is unavailable. Browser speech recognition may use an online service.',
            {
              label: 'Open Flags',
              onClick: openAllRequiredFlags
            }
          )
        }
      } catch {
        setIsAiFlagsReady(false)
      }
    }
    checkFlags()
    const interval = setInterval(checkFlags, 4000)
    return () => clearInterval(interval)
  }, [showAlert])

  const computedStatusDot: 'ready' | 'listening' | 'processing' | 'offline' = useMemo(() => {
    if (isListening) return 'listening'
    if (state.isProcessing || state.isSummarizing || isSpeaking) return 'processing'
    if (!isAiFlagsReady) return 'offline'
    return 'ready'
  }, [isListening, state.isProcessing, state.isSummarizing, isSpeaking, isAiFlagsReady])

  if (isPopup && !onboardingState.isComplete && onboardingState.currentStep) {
    return <OnboardingRedirect />
  }

  return (
    <>
      <OnboardingFlow />
      
      <div 
        className="relative w-full h-full min-h-0 bg-[#FFFEEF] dark:bg-[#171816] text-[#191919] dark:text-[#F5F1E7] flex flex-col overflow-hidden transition-colors duration-200" 
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Modern App Header */}
        <AppHeader 
          currentScreen="main"
          onNavigate={handleNavigation}
          contextCount={latestContextCount}
          audioEnabled={audioEnabled}
          onToggleAudio={() => setAudioEnabled(!audioEnabled)}
          onOpenSidePanel={handleOpenSidePanel}
          statusDot={computedStatusDot}
        />

        {/* Persistent Alert Banner when Chrome AI flags are not enabled */}
        {!isAiFlagsReady && (
          <div className="mx-2.5 sm:mx-3.5 mt-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-col gap-2 text-xs shrink-0 select-none animate-fadeIn">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <div className="min-w-0">
                  <p className="font-semibold text-amber-900 dark:text-amber-200 text-[11px] truncate">
                    Chrome AI Unavailable
                  </p>
                  <p className="text-[10px] text-[#77776E] dark:text-[#A6A49B] truncate">
                    Running offline. Enable flags for Gemini Nano intelligence.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => setShowFlagDetails(!showFlagDetails)}
                  className="px-2 py-1 rounded-lg bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#191919] dark:text-[#F5F1E7] text-[10px] font-semibold hover:opacity-80 transition-opacity flex items-center gap-1 cursor-pointer"
                  title="Toggle individual flag links"
                >
                  <span>Flags</span>
                  {showFlagDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
                <button
                  onClick={() => {
                    openAllRequiredFlags()
                    resetOnboarding()
                  }}
                  className="px-2.5 py-1 rounded-lg bg-[#005447] dark:bg-[#67E2C8] text-white dark:text-[#171816] text-[10.5px] font-bold hover:opacity-90 active:scale-95 transition-all shadow-xs flex items-center gap-1 cursor-pointer"
                  title="Open all 4 flags at once"
                >
                  <Zap className="w-3 h-3" />
                  <span>1-Click All</span>
                </button>
              </div>
            </div>

            {/* Individual Flag & Component Links Drawer */}
            {showFlagDetails && (
              <div className="pt-2 border-t border-amber-500/20 space-y-1.5 animate-fadeIn">
                <div className="grid grid-cols-2 gap-1.5 text-[10.5px]">
                  <button
                    onClick={openOptimizationGuideFlagsPage}
                    className="p-1.5 rounded-lg bg-[#FFFEEF] dark:bg-[#171816] border border-amber-500/30 text-left hover:border-[#005447] dark:hover:border-[#67E2C8] transition-colors flex items-center justify-between gap-1 cursor-pointer"
                    title="Optimization Guide: Set to Enabled BypassPerfRequirement"
                  >
                    <div className="truncate">
                      <span className="block truncate font-semibold">1. Optimization Guide</span>
                      <span className="text-[9px] text-emerald-700 dark:text-emerald-400 font-bold block truncate">BypassPerfRequirement</span>
                    </div>
                    <ExternalLink className="w-2.5 h-2.5 text-[#77776E] shrink-0" />
                  </button>

                  <button
                    onClick={openPromptAPIFlagsPage}
                    className="p-1.5 rounded-lg bg-[#FFFEEF] dark:bg-[#171816] border border-amber-500/30 text-left hover:border-[#005447] dark:hover:border-[#67E2C8] transition-colors flex items-center justify-between gap-1 cursor-pointer"
                    title="Prompt API: Set to Enabled"
                  >
                    <div className="truncate">
                      <span className="block truncate font-semibold">2. Prompt API</span>
                      <span className="text-[9px] text-emerald-700 dark:text-emerald-400 font-bold block truncate">Set to Enabled</span>
                    </div>
                    <ExternalLink className="w-2.5 h-2.5 text-[#77776E] shrink-0" />
                  </button>

                  <button
                    onClick={openWriterFlagsPage}
                    className="p-1.5 rounded-lg bg-[#FFFEEF] dark:bg-[#171816] border border-amber-500/30 text-left hover:border-[#005447] dark:hover:border-[#67E2C8] transition-colors flex items-center justify-between gap-1 cursor-pointer"
                    title="Writer API: Set to Enabled"
                  >
                    <div className="truncate">
                      <span className="block truncate font-semibold">3. Writer API</span>
                      <span className="text-[9px] text-emerald-700 dark:text-emerald-400 font-bold block truncate">Set to Enabled</span>
                    </div>
                    <ExternalLink className="w-2.5 h-2.5 text-[#77776E] shrink-0" />
                  </button>

                  <button
                    onClick={openRewriterFlagsPage}
                    className="p-1.5 rounded-lg bg-[#FFFEEF] dark:bg-[#171816] border border-amber-500/30 text-left hover:border-[#005447] dark:hover:border-[#67E2C8] transition-colors flex items-center justify-between gap-1 cursor-pointer"
                    title="Rewriter API: Set to Enabled"
                  >
                    <div className="truncate">
                      <span className="block truncate font-semibold">4. Rewriter API</span>
                      <span className="text-[9px] text-emerald-700 dark:text-emerald-400 font-bold block truncate">Set to Enabled</span>
                    </div>
                    <ExternalLink className="w-2.5 h-2.5 text-[#77776E] shrink-0" />
                  </button>
                </div>

                {/* Helpful which-flag-to-pick guide */}
                <div className="p-2 rounded-lg bg-[#FFFEEF] dark:bg-[#171816] border border-amber-500/25 text-[9.5px] text-[#55554D] dark:text-[#C5C4B5] space-y-1">
                  <p className="font-bold text-amber-900 dark:text-amber-200">
                    💡 Which flags to enable when clicked:
                  </p>
                  <ul className="list-disc list-inside space-y-0.5 pl-0.5">
                    <li>
                      <strong>Optimization Guide:</strong> Select <strong className="text-emerald-700 dark:text-emerald-400">Enabled BypassPerfRequirement</strong> on <em>Enables optimization guide on device model</em>.
                    </li>
                    <li>
                      <strong>If multiple flags appear:</strong> Ignore <em>debug logs</em> / <em>dogfood logging</em>. If <em>Prompt API</em> appears, set to <strong className="text-emerald-700 dark:text-emerald-400">Enabled</strong>.
                    </li>
                    <li>
                      <strong>Missing in Chrome 154+?</strong> Search <code className="font-mono bg-amber-500/10 px-0.5 rounded">unexpire</code> &rarr; Enable <strong>Temporarily unexpire M154 / M155 flags</strong> &rarr; Relaunch.
                    </li>
                  </ul>
                </div>

                <div className="flex items-center justify-between gap-1.5 pt-0.5">
                  <button
                    onClick={openComponentsPage}
                    className="flex-1 p-1.5 rounded-lg bg-[#FFFEEF] dark:bg-[#171816] border border-amber-500/30 text-[10.5px] hover:border-[#005447] dark:hover:border-[#67E2C8] transition-colors flex items-center justify-center gap-1.5 cursor-pointer font-medium"
                    title="chrome://components: Check Optimization Guide On Device Model update"
                  >
                    <span>5. Components Updater (chrome://components)</span>
                    <ExternalLink className="w-2.5 h-2.5 text-[#77776E] shrink-0" />
                  </button>
                  <button
                    onClick={resetOnboarding}
                    className="p-1.5 rounded-lg bg-[#005447]/10 dark:bg-[#67E2C8]/10 text-[#005447] dark:text-[#67E2C8] text-[10.5px] font-semibold hover:underline shrink-0 cursor-pointer"
                    title="Open full interactive startup guide"
                  >
                    Setup Wizard
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Drag & Drop File Embedder Overlay */}
        {(isDraggingFiles || isEmbedding || embedSuccess) && (
          <div className="absolute inset-0 bg-[#FFFEEF]/95 dark:bg-[#171816]/95 backdrop-blur-sm z-50 flex items-center justify-center p-6 border-2 border-dashed border-[#005447] dark:border-[#67E2C8] m-2 rounded-2xl animate-fadeIn">
            <div className="text-center space-y-3">
              {isEmbedding ? (
                <>
                  <Loader2 className="w-12 h-12 text-[#005447] dark:text-[#67E2C8] animate-spin mx-auto" />
                  <p className="font-display text-lg font-semibold text-[#191919] dark:text-[#F5F1E7]">Embedding files to Vault...</p>
                  <p className="text-xs text-[#77776E] dark:text-[#A6A49B]">Building local vector embeddings</p>
                </>
              ) : embedSuccess ? (
                <>
                  <CheckCircle2 className="w-12 h-12 text-emerald-600 dark:text-emerald-400 mx-auto" />
                  <p className="font-display text-lg font-semibold text-[#191919] dark:text-[#F5F1E7]">{embedSuccess}</p>
                </>
              ) : (
                <>
                  <UploadCloud className="w-12 h-12 text-[#005447] dark:text-[#67E2C8] mx-auto animate-bounce" />
                  <p className="font-display text-lg font-semibold text-[#191919] dark:text-[#F5F1E7]">Drop files to add to Memory</p>
                  <p className="text-xs text-[#77776E] dark:text-[#A6A49B]">Supports PDF, TXT, MD, HTML, JSON</p>
                </>
              )}
            </div>
          </div>
        )}

        {/* Camera Shutter / Flash Animation Overlay */}
        {isFlashingScreenshot && (
          <div 
            className="fixed inset-0 z-[9999] pointer-events-none bg-white/95 backdrop-blur-xs transition-opacity duration-300 ease-out flex items-center justify-center"
          >
            <div className="p-4 rounded-full bg-black/50 text-white backdrop-blur-md shadow-2xl scale-110 transition-transform">
              <Camera className="w-9 h-9 text-white animate-pulse" />
            </div>
          </div>
        )}

        {/* Main Content Body */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col items-center justify-between px-3 sm:px-4 py-3 sm:py-5 select-none w-full min-w-0">
          {/* Editorial Intro */}
          <div className="text-center my-auto space-y-1 w-full min-w-0 px-2">
            <h1 className="font-display text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight text-[#191919] dark:text-[#F5F1E7] break-words">
              Speak naturally.
            </h1>
            <p className="font-sans text-[11px] sm:text-xs text-[#77776E] dark:text-[#A6A49B] max-w-sm mx-auto leading-relaxed break-words">
              On-device AI · Voice through your browser
            </p>
          </div>

          {/* Voice Page In-Body Flags Alert */}
          {!isAiFlagsReady && (
            <div className="w-full max-w-sm my-2 p-3 rounded-2xl bg-amber-500/15 dark:bg-amber-500/10 border border-amber-500/35 dark:border-amber-500/30 text-center animate-fadeIn shadow-xs shrink-0 select-none">
              <div className="flex items-center justify-center gap-1.5 text-amber-900 dark:text-amber-200 font-bold text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>Chrome AI Unavailable · Browser Voice</span>
              </div>
              <p className="text-[10.5px] text-[#77776E] dark:text-[#A6A49B] mt-1 leading-normal">
                Browser speech recognition may use an online service. Enable Chrome AI to use Gemini Nano on this device.
              </p>
              <div className="flex items-center justify-center gap-2 mt-2.5">
                <button
                  onClick={openAllRequiredFlags}
                  className="px-3 py-1.5 rounded-xl bg-[#005447] dark:bg-[#67E2C8] text-white dark:text-[#171816] text-[10.5px] font-bold hover:opacity-90 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Zap className="w-3 h-3" />
                  <span>Open Flags (1-Click)</span>
                </button>
                <button
                  onClick={resetOnboarding}
                  className="px-2.5 py-1.5 rounded-xl bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#191919] dark:text-[#F5F1E7] text-[10.5px] font-semibold hover:opacity-80 transition-opacity cursor-pointer"
                >
                  Setup Guide
                </button>
              </div>
            </div>
          )}

          {/* Assistant Response Card or Status */}
          {state.isProcessing || state.isSummarizing || isSpeaking || latestResponse ? (
            <div className="w-full max-w-sm my-2 px-3 sm:px-4 py-2.5 sm:py-3 rounded-2xl bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] shadow-sm text-center animate-fadeIn min-w-0 break-words">
              {state.executingTool ? (
                <div className="flex items-center justify-center gap-2 text-xs font-medium text-[#005447] dark:text-[#67E2C8] min-w-0 truncate">
                  {state.executingTool === 'captureScreenshot' ? (
                    <Camera className="w-3.5 h-3.5 animate-pulse shrink-0 text-[#005447] dark:text-[#67E2C8]" />
                  ) : (
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  )}
                  <span className="truncate">{getSpokenLine(state.executingTool) || `Executing ${state.executingTool}...`}</span>
                </div>
              ) : isSpeaking && currentSentence ? (
                <p className="font-display text-xs sm:text-sm text-[#191919] dark:text-[#F5F1E7] leading-relaxed break-words">
                  "{currentSentence}"
                </p>
              ) : latestResponse?.text ? (
                <div className="space-y-2 min-w-0">
                  <p className="font-display text-xs sm:text-sm text-[#191919] dark:text-[#F5F1E7] leading-relaxed line-clamp-3 break-words">
                    "{latestResponse.text}"
                  </p>
                  <div className="flex items-center justify-center pt-1 border-t border-[#DDDCCB]/50 dark:border-[#373832]/50">
                    <RatingButtons 
                      messageId={latestResponse.id}
                      currentRating={latestResponse.rating}
                      onRate={rateMessage}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2 text-xs text-[#77776E] dark:text-[#A6A49B]">
                  <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                  <span>Thinking...</span>
                </div>
              )}
            </div>
          ) : null}

          {/* Centered Waveform Canvas */}
          <div 
            className="w-full max-w-sm flex flex-col items-center justify-center my-2 sm:my-3 cursor-pointer min-w-0"
            onClick={state.isSummarizing ? undefined : handleWaveformClick}
            title={isSpeaking ? "Click to interrupt" : isListening ? "Click to stop listening" : "Click to speak"}
          >
            <Waveform state={waveformState} onClick={handleWaveformClick} />
          </div>

          {/* Voice Action Button */}
          <div className="my-2 flex flex-col items-center justify-center w-full min-w-0 px-2">
            <button
              onClick={handleWaveformClick}
              disabled={state.isSummarizing}
              className={`px-5 sm:px-7 py-2.5 sm:py-3 rounded-full font-sans text-xs sm:text-sm font-semibold tracking-wide flex items-center justify-center gap-2 sm:gap-2.5 transition-all shadow-sm select-none max-w-full ${
                isListening
                  ? 'bg-rose-600 text-white shadow-rose-500/40 scale-105 animate-pulse'
                  : isSpeaking
                  ? 'bg-[#005447] text-white hover:bg-[#003F36] dark:bg-[#67E2C8] dark:text-[#171816]'
                  : state.isProcessing
                  ? 'bg-amber-600 text-white cursor-wait'
                  : isPentoneSelected
                  ? 'bg-[#E9D2FF] hover:bg-[#DEBEFF] dark:bg-[#CDB0F3] dark:hover:bg-[#BF9DE8] text-[#191919] dark:text-[#171816] border border-[#D5B8F6] dark:border-[#BFA0E6] ring-2 ring-[#005447] dark:ring-[#67E2C8] ring-offset-2 ring-offset-[#FFFEEF] dark:ring-offset-[#171816] active:scale-95'
                  : 'bg-[#E9D2FF] hover:bg-[#DEBEFF] dark:bg-[#CDB0F3] dark:hover:bg-[#BF9DE8] text-[#191919] dark:text-[#171816] border border-[#D5B8F6] dark:border-[#BFA0E6] opacity-80 active:scale-95'
              }`}
            >
              {isListening ? (
                <>
                  <span className="w-2.5 h-2.5 rounded-full bg-white animate-ping shrink-0" />
                  <span className="truncate">Listening... Release to send</span>
                </>
              ) : isSpeaking ? (
                <>
                  <Square className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-current shrink-0" />
                  <span className="truncate">Interrupt Speech</span>
                </>
              ) : state.isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin shrink-0" />
                  <span className="truncate">Thinking...</span>
                </>
              ) : (
                <>
                  <AudioLines className="w-4 h-4 sm:w-5 sm:h-5 text-[#191919] dark:text-[#171816] shrink-0" />
                  <span className="truncate">Hold to Speak</span>
                  <span className="ml-1 px-1.5 py-0.5 rounded bg-black/10 dark:bg-purple-950/40 text-[10px] font-sans font-medium text-inherit shrink-0 flex items-center gap-1">
                    {isPentoneSelected && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" title="Ready to hold Space" />
                    )}
                    Space
                  </span>
                </>
              )}
            </button>
            {!isAiFlagsReady && (
              <div className="mt-1.5 flex items-center gap-1.5 text-[10px] font-mono text-amber-600 dark:text-amber-400">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
                <span>Browser Voice · Chrome AI Unavailable</span>
              </div>
            )}
          </div>

          {/* Live Transcript Preview while speaking */}
          {isListening && transcript && (
            <div className="w-full max-w-sm text-center px-3 sm:px-4 py-1.5 rounded-xl bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] text-xs font-mono text-[#005447] dark:text-[#67E2C8] animate-pulse break-words">
              "{transcript}"
            </div>
          )}
        </div>

        {/* Bottom Bar: Device Selectors & Input */}
        <div className="p-2.5 sm:p-3.5 border-t border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816] space-y-2 select-none w-full min-w-0">
          {/* Reference indicator */}
          {state.reference && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-[#E9D2FF]/30 dark:bg-[#CDB0F3]/20 border border-[#D5B8F6] dark:border-[#513E6B] rounded-xl text-xs w-full min-w-0">
              <Paperclip className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8] shrink-0" />
              <span className="text-[#191919] dark:text-[#F5F1E7] flex-1 truncate font-mono text-[11px] min-w-0">
                {state.reference.image ? 'Screenshot attached' : state.reference.audio ? 'Audio attached' : `"${state.reference.text.substring(0, 40)}..."`}
              </span>
              <button
                onClick={() => {
                  dispatch({ type: 'SET_REFERENCE', payload: null })
                  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
                    chrome.storage.local.remove('chat_reference')
                  }
                }}
                className="text-[#77776E] hover:text-rose-600 transition-colors shrink-0"
                title="Remove attachment"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Mic and Voice Selectors Row */}
          <div className="flex items-center justify-between gap-1.5 sm:gap-2 w-full min-w-0">
            <div className="flex-1 min-w-0">
              <MicSelector />
            </div>
            <div className="flex-1 min-w-0">
              <VoiceSelector />
            </div>
            <button
              onClick={() => setAudioEnabled(!audioEnabled)}
              className="p-2 rounded-xl bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] text-[#56564E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] transition-colors shrink-0"
              title={audioEnabled ? "Mute speech audio" : "Unmute speech audio"}
            >
              {audioEnabled ? <Volume2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#005447] dark:text-[#67E2C8] shrink-0" /> : <Volume2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 opacity-40 shrink-0" />}
            </button>
          </div>

          {/* Instruction Text Input Form */}
          <form onSubmit={handleTextSubmit} className="relative flex items-center w-full min-w-0">
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              disabled={state.isProcessing || state.isSummarizing}
              placeholder="Type an instruction or question..."
              className="w-full min-w-0 bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-full pl-3.5 sm:pl-4 pr-10 sm:pr-11 py-2 sm:py-2.5 text-xs text-[#191919] dark:text-[#F5F1E7] placeholder-[#77776E] dark:placeholder-[#A6A49B] transition-all focus:border-[#005447] dark:focus:border-[#67E2C8] disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!textInput.trim() || state.isProcessing || state.isSummarizing}
              className="absolute right-1 sm:right-1.5 p-1.5 sm:p-2 rounded-full bg-[#005447] hover:bg-[#003F36] dark:bg-[#1E4D40] dark:hover:bg-[#256050] text-white dark:text-[#67E2C8] transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-xs shrink-0"
              title="Send message"
            >
              <SendHorizontal className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            </button>
          </form>
        </div>
      </div>
    </>
  )
}
