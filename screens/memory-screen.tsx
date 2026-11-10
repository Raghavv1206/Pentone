import React, { useState, useEffect, useMemo } from 'react'
import { BrainCircuit, Database, Search, Trash2, Tag, Calendar, Sparkles, Plus, CheckCircle2, Bookmark, FileText } from 'lucide-react'
import { getAllVaultEntries, deleteVaultEntry, type VaultEntry } from '../lib/vault'
import { AppHeader } from '../components/navigation/app-header'
import { type Screen } from '../lib/config'

interface AgentMemory {
  id: string
  content: string
  tags: string[]
  timestamp: string
  date: string
}

interface MemoryScreenProps {
  onNavigate: (screen: Screen) => void
  onOpenSidePanel?: () => void
}

export const MemoryScreen: React.FC<MemoryScreenProps> = ({ onNavigate, onOpenSidePanel }) => {
  const [activeTab, setActiveTab] = useState<'memories' | 'vault'>('memories')
  const [memories, setMemories] = useState<AgentMemory[]>([])
  const [vaultEntries, setVaultEntries] = useState<VaultEntry[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [newMemoryText, setNewMemoryText] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  // Load memories and vault entries
  const loadData = async () => {
    setIsLoading(true)
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const stored = await chrome.storage.local.get(['agent_memories'])
        setMemories(stored.agent_memories || [])
      }
      const vault = await getAllVaultEntries()
      setVaultEntries(vault || [])
    } catch (e) {
      console.warn('[MemoryScreen] Error loading memory data:', e)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleDeleteMemory = async (id: string) => {
    const updated = memories.filter(m => m.id !== id)
    setMemories(updated)
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ agent_memories: updated })
    }
  }

  const handleDeleteVaultEntry = async (id: string) => {
    await deleteVaultEntry(id)
    setVaultEntries(prev => prev.filter(v => v.id !== id))
  }

  const handleAddMemory = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMemoryText.trim()) return

    const newMem: AgentMemory = {
      id: Date.now().toString(),
      content: newMemoryText.trim(),
      tags: ['user-preference'],
      timestamp: new Date().toISOString(),
      date: new Date().toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })
    }

    const updated = [newMem, ...memories]
    setMemories(updated)
    setNewMemoryText('')

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ agent_memories: updated })
    }
  }

  const filteredMemories = useMemo(() => {
    if (!searchQuery.trim()) return memories
    const q = searchQuery.toLowerCase()
    return memories.filter(m => 
      m.content.toLowerCase().includes(q) ||
      m.tags.some(t => t.toLowerCase().includes(q))
    )
  }, [memories, searchQuery])

  const filteredVault = useMemo(() => {
    if (!searchQuery.trim()) return vaultEntries
    const q = searchQuery.toLowerCase()
    return vaultEntries.filter(v => 
      v.title.toLowerCase().includes(q) ||
      v.url.toLowerCase().includes(q) ||
      v.content.toLowerCase().includes(q)
    )
  }, [vaultEntries, searchQuery])

  return (
    <div className="flex flex-col h-full bg-[#FFFEEF] dark:bg-[#171816] text-[#191919] dark:text-[#F5F1E7] overflow-hidden select-none">
      <AppHeader
        currentScreen="memory"
        onNavigate={onNavigate}
        onOpenSidePanel={onOpenSidePanel}
      />

      {/* Tabs Row */}
      <div className="p-2.5 sm:p-3 border-b border-[#DDDCCB] dark:border-[#373832] flex flex-wrap items-center justify-between gap-2 w-full min-w-0">
        <div className="flex items-center gap-1 bg-[#F3F1DF] dark:bg-[#22231F] p-1 rounded-xl border border-[#DDDCCB] dark:border-[#373832] shrink-0">
          <button
            onClick={() => setActiveTab('memories')}
            className={`px-2.5 sm:px-3 py-1 rounded-lg text-xs font-sans font-medium transition-all flex items-center gap-1.5 shrink-0 ${
              activeTab === 'memories'
                ? 'bg-[#005447] text-white dark:bg-[#67E2C8] dark:text-[#171816] shadow-xs font-semibold'
                : 'text-[#56564E] dark:text-[#A6A49B] hover:text-[#191919] dark:hover:text-[#F5F1E7]'
            }`}
          >
            <BrainCircuit className="w-3.5 h-3.5 shrink-0" />
            <span>Memories ({memories.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('vault')}
            className={`px-2.5 sm:px-3 py-1 rounded-lg text-xs font-sans font-medium transition-all flex items-center gap-1.5 shrink-0 ${
              activeTab === 'vault'
                ? 'bg-[#005447] text-white dark:bg-[#67E2C8] dark:text-[#171816] shadow-xs font-semibold'
                : 'text-[#56564E] dark:text-[#A6A49B] hover:text-[#191919] dark:hover:text-[#F5F1E7]'
            }`}
          >
            <Database className="w-3.5 h-3.5 shrink-0" />
            <span>Vault ({vaultEntries.length})</span>
          </button>
        </div>

        <div className="relative flex-1 min-w-[100px] max-w-full">
          <Search className="w-3.5 h-3.5 sm:w-4 sm:h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#77776E] dark:text-[#A6A49B] shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter memories..."
            className="w-full min-w-0 bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-xl pl-8 pr-2.5 py-1 text-xs text-[#191919] dark:text-[#F5F1E7] placeholder-[#77776E] dark:placeholder-[#A6A49B] focus:border-[#005447] dark:focus:border-[#67E2C8]"
          />
        </div>
      </div>

      {/* Add Memory Input (Only in memories tab) */}
      {activeTab === 'memories' && (
        <form onSubmit={handleAddMemory} className="p-2.5 sm:p-3 border-b border-[#DDDCCB] dark:border-[#373832] flex items-center gap-2 w-full min-w-0">
          <input
            type="text"
            value={newMemoryText}
            onChange={(e) => setNewMemoryText(e.target.value)}
            placeholder="Remember a new fact or preference..."
            className="flex-1 min-w-0 w-full bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-xl px-3 py-1.5 text-xs text-[#191919] dark:text-[#F5F1E7] placeholder-[#77776E] dark:placeholder-[#A6A49B] focus:border-[#005447] dark:focus:border-[#67E2C8]"
          />
          <button
            type="submit"
            disabled={!newMemoryText.trim()}
            className="px-3 py-1.5 bg-[#005447] hover:bg-[#003F36] dark:bg-[#67E2C8] dark:hover:bg-[#52C5AD] text-white dark:text-[#171816] rounded-xl text-xs font-semibold transition-all disabled:opacity-40 flex items-center gap-1.5 shrink-0 shadow-xs"
          >
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span>Remember</span>
          </button>
        </form>
      )}

      {/* Content List */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-3 w-full min-w-0">
        {activeTab === 'memories' ? (
          filteredMemories.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2 opacity-70 my-auto">
              <BrainCircuit className="w-8 h-8 sm:w-10 sm:h-10 text-[#77776E] dark:text-[#A6A49B]" />
              <p className="font-display text-base font-semibold">No Stored Memories</p>
              <p className="text-xs text-[#77776E] dark:text-[#A6A49B]">
                Tell Pentone to remember something (e.g. "Remember that I like short summaries").
              </p>
            </div>
          ) : (
            filteredMemories.map((mem) => (
              <div
                key={mem.id}
                className="p-3.5 rounded-2xl bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] space-y-2 select-text"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs text-[#191919] dark:text-[#F5F1E7] leading-relaxed font-sans">
                    {mem.content}
                  </p>
                  <button
                    onClick={() => handleDeleteMemory(mem.id)}
                    className="p-1 text-[#77776E] hover:text-rose-600 dark:hover:text-rose-400 transition-colors shrink-0"
                    title="Delete memory"
                  >
                    <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                  </button>
                </div>

                <div className="flex items-center justify-between text-[10px] text-[#77776E] dark:text-[#A6A49B] pt-1 border-t border-[#DDDCCB]/40 dark:border-[#373832]/40">
                  <span className="flex items-center gap-1 font-mono">
                    <Calendar className="w-3 h-3 shrink-0" /> {mem.date || 'Recent'}
                  </span>
                  {mem.tags && mem.tags.length > 0 && (
                    <div className="flex items-center gap-1">
                      {mem.tags.map((t) => (
                        <span key={t} className="px-1.5 py-0.5 rounded-md bg-[#DDDCCB]/60 dark:bg-[#373832]/60 font-mono text-[9px] flex items-center gap-0.5">
                          <Tag className="w-2.5 h-2.5 shrink-0 opacity-60" />
                          <span>{t}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))
          )
        ) : (
          filteredVault.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2 opacity-70 my-auto">
              <Database className="w-8 h-8 sm:w-10 sm:h-10 text-[#77776E] dark:text-[#A6A49B]" />
              <p className="font-display text-base font-semibold">Vault is Empty</p>
              <p className="text-xs text-[#77776E] dark:text-[#A6A49B]">
                Captured web pages and embedded documents will appear here.
              </p>
            </div>
          ) : (
            filteredVault.map((entry) => (
              <div
                key={entry.id}
                className="p-3.5 rounded-2xl bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] space-y-1.5 select-text"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <FileText className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8] shrink-0" />
                    <h4 className="font-display text-xs font-bold text-[#191919] dark:text-[#F5F1E7] truncate">
                      {entry.title || entry.domain}
                    </h4>
                  </div>
                  <button
                    onClick={() => handleDeleteVaultEntry(entry.id)}
                    className="p-1 text-[#77776E] hover:text-rose-600 dark:hover:text-rose-400 transition-colors shrink-0"
                    title="Delete page"
                  >
                    <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                  </button>
                </div>

                <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B] line-clamp-2 leading-relaxed">
                  {entry.excerpt || entry.content.substring(0, 150)}
                </p>

                <div className="flex items-center justify-between text-[10px] text-[#77776E] dark:text-[#A6A49B] pt-1 border-t border-[#DDDCCB]/40 dark:border-[#373832]/40 font-mono">
                  <span>{entry.domain} · {entry.wordCount} words</span>
                  <span>{new Date(entry.timestamp).toLocaleDateString()}</span>
                </div>
              </div>
            ))
          )
        )}
      </div>
    </div>
  )
}
