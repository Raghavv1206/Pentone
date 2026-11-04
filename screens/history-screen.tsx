import React, { useState, useMemo } from 'react'
import { Clock, Search, Trash2, Copy, Check, MessageSquare, ArrowLeft } from 'lucide-react'
import { useChatContext } from '../lib/chat-context'
import { AppHeader } from '../components/navigation/app-header'
import { type Screen } from '../lib/config'

interface HistoryScreenProps {
  onNavigate: (screen: Screen) => void
  onOpenSidePanel?: () => void
}

export const HistoryScreen: React.FC<HistoryScreenProps> = ({ onNavigate, onOpenSidePanel }) => {
  const { state, resetChat } = useChatContext()
  const [searchQuery, setSearchQuery] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const filteredMessages = useMemo(() => {
    return state.messages.filter(msg => {
      if (msg.content.startsWith('[TOOL RESULT]')) return false
      if (!searchQuery.trim()) return true
      return msg.content.toLowerCase().includes(searchQuery.toLowerCase())
    })
  }, [state.messages, searchQuery])

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

  return (
    <div className="flex flex-col h-full bg-[#FFFEEF] dark:bg-[#171816] text-[#191919] dark:text-[#F5F1E7] overflow-hidden select-none">
      <AppHeader
        currentScreen="history"
        onNavigate={onNavigate}
        contextCount={latestContextCount}
        onOpenSidePanel={onOpenSidePanel}
      />

      {/* Search & Actions Bar */}
      <div className="p-2.5 sm:p-3.5 border-b border-[#DDDCCB] dark:border-[#373832] flex items-center gap-2 w-full min-w-0">
        <div className="relative flex-1 min-w-0">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#77776E] dark:text-[#A6A49B]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversation history..."
            className="w-full min-w-0 bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-xl pl-9 pr-3 py-1.5 text-xs text-[#191919] dark:text-[#F5F1E7] placeholder-[#77776E] dark:placeholder-[#A6A49B] focus:border-[#005447] dark:focus:border-[#67E2C8]"
          />
        </div>

        {state.messages.length > 0 && (
          <button
            onClick={resetChat}
            className="p-2 rounded-xl text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-transparent hover:border-rose-200 dark:hover:border-rose-900 transition-colors shrink-0"
            title="Clear all history"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* History List */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-3 w-full min-w-0">
        {filteredMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2 opacity-70 my-auto">
            <Clock className="w-8 h-8 text-[#77776E] dark:text-[#A6A49B]" />
            <p className="font-display text-base font-semibold">No Conversation History</p>
            <p className="text-xs text-[#77776E] dark:text-[#A6A49B]">
              {searchQuery ? 'No messages match your search filter.' : 'Your chat interactions will appear here.'}
            </p>
          </div>
        ) : (
          filteredMessages.map((msg) => {
            const isUser = msg.role === 'user'
            const cleanContent = msg.content.split('<function_call>')[0].trim() || msg.content

            return (
              <div
                key={msg.id}
                className="p-3 rounded-2xl bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] space-y-2 select-text w-full min-w-0 break-words"
              >
                <div className="flex items-center justify-between text-[11px] text-[#77776E] dark:text-[#A6A49B]">
                  <span className={`font-semibold ${isUser ? 'text-[#005447] dark:text-[#67E2C8]' : 'text-[#191919] dark:text-[#F5F1E7]'}`}>
                    {isUser ? 'User Prompt' : 'Pentone Response'}
                  </span>
                  <button
                    onClick={() => handleCopy(msg.id, cleanContent)}
                    className="hover:text-[#191919] dark:hover:text-[#F5F1E7] flex items-center gap-1 shrink-0"
                  >
                    {copiedId === msg.id ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                        <span className="text-[10px]">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span className="text-[10px]">Copy</span>
                      </>
                    )}
                  </button>
                </div>

                <p className="text-xs font-sans text-[#191919] dark:text-[#F5F1E7] leading-relaxed whitespace-pre-wrap break-words">
                  {cleanContent}
                </p>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
