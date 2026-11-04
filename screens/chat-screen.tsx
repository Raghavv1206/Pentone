import React, { useState, useRef, useEffect } from 'react'
import { Send, Mic, Square, Paperclip, X, Copy, Check, Sparkles, ArrowRight, RefreshCw, Download } from 'lucide-react'
import { useChatContext } from '../lib/chat-context'
import { useTTS } from '../lib/tts-context'
import { useVoiceInput } from '../lib/use-voice-input'
import { AppHeader } from '../components/navigation/app-header'
import { ToolActivity } from '../components/ui/tool-activity'
import { RatingButtons } from '../components/rating-buttons'
import { parseToolCall } from '../lib/tools'
import { stripInternalReasoning } from '../lib/reasoning-sanitizer'
import { type Screen } from '../lib/config'
import { useModelProvisioning } from '../lib/model-provisioning-context'
import { generativeRuntime, type ModelRuntimeState } from '../lib/generative-runtime'

interface ChatScreenProps {
  onNavigate: (screen: Screen) => void
  onOpenSidePanel?: () => void
}

export const ChatScreen: React.FC<ChatScreenProps> = ({ onNavigate, onOpenSidePanel }) => {
  const { state, sendMessage, interruptChat, rateMessage, dispatch } = useChatContext()
  const { isListening, transcript, handleMicClick } = useVoiceInput()
  const { audioEnabled, setAudioEnabled } = useTTS()
  const modelProv = useModelProvisioning()
  const [runtimeState, setRuntimeState] = useState<ModelRuntimeState>(generativeRuntime.getState())
  const [input, setInput] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const unsub = generativeRuntime.subscribe(setRuntimeState)
    return () => unsub()
  }, [])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [state.messages.length, state.isProcessing])

  // Sync speech transcript into input if mic was used
  useEffect(() => {
    if (transcript && isListening) {
      setInput(transcript)
    }
  }, [transcript, isListening])

  const handleSend = async () => {
    if (!input.trim() || state.isProcessing || state.isSummarizing) return
    const textToSend = input.trim()
    setInput('')
    await sendMessage(textToSend)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  // Filter messages to hide internal system banners and summaries from chat stream
  const visibleMessages = state.messages.filter(m => 
    !m.visualOnly && 
    m.messageType !== 'summary' &&
    !m.content.startsWith('[CONTEXT SUMMAR')
  )

  const quickPrompts = [
    "Summarize this webpage concisely",
    "Find all primary action buttons on page",
    "Open YouTube and search for Next.js tutorials",
    "Explain key concepts from this tab"
  ]

  return (
    <div className="w-full h-full flex flex-col bg-[#FFFEEF] dark:bg-[#171816] text-[#191919] dark:text-[#F5F1E7] overflow-hidden select-none">
      <AppHeader
        currentScreen="chat"
        onNavigate={onNavigate}
        audioEnabled={audioEnabled}
        onToggleAudio={() => setAudioEnabled(!audioEnabled)}
        onOpenSidePanel={onOpenSidePanel}
        statusDot={state.isProcessing ? 'processing' : isListening ? 'listening' : 'ready'}
      />

      {/* Dismissible First-Run Local AI Banner */}
      {!modelProv.isCached && !modelProv.bannerDismissed && !modelProv.isChecking && (
        <div className="mx-4 mt-2 p-2.5 rounded-xl bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] flex items-start justify-between gap-2.5 shadow-2xs">
          <div className="flex items-start gap-2">
            <Sparkles className="w-4 h-4 text-[#005447] dark:text-[#67E2C8] mt-0.5 shrink-0" />
            <div className="space-y-0.5">
              <div className="text-xs font-semibold text-[#191919] dark:text-[#F5F1E7]">
                Local AI Setup Required (SmolLM-135M)
              </div>
              <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B] leading-tight">
                Download local models (~200 MB) to unlock private offline chat, semantic search, and browser automation.
              </p>
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={() => modelProv.downloadAllModels()}
                  className="px-2.5 py-1 text-[11px] font-medium bg-[#005447] dark:bg-[#67E2C8] text-white dark:text-[#171816] rounded-lg hover:opacity-90 transition-opacity inline-flex items-center gap-1 shadow-xs"
                >
                  <Download className="w-3 h-3" /> Download (~200 MB)
                </button>
                <button
                  onClick={() => onNavigate('settings')}
                  className="text-[11px] text-[#77776E] dark:text-[#A6A49B] hover:text-[#191919] dark:hover:text-[#F5F1E7] font-medium inline-flex items-center gap-1"
                >
                  Settings <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>
          <button
            onClick={modelProv.dismissBanner}
            className="text-[#77776E] hover:text-[#191919] dark:hover:text-[#F5F1E7] p-1 shrink-0"
            title="Dismiss banner"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Worker Crash Recovery / Error Banner */}
      {(runtimeState.status === 'recovering' || (runtimeState.status === 'error' && runtimeState.error)) && (
        <div className="mx-4 mt-2 p-2.5 rounded-xl bg-[#FFF3E0] dark:bg-[#2A1E14] border border-[#FFE0B2] dark:border-[#4E342E] flex items-center justify-between gap-2.5 shadow-2xs">
          <div className="flex items-center gap-2 min-w-0">
            <RefreshCw className={`w-4 h-4 text-[#D84315] dark:text-[#FF8A65] shrink-0 ${runtimeState.status === 'recovering' ? 'animate-spin' : ''}`} />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-[#BF360C] dark:text-[#FFAB91] truncate">
                {runtimeState.status === 'recovering' ? 'Local AI Recovering...' : 'Local AI Engine Offline'}
              </div>
              <p className="text-[11px] text-[#D84315] dark:text-[#FF8A65] leading-tight truncate">
                {runtimeState.error || (runtimeState.status === 'recovering' ? `Re-initializing worker (attempt ${runtimeState.recoveryAttempt || 1}/${runtimeState.maxRecoveryAttempts || 3})...` : 'Inference worker encountered an error.')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {runtimeState.status === 'recovering' ? (
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

      {/* Message history */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
        {visibleMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-5">
            <div className="w-12 h-12 rounded-2xl bg-[#E9D2FF] dark:bg-[#CDB0F3]/20 flex items-center justify-center text-[#005447] dark:text-[#67E2C8] shadow-sm">
              <Sparkles className="w-6 h-6" />
            </div>

            <div className="space-y-1.5 max-w-xs">
              <h2 className="font-display text-xl font-semibold text-[#191919] dark:text-[#F5F1E7]">
                How can Pentone <span className="italic font-normal">assist</span> today?
              </h2>
              <p className="text-xs text-[#77776E] dark:text-[#A6A49B] leading-relaxed">
                Speak or type to navigate tabs, summarize pages, click elements, or query information.
              </p>
            </div>

            {/* Quick suggestion chips */}
            <div className="w-full max-w-sm grid grid-cols-1 gap-2 pt-2">
              {quickPrompts.map((prompt, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setInput(prompt)
                  }}
                  className="px-3.5 py-2.5 rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/70 dark:bg-[#22231F]/70 hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] text-left text-xs font-sans text-[#191919] dark:text-[#F5F1E7] transition-all flex items-center justify-between group shadow-2xs"
                >
                  <span className="truncate pr-2">{prompt}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-[#77776E] dark:text-[#A6A49B] group-hover:text-[#005447] dark:group-hover:text-[#67E2C8] transition-colors shrink-0" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          visibleMessages.map((msg) => {
            const isUser = msg.role === 'user'
            const isToolResult = msg.content.startsWith('[TOOL RESULT]')
            const toolCall = !isToolResult ? parseToolCall(msg.content) : null
            const cleanContent = stripInternalReasoning(msg.content)

            // Render Tool Result
            if (isToolResult) {
              const resultPayload = msg.content.replace('[TOOL RESULT]\n', '')
              return (
                <ToolActivity
                  key={msg.id}
                  toolName="Browser Action"
                  result={resultPayload}
                  status="completed"
                />
              )
            }

            // Render Tool Call message
            if (toolCall) {
              return (
                <ToolActivity
                  key={msg.id}
                  toolName={toolCall.function}
                  args={toolCall.arguments}
                  status={state.isProcessing ? 'running' : 'completed'}
                />
              )
            }

            // Render User Message
            if (isUser) {
              return (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-xs px-4 py-2.5 bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] text-sm text-[#191919] dark:text-[#F5F1E7] shadow-xs">
                    <p className="whitespace-pre-wrap leading-relaxed select-text font-sans">{cleanContent}</p>
                  </div>
                </div>
              )
            }

            // Render Assistant Message
            return (
              <div key={msg.id} className="flex flex-col space-y-1.5 max-w-[95%]">
                <div className="flex items-center gap-1.5 text-xs text-[#77776E] dark:text-[#A6A49B] font-display font-medium">
                  <span>Pentone</span>
                  {msg.provenance === 'generative' || msg.executionMode === 'worker' ? (
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20" title="Executed on dedicated off-thread Web Worker">
                      Local Model · {msg.modelId?.includes('smollm') || msg.modelId?.includes('qwen') ? 'SmolLM-135M' : (msg.modelId || 'SmolLM-135M')}
                    </span>
                  ) : msg.provenance === 'native' || msg.executionMode === 'native' ? (
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                      {msg.modelId?.includes('writer')
                        ? 'Chrome AI · Writer'
                        : msg.modelId?.includes('translator')
                        ? 'Chrome AI · Translator'
                        : msg.modelId?.includes('language-detector')
                        ? 'Chrome AI · LanguageDetector'
                        : 'Chrome AI · Gemini Nano'}
                    </span>
                  ) : msg.provenance === 'deterministic' || msg.executionMode === 'deterministic' ? (
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-neutral-500/10 text-neutral-600 dark:text-neutral-400 border border-neutral-500/20" title="Executed via local deterministic offline fallback">
                      Offline Fallback
                    </span>
                  ) : msg.executionMode === 'unavailable' ? (
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                      Local AI Unavailable
                    </span>
                  ) : null}
                  {msg.contextCount !== undefined && (
                    <span className="text-[10px] font-mono text-[#77776E]/80 dark:text-[#A6A49B]/80">
                      · {msg.contextCount}t
                    </span>
                  )}
                </div>

                <div className="rounded-2xl rounded-tl-xs px-4 py-3 bg-[#FFFEEF] dark:bg-[#1E1F1B] border border-[#DDDCCB] dark:border-[#373832] text-sm text-[#191919] dark:text-[#F5F1E7] shadow-xs leading-relaxed select-text">
                  <div className="whitespace-pre-wrap font-sans">{cleanContent}</div>

                  {/* Actions footer */}
                  <div className="mt-2.5 pt-2 border-t border-[#DDDCCB]/50 dark:border-[#373832]/50 flex items-center justify-between">
                    <button
                      onClick={() => handleCopy(msg.id, cleanContent)}
                      className="inline-flex items-center gap-1 text-[11px] text-[#77776E] dark:text-[#A6A49B] hover:text-[#191919] dark:hover:text-[#F5F1E7] transition-colors"
                      title="Copy response"
                    >
                      {copiedId === msg.id ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                          <span className="text-emerald-600 dark:text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>

                    <RatingButtons
                      messageId={msg.id}
                      currentRating={msg.rating}
                      onRate={rateMessage}
                      size="sm"
                    />
                  </div>
                </div>
              </div>
            )
          })
        )}

        {/* Processing/Streaming Indicator */}
        {state.isProcessing && (
          <div className="flex items-center gap-2 text-xs text-[#005447] dark:text-[#67E2C8] py-1 font-sans">
            <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
            <span className="font-medium">
              {runtimeState.status === 'downloading'
                ? `Compiling local model (${runtimeState.downloadProgress}%)...`
                : runtimeState.status === 'generating'
                ? 'Generating response (Local SmolLM-135M)...'
                : state.executingTool
                ? (state.executingTool === 'writeContent' || state.executingTool === 'summarizePage' || state.executingTool === 'translateText')
                  ? (modelProv.isResident ? `Generating with ${state.executingTool}...` : `Compiling local model & executing ${state.executingTool}...`)
                  : `Executing ${state.executingTool}...`
                : 'Pentone is thinking...'}
            </span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Composer Bottom Area */}
      <div className="flex-shrink-0 p-3 border-t border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816]">
        {/* Attached reference pill if active */}
        {state.reference && (
          <div className="mb-2 p-2 rounded-lg bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] flex items-center justify-between text-xs font-sans">
            <div className="flex items-center gap-2 min-w-0">
              <Paperclip className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8] shrink-0" />
              <span className="truncate text-[#191919] dark:text-[#F5F1E7]">
                {state.reference.text ? `"${state.reference.text.slice(0, 40)}..."` : 'Attached item'}
              </span>
            </div>
            <button
              onClick={() => dispatch({ type: 'SET_REFERENCE', payload: null })}
              className="text-[#77776E] hover:text-[#191919] dark:hover:text-[#F5F1E7]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Input box */}
        <div className="relative flex items-end rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF] dark:bg-[#22231F] focus-within:border-[#005447] dark:focus-within:border-[#67E2C8] transition-colors p-1.5 shadow-2xs">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message or instruction... (Enter to send)"
            rows={1}
            disabled={state.isProcessing}
            className="flex-1 bg-transparent border-0 px-2.5 py-1.5 text-xs sm:text-sm text-[#191919] dark:text-[#F5F1E7] placeholder-[#77776E] dark:placeholder-[#A6A49B] focus:outline-none resize-none max-h-28 overflow-y-auto font-sans"
          />

          <div className="flex items-center gap-1 shrink-0 pb-0.5 pr-0.5">
            <button
              onClick={handleMicClick}
              className={`p-1.5 rounded-lg text-[#77776E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] transition-colors ${
                isListening ? 'text-rose-500 bg-rose-100 dark:bg-rose-950/40 animate-pulse' : ''
              }`}
              title={isListening ? 'Stop recording' : 'Dictate message'}
            >
              <Mic className="w-4 h-4" />
            </button>

            {state.isProcessing ? (
              <button
                onClick={interruptChat}
                className="p-1.5 rounded-lg bg-rose-500 hover:bg-rose-600 text-white transition-colors"
                title="Stop generation"
              >
                <Square className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="p-1.5 rounded-lg bg-[#E9D2FF] hover:bg-[#DFC2FA] dark:bg-[#CDB0F3] dark:hover:bg-[#C2A1E8] text-[#191919] dark:text-[#171816] disabled:opacity-40 disabled:cursor-not-allowed transition-all font-semibold shadow-xs"
                title="Send message"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
