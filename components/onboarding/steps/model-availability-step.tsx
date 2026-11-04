import React, { useState, useEffect, useCallback } from 'react'
import { 
  Brain, Download, CheckCircle2, AlertCircle, ArrowRight, ArrowLeft, 
  Loader2, Sparkles, RefreshCw, X, Shield, Cpu 
} from 'lucide-react'
import { useOnboarding } from '../onboarding-provider'
import { useModelProvisioning } from '../../../lib/model-provisioning-context'
import { verifyGeminiNanoCapability } from '../../../lib/ai-config'

export const ModelAvailabilityStep: React.FC = () => {
  const { nextStep, prevStep, setModelAvailability, setLocalModelsReady, setGeminiNanoVerified } = useOnboarding()
  const modelProv = useModelProvisioning()

  const [geminiNanoStatus, setGeminiNanoStatus] = useState<'checking' | 'verified' | 'unavailable'>('checking')
  const [nanoReason, setNanoReason] = useState<string>('')

  // Check Gemini Nano capability
  useEffect(() => {
    let active = true
    verifyGeminiNanoCapability().then(res => {
      if (!active) return
      if (res.verified) {
        setGeminiNanoStatus('verified')
        setGeminiNanoVerified(true)
      } else {
        setGeminiNanoStatus('unavailable')
        setNanoReason(res.reason || 'Native Prompt API not enabled in this browser.')
        setGeminiNanoVerified(false)
      }
    }).catch(err => {
      if (!active) return
      setGeminiNanoStatus('unavailable')
      setNanoReason(err?.message || 'Detection check failed.')
      setGeminiNanoVerified(false)
    })
    return () => {
      active = false
    }
  }, [setGeminiNanoVerified])

  const isAllReady = Boolean(
    modelProv.modelsCached?.qwen && 
    modelProv.modelsCached?.embeddings && 
    modelProv.modelsCached?.whisper &&
    modelProv.modelsCached?.vision
  )

  const isCoreReady = Boolean(
    modelProv.modelsCached?.qwen && 
    modelProv.modelsCached?.embeddings && 
    modelProv.modelsCached?.whisper
  )

  useEffect(() => {
    setModelAvailability(isAllReady || isCoreReady || geminiNanoStatus === 'verified')
    setLocalModelsReady(isAllReady || isCoreReady)
  }, [isAllReady, isCoreReady, geminiNanoStatus, setModelAvailability, setLocalModelsReady])

  const isDownloading = modelProv.progress.state === 'downloading'
  const isFailed = modelProv.progress.state === 'failed' || Boolean(modelProv.progress.error)
  const isInitializing = modelProv.progress.state === 'initializing'

  const handleStartDownload = useCallback(async () => {
    if (isDownloading) return
    await modelProv.downloadAllModels({ includeOptionalVision: true })
  }, [modelProv, isDownloading])

  const handleRetry = useCallback(async () => {
    if (isDownloading) return
    await modelProv.retryDownload('all', { includeOptionalVision: true })
  }, [modelProv, isDownloading])

  return (
    <div className="flex flex-col items-center justify-center py-2 sm:py-3">
      <div className="w-full text-center space-y-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#005447] dark:text-[#67E2C8] text-xs font-medium mb-1">
            <Cpu className="w-3.5 h-3.5" />
            <span>Local AI Provisioning</span>
          </div>
          <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-[#191919] dark:text-[#F5F1E7]">
            Local AI Engine Setup
          </h2>
          <p className="font-sans text-xs text-[#77776E] dark:text-[#A6A49B] max-w-sm mx-auto">
            Pentone runs state-of-the-art models locally on your device for fast, private inference.
          </p>
        </div>

        {/* Core Required Models Card */}
        <div className="p-3.5 sm:p-4 rounded-xl bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] text-left space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" />
              <span className="font-sans font-semibold text-xs sm:text-sm text-[#191919] dark:text-[#F5F1E7]">
                Pentone Local Models (~450 MB)
              </span>
            </div>
            {isAllReady ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" /> All Models Ready
              </span>
            ) : isDownloading ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#005447] dark:text-[#67E2C8]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Downloading {modelProv.progress.percent}%
              </span>
            ) : (
              <span className="text-[11px] font-mono text-[#77776E] dark:text-[#A6A49B]">
                Setup Required
              </span>
            )}
          </div>

          {/* Model Breakdown */}
          <div className="space-y-2 border-t border-[#DDDCCB] dark:border-[#373832] pt-2.5 text-xs">
            {/* 1. SmolLM-135M */}
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-[#191919] dark:text-[#F5F1E7]">SmolLM-135M-Instruct</div>
                <div className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">Language reasoning, action planning, chat (~136 MB)</div>
              </div>
              <div>
                {modelProv.modelsCached?.qwen ? (
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Cached
                  </span>
                ) : (
                  <span className="text-[10px] text-[#77776E] dark:text-[#A6A49B] font-mono">Not Cached</span>
                )}
              </div>
            </div>

            {/* 2. all-MiniLM-L6-v2 */}
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-[#191919] dark:text-[#F5F1E7]">all-MiniLM-L6-v2</div>
                <div className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">384-D Vector Vault & document search (~23 MB)</div>
              </div>
              <div>
                {modelProv.modelsCached?.embeddings ? (
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Cached
                  </span>
                ) : (
                  <span className="text-[10px] text-[#77776E] dark:text-[#A6A49B] font-mono">Not Cached</span>
                )}
              </div>
            </div>

            {/* 3. Whisper Tiny */}
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-[#191919] dark:text-[#F5F1E7]">Whisper Tiny</div>
                <div className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">Universal offline speech recognition (~41 MB)</div>
              </div>
              <div>
                {modelProv.modelsCached?.whisper ? (
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Cached
                  </span>
                ) : (
                  <span className="text-[10px] text-[#77776E] dark:text-[#A6A49B] font-mono">Not Cached</span>
                )}
              </div>
            </div>

            {/* 4. ViT-GPT2 Local Vision */}
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-[#191919] dark:text-[#F5F1E7]">ViT-GPT2 Local Vision</div>
                <div className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">On-device screenshot inspection & chart reasoning (~250 MB)</div>
              </div>
              <div>
                {modelProv.modelsCached?.vision ? (
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Cached
                  </span>
                ) : (
                  <span className="text-[10px] text-[#77776E] dark:text-[#A6A49B] font-mono">Not Cached</span>
                )}
              </div>
            </div>
          </div>

          {/* Progress Bar during download */}
          {isDownloading && (
            <div className="space-y-1.5 pt-2 border-t border-[#DDDCCB] dark:border-[#373832]">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="truncate max-w-[200px] text-[#77776E] dark:text-[#A6A49B]">
                  {modelProv.progress.currentFile || 'Downloading model weights...'}
                </span>
                <span className="font-semibold text-[#005447] dark:text-[#67E2C8]">
                  {modelProv.progress.percent}%
                </span>
              </div>
              <div className="w-full h-2 bg-[#DDDCCB] dark:bg-[#373832] rounded-full overflow-hidden">
                <div 
                  className="h-full bg-[#005447] dark:bg-[#67E2C8] rounded-full transition-all duration-300"
                  style={{ width: `${Math.max(4, modelProv.progress.percent)}%` }}
                />
              </div>
              <div className="flex justify-end">
                <button
                  onClick={modelProv.cancelDownload}
                  className="text-[10px] text-rose-600 dark:text-rose-400 hover:underline flex items-center gap-0.5"
                >
                  <X className="w-2.5 h-2.5" /> Cancel Download
                </button>
              </div>
            </div>
          )}

          {/* Initializing indicator */}
          {isInitializing && (
            <div className="pt-2 border-t border-[#DDDCCB] dark:border-[#373832] flex items-center gap-2 text-xs text-[#005447] dark:text-[#67E2C8]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Verifying and compiling model weights into runtime memory...</span>
            </div>
          )}

          {/* Download Error Alert */}
          {isFailed && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-xs space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1 pr-1 flex-1">
                  <div className="font-semibold text-rose-800 dark:text-rose-200 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-600 dark:text-rose-400" />
                    <span>Model Provisioning Incomplete</span>
                  </div>
                  <p className="text-[11px] leading-relaxed break-words">
                    {modelProv.progress.error || 'Network error or integrity verification failed during download.'}
                  </p>
                  <p className="text-[10px] text-rose-600/80 dark:text-rose-400/80">
                    Existing valid models remain cached and intact. Retry will resume only the missing or unverified files.
                  </p>
                </div>
                <button
                  onClick={handleRetry}
                  disabled={isDownloading}
                  className="px-2.5 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-md text-[11px] font-medium shrink-0 flex items-center gap-1 shadow-xs transition-colors"
                >
                  <RefreshCw className={`w-3 h-3 ${isDownloading ? 'animate-spin' : ''}`} />
                  <span>Retry</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Gemini Nano Detection Card */}
        <div className="p-3 rounded-xl bg-[#F3F1DF]/70 dark:bg-[#22231F]/70 border border-[#DDDCCB] dark:border-[#373832] text-left text-xs space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-sans font-medium text-[#191919] dark:text-[#F5F1E7] flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8]" />
              Chrome Built-in AI (Gemini Nano)
            </span>
            {geminiNanoStatus === 'checking' ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-[#77776E] dark:text-[#A6A49B]">
                <Loader2 className="w-3 h-3 animate-spin" /> Checking
              </span>
            ) : geminiNanoStatus === 'verified' ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-3 h-3" /> Active Native Fast-Path
              </span>
            ) : (
              <span className="text-[11px] font-mono text-[#77776E] dark:text-[#A6A49B]">
                Not Detected
              </span>
            )}
          </div>
          <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B]">
            {geminiNanoStatus === 'verified'
              ? 'Chrome Prompt API is enabled and active. Pentone will use it for native acceleration where supported.'
              : 'Optional native API not present. Pentone operates 100% offline using bundled SmolLM-135M.'}
          </p>
        </div>

        {/* Primary Action Button */}
        <div className="space-y-2 pt-1">
          {!isAllReady && !isDownloading && (
            <button
              onClick={handleStartDownload}
              className="w-full bg-[#005447] hover:bg-[#003F36] dark:bg-[#67E2C8] dark:hover:bg-[#52C5AD] text-white dark:text-[#171816] px-5 py-2.5 rounded-xl font-sans font-semibold text-xs sm:text-sm transition-all duration-200 flex items-center justify-center gap-2 shadow-sm cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Download & Set Up All Local Models (~450 MB)</span>
            </button>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={prevStep}
              className="flex-1 px-4 py-2.5 rounded-xl border border-[#DDDCCB] dark:border-[#373832] text-[#77776E] dark:text-[#A6A49B] hover:text-[#191919] dark:hover:text-[#F5F1E7] hover:bg-[#F3F1DF] dark:hover:bg-[#22231F] font-sans font-medium text-xs sm:text-sm transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>

            <button
              onClick={isAllReady ? nextStep : handleStartDownload}
              disabled={isDownloading}
              className={`flex-1 px-4 py-2.5 rounded-xl font-sans font-semibold text-xs sm:text-sm transition-all duration-200 flex items-center justify-center gap-1.5 shadow-sm ${
                isAllReady
                  ? 'bg-[#005447] hover:bg-[#003F36] dark:bg-[#67E2C8] dark:hover:bg-[#52C5AD] text-white dark:text-[#171816] cursor-pointer'
                  : 'bg-[#005447]/85 hover:bg-[#005447] dark:bg-[#67E2C8]/85 dark:hover:bg-[#67E2C8] text-white dark:text-[#171816] cursor-pointer'
              }`}
            >
              <span>{isAllReady ? 'Next: Complete Setup' : isDownloading ? 'Downloading Models...' : 'Download Models to Continue'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
