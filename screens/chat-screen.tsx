import React, { useState, useRef, useEffect, useMemo } from 'react'
import { Send, Mic, Square, Copy, Check, Sparkles, ArrowRight, RotateCcw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useChatContext } from '../lib/chat-context'
import { useTTS } from '../lib/tts-context'
import { useVoiceInput } from '../lib/use-voice-input'
import { AppHeader } from '../components/navigation/app-header'
import { RatingButtons } from '../components/rating-buttons'
import { parseToolCall } from '../lib/tools'
import { getSpokenLine } from '../lib/tool-registry'
import { type Screen } from '../lib/config'

function getCleanDisplayContent(content: string): string {
  if (!content) return ''
  const splitText = content.split(/<function_call>|```(?:tool_code|tool_call|function_call|json)/i)[0].trim()
  if (splitText) return splitText

  // If content has function_call without leading text, extract human-readable description
  const match = content.match(/<function_call>([\s\S]*?)<\/function_call>/i)
  if (match) {
    try {
      const parsed = JSON.parse(match[1].trim())
      return getSpokenLine(parsed.function, parsed.arguments || {})
    } catch {
      return 'Performing action...'
    }
  }

  return content
}

interface ChatScreenProps {
  onNavigate: (screen: Screen) => void
  onOpenSidePanel?: () => void
}

class MarkdownErrorBoundary extends React.Component<
  { content: string; children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { content: string; children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: any) {
    console.warn('[SafeMarkdown] Error rendering markdown, falling back to plain text:', error)
  }

  componentDidUpdate(prevProps: { content: string }) {
    if (prevProps.content !== this.props.content && this.state.hasError) {
      this.setState({ hasError: false })
    }
  }

  render() {
    if (this.state.hasError) {
      return <div className="whitespace-pre-wrap">{this.props.content}</div>
    }
    return this.props.children
  }
}

export const ChatScreen: React.FC<ChatScreenProps> = ({ onNavigate, onOpenSidePanel }) => {
  const { state, sendMessage, interruptChat, rateMessage, resetChat } = useChatContext()
  const { isListening, transcript, handleMicClick } = useVoiceInput()
  const { audioEnabled, setAudioEnabled } = useTTS()
  const [input, setInput] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

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

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || state.isProcessing) return
    sendMessage(input.trim())
    setInput('')
  }

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const latestContextCount = useMemo(() => {
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const msg = state.messages[i]
      if (msg.contextCount !== undefined) {
        return msg.contextCount
      }
    }
    return 0
  }, [state.messages])

  const computedStatusDot: 'ready' | 'listening' | 'processing' = useMemo(() => {
    if (isListening) return 'listening'
    if (state.isProcessing || state.isSummarizing) return 'processing'
    return 'ready'
  }, [isListening, state.isProcessing, state.isSummarizing])

  // Filter out internal tool result messages from display
  const displayMessages = useMemo(() => {
    return state.messages.filter(msg => !msg.content.startsWith('[TOOL RESULT]'))
  }, [state.messages])

  return (
    <div className="flex flex-col w-full h-full min-h-0 min-w-0 bg-[#FFFEEF] dark:bg-[#171816] text-[#191919] dark:text-[#F5F1E7] overflow-hidden select-none">
      <AppHeader
        currentScreen="chat"
        onNavigate={onNavigate}
        contextCount={latestContextCount}
        audioEnabled={audioEnabled}
        onToggleAudio={() => setAudioEnabled(!audioEnabled)}
        onOpenSidePanel={onOpenSidePanel}
        statusDot={computedStatusDot}
      />

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {displayMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2 opacity-80 my-auto">
            <div className="w-10 h-10 rounded-full bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] flex items-center justify-center text-[#005447] dark:text-[#67E2C8] mb-2">
              <Sparkles className="w-5 h-5" />
            </div>
            <h3 className="font-display text-lg font-bold text-[#191919] dark:text-[#F5F1E7]">
              Start a Conversation
            </h3>
            <p className="font-sans text-xs text-[#77776E] dark:text-[#A6A49B] max-w-xs leading-relaxed">
              Ask anything, summarize web pages, write documents, or control browser tabs naturally.
            </p>
          </div>
        ) : (
          displayMessages.map((msg) => {
            const isUser = msg.role === 'user'
            // Strip any raw function call syntax for clean reading
            const cleanContent = getCleanDisplayContent(msg.content)
            const tokenCount = msg.contextCount || latestContextCount || 3987

            if (isUser) {
              return (
                <div key={msg.id} className="flex flex-col items-end space-y-1 w-full min-w-0">
                  <div className="max-w-[90%] sm:max-w-[85%] rounded-2xl px-3.5 sm:px-4 py-2 sm:py-2.5 bg-[#EBE7D0] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] text-xs sm:text-sm text-[#191919] dark:text-[#F5F1E7] select-text shadow-xs break-words">
                    {cleanContent}
                  </div>
                </div>
              )
            }

            return (
              <div key={msg.id} className="w-full min-w-0 flex flex-col items-start space-y-1.5 select-text animate-fadeIn">
                {/* Assistant Metadata Header */}
                <div className="flex flex-wrap items-center gap-1.5 px-1 text-xs text-[#77776E] dark:text-[#A6A49B]">
                  <span className="font-display font-medium text-sm text-[#191919] dark:text-[#E8E6DF] shrink-0">
                    Pentone
                  </span>
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-sky-800/40 bg-sky-950/20 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 text-[10px] font-mono shrink-0">
                    <span>Chrome AI</span>
                    <span>·</span>
                    <span>Gemini Nano</span>
                  </div>
                  <span>·</span>
                  <span className="font-mono text-[11px] text-[#77776E] dark:text-[#888780] shrink-0">
                    {tokenCount}t
                  </span>
                </div>

                {/* Assistant Message Card */}
                <div className="w-full min-w-0 rounded-2xl border border-[#DDDCCB] dark:border-[#2B2B28] bg-[#F3F1DF] dark:bg-[#1E1F1C] p-3.5 sm:p-4 text-[#191919] dark:text-[#F5F1E7] shadow-xs break-words">
                  <div className="prose dark:prose-invert prose-xs sm:prose-sm max-w-none break-words text-xs sm:text-sm leading-relaxed overflow-x-auto">
                    <MarkdownErrorBoundary content={cleanContent}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {cleanContent}
                      </ReactMarkdown>
                    </MarkdownErrorBoundary>
                  </div>

                  {/* Assistant Actions Bar */}
                  <div className="flex items-center justify-between pt-2.5 mt-3 border-t border-[#DDDCCB]/60 dark:border-[#2D2E2B] text-xs">
                    <button
                      onClick={() => handleCopy(msg.id, cleanContent)}
                      className="p-1 rounded-md text-[#77776E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] flex items-center gap-1.5 transition-colors shrink-0"
                      title="Copy message"
                    >
                      {copiedId === msg.id ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                          <span className="text-[11px]">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span className="text-[11px]">Copy</span>
                        </>
                      )}
                    </button>

                    <RatingButtons
                      messageId={msg.id}
                      currentRating={msg.rating}
                      onRate={rateMessage}
                    />
                  </div>
                </div>
              </div>
            )
          })
        )}

        {/* Processing Indicator */}
        {state.isProcessing && (
          <div className="flex items-center gap-2 p-3 bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-2xl max-w-xs text-xs text-[#005447] dark:text-[#67E2C8] animate-pulse">
            <Sparkles className="w-4 h-4 animate-spin" />
            <span>{state.executingTool ? `Running ${state.executingTool}...` : 'Generating response...'}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar */}
      <div className="p-2.5 sm:p-3.5 border-t border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816] w-full min-w-0">
        <form onSubmit={handleSend} className="relative flex items-center gap-1.5 sm:gap-2 w-full min-w-0">
          <button
            type="button"
            onClick={resetChat}
            className="p-2 rounded-xl text-[#77776E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] hover:bg-[#F3F1DF] dark:hover:bg-[#22231F] transition-colors shrink-0"
            title="Clear Chat History"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <div className="relative flex-1 min-w-0">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isListening ? "Listening..." : "Type an instruction or question..."}
              className="w-full min-w-0 bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-xl pl-3.5 pr-10 py-2.5 text-xs text-[#191919] dark:text-[#F5F1E7] placeholder-[#77776E] dark:placeholder-[#A6A49B] transition-all focus:border-[#005447] dark:focus:border-[#67E2C8]"
              disabled={state.isProcessing}
            />

            <button
              type="submit"
              disabled={!input.trim() || state.isProcessing}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-[#005447] hover:bg-[#003F36] dark:bg-[#67E2C8] dark:hover:bg-[#52C5AD] text-white dark:text-[#171816] transition-all disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
              title="Send"
            >
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleMicClick}
            className={`p-2 sm:p-2.5 rounded-xl text-white transition-all shrink-0 ${
              isListening 
                ? 'bg-rose-600 animate-pulse shadow-md' 
                : 'bg-[#E9D2FF] hover:bg-[#DEBEFF] dark:bg-[#CDB0F3] dark:hover:bg-[#BF9DE8] text-[#191919] dark:text-[#171816]'
            }`}
            title={isListening ? "Stop listening" : "Speak instruction"}
          >
            <Mic className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  )
}
