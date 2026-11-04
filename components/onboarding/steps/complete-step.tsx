import React from 'react'
import { CheckCircle2, Sparkles, Mic, Brain, Database, ArrowRight, ShieldCheck, Eye } from 'lucide-react'
import { useOnboarding } from '../onboarding-provider'

export const CompleteStep = () => {
  const { nextStep, state } = useOnboarding()

  return (
    <div className="flex flex-col items-center justify-center py-2 sm:py-3">
      <div className="w-full text-center space-y-4">
        <div className="space-y-1">
          <div className="flex justify-center mb-1.5">
            <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
              <CheckCircle2 className="w-8 h-8" />
            </div>
          </div>
          <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-[#191919] dark:text-[#F5F1E7]">
            You're All Set!
          </h2>
          <p className="font-sans text-xs text-[#77776E] dark:text-[#A6A49B] max-w-sm mx-auto">
            Pentone is fully configured and ready to assist you.
          </p>
        </div>

        {/* Verification Summary Card */}
        <div className="p-3.5 rounded-xl bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] text-left space-y-2.5 text-xs">
          <div className="font-sans font-semibold text-[#191919] dark:text-[#F5F1E7] pb-1 border-b border-[#DDDCCB] dark:border-[#373832]">
            System Status
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[#191919] dark:text-[#F5F1E7]">
              <Mic className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8]" />
              <span>Voice Input & Microphone</span>
            </div>
            <span className={`text-[11px] font-medium ${state.micPermissionGranted ? 'text-emerald-600 dark:text-emerald-400' : 'text-[#77776E] dark:text-[#A6A49B]'}`}>
              {state.micPermissionGranted ? 'Ready' : 'Text-Only Mode'}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[#191919] dark:text-[#F5F1E7]">
              <Brain className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8]" />
              <span>Local AI Engine</span>
            </div>
            <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              {state.geminiNanoVerified ? 'Gemini Nano + SmolLM' : state.localModelsReady ? 'SmolLM-135M Active' : 'Configurable'}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[#191919] dark:text-[#F5F1E7]">
              <Database className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8]" />
              <span>Vector Memory Vault</span>
            </div>
            <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              all-MiniLM-L6-v2 Ready
            </span>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[#191919] dark:text-[#F5F1E7]">
              <Eye className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8]" />
              <span>Local Vision & OCR</span>
            </div>
            <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              ViT-GPT2 Ready
            </span>
          </div>
        </div>

        {/* Quick Start Tips Card */}
        <div className="p-3.5 rounded-xl bg-[#EBE7D0]/60 dark:bg-[#2A2B26]/60 border border-[#DDDCCB] dark:border-[#373832] text-left text-xs space-y-2">
          <div className="flex items-center gap-1.5 text-[#005447] dark:text-[#67E2C8] font-medium">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Quick Start Tips</span>
          </div>
          <ul className="text-[11px] text-[#77776E] dark:text-[#A6A49B] space-y-1.5 pl-1">
            <li className="flex items-start gap-1.5">
              <span className="font-mono text-[#005447] dark:text-[#67E2C8] font-bold">•</span>
              <span><strong>Hold Spacebar:</strong> Push-to-Talk from any webpage or inside the panel.</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span className="font-mono text-[#005447] dark:text-[#67E2C8] font-bold">•</span>
              <span><strong>27 Browser Tools:</strong> Ask Pentone to scroll, extract text, fill forms, or click links.</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span className="font-mono text-[#005447] dark:text-[#67E2C8] font-bold">•</span>
              <span><strong>100% Private:</strong> Zero data leaves your browser. Local intelligence only.</span>
            </li>
          </ul>
        </div>

        <div className="pt-2">
          <button
            onClick={nextStep}
            className="w-full bg-[#005447] hover:bg-[#003F36] dark:bg-[#67E2C8] dark:hover:bg-[#52C5AD] text-white dark:text-[#171816] px-5 py-3 rounded-xl font-sans font-semibold text-xs sm:text-sm transition-all duration-200 flex items-center justify-center gap-2 shadow-sm"
          >
            <span>Start Using Pentone</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
