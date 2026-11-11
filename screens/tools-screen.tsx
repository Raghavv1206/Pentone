import React, { useState, useMemo } from 'react'
import { 
  Search, ChevronRight, CheckCircle2, Shield, Sparkles,
  BrainCircuit, Camera, ScanEye, Crosshair, MousePointerClick,
  TextCursorInput, AudioLines, PenLine, Brain, Languages, ArrowUpDown,
  Keyboard, Highlighter, Database, BookOpen, Layers, Compass, PlaySquare,
  ZoomIn, ShieldAlert, Copy, CheckSquare, Wand2, ShieldCheck, Radio,
  Wrench
} from 'lucide-react'
import { TOOL_REGISTRY, type ToolSpec } from '../lib/tool-registry'
import { AppHeader } from '../components/navigation/app-header'
import { type Screen } from '../lib/config'

interface ToolsScreenProps {
  onNavigate: (screen: Screen) => void
}

function getToolIcon(name: string) {
  const n = name.toLowerCase()
  if (n.includes('think')) {
    return <BrainCircuit className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#A78BFA] shrink-0" />
  }
  if (n.includes('screenshot') || n.includes('capture')) {
    return <Camera className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#38BDF8] shrink-0" />
  }
  if (n.includes('title') || n.includes('snapshot') || n.includes('inspect')) {
    return <ScanEye className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#67E2C8] shrink-0" />
  }
  if (n.includes('findelement') || n.includes('find')) {
    return <Crosshair className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#34D399] shrink-0" />
  }
  if (n.includes('click') || n.includes('hover')) {
    return <MousePointerClick className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#F59E0B] shrink-0" />
  }
  if (n.includes('fill') || n.includes('type') || n.includes('input')) {
    return <TextCursorInput className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#60A5FA] shrink-0" />
  }
  if (n.includes('listen') || n.includes('audio') || n.includes('mic')) {
    return <AudioLines className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#F43F5E] shrink-0" />
  }
  if (n.includes('write') || n.includes('draft') || n.includes('rewrite')) {
    return <PenLine className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#A78BFA] shrink-0" />
  }
  if (n.includes('summarize')) {
    return <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#67E2C8] shrink-0" />
  }
  if (n.includes('memory') || n.includes('memories')) {
    return <Brain className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#C084FC] shrink-0" />
  }
  if (n.includes('translate') || n.includes('language')) {
    return <Languages className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#38BDF8] shrink-0" />
  }
  if (n.includes('scroll')) {
    return <ArrowUpDown className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#94A3B8] shrink-0" />
  }
  if (n.includes('key') || n.includes('press')) {
    return <Keyboard className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#FB923C] shrink-0" />
  }
  if (n.includes('highlight')) {
    return <Highlighter className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#FBBF24] shrink-0" />
  }
  if (n.includes('vault') || n.includes('clip')) {
    return <Database className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#67E2C8] shrink-0" />
  }
  if (n.includes('playbook')) {
    return <BookOpen className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#F472B6] shrink-0" />
  }
  if (n.includes('tab')) {
    return <Layers className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#818CF8] shrink-0" />
  }
  if (n.includes('navigate') || n.includes('url')) {
    return <Compass className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#2DD4BF] shrink-0" />
  }
  if (n.includes('media')) {
    return <PlaySquare className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#E879F9] shrink-0" />
  }
  if (n.includes('zoom')) {
    return <ZoomIn className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#38BDF8] shrink-0" />
  }
  if (n.includes('modal') || n.includes('dismiss')) {
    return <ShieldAlert className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#F87171] shrink-0" />
  }
  if (n.includes('copy') || n.includes('clipboard')) {
    return <Copy className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#94A3B8] shrink-0" />
  }
  if (n.includes('option') || n.includes('selectoption')) {
    return <CheckSquare className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#34D399] shrink-0" />
  }
  if (n.includes('autofill') || n.includes('form')) {
    return <Wand2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#67E2C8] shrink-0" />
  }
  if (n.includes('privacy') || n.includes('phishing') || n.includes('risk') || n.includes('scan')) {
    return <ShieldCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#F87171] shrink-0" />
  }
  if (n.includes('voicesurfer') || n.includes('surfer')) {
    return <Radio className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#F59E0B] shrink-0" />
  }
  return <Wrench className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#67E2C8] shrink-0" />
}

export const ToolsScreen: React.FC<ToolsScreenProps> = ({ onNavigate }) => {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTool, setSelectedTool] = useState<ToolSpec | null>(null)

  const filteredTools = useMemo(() => {
    if (!searchQuery.trim()) return TOOL_REGISTRY
    const q = searchQuery.toLowerCase()
    return TOOL_REGISTRY.filter(tool => 
      tool.name.toLowerCase().includes(q) ||
      tool.description.toLowerCase().includes(q)
    )
  }, [searchQuery])

  return (
    <div className="flex flex-col h-full bg-[#FFFEEF] dark:bg-[#171816] text-[#191919] dark:text-[#F5F1E7] overflow-hidden select-none">
      <AppHeader
        currentScreen="tools"
        onNavigate={onNavigate}
      />

      {/* Search Header */}
      <div className="p-2.5 sm:p-3.5 border-b border-[#DDDCCB] dark:border-[#373832] w-full min-w-0">
        <div className="relative w-full min-w-0">
          <Search className="w-3.5 h-3.5 sm:w-4 sm:h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#77776E] dark:text-[#A6A49B] shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search ${TOOL_REGISTRY.length} registered tools...`}
            className="w-full min-w-0 bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-xl pl-9 pr-3 py-1.5 text-xs text-[#191919] dark:text-[#F5F1E7] placeholder-[#77776E] dark:placeholder-[#A6A49B] focus:border-[#005447] dark:focus:border-[#67E2C8]"
          />
        </div>
      </div>

      {/* Tool List */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-2.5 w-full min-w-0">
        {filteredTools.map((tool) => {
          const isSelected = selectedTool?.name === tool.name

          return (
            <div
              key={tool.name}
              onClick={() => setSelectedTool(isSelected ? null : tool)}
              className={`p-3 rounded-2xl border transition-all cursor-pointer w-full min-w-0 break-words ${
                isSelected
                  ? 'bg-[#E9D2FF]/30 dark:bg-[#CDB0F3]/20 border-[#D5B8F6] dark:border-[#513E6B]'
                  : 'bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] hover:border-[#878571] dark:hover:border-[#6D6E63]'
              }`}
            >
              <div className="flex items-center justify-between gap-2 min-w-0">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-[#EBE7D0] dark:bg-[#2A2B26] flex items-center justify-center shrink-0 shadow-xs border border-[#DDDCCB]/40 dark:border-[#373832]/40">
                    {getToolIcon(tool.name)}
                  </div>
                  <span className="font-mono text-xs font-semibold text-[#191919] dark:text-[#F5F1E7] truncate min-w-0">
                    {tool.name}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#DDDCCB]/50 dark:bg-[#373832]/60 text-[#56564E] dark:text-[#A6A49B]">
                    {tool.parameters.length}p
                  </span>
                  <ChevronRight className={`w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#77776E] transition-transform shrink-0 ${isSelected ? 'rotate-90' : ''}`} />
                </div>
              </div>

              <p className="mt-1.5 text-xs text-[#77776E] dark:text-[#A6A49B] leading-relaxed break-words">
                {tool.description}
              </p>

              {/* Expanded parameter specifications */}
              {isSelected && (
                <div className="mt-3 pt-3 border-t border-[#DDDCCB]/60 dark:border-[#373832]/60 space-y-2 animate-fadeIn select-text w-full min-w-0">
                  <h4 className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#005447] dark:text-[#67E2C8]">
                    Parameters
                  </h4>
                  {tool.parameters.length === 0 ? (
                    <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B] italic">No parameters required.</p>
                  ) : (
                    <div className="space-y-1.5 w-full min-w-0">
                      {tool.parameters.map((p) => (
                        <div key={p.name} className="p-2 rounded-xl bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] text-[11px] space-y-0.5 w-full min-w-0 break-words">
                          <div className="flex items-center justify-between gap-1 min-w-0">
                            <span className="font-mono font-bold text-[#191919] dark:text-[#F5F1E7] truncate">{p.name}</span>
                            <span className="font-mono text-[10px] text-[#77776E] dark:text-[#A6A49B] shrink-0">
                              {p.type} {p.required && <span className="text-rose-500 font-bold">*req</span>}
                            </span>
                          </div>
                          <p className="text-[#56564E] dark:text-[#A6A49B] text-[10px] break-words">{p.description}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
