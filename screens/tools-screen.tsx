import React, { useState } from 'react'
import { 
  Globe, Layers, MousePointer, Edit3, Keyboard, ArrowUp, ArrowDown, 
  Highlighter, Camera, Search, BookOpen, Compass, Shield, Play, 
  Terminal, ChevronDown, ChevronRight, AlertTriangle, X, Check 
} from 'lucide-react'
import { AppHeader } from '../components/navigation/app-header'
import { TOOL_REGISTRY, type ToolSpec } from '../lib/tool-registry'
import { executeTool } from '../lib/tools'
import { executeUITool } from '../lib/ui-tools'
import { classifyTool, evaluateHighImpact, type HighImpactCheckResult } from '../lib/audio/tool-authorization-classifier'
import { voiceAuthorizationManager } from '../lib/audio/voice-authorization-manager'
import { type Screen } from '../lib/config'

interface ToolsScreenProps {
  onNavigate: (screen: Screen) => void
  onOpenSidePanel?: () => void
}

type ToolCategory = 'All' | 'Navigation' | 'Page Interaction' | 'Page Understanding' | 'Knowledge & Extraction' | 'Content & Voice'

interface PendingConfirmationState {
  tool: ToolSpec
  args: any
  impact: HighImpactCheckResult
}

export const ToolsScreen: React.FC<ToolsScreenProps> = ({ onNavigate, onOpenSidePanel }) => {
  const [selectedCategory, setSelectedCategory] = useState<ToolCategory>('All')
  const [expandedTool, setExpandedTool] = useState<string | null>(null)
  const [toolInputs, setToolInputs] = useState<Record<string, string>>({})
  const [executionResults, setExecutionResults] = useState<Record<string, any>>({})
  const [runningTool, setRunningTool] = useState<string | null>(null)
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmationState | null>(null)

  const categorizeTool = (tool: ToolSpec): ToolCategory => {
    switch (tool.name) {
      case 'openTab':
      case 'switchTab':
      case 'getTabs':
        return 'Navigation'
      case 'clickElement':
      case 'fillInput':
      case 'pressKey':
      case 'scrollUp':
      case 'scrollDown':
      case 'highlightSelector':
      case 'highlightText':
        return 'Page Interaction'
      case 'getAccessibilitySnapshot':
      case 'findElements':
      case 'getPageTitle':
      case 'summarizePage':
      case 'captureScreenshot':
      case 'captureCurrentPage':
        return 'Page Understanding'
      case 'searchVault':
      case 'getVaultStats':
      case 'getPlaybook':
        return 'Knowledge & Extraction'
      case 'storeMemory':
      case 'writeContent':
      case 'translateText':
      case 'detectLanguage':
      case 'listen':
      case 'think':
      default:
        return 'Content & Voice'
    }
  }

  const getToolIcon = (name: string) => {
    switch (name) {
      case 'openTab': return <Globe className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" />
      case 'switchTab':
      case 'getTabs': return <Layers className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" />
      case 'clickElement': return <MousePointer className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" />
      case 'fillInput': return <Edit3 className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" />
      case 'pressKey': return <Keyboard className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" />
      case 'scrollUp': return <ArrowUp className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" />
      case 'scrollDown': return <ArrowDown className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" />
      case 'highlightSelector':
      case 'highlightText': return <Highlighter className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" />
      case 'captureScreenshot':
      case 'captureCurrentPage': return <Camera className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" />
      case 'findElements': return <Search className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" />
      case 'summarizePage': return <BookOpen className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" />
      case 'getAccessibilitySnapshot': return <Compass className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" />
      default: return <Terminal className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" />
    }
  }

  const categories: ToolCategory[] = [
    'All',
    'Navigation',
    'Page Interaction',
    'Page Understanding',
    'Knowledge & Extraction',
    'Content & Voice'
  ]

  const filteredTools = TOOL_REGISTRY.filter(t => 
    selectedCategory === 'All' || categorizeTool(t) === selectedCategory
  )

  // Execution dispatch with strict authorization invariants:
  // 1. Never fabricates credentials or fake authorization contexts.
  // 2. High-impact tools require deliberate interactive user confirmation.
  // 3. The background service worker enforces final authorization.
  const executeToolWithAuth = async (tool: ToolSpec, parsedArgs: any, confirmationApproved: boolean) => {
    setRunningTool(tool.name)
    try {
      // Resolve execution token strictly from existing legitimate active context (if present)
      const activeContext = voiceAuthorizationManager.getActiveContext()
      let token = undefined
      if (activeContext?.turnId !== undefined) {
        const grant = voiceAuthorizationManager.getTurnGrant(activeContext.turnId)
        if (grant && voiceAuthorizationManager.isGrantActive(grant.grantId)) {
          token = voiceAuthorizationManager.mintExecutionToken(grant, tool.name)
        }
      }

      let res
      if (tool.requiresUserGesture) {
        res = await executeUITool({ function: tool.name, arguments: parsedArgs }, token, confirmationApproved)
      } else {
        res = await executeTool({ function: tool.name, arguments: parsedArgs }, token, confirmationApproved)
      }
      setExecutionResults(prev => ({ ...prev, [tool.name]: res }))
    } catch (err: any) {
      setExecutionResults(prev => ({ ...prev, [tool.name]: { success: false, error: err.message } }))
    } finally {
      setRunningTool(null)
    }
  }

  const handleTestExecute = (tool: ToolSpec) => {
    try {
      const rawInput = toolInputs[tool.name] || '{}'
      const parsedArgs = JSON.parse(rawInput)

      // Evaluate whether the tool call constitutes a high-impact or sensitive action
      const impact = evaluateHighImpact(tool.name, parsedArgs)

      if (impact.isHighImpact) {
        // High-impact actions strictly require interactive confirmation before dispatching
        setPendingConfirmation({
          tool,
          args: parsedArgs,
          impact
        })
        return
      }

      // Read-only or safe actions execute without extra confirmation dialog
      executeToolWithAuth(tool, parsedArgs, false)
    } catch (err: any) {
      setExecutionResults(prev => ({
        ...prev,
        [tool.name]: { success: false, error: `Invalid JSON parameters: ${err.message}` }
      }))
    }
  }

  const handleConfirmApproved = () => {
    if (!pendingConfirmation) return
    const { tool, args } = pendingConfirmation
    setPendingConfirmation(null)
    executeToolWithAuth(tool, args, true)
  }

  const handleConfirmCancelled = () => {
    if (!pendingConfirmation) return
    const toolName = pendingConfirmation.tool.name
    setPendingConfirmation(null)
    setExecutionResults(prev => ({
      ...prev,
      [toolName]: { success: false, error: 'Execution cancelled by operator' }
    }))
  }

  return (
    <div className="w-full h-full flex flex-col bg-[#FFFEEF] dark:bg-[#171816] text-[#191919] dark:text-[#F5F1E7] overflow-hidden select-none">
      <AppHeader
        currentScreen="tools"
        onNavigate={onNavigate}
        onOpenSidePanel={onOpenSidePanel}
      />

      <div className="flex-1 min-h-0 flex flex-col p-4 overflow-hidden">
        {/* Category Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-3 mb-2 no-scrollbar shrink-0">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-full text-xs font-sans font-medium transition-all shrink-0 ${
                selectedCategory === cat
                  ? 'bg-[#005447] text-[#FFFEEF] dark:bg-[#07584B] dark:text-[#F5F1E7] shadow-xs'
                  : 'bg-[#F3F1DF] text-[#77776E] dark:bg-[#22231F] dark:text-[#A6A49B] hover:text-[#191919] dark:hover:text-[#F5F1E7] border border-[#DDDCCB] dark:border-[#373832]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Tools Catalog */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-0.5">
          {filteredTools.map((tool) => {
            const isExpanded = expandedTool === tool.name
            const result = executionResults[tool.name]
            const isRunning = runningTool === tool.name
            const classification = classifyTool(tool.name)

            return (
              <div
                key={tool.name}
                className="rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/70 dark:bg-[#22231F]/70 overflow-hidden transition-all shadow-2xs"
              >
                <div
                  onClick={() => setExpandedTool(isExpanded ? null : tool.name)}
                  className="p-3.5 flex items-start justify-between cursor-pointer hover:bg-[#EBE7D0]/60 dark:hover:bg-[#2A2B26]/60 gap-3"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span className="p-2 rounded-lg bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] shrink-0 mt-0.5">
                      {getToolIcon(tool.name)}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-xs font-bold text-[#191919] dark:text-[#F5F1E7] font-mono truncate">
                          {tool.name}
                        </h4>
                        <span className={`px-1.5 py-0.2 rounded text-[9px] font-sans font-semibold ${
                          classification?.actionType === 'MUTATING'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                        }`}>
                          {classification?.actionType || 'READ_ONLY'}
                        </span>
                        {tool.requiresUserGesture && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-sans font-semibold bg-[#E9D2FF] text-[#4E2A7A] dark:bg-[#CDB0F3]/30 dark:text-[#DBC3FA]">
                            UI Tool
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#77776E] dark:text-[#A6A49B] mt-1 line-clamp-2 leading-relaxed font-sans">
                        {tool.description}
                      </p>
                    </div>
                  </div>

                  <span className="text-[#77776E] dark:text-[#A6A49B] shrink-0 mt-1">
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </span>
                </div>

                {isExpanded && (
                  <div className="px-3.5 pb-3.5 pt-2 border-t border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF]/60 dark:bg-[#171816]/60 space-y-3 font-sans text-xs">
                    {/* Parameters schema */}
                    <div>
                      <div className="text-[10px] uppercase font-bold text-[#77776E] dark:text-[#A6A49B] tracking-wider mb-1.5">
                        Parameters ({tool.parameters.length})
                      </div>
                      {tool.parameters.length === 0 ? (
                        <div className="text-[11px] text-[#77776E] dark:text-[#A6A49B] italic">No parameters required</div>
                      ) : (
                        <div className="space-y-1">
                          {tool.parameters.map((p) => (
                            <div key={p.name} className="flex items-baseline gap-2 text-[11px] font-mono">
                              <span className="font-semibold text-[#005447] dark:text-[#67E2C8]">
                                {p.name}{p.required ? '*' : ''}
                              </span>
                              <span className="text-[#77776E] dark:text-[#A6A49B]">({p.type}):</span>
                              <span className="text-[#191919] dark:text-[#F5F1E7] font-sans text-[11px] truncate">
                                {p.description}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Interactive tester */}
                    <div className="pt-2 border-t border-[#DDDCCB]/60 dark:border-[#373832]/60">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] uppercase font-bold text-[#77776E] dark:text-[#A6A49B] tracking-wider">
                          Test Tool JSON Arguments
                        </span>
                        <button
                          onClick={() => handleTestExecute(tool)}
                          disabled={isRunning}
                          className="px-2.5 py-1 rounded-md bg-[#005447] hover:bg-[#003F36] text-[#FFFEEF] dark:bg-[#07584B] dark:hover:bg-[#064238] dark:text-[#F5F1E7] text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50"
                        >
                          {isRunning ? (
                            <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <Play className="w-3 h-3 fill-current" />
                          )}
                          Execute
                        </button>
                      </div>

                      <textarea
                        value={toolInputs[tool.name] || '{}'}
                        onChange={(e) => setToolInputs(prev => ({ ...prev, [tool.name]: e.target.value }))}
                        rows={2}
                        className="w-full rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF] dark:bg-[#22231F] p-2 font-mono text-[11px] text-[#191919] dark:text-[#F5F1E7] focus:outline-none focus:border-[#005447] dark:focus:border-[#67E2C8]"
                        placeholder="{}"
                      />

                      {result && (
                        <div className="mt-2 p-2 rounded-lg bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] overflow-x-auto max-h-36 overflow-y-auto font-mono text-[10px]">
                          <div className="text-[9px] uppercase font-bold text-[#77776E] dark:text-[#A6A49B] mb-1 font-sans">
                            Execution Output:
                          </div>
                          <pre className="text-[#191919] dark:text-[#F5F1E7]">
                            {JSON.stringify(result, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Explicit High-Impact Action Confirmation Modal */}
      {pendingConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div className="bg-[#FFFEEF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-display font-bold text-sm text-[#191919] dark:text-[#F5F1E7]">
                  Confirm High-Impact Action
                </h3>
                <p className="text-xs text-[#77776E] dark:text-[#A6A49B] mt-0.5 font-sans leading-relaxed">
                  {pendingConfirmation.impact.reason || 'This tool performs a sensitive mutation on external or financial resources.'}
                </p>
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-[#F3F1DF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] font-mono text-[11px] max-h-28 overflow-y-auto">
              <div className="text-[9px] uppercase font-bold text-[#77776E] dark:text-[#A6A49B] mb-1 font-sans">
                Target: {pendingConfirmation.tool.name}
              </div>
              <pre className="text-[#191919] dark:text-[#F5F1E7]">
                {JSON.stringify(pendingConfirmation.args, null, 2)}
              </pre>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={handleConfirmCancelled}
                className="px-3 py-1.5 rounded-lg border border-[#DDDCCB] dark:border-[#373832] text-xs font-sans text-[#77776E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmApproved}
                className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-sans font-semibold shadow-xs transition-colors flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" />
                Confirm &amp; Run
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
