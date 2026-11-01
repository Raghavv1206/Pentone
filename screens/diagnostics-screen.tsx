import React, { useState, useEffect } from 'react'
import { Activity, Copy, Check, RefreshCw, Terminal, Layers, ShieldCheck, Cpu, Database, Brain, Sparkles } from 'lucide-react'
import { AppHeader } from '../components/navigation/app-header'
import { voiceDiagnosticTracker, type TurnDiagnosticRecord } from '../lib/audio/voice-diagnostic-tracker'
import { getTokenUsage, getAIMetrics } from '../lib/ai'
import { inspectPromptAPIAvailability, getModelDownloadState, subscribeToModelDownload } from '../lib/ai-config'
import { MAX_CONTEXT_SIZE, PROACTIVE_CONTEXT_LIMIT } from '../lib/summarizer'
import { useChatContext } from '../lib/chat-context'
import { type Screen } from '../lib/config'

interface DiagnosticsScreenProps {
  onNavigate: (screen: Screen) => void
  onOpenSidePanel?: () => void
}

export const DiagnosticsScreen: React.FC<DiagnosticsScreenProps> = ({ onNavigate, onOpenSidePanel }) => {
  const { state } = useChatContext()
  const [turns, setTurns] = useState<TurnDiagnosticRecord[]>([])
  const [selectedTurn, setSelectedTurn] = useState<TurnDiagnosticRecord | null>(null)
  const [copied, setCopied] = useState(false)
  const tokenUsage = getTokenUsage()
  const aiMetrics = getAIMetrics()

  const [modelTelemetry, setModelTelemetry] = useState<{
    chromeVersion: string
    rawAvailability: string
    normalizedAvailability: string
    downloadState: string
    downloadProgress: number
    initLatencyMs: number | null
    capabilities: {
      prompt: string
      summarizer: string
      writer: string
      translator: string
    }
  }>({
    chromeVersion: 'Detecting...',
    rawAvailability: 'Checking...',
    normalizedAvailability: 'Checking...',
    downloadState: 'Checking...',
    downloadProgress: 0,
    initLatencyMs: null,
    capabilities: {
      prompt: 'checking',
      summarizer: 'checking',
      writer: 'checking',
      translator: 'checking'
    }
  })

  const refreshAITelemetry = async () => {
    let chromeVersion = 'Unknown'
    if (typeof navigator !== 'undefined') {
      const match = navigator.userAgent.match(/Chrome\/([0-9.]+)/)
      if (match) chromeVersion = match[1]
    }

    try {
      const { raw, normalized } = await inspectPromptAPIAvailability()
      const dlState = getModelDownloadState()

      let summarizerStatus = 'unavailable'
      let writerStatus = 'unavailable'
      let translatorStatus = 'unavailable'

      if (typeof window !== 'undefined') {
        try {
          if ('Summarizer' in window && typeof (window as any).Summarizer?.availability === 'function') {
            summarizerStatus = await (window as any).Summarizer.availability()
          }
        } catch (e) {}

        try {
          if ('Writer' in window && typeof (window as any).Writer?.availability === 'function') {
            writerStatus = await (window as any).Writer.availability()
          }
        } catch (e) {}

        try {
          if ('Translator' in window && typeof (window as any).Translator?.availability === 'function') {
            translatorStatus = await (window as any).Translator.availability({ sourceLanguage: 'en', targetLanguage: 'es' })
          }
        } catch (e) {}
      }

      let downloadStateText = 'Not Downloaded'
      if (dlState.status === 'ready' || normalized === 'available') {
        downloadStateText = 'Ready'
      } else if (dlState.status === 'downloading') {
        downloadStateText = `Downloading (${dlState.progress}%)`
      } else if (dlState.status === 'error') {
        downloadStateText = 'Error'
      } else if (normalized === 'downloadable') {
        downloadStateText = 'Downloadable (Ready to Install)'
      }

      setModelTelemetry({
        chromeVersion,
        rawAvailability: raw,
        normalizedAvailability: normalized,
        downloadState: downloadStateText,
        downloadProgress: dlState.progress,
        initLatencyMs: dlState.downloadDurationMs,
        capabilities: {
          prompt: raw,
          summarizer: summarizerStatus,
          writer: writerStatus,
          translator: translatorStatus
        }
      })
    } catch (e) {
      // ignore
    }
  }

  const refreshTurns = () => {
    const records = voiceDiagnosticTracker.getRecentTurns()
    setTurns([...records])
    if (records.length > 0 && !selectedTurn) {
      setSelectedTurn(records[0])
    }
    refreshAITelemetry()
  }

  useEffect(() => {
    refreshTurns()
    refreshAITelemetry()
    const unsubscribe = voiceDiagnosticTracker.subscribe(() => {
      refreshTurns()
    })
    const unsubDl = subscribeToModelDownload(() => {
      refreshAITelemetry()
    })
    return () => {
      unsubscribe()
      unsubDl()
    }
  }, [])

  const handleCopyJSON = () => {
    const payload = {
      timestamp: new Date().toISOString(),
      chromeVersion: modelTelemetry.chromeVersion,
      modelTelemetry,
      tokenUsage,
      aiMetrics,
      activeMessages: state.messages.length,
      turns
    }
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="w-full h-full flex flex-col bg-[#FFFEEF] dark:bg-[#171816] text-[#191919] dark:text-[#F5F1E7] overflow-hidden select-none">
      <AppHeader
        currentScreen="diagnostics"
        onNavigate={onNavigate}
        onOpenSidePanel={onOpenSidePanel}
      />

      <div className="flex-1 min-h-0 flex flex-col p-4 overflow-hidden space-y-4">
        {/* Top telemetry status cards */}
        <div className="grid grid-cols-3 gap-2 shrink-0">
          <div className="p-2.5 rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/70 dark:bg-[#22231F]/70">
            <div className="text-[10px] uppercase font-sans text-[#77776E] dark:text-[#A6A49B] font-bold">Context Tokens</div>
            <div className="text-sm font-bold font-mono text-[#005447] dark:text-[#67E2C8] mt-0.5">
              {tokenUsage.usage} / {MAX_CONTEXT_SIZE}
            </div>
            <div className="text-[9px] font-mono text-[#77776E] dark:text-[#A6A49B] mt-0.5">
              Limit: {PROACTIVE_CONTEXT_LIMIT}t
            </div>
          </div>

          <div className="p-2.5 rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/70 dark:bg-[#22231F]/70">
            <div className="text-[10px] uppercase font-sans text-[#77776E] dark:text-[#A6A49B] font-bold">Recorded Turns</div>
            <div className="text-sm font-bold font-mono text-[#191919] dark:text-[#F5F1E7] mt-0.5">
              {turns.length}
            </div>
            <div className="text-[9px] font-sans text-[#77776E] dark:text-[#A6A49B] mt-0.5">
              Voice Diagnostic Ring
            </div>
          </div>

          <div className="p-2.5 rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/70 dark:bg-[#22231F]/70">
            <div className="text-[10px] uppercase font-sans text-[#77776E] dark:text-[#A6A49B] font-bold">Messages</div>
            <div className="text-sm font-bold font-mono text-[#191919] dark:text-[#F5F1E7] mt-0.5">
              {state.messages.length}
            </div>
            <div className="text-[9px] font-sans text-[#77776E] dark:text-[#A6A49B] mt-0.5">
              {state.messages.filter(m => m.visualOnly).length} Compacted
            </div>
          </div>
        </div>

        {/* Chrome Built-in AI / Prompt API Telemetry Card */}
        <div className="p-3 rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/70 dark:bg-[#22231F]/70 shrink-0">
          <div className="flex items-center justify-between pb-2 border-b border-[#DDDCCB]/60 dark:border-[#373832]/60 mb-2">
            <div className="flex items-center gap-1.5">
              <Brain className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8]" />
              <span className="text-xs font-bold font-sans text-[#191919] dark:text-[#F5F1E7]">
                Chrome Built-in AI (Prompt API)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-[#77776E] dark:text-[#A6A49B]">
                Chrome {modelTelemetry.chromeVersion}
              </span>
              <button
                onClick={refreshAITelemetry}
                className="px-1.5 py-0.5 rounded text-[10px] font-sans font-medium text-[#77776E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] flex items-center gap-1 border border-[#DDDCCB] dark:border-[#373832]"
                title="Check AI Availability Again"
              >
                <RefreshCw className="w-2.5 h-2.5" />
                Check Again
              </button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2 text-[10px] font-mono">
            <div>
              <div className="text-[9px] uppercase font-sans text-[#77776E] dark:text-[#A6A49B]">Availability</div>
              <div className="font-bold text-[#005447] dark:text-[#67E2C8] capitalize truncate">
                {modelTelemetry.normalizedAvailability} ({modelTelemetry.rawAvailability})
              </div>
            </div>
            <div>
              <div className="text-[9px] uppercase font-sans text-[#77776E] dark:text-[#A6A49B]">Download State</div>
              <div className="font-bold text-[#191919] dark:text-[#F5F1E7] truncate">
                {modelTelemetry.downloadState}
              </div>
            </div>
            <div>
              <div className="text-[9px] uppercase font-sans text-[#77776E] dark:text-[#A6A49B]">Init Latency</div>
              <div className="font-bold text-[#191919] dark:text-[#F5F1E7]">
                {modelTelemetry.initLatencyMs !== null ? `${modelTelemetry.initLatencyMs}ms` : '—'}
              </div>
            </div>
            <div>
              <div className="text-[9px] uppercase font-sans text-[#77776E] dark:text-[#A6A49B]">Optional APIs</div>
              <div className="text-[9px] text-[#77776E] dark:text-[#A6A49B] truncate">
                Sum: {modelTelemetry.capabilities.summarizer === 'available' || modelTelemetry.capabilities.summarizer === 'readily' ? '✓' : '—'} · 
                Wri: {modelTelemetry.capabilities.writer === 'available' || modelTelemetry.capabilities.writer === 'readily' ? '✓' : '—'} · 
                Tra: {modelTelemetry.capabilities.translator === 'available' ? '✓' : '—'}
              </div>
            </div>
          </div>
        </div>

        {/* Turn Selector & JSON Inspector */}
        <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/50 dark:bg-[#22231F]/50 overflow-hidden">
          <div className="px-3 py-2 border-b border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF] dark:bg-[#22231F] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8]" />
              <span className="text-xs font-bold text-[#191919] dark:text-[#F5F1E7] font-sans">
                Voice Pipeline Telemetry
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyJSON}
                className="px-2 py-1 rounded-md text-[11px] font-sans font-medium text-[#77776E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] flex items-center gap-1 transition-colors"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                {copied ? 'Copied' : 'Copy JSON'}
              </button>
              <button
                onClick={refreshTurns}
                className="p-1 rounded-md text-[#77776E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7]"
                title="Refresh"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 flex overflow-hidden">
            {/* Turns sidebar */}
            <div className="w-36 border-r border-[#DDDCCB] dark:border-[#373832] overflow-y-auto p-1.5 space-y-1">
              {turns.length === 0 ? (
                <div className="p-3 text-[10px] text-[#77776E] dark:text-[#A6A49B] text-center font-sans">
                  No turns recorded yet
                </div>
              ) : (
                turns.map((turn) => {
                  const isSelected = selectedTurn?.turnId === turn.turnId
                  return (
                    <button
                      key={turn.turnId}
                      onClick={() => setSelectedTurn(turn)}
                      className={`w-full p-2 text-left rounded-lg text-[10px] font-mono transition-all ${
                        isSelected
                          ? 'bg-[#E9D2FF] text-[#191919] font-bold border border-[#D5B5F5] dark:bg-[#CDB0F3] dark:text-[#171816]'
                          : 'hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] text-[#77776E] dark:text-[#A6A49B]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span>Turn #{turn.turnId}</span>
                        <span className={`w-1.5 h-1.5 rounded-full ${turn.terminalState === 'COMPLETED' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                      </div>
                      <div className="truncate text-[9px] mt-0.5 opacity-80">
                        {turn.whisperText || 'No transcript'}
                      </div>
                    </button>
                  )
                })
              )}
            </div>

            {/* Turn details inspector */}
            <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px] select-text">
              {selectedTurn ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-[10px] font-sans pb-2 border-b border-[#DDDCCB]/60 dark:border-[#373832]/60">
                    <div>
                      <span className="text-[#77776E] dark:text-[#A6A49B]">Status:</span>{' '}
                      <span className="font-bold text-[#005447] dark:text-[#67E2C8]">{selectedTurn.terminalState || 'PROCESSING'}</span>
                    </div>
                    <div>
                      <span className="text-[#77776E] dark:text-[#A6A49B]">Decision:</span>{' '}
                      <span className="font-bold">{selectedTurn.authDecision || 'PENDING'}</span>
                    </div>
                    <div>
                      <span className="text-[#77776E] dark:text-[#A6A49B]">Whisper Latency:</span>{' '}
                      <span>{selectedTurn.whisperLatencyMs ? `${selectedTurn.whisperLatencyMs}ms` : '—'}</span>
                    </div>
                    <div>
                      <span className="text-[#77776E] dark:text-[#A6A49B]">Audio Duration:</span>{' '}
                      <span>{selectedTurn.audioDurationSeconds ? `${selectedTurn.audioDurationSeconds.toFixed(2)}s` : '—'}</span>
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] font-bold uppercase text-[#77776E] dark:text-[#A6A49B] font-sans mb-1">
                      Raw Transcript
                    </div>
                    <div className="p-2 rounded-lg bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] text-xs">
                      {selectedTurn.whisperText || '(No transcript captured)'}
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] font-bold uppercase text-[#77776E] dark:text-[#A6A49B] font-sans mb-1">
                      Complete Diagnostic Snapshot
                    </div>
                    <pre className="p-2 rounded-lg bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] text-[10px] overflow-x-auto text-[#191919] dark:text-[#F5F1E7]">
                      {JSON.stringify(selectedTurn, null, 2)}
                    </pre>
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-[#77776E] dark:text-[#A6A49B] font-sans">
                  Select a turn from the left to view diagnostic telemetry
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
