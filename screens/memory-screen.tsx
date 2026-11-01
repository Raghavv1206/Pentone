import React, { useState, useEffect } from 'react'
import { Brain, Plus, Trash2, ShieldCheck, Lock, Search, AlertCircle, Database, Check } from 'lucide-react'
import { AppHeader } from '../components/navigation/app-header'
import { getVaultStats, searchVault, clearVault } from '../lib/vault'
import { type Screen } from '../lib/config'

interface MemoryScreenProps {
  onNavigate: (screen: Screen) => void
  onOpenSidePanel?: () => void
}

interface AgentMemory {
  id: string
  content: string
  timestamp: number
}

export const MemoryScreen: React.FC<MemoryScreenProps> = ({ onNavigate, onOpenSidePanel }) => {
  const [memories, setMemories] = useState<AgentMemory[]>([])
  const [newMemory, setNewMemory] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [vaultStats, setVaultStats] = useState<any>(null)
  const [activeTab, setActiveTab] = useState<'facts' | 'vault'>('facts')
  const [isAdding, setIsAdding] = useState(false)

  // Load real memories from storage on mount
  const loadMemories = () => {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get(['agent_memories'], (res) => {
        setMemories(res.agent_memories || [])
      })
    }
  }

  const loadVault = async () => {
    try {
      const stats = await getVaultStats()
      setVaultStats(stats)
    } catch {
      setVaultStats(null)
    }
  }

  useEffect(() => {
    loadMemories()
    loadVault()
  }, [])

  const handleAddMemory = () => {
    if (!newMemory.trim()) return
    const entry: AgentMemory = {
      id: `mem_${Date.now()}`,
      content: newMemory.trim(),
      timestamp: Date.now()
    }
    const updated = [entry, ...memories]
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ agent_memories: updated }, () => {
        setMemories(updated)
        setNewMemory('')
        setIsAdding(false)
      })
    } else {
      setMemories(updated)
      setNewMemory('')
      setIsAdding(false)
    }
  }

  const handleDeleteMemory = (id: string) => {
    const updated = memories.filter(m => m.id !== id)
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ agent_memories: updated }, () => {
        setMemories(updated)
      })
    } else {
      setMemories(updated)
    }
  }

  const handleClearAll = () => {
    if (confirm('Delete all stored personalization memories?')) {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.remove(['agent_memories'], () => {
          setMemories([])
        })
      }
    }
  }

  const filteredMemories = memories.filter(m => 
    m.content.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="w-full h-full flex flex-col bg-[#FFFEEF] dark:bg-[#171816] text-[#191919] dark:text-[#F5F1E7] overflow-hidden select-none">
      <AppHeader
        currentScreen="memory"
        onNavigate={onNavigate}
        onOpenSidePanel={onOpenSidePanel}
      />

      <div className="flex-1 min-h-0 flex flex-col p-4 overflow-hidden">
        {/* Privacy Callout Banner */}
        <div className="mb-4 p-3 rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/70 dark:bg-[#22231F]/70 flex items-start gap-2.5">
          <ShieldCheck className="w-4 h-4 text-[#005447] dark:text-[#67E2C8] shrink-0 mt-0.5" />
          <div className="text-xs font-sans leading-relaxed">
            <span className="font-semibold text-[#191919] dark:text-[#F5F1E7]">Local-First Memory: </span>
            <span className="text-[#77776E] dark:text-[#A6A49B]">
              All facts, preferences, and vault context remain stored strictly inside your browser sandbox. Never transmitted to third-party cloud servers.
            </span>
          </div>
        </div>

        {/* Tab switcher: User Facts vs Page Knowledge Vault */}
        <div className="flex items-center gap-2 mb-3 shrink-0">
          <button
            onClick={() => setActiveTab('facts')}
            className={`px-3 py-1.5 rounded-lg text-xs font-sans font-medium transition-all ${
              activeTab === 'facts'
                ? 'bg-[#E9D2FF] text-[#191919] font-semibold border border-[#D5B5F5] dark:bg-[#CDB0F3] dark:text-[#171816]'
                : 'text-[#77776E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7]'
            }`}
          >
            Personal Preferences ({memories.length})
          </button>
          <button
            onClick={() => setActiveTab('vault')}
            className={`px-3 py-1.5 rounded-lg text-xs font-sans font-medium transition-all ${
              activeTab === 'vault'
                ? 'bg-[#E9D2FF] text-[#191919] font-semibold border border-[#D5B5F5] dark:bg-[#CDB0F3] dark:text-[#171816]'
                : 'text-[#77776E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7]'
            }`}
          >
            Page Knowledge Vault ({vaultStats?.totalChunks || 0})
          </button>
        </div>

        {activeTab === 'facts' ? (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {/* Search & Add bar */}
            <div className="flex items-center gap-2 mb-3 shrink-0">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#77776E] dark:text-[#A6A49B]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter remembered facts..."
                  className="w-full rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF] dark:bg-[#22231F] pl-8 pr-3 py-1.5 text-xs text-[#191919] dark:text-[#F5F1E7] placeholder-[#77776E] dark:placeholder-[#A6A49B] focus:outline-none focus:border-[#005447] dark:focus:border-[#67E2C8]"
                />
              </div>

              <button
                onClick={() => setIsAdding(!isAdding)}
                className="px-2.5 py-1.5 rounded-xl bg-[#005447] hover:bg-[#003F36] text-[#FFFEEF] dark:bg-[#07584B] dark:hover:bg-[#064238] dark:text-[#F5F1E7] text-xs font-medium flex items-center gap-1.5 transition-colors shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Fact
              </button>
            </div>

            {/* Add memory form */}
            {isAdding && (
              <div className="mb-3 p-3 rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF] dark:bg-[#22231F] space-y-2 shrink-0">
                <div className="text-xs font-semibold text-[#191919] dark:text-[#F5F1E7]">
                  Add a personal preference or instruction
                </div>
                <input
                  type="text"
                  value={newMemory}
                  onChange={(e) => setNewMemory(e.target.value)}
                  placeholder="e.g. Always summarize in bullet points with links"
                  className="w-full rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816] p-2 text-xs text-[#191919] dark:text-[#F5F1E7] focus:outline-none focus:border-[#005447]"
                  onKeyDown={(e) => e.key === 'Enter' && handleAddMemory()}
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setIsAdding(false)}
                    className="px-2.5 py-1 rounded-md text-xs text-[#77776E] hover:text-[#191919]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddMemory}
                    disabled={!newMemory.trim()}
                    className="px-3 py-1 rounded-md bg-[#005447] text-white text-xs font-medium disabled:opacity-50"
                  >
                    Save Fact
                  </button>
                </div>
              </div>
            )}

            {/* Memories list */}
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-0.5">
              {filteredMemories.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] flex items-center justify-center text-[#77776E] dark:text-[#A6A49B]">
                    <Brain className="w-5 h-5" />
                  </div>
                  <h4 className="font-display text-base font-semibold text-[#191919] dark:text-[#F5F1E7]">
                    No memories stored yet
                  </h4>
                  <p className="text-xs text-[#77776E] dark:text-[#A6A49B] max-w-xs leading-relaxed">
                    Say "Remember that I prefer concise summaries" during voice commands, or tap Add Fact above.
                  </p>
                </div>
              ) : (
                filteredMemories.map((mem) => (
                  <div
                    key={mem.id}
                    className="p-3 rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/70 dark:bg-[#22231F]/70 hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] flex items-center justify-between gap-3 group transition-colors shadow-2xs"
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#005447] dark:bg-[#67E2C8] shrink-0 mt-1.5" />
                      <p className="text-xs text-[#191919] dark:text-[#F5F1E7] font-sans leading-relaxed select-text">
                        {mem.content}
                      </p>
                    </div>

                    <button
                      onClick={() => handleDeleteMemory(mem.id)}
                      className="p-1 rounded-md text-[#77776E] hover:text-rose-600 dark:text-[#A6A49B] dark:hover:text-rose-400 opacity-60 group-hover:opacity-100 transition-opacity shrink-0"
                      title="Forget this memory"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>

            {memories.length > 0 && (
              <div className="pt-3 border-t border-[#DDDCCB] dark:border-[#373832] flex justify-between items-center text-[11px] text-[#77776E] dark:text-[#A6A49B] shrink-0">
                <span>{memories.length} stored preference rules</span>
                <button
                  onClick={handleClearAll}
                  className="text-rose-600 hover:text-rose-700 dark:text-rose-400"
                >
                  Clear All
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col space-y-4">
            <div className="p-4 rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/70 dark:bg-[#22231F]/70 space-y-3">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" />
                <h4 className="text-xs font-bold text-[#191919] dark:text-[#F5F1E7] font-sans">
                  IndexedDB Knowledge Vault
                </h4>
              </div>
              <p className="text-xs text-[#77776E] dark:text-[#A6A49B] leading-relaxed">
                Stores vectorized webpage chunks and file embeddings to allow contextual semantic search across tabs and documents.
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono pt-1">
                <div className="p-2.5 rounded-lg bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832]">
                  <div className="text-[10px] text-[#77776E] dark:text-[#A6A49B] uppercase font-sans">Stored Chunks</div>
                  <div className="text-base font-bold text-[#191919] dark:text-[#F5F1E7] mt-0.5">{vaultStats?.totalChunks || 0}</div>
                </div>
                <div className="p-2.5 rounded-lg bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832]">
                  <div className="text-[10px] text-[#77776E] dark:text-[#A6A49B] uppercase font-sans">Embedded Files</div>
                  <div className="text-base font-bold text-[#191919] dark:text-[#F5F1E7] mt-0.5">{vaultStats?.totalFiles || 0}</div>
                </div>
              </div>
            </div>

            <button
              onClick={async () => {
                if (confirm('Clear local knowledge vault?')) {
                  await clearVault()
                  loadVault()
                }
              }}
              className="p-2.5 rounded-xl border border-rose-200 dark:border-rose-900/40 bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400 text-xs font-medium hover:bg-rose-100 transition-colors"
            >
              Flush Local Knowledge Vault
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
