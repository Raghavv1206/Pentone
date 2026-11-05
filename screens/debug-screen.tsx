import React, { useState, useRef, useEffect } from "react"
import { 
  Copy, RotateCcw, Square, ArrowLeft, Play, ChevronDown, ChevronRight, 
  Paperclip, X, MessageSquare, Wrench, Brain, Activity, Check, CheckCircle2, 
  AlertCircle, RefreshCw, Send, Database, Sparkles, FileText, Download, 
  Trash2, Loader2, Search, ExternalLink, ThumbsUp, ThumbsDown, Terminal, Key
} from "lucide-react"
import { parseToolCall, executeTool } from "../lib/tools"
import { executeUITool } from "../lib/ui-tools"
import { type Message } from "../lib/messages"
import { useChatContext } from "../lib/chat-context"
import { useTTS } from "../lib/tts-context"
import { getToolNames, TOOL_REGISTRY, getToolSpec } from "../lib/tool-registry"
import { testEmbeddings, testSimilarity } from "../lib/transformers-test"
import { searchVault, getVaultStats, clearVault, getAllVaultEntries, deleteVaultEntry } from "../lib/vault"
import { EmbeddedFilesList } from "../components/embedded-files-list"
import { useWakeWordBuiltIn } from "../lib/use-wake-word-builtin"
import { loadSettings, saveSettings } from "../lib/settings"
import { RatingButtons } from "../components/rating-buttons"
import { useOnboarding } from "../components/onboarding/onboarding-provider"
import { getRatingStats, clearAllRatings, exportRatings } from "../lib/rating-database"

interface DebugScreenProps {
  onNavigateToMain: () => void
  fullHeight?: boolean
}

type DebugTab = 'chat' | 'tools' | 'vault' | 'memories' | 'diagnostics'

const ToolTester = () => {
  const [selectedTool, setSelectedTool] = useState("")
  const [params, setParams] = useState("{}")
  const [result, setResult] = useState<any>(null)
  const [isExecuting, setIsExecuting] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)

  const toolNames = getToolNames()
  const selectedToolSpec = TOOL_REGISTRY.find(t => t.name === selectedTool)

  const handleExecute = async () => {
    if (!selectedTool) return

    setIsExecuting(true)
    setResult(null)

    try {
      const parsedParams = JSON.parse(params)
      const toolSpec = getToolSpec(selectedTool)
      
      let toolResult
      if (toolSpec?.requiresUserGesture) {
        console.log('[DEBUG] Executing UI tool:', selectedTool)
        toolResult = await executeUITool({ function: selectedTool, arguments: parsedParams })
      } else {
        console.log('[DEBUG] Executing background tool:', selectedTool)
        toolResult = await executeTool({ function: selectedTool, arguments: parsedParams })
      }
      
      setResult(toolResult)
    } catch (error: any) {
      setResult({ success: false, error: error.message })
    } finally {
      setIsExecuting(false)
    }
  }

  const handleToolChange = (toolName: string) => {
    setSelectedTool(toolName)
    const spec = TOOL_REGISTRY.find(t => t.name === toolName)
    if (spec) {
      const defaultParams: any = {}
      spec.parameters.forEach(p => {
        if (p.required) {
          defaultParams[p.name] = p.type === 'number' ? 0 : ""
        }
      })
      setParams(JSON.stringify(defaultParams, null, 2))
    }
  }

  const copyResultToClipboard = () => {
    if (!result) return
    const text = result.success ? (typeof result.result === 'object' ? JSON.stringify(result.result, null, 2) : result.result) : result.error
    navigator.clipboard.writeText(String(text))
    setCopySuccess(true)
    setTimeout(() => setCopySuccess(false), 2000)
  }

  return (
    <div className="space-y-3 p-3 max-w-2xl mx-auto">
      {/* Tool Selector Bar */}
      <div className="bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-xl p-3 space-y-2.5">
        <div className="text-xs font-mono font-medium text-[#77776E] dark:text-[#A6A49B] flex items-center justify-between">
          <span>SELECT REGISTERED TOOL</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#DDDCCB]/40 dark:bg-[#373832]/60">
            {toolNames.length} available
          </span>
        </div>

        <div className="flex gap-2">
          <select
            value={selectedTool}
            onChange={(e) => handleToolChange(e.target.value)}
            className="flex-1 bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-[#005447] dark:focus:border-[#67E2C8]"
          >
            <option value="">Choose a tool to test...</option>
            {toolNames.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          
          <button
            onClick={handleExecute}
            disabled={!selectedTool || isExecuting}
            className="px-4 py-2 bg-[#005447] hover:bg-[#003F36] dark:bg-[#1E4D40] dark:hover:bg-[#256050] text-white dark:text-[#67E2C8] disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-xs font-mono font-medium flex items-center gap-1.5 transition-colors shrink-0 shadow-xs"
          >
            {isExecuting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                Execute
              </>
            )}
          </button>
        </div>

        {selectedToolSpec && (
          <div className="pt-2 border-t border-[#DDDCCB]/50 dark:border-[#373832]/50 text-xs font-mono">
            <div className="text-[11px] text-[#56564E] dark:text-[#DDDCCB] mb-1 font-medium">
              {selectedToolSpec.description}
            </div>
            {selectedToolSpec.parameters.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {selectedToolSpec.parameters.map(p => (
                  <span 
                    key={p.name} 
                    className={`text-[10px] px-2 py-0.5 rounded-md border ${
                      p.required 
                        ? "bg-[#005447]/10 dark:bg-[#67E2C8]/10 text-[#005447] dark:text-[#67E2C8] border-[#005447]/20 dark:border-[#67E2C8]/20 font-semibold" 
                        : "bg-[#DDDCCB]/20 dark:bg-[#373832]/30 text-[#77776E] dark:text-[#A6A49B] border-transparent"
                    }`}
                  >
                    {p.name}: {p.type} {p.required && "*"}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* JSON Parameters Input */}
      <div className="bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-xl p-3 space-y-1.5">
        <div className="text-xs font-mono font-medium text-[#77776E] dark:text-[#A6A49B] flex items-center justify-between">
          <span>ARGUMENTS (JSON)</span>
          <button 
            type="button"
            onClick={() => selectedTool && handleToolChange(selectedTool)}
            className="text-[10px] text-[#005447] dark:text-[#67E2C8] hover:underline"
          >
            Reset to defaults
          </button>
        </div>
        <textarea
          value={params}
          onChange={(e) => setParams(e.target.value)}
          placeholder='{"param": "value"}'
          className="w-full bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] rounded-lg p-2.5 text-xs font-mono focus:outline-none focus:border-[#005447] dark:focus:border-[#67E2C8] h-28 resize-none text-[#191919] dark:text-[#F5F1E7]"
        />
      </div>

      {/* Execution Results View */}
      {result && (
        <div className="bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded-md ${
              result.success 
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20' 
                : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/20'
            }`}>
              {result.success ? 'EXECUTION SUCCESS' : 'EXECUTION FAILED'}
            </span>
            <button
              onClick={copyResultToClipboard}
              className="text-[10px] font-mono text-[#77776E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] flex items-center gap-1"
            >
              {copySuccess ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
              {copySuccess ? 'Copied' : 'Copy'}
            </button>
          </div>

          <pre className="text-xs bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] rounded-lg p-2.5 text-[#191919] dark:text-[#F5F1E7] font-mono whitespace-pre-wrap max-h-56 overflow-y-auto">
            <code>
              {result.success 
                ? (typeof result.result === 'object' ? JSON.stringify(result.result, null, 2) : result.result)
                : result.error
              }
            </code>
          </pre>
        </div>
      )}
    </div>
  )
}

const TransformersTest = () => {
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<any>(null)

  const runEmbeddingTest = async () => {
    setIsLoading(true)
    setResult(null)
    const res = await testEmbeddings("Hello world, this is a test!")
    setResult(res)
    setIsLoading(false)
  }

  const runSimilarityTest = async () => {
    setIsLoading(true)
    setResult(null)
    const res = await testSimilarity("I love programming", "I enjoy coding")
    setResult(res)
    setIsLoading(false)
  }

  return (
    <div className="bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-xl p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-mono font-medium text-[#77776E] dark:text-[#A6A49B]">
          LOCAL TRANSFORMERS.JS EMBEDDINGS
        </div>
        <span className="text-[10px] text-[#005447] dark:text-[#67E2C8] font-mono bg-[#005447]/10 dark:bg-[#67E2C8]/10 px-2 py-0.5 rounded-full">
          all-MiniLM-L6-v2
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={runEmbeddingTest}
          disabled={isLoading}
          className="px-3 py-1.5 bg-[#005447] hover:bg-[#003F36] dark:bg-[#1E4D40] dark:hover:bg-[#256050] text-white dark:text-[#67E2C8] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-xs font-mono flex items-center gap-1.5 transition-colors"
        >
          <Play className="w-3 h-3 fill-current" />
          Test Embedding Vector
        </button>
        
        <button
          onClick={runSimilarityTest}
          disabled={isLoading}
          className="px-3 py-1.5 bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] text-[#191919] dark:text-[#F5F1E7] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-xs font-mono flex items-center gap-1.5 transition-colors"
        >
          <Sparkles className="w-3 h-3 text-[#005447] dark:text-[#67E2C8]" />
          Cosine Similarity
        </button>
      </div>

      {isLoading && (
        <div className="text-xs text-[#005447] dark:text-[#67E2C8] font-mono animate-pulse flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Generating embeddings locally in-browser...
        </div>
      )}

      {result && (
        <div className="bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] rounded-lg p-2.5 text-xs font-mono space-y-1.5">
          <div className={result.success ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-rose-600 dark:text-rose-400 font-semibold'}>
            {result.success ? 'SUCCESS ✓' : 'ERROR ✗'}
          </div>
          {result.success && result.dimensions && (
            <div className="text-[#56564E] dark:text-[#F5F1E7] space-y-1">
              <div>Dimensions: <span className="font-bold text-[#191919] dark:text-[#F5F1E7]">{result.dimensions}</span></div>
              {result.similarity !== undefined && (
                <div className="pt-1 border-t border-[#DDDCCB]/40 dark:border-[#373832]/40">
                  <div className="text-[11px] text-[#77776E] dark:text-[#A6A49B]">Text 1: "{result.text1}"</div>
                  <div className="text-[11px] text-[#77776E] dark:text-[#A6A49B]">Text 2: "{result.text2}"</div>
                  <div className="text-emerald-600 dark:text-emerald-400 font-bold mt-0.5">
                    Match Similarity: {(result.similarity * 100).toFixed(2)}%
                  </div>
                </div>
              )}
              {result.embedding && (
                <div className="text-[10px] text-[#77776E] dark:text-[#A6A49B] truncate">
                  Vector Preview: [{result.embedding.slice(0, 8).map((v: number) => v.toFixed(3)).join(', ')}...]
                </div>
              )}
            </div>
          )}
          {result.error && (
            <div className="text-rose-600 dark:text-rose-400">{result.error}</div>
          )}
        </div>
      )}
    </div>
  )
}

const WakeWordTest = () => {
  const [accessKey, setAccessKey] = useState('')
  const [isEditingKey, setIsEditingKey] = useState(false)
  const [isSaved, setIsSaved] = useState(false)

  const { isListening, lastDetection, error, start, stop } = useWakeWordBuiltIn(() => {
    console.log('Wake word callback triggered!')
  })

  useEffect(() => {
    loadSettings().then(s => {
      if (s.picovoiceAccessKey) {
        setAccessKey(s.picovoiceAccessKey)
      }
    })
  }, [])

  const handleSaveKey = async () => {
    const s = await loadSettings()
    await saveSettings({ ...s, picovoiceAccessKey: accessKey.trim() })
    setIsEditingKey(false)
    setIsSaved(true)
    setTimeout(() => setIsSaved(false), 2000)
  }

  const handleStart = () => {
    start(accessKey.trim())
  }

  return (
    <div className="bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-xl p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="text-xs font-mono font-medium text-[#77776E] dark:text-[#A6A49B]">
          WAKE WORD ENGINE
        </div>
        <div className={`px-2 py-0.5 rounded-full text-[10px] font-mono flex items-center gap-1.5 ${
          isListening 
            ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/20' 
            : 'bg-[#DDDCCB]/40 dark:bg-[#373832]/60 text-[#77776E] dark:text-[#A6A49B]'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isListening ? 'bg-rose-500 animate-ping' : 'bg-gray-400'}`} />
          {isListening ? 'LISTENING' : 'STANDBY'}
        </div>
      </div>

      {/* AccessKey Config */}
      <div className="space-y-1.5 bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] rounded-lg p-2 text-xs font-mono">
        <div className="flex items-center justify-between">
          <span className="text-[#77776E] dark:text-[#A6A49B] text-[11px] flex items-center gap-1">
            <Key className="w-3 h-3" /> Picovoice AccessKey:
          </span>
          <a
            href="https://console.picovoice.ai/"
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-[#005447] dark:text-[#67E2C8] hover:underline flex items-center gap-0.5"
          >
            Get free key <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </div>
        {isEditingKey || !accessKey ? (
          <div className="flex gap-1.5 items-center">
            <input
              type="password"
              value={accessKey}
              onChange={(e) => setAccessKey(e.target.value)}
              placeholder="Paste Picovoice AccessKey..."
              className="flex-1 px-2 py-1 bg-white dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded text-xs text-[#22231F] dark:text-[#F5F1E7] focus:outline-none focus:border-[#005447]"
            />
            <button
              onClick={handleSaveKey}
              className="px-2.5 py-1 bg-[#005447] hover:bg-[#003F36] dark:bg-[#1E4D40] dark:hover:bg-[#256050] text-white dark:text-[#67E2C8] rounded text-xs transition-colors"
            >
              Save
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[#56564E] dark:text-[#C5C3B8]">
              ••••••••••••••••{accessKey.slice(-4)}
            </span>
            <div className="flex items-center gap-2">
              {isSaved && <span className="text-emerald-600 text-[10px]">Saved!</span>}
              <button
                onClick={() => setIsEditingKey(true)}
                className="text-[10px] text-[#005447] dark:text-[#67E2C8] hover:underline"
              >
                Change
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        {!isListening ? (
          <button
            onClick={handleStart}
            className="px-3 py-1.5 bg-[#005447] hover:bg-[#003F36] dark:bg-[#1E4D40] dark:hover:bg-[#256050] text-white dark:text-[#67E2C8] rounded-lg text-xs font-mono flex items-center gap-1.5 transition-colors"
          >
            <Play className="w-3 h-3 fill-current" />
            Start Listening
          </button>
        ) : (
          <button
            onClick={stop}
            className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-mono flex items-center gap-1.5 transition-colors"
          >
            <Square className="w-3 h-3 fill-current" />
            Stop Engine
          </button>
        )}
      </div>

      {isListening && (
        <div className="text-[11px] text-[#005447] dark:text-[#67E2C8] font-mono animate-pulse">
          Say "Hey Pentone" or "Porcupine" to test trigger sensitivity...
        </div>
      )}

      {lastDetection && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2 text-xs font-mono text-emerald-600 dark:text-emerald-400">
          ✓ DETECTED KEYWORD: {lastDetection}
        </div>
      )}

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-2 text-xs font-mono text-rose-600 dark:text-rose-400 leading-relaxed">
          {error}
        </div>
      )}
    </div>
  )
}

const OnboardingControls = () => {
  const { state, resetOnboarding } = useOnboarding()

  return (
    <div className="bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-xl p-3 space-y-2.5">
      <div className="text-xs font-mono font-medium text-[#77776E] dark:text-[#A6A49B]">
        SYSTEM READINESS & ONBOARDING
      </div>

      <div className="bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] rounded-lg p-2.5 text-xs font-mono space-y-1 text-[#56564E] dark:text-[#F5F1E7]">
        <div className="flex items-center justify-between">
          <span>Tour Status:</span>
          <span className={state.isComplete ? "text-emerald-600 dark:text-emerald-400 font-bold" : "text-amber-500 font-bold"}>
            {state.isComplete ? 'Complete ✓' : 'Incomplete ⚠'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Microphone Access:</span>
          <span className={state.micPermissionGranted ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"}>
            {state.micPermissionGranted ? 'Granted ✓' : 'Not Granted ✗'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Local AI Model:</span>
          <span className={state.modelAvailable ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"}>
            {state.modelAvailable ? 'Available ✓' : 'Unavailable ✗'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Speech Recognition:</span>
          <span className={state.speechRecognitionAvailable ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"}>
            {state.speechRecognitionAvailable ? 'Available ✓' : 'Unavailable ✗'}
          </span>
        </div>
        {state.currentStep && (
          <div className="text-[#005447] dark:text-[#67E2C8] pt-1 border-t border-[#DDDCCB]/40 dark:border-[#373832]/40">
            Current Step: {state.currentStep}
          </div>
        )}
      </div>

      <button
        onClick={resetOnboarding}
        className="w-full px-3 py-2 bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] text-[#191919] dark:text-[#F5F1E7] rounded-lg text-xs font-mono flex items-center justify-center gap-2 transition-colors"
      >
        <RotateCcw className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8]" />
        Restart Onboarding Tour
      </button>
    </div>
  )
}

const RatingStatsDebugger = () => {
  const [stats, setStats] = useState<{ total: number; positive: number; negative: number } | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const loadStats = async () => {
    setIsLoading(true)
    try {
      const ratingStats = await getRatingStats()
      setStats(ratingStats)
    } catch (error: any) {
      console.error('Error loading rating stats:', error)
      setStats({ total: 0, positive: 0, negative: 0 })
    }
    setIsLoading(false)
  }

  const handleClearRatings = async () => {
    if (!confirm('Are you sure you want to clear all ratings? This cannot be undone.')) {
      return
    }
    
    setIsLoading(true)
    try {
      await clearAllRatings()
      await loadStats()
      alert('All ratings cleared successfully!')
    } catch (error: any) {
      alert(`Error clearing ratings: ${error.message}`)
    }
    setIsLoading(false)
  }

  const handleExportRatings = async () => {
    setIsLoading(true)
    try {
      const jsonData = await exportRatings()
      const blob = new Blob([jsonData], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `pentone-ratings-${Date.now()}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error: any) {
      alert(`Error exporting ratings: ${error.message}`)
    }
    setIsLoading(false)
  }

  useEffect(() => {
    loadStats()
  }, [])

  return (
    <div className="bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-xl p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-mono font-medium text-[#77776E] dark:text-[#A6A49B]">
          USER FEEDBACK & RATINGS
        </div>
        <button
          onClick={loadStats}
          disabled={isLoading}
          className="text-[10px] font-mono text-[#005447] dark:text-[#67E2C8] hover:underline flex items-center gap-1"
        >
          <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>
      
      {stats && (
        <div className="bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] rounded-lg p-3 text-xs font-mono space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[#77776E] dark:text-[#A6A49B]">Total Responses Rated:</span>
            <span className="font-bold text-[#191919] dark:text-[#F5F1E7]">{stats.total}</span>
          </div>
          
          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#DDDCCB]/50 dark:border-[#373832]/50">
            <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
              <ThumbsUp className="w-3.5 h-3.5" />
              <span>Positive: {stats.positive}</span>
            </div>
            <div className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400">
              <ThumbsDown className="w-3.5 h-3.5" />
              <span>Negative: {stats.negative}</span>
            </div>
          </div>

          {stats.total > 0 && (
            <div className="pt-1.5 border-t border-[#DDDCCB]/40 dark:border-[#373832]/40">
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-[#77776E] dark:text-[#A6A49B]">Approval Rating:</span>
                <span className="font-bold text-[#005447] dark:text-[#67E2C8]">
                  {((stats.positive / stats.total) * 100).toFixed(1)}%
                </span>
              </div>
              <div className="w-full bg-[#DDDCCB]/40 dark:bg-[#373832]/60 rounded-full h-1.5 overflow-hidden">
                <div 
                  className="bg-[#005447] dark:bg-[#67E2C8] h-full transition-all duration-300" 
                  style={{ width: `${(stats.positive / stats.total) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={handleExportRatings}
          disabled={isLoading || !stats || stats.total === 0}
          className="flex-1 px-3 py-1.5 bg-[#005447] hover:bg-[#003F36] dark:bg-[#1E4D40] dark:hover:bg-[#256050] text-white dark:text-[#67E2C8] disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-xs font-mono flex items-center justify-center gap-1.5 transition-colors"
        >
          <Download className="w-3 h-3" />
          Export JSON
        </button>
        <button
          onClick={handleClearRatings}
          disabled={isLoading || !stats || stats.total === 0}
          className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/20 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-xs font-mono flex items-center gap-1.5 transition-colors"
        >
          <Trash2 className="w-3 h-3" />
          Clear
        </button>
      </div>
    </div>
  )
}

const EmbeddedFilesDebugger = () => {
  const [vaultEntries, setVaultEntries] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const loadFiles = async () => {
    setIsLoading(true)
    try {
      const entries = await getAllVaultEntries()
      setVaultEntries(entries)
    } catch (error: any) {
      console.error('Error loading files:', error)
    }
    setIsLoading(false)
  }

  const handleDelete = async (id: string) => {
    setIsLoading(true)
    try {
      await deleteVaultEntry(id)
      await loadFiles()
    } catch (error: any) {
      alert(`Error deleting file: ${error.message}`)
    }
    setIsLoading(false)
  }

  useEffect(() => {
    loadFiles()
  }, [])

  return (
    <div className="space-y-3 p-3 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="text-xs font-mono font-medium text-[#77776E] dark:text-[#A6A49B]">
          EMBEDDED DOCUMENTS IN VAULT ({vaultEntries.length})
        </div>
        <button
          onClick={loadFiles}
          disabled={isLoading}
          className="text-[10px] font-mono text-[#005447] dark:text-[#67E2C8] hover:underline flex items-center gap-1"
        >
          <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <EmbeddedFilesList 
        entries={vaultEntries}
        onDelete={handleDelete}
        onRefresh={loadFiles}
      />
    </div>
  )
}

const VaultDebugger = () => {
  const [stats, setStats] = useState<any>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [subView, setSubView] = useState<'search' | 'files'>('search')

  const loadStats = async () => {
    setIsLoading(true)
    try {
      const vaultStats = await getVaultStats()
      setStats(vaultStats)
    } catch (error: any) {
      setStats({ error: error.message })
    }
    setIsLoading(false)
  }

  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    
    setIsLoading(true)
    setSearchResults(null)
    
    try {
      const results = await searchVault(searchQuery, 5, 0.2)
      setSearchResults(results)
    } catch (error: any) {
      setSearchResults({ error: error.message })
    }
    
    setIsLoading(false)
  }

  const handleCapture = async () => {
    setIsLoading(true)
    try {
      const result = await executeTool({ 
        function: 'captureCurrentPage', 
        arguments: {} 
      })
      
      if (result.success) {
        await loadStats()
        alert('Page captured into vector vault!')
      } else {
        alert(`Error: ${result.error}`)
      }
    } catch (error: any) {
      alert(`Error: ${error.message}`)
    }
    setIsLoading(false)
  }

  const handleClearVault = async () => {
    if (!confirm('Are you sure you want to clear the entire vault? This cannot be undone.')) {
      return
    }
    
    setIsLoading(true)
    try {
      await clearVault()
      await loadStats()
      setSearchResults(null)
      alert('Vault cleared successfully!')
    } catch (error: any) {
      alert(`Error clearing vault: ${error.message}`)
    }
    setIsLoading(false)
  }

  useEffect(() => {
    loadStats()
  }, [])

  return (
    <div className="space-y-3 p-3 max-w-2xl mx-auto">
      {/* Vault Sub-tabs */}
      <div className="flex gap-1.5 p-1 bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-xl">
        <button
          onClick={() => setSubView('search')}
          className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-mono font-medium transition-all flex items-center justify-center gap-1.5 ${
            subView === 'search'
              ? 'bg-[#FFFEEF] dark:bg-[#171816] text-[#005447] dark:text-[#67E2C8] shadow-xs'
              : 'text-[#77776E] dark:text-[#A6A49B] hover:text-[#191919] dark:hover:text-[#F5F1E7]'
          }`}
        >
          <Database className="w-3.5 h-3.5" />
          Vector Vault & Search
        </button>
        <button
          onClick={() => setSubView('files')}
          className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-mono font-medium transition-all flex items-center justify-center gap-1.5 ${
            subView === 'files'
              ? 'bg-[#FFFEEF] dark:bg-[#171816] text-[#005447] dark:text-[#67E2C8] shadow-xs'
              : 'text-[#77776E] dark:text-[#A6A49B] hover:text-[#191919] dark:hover:text-[#F5F1E7]'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          Embedded Documents
        </button>
      </div>

      {subView === 'files' ? (
        <EmbeddedFilesDebugger />
      ) : (
        <>
          {/* Stats Card */}
          <div className="bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-xl p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="text-xs font-mono font-medium text-[#77776E] dark:text-[#A6A49B] flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8]" />
                VECTOR DATABASE STATS
              </div>
              <div className="flex gap-2">
                <button
                  onClick={loadStats}
                  disabled={isLoading}
                  className="text-[10px] font-mono text-[#005447] dark:text-[#67E2C8] hover:underline flex items-center gap-1"
                >
                  <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
                <button
                  onClick={handleClearVault}
                  disabled={isLoading || !stats || stats.count === 0}
                  className="text-[10px] font-mono text-rose-600 dark:text-rose-400 hover:underline flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear All
                </button>
              </div>
            </div>
            
            {stats && (
              <div className="bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] rounded-lg p-2.5 text-xs font-mono space-y-1 text-[#56564E] dark:text-[#F5F1E7]">
                {stats.error ? (
                  <div className="text-rose-600 dark:text-rose-400">{stats.error}</div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-[#77776E] dark:text-[#A6A49B]">Indexed Pages & Chunks:</span>
                      <span className="font-bold text-[#191919] dark:text-[#F5F1E7]">{stats.count}</span>
                    </div>
                    {stats.count > 0 && (
                      <>
                        <div className="text-[11px] text-[#77776E] dark:text-[#A6A49B]">
                          Latest index: {new Date(stats.newestEntry).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                        {stats.domains && (
                          <div className="text-[10px] text-[#77776E] dark:text-[#A6A49B] pt-1 border-t border-[#DDDCCB]/40 dark:border-[#373832]/40 truncate">
                            Domains: {Object.keys(stats.domains).slice(0, 4).join(', ')}
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            <button
              onClick={handleCapture}
              disabled={isLoading}
              className="w-full px-3 py-2 bg-[#005447] hover:bg-[#003F36] dark:bg-[#1E4D40] dark:hover:bg-[#256050] text-white dark:text-[#67E2C8] disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-xs font-mono font-medium flex items-center justify-center gap-2 transition-colors shadow-xs"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Capture Active Page to Vault
            </button>
          </div>

          {/* Search Box */}
          <div className="bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-xl p-3 space-y-2.5">
            <div className="text-xs font-mono font-medium text-[#77776E] dark:text-[#A6A49B]">
              SEMANTIC VAULT SEARCH
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Query vault (e.g. Starship launch date)..."
                className="flex-1 bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-[#005447] dark:focus:border-[#67E2C8] text-[#191919] dark:text-[#F5F1E7]"
              />
              <button
                onClick={handleSearch}
                disabled={isLoading || !searchQuery.trim()}
                className="px-3 py-2 bg-[#005447] hover:bg-[#003F36] dark:bg-[#1E4D40] dark:hover:bg-[#256050] text-white dark:text-[#67E2C8] disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-xs font-mono flex items-center gap-1.5 transition-colors shrink-0"
              >
                <Search className="w-3.5 h-3.5" />
                Search
              </button>
            </div>

            {isLoading && (
              <div className="text-xs text-[#005447] dark:text-[#67E2C8] font-mono animate-pulse flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" />
                Scanning vector embeddings...
              </div>
            )}

            {searchResults && (
              <div className="bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] rounded-lg p-2.5 space-y-2 max-h-72 overflow-y-auto">
                {searchResults.error ? (
                  <div className="text-xs text-rose-600 dark:text-rose-400 font-mono">{searchResults.error}</div>
                ) : searchResults.length === 0 ? (
                  <div className="text-xs text-[#77776E] dark:text-[#A6A49B] font-mono text-center py-2">
                    No matching vault entries found
                  </div>
                ) : (
                  searchResults.map((page: any, i: number) => (
                    <div key={page.id || i} className="border-b border-[#DDDCCB]/50 dark:border-[#373832]/50 last:border-0 pb-2.5 last:pb-0 font-mono">
                      <div className="text-xs font-semibold text-[#191919] dark:text-[#F5F1E7] flex items-center justify-between">
                        <span className="truncate flex-1">[{i + 1}] {page.title}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold ml-2 shrink-0">
                          {(page.similarity * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="text-[10px] text-[#77776E] dark:text-[#A6A49B] mt-0.5">
                        {page.domain}
                      </div>
                      <div className="text-[11px] text-[#56564E] dark:text-[#DDDCCB] mt-1 line-clamp-2 leading-relaxed">
                        {page.excerpt}
                      </div>
                      {page.url && (
                        <div className="text-[9px] text-[#77776E] dark:text-[#A6A49B] mt-1 truncate hover:underline">
                          {page.url}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

const MemoriesDebugger = () => {
  const [memories, setMemories] = useState<any[]>([])
  const [newMemoryContent, setNewMemoryContent] = useState("")
  const [newMemoryTags, setNewMemoryTags] = useState("")
  const [searchFilter, setSearchFilter] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const loadMemories = async () => {
    setIsLoading(true)
    try {
      const storage = await chrome.storage.local.get(['agent_memories'])
      const memoriesData = storage.agent_memories || []
      const sorted = memoriesData.sort((a: any, b: any) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
      setMemories(sorted)
    } catch (error: any) {
      console.error('Error loading memories:', error)
    }
    setIsLoading(false)
  }

  const handleAddMemory = async () => {
    if (!newMemoryContent.trim()) return

    setIsLoading(true)
    try {
      const tags = newMemoryTags
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0)

      const result = await executeTool({
        function: 'storeMemory',
        arguments: {
          content: newMemoryContent.trim(),
          tags: tags.length > 0 ? tags : undefined
        }
      })

      if (result.success) {
        setNewMemoryContent("")
        setNewMemoryTags("")
        await loadMemories()
      } else {
        alert(`Error: ${result.error}`)
      }
    } catch (error: any) {
      alert(`Error: ${error.message}`)
    }
    setIsLoading(false)
  }

  const handleDeleteMemory = async (memoryId: string) => {
    if (!confirm('Delete this memory?')) return

    setIsLoading(true)
    try {
      const storage = await chrome.storage.local.get(['agent_memories'])
      const memoriesData = storage.agent_memories || []
      const updated = memoriesData.filter((m: any) => m.id !== memoryId)
      await chrome.storage.local.set({ agent_memories: updated })
      await loadMemories()
    } catch (error: any) {
      alert(`Error: ${error.message}`)
    }
    setIsLoading(false)
  }

  const handleClearAll = async () => {
    if (!confirm('Are you sure you want to delete ALL memories? This cannot be undone.')) {
      return
    }

    setIsLoading(true)
    try {
      await chrome.storage.local.set({ agent_memories: [] })
      await loadMemories()
    } catch (error: any) {
      alert(`Error: ${error.message}`)
    }
    setIsLoading(false)
  }

  useEffect(() => {
    loadMemories()
  }, [])

  const filteredMemories = memories.filter(m => {
    if (!searchFilter.trim()) return true
    const q = searchFilter.toLowerCase()
    return m.content?.toLowerCase().includes(q) || m.tags?.some((t: string) => t.toLowerCase().includes(q))
  })

  return (
    <div className="space-y-3 p-3 max-w-2xl mx-auto font-mono">
      {/* Header Stats & Actions */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-[#77776E] dark:text-[#A6A49B] flex items-center gap-1.5">
          <Brain className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8]" />
          <span>Total: <strong className="text-[#191919] dark:text-[#F5F1E7]">{memories.length}</strong> memories</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadMemories}
            disabled={isLoading}
            className="text-[10px] text-[#005447] dark:text-[#67E2C8] hover:underline flex items-center gap-1"
          >
            <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={handleClearAll}
            disabled={isLoading || memories.length === 0}
            className="text-[10px] text-rose-600 dark:text-rose-400 hover:underline flex items-center gap-1"
          >
            <Trash2 className="w-3 h-3" />
            Clear All
          </button>
        </div>
      </div>

      {/* Add Memory Form */}
      <div className="bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-xl p-3 space-y-2">
        <div className="text-xs font-medium text-[#77776E] dark:text-[#A6A49B]">ADD NEW MEMORY</div>
        <textarea
          value={newMemoryContent}
          onChange={(e) => setNewMemoryContent(e.target.value)}
          placeholder="Memory fact (e.g., 'User loves space technology and Starship launches')"
          className="w-full bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] rounded-lg p-2.5 text-xs focus:outline-none focus:border-[#005447] dark:focus:border-[#67E2C8] h-16 resize-none text-[#191919] dark:text-[#F5F1E7]"
        />
        <div className="flex gap-2">
          <input
            type="text"
            value={newMemoryTags}
            onChange={(e) => setNewMemoryTags(e.target.value)}
            placeholder="Tags (comma-separated, e.g. space, preferences)"
            className="flex-1 bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-[#005447] dark:focus:border-[#67E2C8] text-[#191919] dark:text-[#F5F1E7]"
          />
          <button
            onClick={handleAddMemory}
            disabled={isLoading || !newMemoryContent.trim()}
            className="px-4 py-1.5 bg-[#005447] hover:bg-[#003F36] dark:bg-[#1E4D40] dark:hover:bg-[#256050] text-white dark:text-[#67E2C8] disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors shrink-0 shadow-xs"
          >
            <Play className="w-3 h-3 fill-current" />
            Save
          </button>
        </div>
      </div>

      {/* Search Filter */}
      {memories.length > 0 && (
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[#77776E] dark:text-[#A6A49B] absolute left-2.5 top-2.5" />
          <input
            type="text"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Filter memories by keyword or tag..."
            className="w-full bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:border-[#005447] dark:focus:border-[#67E2C8] text-[#191919] dark:text-[#F5F1E7]"
          />
        </div>
      )}

      {/* Memories List */}
      <div className="space-y-2">
        {filteredMemories.length === 0 ? (
          <div className="bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-xl p-6 text-center text-xs text-[#77776E] dark:text-[#A6A49B]">
            {searchFilter ? 'No memories match your filter' : 'No memories saved yet'}
          </div>
        ) : (
          filteredMemories.map((memory: any) => (
            <div
              key={memory.id}
              className="bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-xl p-3 hover:border-[#005447]/40 dark:hover:border-[#67E2C8]/40 transition-colors space-y-1.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-xs text-[#191919] dark:text-[#F5F1E7] leading-relaxed break-words flex-1">
                  {memory.content}
                </div>
                <button
                  onClick={() => handleDeleteMemory(memory.id)}
                  disabled={isLoading}
                  className="p-1 text-[#77776E] hover:text-rose-600 dark:text-[#A6A49B] dark:hover:text-rose-400 transition-colors shrink-0"
                  title="Delete memory"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1 border-t border-[#DDDCCB]/40 dark:border-[#373832]/40 text-[10px]">
                <div className="flex flex-wrap gap-1">
                  {memory.tags?.map((tag: string, i: number) => (
                    <span
                      key={i}
                      className="px-1.5 py-0.5 bg-[#005447]/10 dark:bg-[#67E2C8]/10 text-[#005447] dark:text-[#67E2C8] rounded text-[9px] font-semibold"
                    >
                      #{tag}
                    </span>
                  ))}
                  {memory.embedding && (
                    <span className="px-1.5 py-0.5 bg-purple-500/10 text-purple-600 dark:text-purple-400 rounded text-[9px]">
                      ● embedded
                    </span>
                  )}
                </div>
                <span className="text-[#77776E] dark:text-[#A6A49B] text-[9px]">
                  {memory.date || (memory.timestamp ? new Date(memory.timestamp).toLocaleDateString() : '')}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export const DebugScreen = ({ onNavigateToMain, fullHeight = false }: DebugScreenProps) => {
  const { state, sendMessage, resetChat, interruptChat, copyContext, rateMessage, dispatch } = useChatContext()
  const { stop, isSpeaking } = useTTS()
  const [activeTab, setActiveTab] = useState<DebugTab>('chat')
  const [input, setInput] = useState("")
  const [copyFeedback, setCopyFeedback] = useState("")
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (activeTab === 'chat') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [state.messages, state.isWaitingForFirstChunk, activeTab])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return

    if (state.isProcessing || isSpeaking) {
      handleInterrupt()
    }

    const userInput = input.trim()
    setInput("")
    await sendMessage(userInput)
  }

  const handleReset = () => {
    resetChat()
    setCopyFeedback("Reset complete")
    setTimeout(() => setCopyFeedback(""), 2000)
  }

  const handleInterrupt = () => {
    stop()
    interruptChat()
  }

  const handleCopyContext = async () => {
    try {
      const contextText = await copyContext()
      await navigator.clipboard.writeText(contextText)
      setCopyFeedback("Context copied")
      setTimeout(() => setCopyFeedback(""), 2000)
    } catch (error) {
      setCopyFeedback("Copy failed")
      setTimeout(() => setCopyFeedback(""), 2000)
    }
  }

  const renderMessage = (message: Message) => {
    const isToolResult = message.content.startsWith('[TOOL RESULT]')
    const toolCall = !isToolResult ? parseToolCall(message.content) : null
    
    if (toolCall) {
      let contentToSplit = message.content
      const codeBlockMatch = contentToSplit.match(/```(?:tool_code|tool_call|function_call|json)\s*\n?(.*?)```/s)
      if (codeBlockMatch) {
        contentToSplit = codeBlockMatch[1]
      }
      const textBeforeToolCall = contentToSplit.split('<function_call>')[0].trim()
      
      return (
        <div key={message.id} className="mb-3 font-mono text-xs">
          <div className="flex items-center gap-1.5 text-[#77776E] dark:text-[#A6A49B] mb-1 text-[11px] font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#005447] dark:bg-[#67E2C8]" />
            {message.role.toUpperCase()}
          </div>

          {textBeforeToolCall && (
            <div className="text-[#191919] dark:text-[#F5F1E7] whitespace-pre-wrap mb-2 leading-relaxed bg-[#F3F1DF]/60 dark:bg-[#22231F]/60 p-2.5 rounded-xl border border-[#DDDCCB]/60 dark:border-[#373832]/60">
              {textBeforeToolCall}
            </div>
          )}

          <div className="bg-[#F3F1DF] dark:bg-[#22231F] p-3 rounded-xl border border-[#005447]/30 dark:border-[#67E2C8]/30 shadow-xs">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-[#005447] dark:text-[#67E2C8] tracking-wider uppercase flex items-center gap-1">
                <Wrench className="w-3 h-3" />
                TOOL_CALL: {toolCall.function}
              </span>
              {message.contextCount !== undefined && (
                <span className="text-[9px] text-[#77776E] dark:text-[#A6A49B]">
                  {message.contextCount}/9216 tok
                </span>
              )}
            </div>

            {Object.keys(toolCall.arguments).length > 0 && (
              <div className="bg-[#FFFEEF] dark:bg-[#171816] rounded-lg p-2 text-[11px] text-[#56564E] dark:text-[#DDDCCB] space-y-0.5 mt-1 border border-[#DDDCCB]/40 dark:border-[#373832]/40">
                {Object.entries(toolCall.arguments).map(([key, value]) => (
                  <div key={key} className="truncate">
                    <span className="text-[#77776E] dark:text-[#A6A49B]">{key}:</span>{' '}
                    <span className="font-semibold text-[#191919] dark:text-[#F5F1E7]">{typeof value === 'string' ? value : JSON.stringify(value)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {!state.isProcessing && !state.isInToolLoop && (
            <div className="mt-1.5 flex justify-end">
              <RatingButtons 
                messageId={message.id}
                currentRating={message.rating}
                onRate={rateMessage}
                size="sm"
              />
            </div>
          )}
        </div>
      )
    }
    
    if (isToolResult) {
      const resultContent = message.content.replace('[TOOL RESULT]\n', '')
      const isScreenshot = resultContent.startsWith('data:image/')
      const isAudio = resultContent.startsWith('data:audio/')
      
      if (isScreenshot) {
        return (
          <div key={message.id} className="mb-3 font-mono text-xs">
            <div className="text-[10px] text-[#005447] dark:text-[#67E2C8] font-bold mb-1 flex items-center gap-1">
              <span>●</span> TOOL RESULT: SCREENSHOT
            </div>
            <div className="bg-[#F3F1DF] dark:bg-[#22231F] p-2 rounded-xl border border-[#DDDCCB] dark:border-[#373832]">
              <img src={resultContent} alt="Screenshot" className="w-full rounded-lg shadow-sm border border-[#DDDCCB]/50 dark:border-[#373832]/50" />
            </div>
          </div>
        )
      }
      
      if (isAudio) {
        return (
          <div key={message.id} className="mb-3 font-mono text-xs">
            <div className="text-[10px] text-[#005447] dark:text-[#67E2C8] font-bold mb-1 flex items-center gap-1">
              <span>●</span> TOOL RESULT: AUDIO
            </div>
            <div className="bg-[#F3F1DF] dark:bg-[#22231F] p-2 rounded-xl border border-[#DDDCCB] dark:border-[#373832]">
              <audio src={resultContent} controls className="w-full h-8" />
            </div>
          </div>
        )
      }
      
      return (
        <div key={message.id} className="mb-3 font-mono text-xs">
          <div className="text-[10px] text-[#005447] dark:text-[#67E2C8] font-bold mb-1 flex items-center gap-1">
            <span>●</span> TOOL RESULT
          </div>
          <pre className="bg-[#F3F1DF] dark:bg-[#22231F] p-2.5 rounded-xl border border-[#DDDCCB] dark:border-[#373832] text-[#191919] dark:text-[#F5F1E7] whitespace-pre-wrap text-[11px] max-h-48 overflow-y-auto leading-relaxed">
            <code>{resultContent}</code>
          </pre>
        </div>
      )
    }

    const isUser = message.role === 'user'

    return (
      <div key={message.id} className="mb-3 font-mono text-xs">
        <div className="flex items-center justify-between text-[#77776E] dark:text-[#A6A49B] mb-1 text-[10px] font-semibold">
          <span>{isUser ? 'USER PROMPT' : 'ASSISTANT'}</span>
          {message.contextCount !== undefined && (
            <span>{message.contextCount}/9216 tok</span>
          )}
        </div>

        <div className={`p-3 rounded-xl border leading-relaxed break-words whitespace-pre-wrap ${
          isUser 
            ? 'bg-[#005447]/10 dark:bg-[#67E2C8]/10 border-[#005447]/20 dark:border-[#67E2C8]/20 text-[#191919] dark:text-[#F5F1E7]'
            : 'bg-[#F3F1DF] dark:bg-[#22231F] border-[#DDDCCB] dark:border-[#373832] text-[#191919] dark:text-[#F5F1E7]'
        }`}>
          {message.content}
        </div>

        {message.role === 'assistant' && !state.isProcessing && !state.isInToolLoop && (
          <div className="mt-1.5 flex justify-end">
            <RatingButtons 
              messageId={message.id}
              currentRating={message.rating}
              onRate={rateMessage}
              size="sm"
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="w-full h-full min-h-0 min-w-0 bg-[#FFFEEF] dark:bg-[#171816] text-[#191919] dark:text-[#F5F1E7] flex flex-col overflow-hidden">
      {/* Top Header */}
      <div className="p-2.5 sm:p-3 border-b border-[#DDDCCB] dark:border-[#373832] flex justify-between items-center bg-[#FFFEEF]/90 dark:bg-[#171816]/90 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onNavigateToMain}
            className="p-1.5 text-[#56564E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] rounded-lg transition-colors"
            title="Back to voice screen"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-1.5 font-mono text-xs font-bold tracking-tight text-[#191919] dark:text-[#F5F1E7]">
            <Activity className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" />
            <span>DEBUG_CHAT</span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleCopyContext}
            className="p-1.5 text-[#56564E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] rounded-lg transition-colors"
            title="Copy conversation context tokens to clipboard"
          >
            <Copy className="w-4 h-4" />
          </button>
          {state.isProcessing && (
            <button
              onClick={handleInterrupt}
              className="p-1.5 text-rose-600 hover:text-rose-700 hover:bg-rose-500/10 rounded-lg transition-colors"
              title="Stop current response"
            >
              <Square className="w-4 h-4 fill-current" />
            </button>
          )}
          <button
            onClick={handleReset}
            className="p-1.5 text-[#56564E] hover:text-rose-600 dark:text-[#A6A49B] dark:hover:text-rose-400 hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] rounded-lg transition-colors"
            title="Reset conversation state"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Modern Navigation Tabs (Segmented Control) */}
      <div className="flex items-center gap-1 px-2.5 py-1.5 border-b border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/70 dark:bg-[#22231F]/70 overflow-x-auto no-scrollbar shrink-0 select-none">
        <button
          onClick={() => setActiveTab('chat')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all shrink-0 ${
            activeTab === 'chat'
              ? 'bg-[#005447] text-white dark:bg-[#1E4D40] dark:text-[#67E2C8] shadow-xs'
              : 'text-[#56564E] dark:text-[#A6A49B] hover:text-[#191919] dark:hover:text-[#F5F1E7] hover:bg-[#DDDCCB]/40 dark:hover:bg-[#373832]/60'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Chat ({state.messages.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('tools')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all shrink-0 ${
            activeTab === 'tools'
              ? 'bg-[#005447] text-white dark:bg-[#1E4D40] dark:text-[#67E2C8] shadow-xs'
              : 'text-[#56564E] dark:text-[#A6A49B] hover:text-[#191919] dark:hover:text-[#F5F1E7] hover:bg-[#DDDCCB]/40 dark:hover:bg-[#373832]/60'
          }`}
        >
          <Wrench className="w-3.5 h-3.5" />
          <span>Tool Tester</span>
        </button>

        <button
          onClick={() => setActiveTab('vault')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all shrink-0 ${
            activeTab === 'vault'
              ? 'bg-[#005447] text-white dark:bg-[#1E4D40] dark:text-[#67E2C8] shadow-xs'
              : 'text-[#56564E] dark:text-[#A6A49B] hover:text-[#191919] dark:hover:text-[#F5F1E7] hover:bg-[#DDDCCB]/40 dark:hover:bg-[#373832]/60'
          }`}
        >
          <Database className="w-3.5 h-3.5" />
          <span>Vault & Files</span>
        </button>

        <button
          onClick={() => setActiveTab('memories')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all shrink-0 ${
            activeTab === 'memories'
              ? 'bg-[#005447] text-white dark:bg-[#1E4D40] dark:text-[#67E2C8] shadow-xs'
              : 'text-[#56564E] dark:text-[#A6A49B] hover:text-[#191919] dark:hover:text-[#F5F1E7] hover:bg-[#DDDCCB]/40 dark:hover:bg-[#373832]/60'
          }`}
        >
          <Brain className="w-3.5 h-3.5" />
          <span>Memories</span>
        </button>

        <button
          onClick={() => setActiveTab('diagnostics')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all shrink-0 ${
            activeTab === 'diagnostics'
              ? 'bg-[#005447] text-white dark:bg-[#1E4D40] dark:text-[#67E2C8] shadow-xs'
              : 'text-[#56564E] dark:text-[#A6A49B] hover:text-[#191919] dark:hover:text-[#F5F1E7] hover:bg-[#DDDCCB]/40 dark:hover:bg-[#373832]/60'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Diagnostics</span>
        </button>
      </div>

      {/* Main Tab Content Panels */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === 'chat' && (
          <div className="flex flex-col h-full">
            {/* Messages Scroll Area */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {state.messages.length === 0 ? (
                <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-center p-6 text-[#77776E] dark:text-[#A6A49B] font-mono text-xs">
                  <Terminal className="w-8 h-8 text-[#005447]/40 dark:text-[#67E2C8]/40 mb-2" />
                  <p className="font-semibold text-[#191919] dark:text-[#F5F1E7]">Debug Conversation Stream</p>
                  <p className="text-[11px] mt-1">Send a message below or trigger tools to inspect execution traces and raw context.</p>
                </div>
              ) : (
                state.messages.map(renderMessage)
              )}

              {/* Status Indicator */}
              {state.isProcessing && (
                <div className="mb-3 font-mono text-xs bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-xl p-3">
                  {state.isSummarizing ? (
                    <div className="flex items-center gap-2 text-amber-500 font-semibold">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>SUMMARIZING: Condensing conversation to preserve context...</span>
                    </div>
                  ) : state.isWarmingUp ? (
                    <div className="flex items-center gap-2 text-orange-500 font-semibold">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>WARMING UP: Initializing Gemini Nano model...</span>
                    </div>
                  ) : state.executingTool ? (
                    <div className="flex items-center gap-2 text-[#005447] dark:text-[#67E2C8] font-semibold">
                      <Wrench className="w-3.5 h-3.5 animate-pulse" />
                      <span>EXECUTING TOOL: {state.executingTool}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-[#77776E] dark:text-[#A6A49B]">
                      <span className="w-2 h-2 rounded-full bg-[#005447] dark:bg-[#67E2C8] animate-ping" />
                      <span>Assistant generating response...</span>
                    </div>
                  )}
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>

            {/* Copy Feedback Toast */}
            {copyFeedback && (
              <div className="px-3 py-1 text-xs text-emerald-600 dark:text-emerald-400 font-mono bg-emerald-500/10 border-t border-emerald-500/20">
                ✓ {copyFeedback}
              </div>
            )}

            {/* Input Bar */}
            <form onSubmit={handleSubmit} className="p-2.5 border-t border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816] shrink-0">
              {state.reference && (
                <div className="mb-2 flex flex-col gap-1.5 px-3 py-2 bg-[#F3F1DF] dark:bg-[#22231F] border border-[#005447]/30 dark:border-[#67E2C8]/30 rounded-xl text-xs font-mono">
                  <div className="flex items-center gap-2">
                    <Paperclip size={13} className="text-[#005447] dark:text-[#67E2C8] shrink-0" />
                    <span className="text-[#191919] dark:text-[#F5F1E7] flex-1 truncate font-medium">
                      {state.reference.image ? 'Screenshot attached' : state.reference.audio ? 'Audio attached' : `"${state.reference.text.substring(0, 50)}..."`}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        dispatch({ type: 'SET_REFERENCE', payload: null })
                        chrome.storage.local.remove('chat_reference')
                      }}
                      className="text-[#77776E] hover:text-rose-600 dark:text-[#A6A49B] transition-colors"
                    >
                      <X size={13} />
                    </button>
                  </div>
                  
                  {state.reference.image && (
                    <img 
                      src={state.reference.image} 
                      alt="Reference screenshot" 
                      className="max-w-full max-h-24 rounded-lg border border-[#DDDCCB]/60 dark:border-[#373832]/60 object-contain"
                    />
                  )}
                  
                  {state.reference.audio && (
                    <audio 
                      src={state.reference.audio} 
                      controls 
                      className="w-full h-7"
                    />
                  )}
                </div>
              )}
              
              <div className="flex items-center gap-1.5">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={state.isProcessing}
                  placeholder="Type debug prompt..."
                  className="flex-1 bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:border-[#005447] dark:focus:border-[#67E2C8] disabled:opacity-50 text-[#191919] dark:text-[#F5F1E7]"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || state.isProcessing}
                  className="p-2 bg-[#005447] hover:bg-[#003F36] dark:bg-[#1E4D40] dark:hover:bg-[#256050] text-white dark:text-[#67E2C8] disabled:opacity-30 disabled:cursor-not-allowed rounded-xl transition-colors shrink-0 shadow-xs"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>
          </div>
        )}

        {activeTab === 'tools' && (
          <ToolTester />
        )}

        {activeTab === 'vault' && (
          <VaultDebugger />
        )}

        {activeTab === 'memories' && (
          <MemoriesDebugger />
        )}

        {activeTab === 'diagnostics' && (
          <div className="space-y-3 p-3 max-w-2xl mx-auto">
            <WakeWordTest />
            <TransformersTest />
            <RatingStatsDebugger />
            <OnboardingControls />
          </div>
        )}
      </div>
    </div>
  )
}

export default DebugScreen
