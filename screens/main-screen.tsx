import "../lib/suppress-warnings"
import React, { useMemo, useState, useEffect, useRef } from "react"
import { 
  Mic, Square, Paperclip, X, ArrowRight, Loader2, Sparkles, Volume2, 
  UploadCloud, FileText, CheckCircle2, AlertCircle 
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
import { getCompleteSentences } from "../lib/sentence-parser"
import { embedFiles } from "../lib/file-embedder"
import { type Screen } from "../lib/config"

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
  const { state: onboardingState, isPopup } = useOnboarding()
  const { isListening, transcript, handleMicClick } = useVoiceInput()
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
        if (msg.role === 'assistant' && !msg.content.startsWith('[TOOL RESULT]')) {
          const textBeforeToolCall = msg.content.split('<function_call>')[0].trim()
          const text = getCompleteSentences(textBeforeToolCall || msg.content)
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
      if (msg.role === 'assistant' && !msg.content.startsWith('[TOOL RESULT]')) {
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

  // Feed new assistant messages to TTS
  useEffect(() => {
    if (!isInitialLoadComplete) return
    
    if (latestResponse?.text && latestResponse.text !== lastSpokenTextRef.current) {
      const sentences = getCompleteSentences(latestResponse.text)
      if (sentences.length > lastSpokenTextRef.current.length) {
        const newText = sentences.slice(lastSpokenTextRef.current.length)
        handleNewText(newText)
        lastSpokenTextRef.current = sentences
      }
    }
  }, [latestResponse?.text, isInitialLoadComplete, handleNewText])

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

  // Spacebar hold/toggle to speak listener
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
          handleMicClick()
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
        // Only stop on keyup if user deliberately held Space (>600ms) as push-to-talk.
        // If user tapped/pressed Space (<=600ms), KEEP LISTENING so they can speak!
        if (duration > 600 && isListening) {
          handleMicClick()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [isListening, state.isProcessing, state.isSummarizing, handleMicClick])

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
      soundEffects.playSpeechInterrupted?.()
      stop()
      interruptChat()
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

  const computedStatusDot: 'ready' | 'listening' | 'processing' = useMemo(() => {
    if (isListening) return 'listening'
    if (state.isProcessing || state.isSummarizing || isSpeaking) return 'processing'
    return 'ready'
  }, [isListening, state.isProcessing, state.isSummarizing, isSpeaking])

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

        {/* Main Content Body */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col items-center justify-between px-3 sm:px-4 py-3 sm:py-5 select-none w-full min-w-0">
          {/* Editorial Intro */}
          <div className="text-center my-auto space-y-1 w-full min-w-0 px-2">
            <h1 className="font-display text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight text-[#191919] dark:text-[#F5F1E7] break-words">
              Speak naturally.
            </h1>
            <p className="font-sans text-[11px] sm:text-xs text-[#77776E] dark:text-[#A6A49B] max-w-sm mx-auto leading-relaxed break-words">
              Zero cloud latency · 100% private in-browser intelligence
            </p>
          </div>

          {/* Assistant Response Card or Status */}
          {state.isProcessing || state.isSummarizing || isSpeaking || latestResponse ? (
            <div className="w-full max-w-sm my-2 px-3 sm:px-4 py-2.5 sm:py-3 rounded-2xl bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] shadow-sm text-center animate-fadeIn min-w-0 break-words">
              {state.executingTool ? (
                <div className="flex items-center justify-center gap-2 text-xs font-medium text-[#005447] dark:text-[#67E2C8] min-w-0 truncate">
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
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
                  : 'bg-[#E9D2FF] hover:bg-[#DEBEFF] dark:bg-[#CDB0F3] dark:hover:bg-[#BF9DE8] text-[#191919] dark:text-[#171816] border border-[#D5B8F6] dark:border-[#BFA0E6] active:scale-95'
              }`}
            >
              {isListening ? (
                <>
                  <span className="w-2.5 h-2.5 rounded-full bg-white animate-ping shrink-0" />
                  <span className="truncate">Listening... Release to send</span>
                </>
              ) : isSpeaking ? (
                <>
                  <Square className="w-3.5 h-3.5 fill-current shrink-0" />
                  <span className="truncate">Interrupt Speech</span>
                </>
              ) : state.isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  <span className="truncate">Thinking...</span>
                </>
              ) : (
                <>
                  <Mic className="w-4 h-4 text-[#191919] dark:text-[#171816] shrink-0" />
                  <span className="truncate">Hold to Speak</span>
                  <span className="ml-1 px-1.5 py-0.5 rounded bg-black/10 dark:bg-purple-950/40 text-[10px] font-sans font-medium text-inherit shrink-0">
                    Space
                  </span>
                </>
              )}
            </button>
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
              {audioEnabled ? <Volume2 className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" /> : <Volume2 className="w-4 h-4 opacity-40" />}
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
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      </div>
    </>
  )
}
