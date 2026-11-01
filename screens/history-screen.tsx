import React, { useState, useEffect } from 'react'
import { Search, Clock, Trash2, ArrowRight, MessageSquare, Mic } from 'lucide-react'
import { AppHeader } from '../components/navigation/app-header'
import { useChatContext } from '../lib/chat-context'
import { type Message } from '../lib/messages'
import { type Screen } from '../lib/config'

interface HistoryScreenProps {
  onNavigate: (screen: Screen) => void
  onOpenSidePanel?: () => void
}

interface ConversationSession {
  id: string
  title: string
  preview: string
  timestamp: number
  messageCount: number
  hasVoice: boolean
  messages: Message[]
}

export const HistoryScreen: React.FC<HistoryScreenProps> = ({ onNavigate, onOpenSidePanel }) => {
  const { state, dispatch, resetChat } = useChatContext()
  const [searchQuery, setSearchQuery] = useState('')
  const [sessions, setSessions] = useState<ConversationSession[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Load conversation history from local storage
  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get(['chat_messages', 'chat_history_archive'], (res) => {
        const currentMessages: Message[] = res.chat_messages || []
        const archives: Message[][] = res.chat_history_archive || []

        const sessionList: ConversationSession[] = []

        // Add current active session
        if (currentMessages.length > 0) {
          const firstUserMsg = currentMessages.find(m => m.role === 'user')
          const title = firstUserMsg ? firstUserMsg.content.slice(0, 48) : 'Active Session'
          const lastMsg = currentMessages[currentMessages.length - 1]
          sessionList.push({
            id: 'current_session',
            title: title + (firstUserMsg && firstUserMsg.content.length > 48 ? '...' : ''),
            preview: lastMsg?.content.slice(0, 80) || 'Active conversation in progress',
            timestamp: lastMsg?.timestamp || Date.now(),
            messageCount: currentMessages.length,
            hasVoice: currentMessages.some(m => (m as any).isVoice || false),
            messages: currentMessages
          })
        }

        // Add archived sessions if any
        archives.forEach((archive, idx) => {
          if (archive.length === 0) return
          const firstUserMsg = archive.find(m => m.role === 'user')
          const title = firstUserMsg ? firstUserMsg.content.slice(0, 48) : `Session #${idx + 1}`
          const lastMsg = archive[archive.length - 1]
          sessionList.push({
            id: `archive_${idx}`,
            title: title + (firstUserMsg && firstUserMsg.content.length > 48 ? '...' : ''),
            preview: lastMsg?.content.slice(0, 80) || 'Archived conversation',
            timestamp: lastMsg?.timestamp || Date.now() - (idx + 1) * 3600000,
            messageCount: archive.length,
            hasVoice: archive.some(m => (m as any).isVoice || false),
            messages: archive
          })
        })

        setSessions(sessionList)
        setIsLoading(false)
      })
    } else {
      setIsLoading(false)
    }
  }, [state.messages])

  const filteredSessions = sessions.filter(session => {
    const q = searchQuery.toLowerCase()
    return (
      session.title.toLowerCase().includes(q) ||
      session.preview.toLowerCase().includes(q) ||
      session.messages.some(m => m.content.toLowerCase().includes(q))
    )
  })

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffHours = Math.abs(now.getTime() - date.getTime()) / 36e5

    if (diffHours < 24) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } else if (diffHours < 168) {
      return date.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
    }
  }

  // Restore session using valid ChatAction SET_MESSAGES
  // Strictly restores message history only - never restores VoiceTurnGrant, execution tokens, or pending tool calls
  const handleRestoreSession = (session: ConversationSession) => {
    if (!session || !Array.isArray(session.messages)) return

    // Cleanly map purely textual/informational Message fields, guaranteeing no authorization tokens are attached
    const sanitizedMessages: Message[] = session.messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      contextCount: m.contextCount,
      rating: m.rating,
      visualOnly: m.visualOnly,
      isInternal: m.isInternal,
      messageType: m.messageType
    }))

    dispatch({ type: 'SET_MESSAGES', payload: sanitizedMessages })
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ chat_messages: sanitizedMessages })
    }
    onNavigate('chat')
  }

  // Clear all history using valid ChatAction RESET and resetChat()
  const handleClearAll = () => {
    if (confirm('Clear all conversation history? This cannot be undone.')) {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.remove(['chat_messages', 'chat_history_archive'], () => {
          resetChat()
          setSessions([])
        })
      } else {
        resetChat()
        setSessions([])
      }
    }
  }

  return (
    <div className="w-full h-full flex flex-col min-h-0 bg-[#FFFEEF] dark:bg-[#171816] text-[#191919] dark:text-[#F5F1E7]">
      <AppHeader 
        currentScreen="history" 
        onNavigate={onNavigate}
        onOpenSidePanel={onOpenSidePanel}
      />

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 max-w-2xl mx-auto w-full">
        {/* Title and search bar */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight text-[#191919] dark:text-[#F5F1E7]">
              Conversation History
            </h1>
            <p className="font-sans text-xs text-[#77776E] dark:text-[#A6A49B]">
              Search and restore past interactions
            </p>
          </div>

          {sessions.length > 0 && (
            <button
              onClick={handleClearAll}
              className="px-2.5 py-1 text-xs font-sans text-rose-600 hover:text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-colors flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear History</span>
            </button>
          )}
        </div>

        {/* Search input */}
        <div className="relative mb-4">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#77776E] dark:text-[#A6A49B]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations, voice turns, or tool results..."
            className="w-full bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-xl pl-9 pr-4 py-2 text-xs font-sans text-[#191919] dark:text-[#F5F1E7] placeholder-[#77776E] dark:placeholder-[#A6A49B] focus:outline-none focus:border-[#005447] dark:focus:border-[#67E2C8]"
          />
        </div>

        {/* Session cards */}
        {isLoading ? (
          <div className="py-12 text-center text-xs text-[#77776E] dark:text-[#A6A49B]">
            Loading history...
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="py-16 text-center">
            <div className="w-12 h-12 rounded-full bg-[#F3F1DF] dark:bg-[#22231F] flex items-center justify-center mx-auto mb-3 text-[#77776E] dark:text-[#A6A49B]">
              <Clock className="w-6 h-6" />
            </div>
            <h3 className="font-display text-base font-semibold text-[#191919] dark:text-[#F5F1E7]">
              {searchQuery ? 'No matching conversations' : 'No conversations yet'}
            </h3>
            <p className="font-sans text-xs text-[#77776E] dark:text-[#A6A49B] mt-1 max-w-xs mx-auto">
              {searchQuery 
                ? 'Try a different query or keyword from your voice commands.'
                : 'Your voice interactions and chat sessions will appear here.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filteredSessions.map((session) => (
              <div
                key={session.id}
                onClick={() => handleRestoreSession(session)}
                className="group p-3.5 rounded-2xl bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] hover:border-[#005447] dark:hover:border-[#67E2C8] transition-all cursor-pointer shadow-sm hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {session.hasVoice ? (
                        <span className="p-1 rounded-md bg-[#E9D2FF] dark:bg-[#CDB0F3]/30 text-[#191919] dark:text-[#CDB0F3]" title="Includes voice commands">
                          <Mic className="w-3 h-3" />
                        </span>
                      ) : (
                        <span className="p-1 rounded-md bg-stone-200 dark:bg-stone-800 text-[#77776E] dark:text-[#A6A49B]">
                          <MessageSquare className="w-3 h-3" />
                        </span>
                      )}
                      <h4 className="font-sans font-semibold text-xs text-[#191919] dark:text-[#F5F1E7] truncate">
                        {session.title}
                      </h4>
                    </div>

                    <p className="font-sans text-xs text-[#77776E] dark:text-[#A6A49B] line-clamp-2">
                      {session.preview}
                    </p>

                    <div className="flex items-center gap-3 mt-2 text-[10px] text-[#77776E] dark:text-[#A6A49B]">
                      <span>{formatDate(session.timestamp)}</span>
                      <span>·</span>
                      <span>{session.messageCount} messages</span>
                    </div>
                  </div>

                  <div className="text-[#77776E] group-hover:text-[#005447] dark:group-hover:text-[#67E2C8] transition-colors p-1">
                    <ArrowRight className="w-4 h-4 transform group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
