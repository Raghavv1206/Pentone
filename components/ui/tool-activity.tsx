import React, { useState } from 'react'
import { ChevronDown, ChevronRight, CheckCircle2, AlertCircle, Compass, Globe, MousePointer, Edit3, Camera, Search, BookOpen, Layers, Terminal } from 'lucide-react'

export interface ToolActivityProps {
  toolName: string
  args?: Record<string, any>
  result?: any
  status?: 'running' | 'completed' | 'failed'
  error?: string
}

const getToolMeta = (toolName: string) => {
  switch (toolName) {
    case 'openTab':
      return { label: 'Opening Tab', icon: <Globe className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8]" /> }
    case 'switchTab':
      return { label: 'Switching Tab', icon: <Layers className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8]" /> }
    case 'clickElement':
      return { label: 'Clicking Element', icon: <MousePointer className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8]" /> }
    case 'fillInput':
      return { label: 'Typing Text', icon: <Edit3 className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8]" /> }
    case 'findElements':
      return { label: 'Scanning Page Elements', icon: <Search className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8]" /> }
    case 'summarizePage':
      return { label: 'Summarizing Page', icon: <BookOpen className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8]" /> }
    case 'captureScreenshot':
    case 'captureCurrentPage':
      return { label: 'Capturing Screenshot', icon: <Camera className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8]" /> }
    case 'getAccessibilitySnapshot':
      return { label: 'Reading Accessibility Tree', icon: <Compass className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8]" /> }
    default:
      return { label: toolName, icon: <Terminal className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8]" /> }
  }
}

export const ToolActivity: React.FC<ToolActivityProps> = ({
  toolName,
  args,
  result,
  status = 'completed',
  error
}) => {
  const [expanded, setExpanded] = useState(false)
  const meta = getToolMeta(toolName)

  const isFailed = status === 'failed' || Boolean(error)
  const isImageResult = typeof result === 'string' && result.startsWith('data:image/')
  const isAudioResult = typeof result === 'string' && result.startsWith('data:audio/')

  const conciseDetail = args 
    ? (args.tabName || args.url || args.query || args.text || args.selector || '')
    : ''

  return (
    <div className="my-1.5 rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/70 dark:bg-[#22231F]/70 overflow-hidden text-xs transition-all">
      <div 
        onClick={() => setExpanded(!expanded)}
        className="px-2.5 py-1.5 flex items-center justify-between cursor-pointer hover:bg-[#EBE7D0]/50 dark:hover:bg-[#2A2B26]/50 select-none gap-2"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 p-1 rounded-md bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832]">
            {meta.icon}
          </span>
          <span className="font-medium text-[#191919] dark:text-[#F5F1E7] truncate">
            {meta.label}
          </span>
          {conciseDetail && (
            <span className="text-[#77776E] dark:text-[#A6A49B] truncate max-w-[140px] font-mono text-[11px]">
              "{String(conciseDetail)}"
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {status === 'running' ? (
            <span className="w-3.5 h-3.5 border-2 border-[#005447] dark:border-[#67E2C8] border-t-transparent rounded-full animate-spin" />
          ) : isFailed ? (
            <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8]" />
          )}
          <span className="text-[#77776E] dark:text-[#A6A49B]">
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="p-2.5 border-t border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF]/50 dark:bg-[#171816]/50 space-y-2 font-mono text-[11px]">
          {args && Object.keys(args).length > 0 && (
            <div>
              <div className="text-[#77776E] dark:text-[#A6A49B] text-[10px] uppercase font-bold tracking-wider mb-1 font-sans">
                Parameters
              </div>
              <pre className="p-1.5 rounded bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] overflow-x-auto text-[#191919] dark:text-[#F5F1E7]">
                {JSON.stringify(args, null, 2)}
              </pre>
            </div>
          )}

          {error && (
            <div className="text-rose-600 dark:text-rose-400 p-2 rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/40">
              Error: {error}
            </div>
          )}

          {result && (
            <div>
              <div className="text-[#77776E] dark:text-[#A6A49B] text-[10px] uppercase font-bold tracking-wider mb-1 font-sans">
                Output
              </div>
              {isImageResult ? (
                <img src={result} alt="Captured output" className="max-h-48 rounded border border-[#DDDCCB] dark:border-[#373832]" />
              ) : isAudioResult ? (
                <audio src={result} controls className="w-full h-8" />
              ) : (
                <pre className="p-1.5 rounded bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] overflow-x-auto max-h-40 overflow-y-auto text-[#191919] dark:text-[#F5F1E7]">
                  {typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
