import React from 'react'
import { CheckCircle2, Sparkles, ArrowRight, Mic, Cpu, Volume2 } from 'lucide-react'
import { useOnboarding } from '../onboarding-provider'

export const CompleteStep: React.FC = () => {
  const { nextStep, state } = useOnboarding()

  return (
    <div className="flex flex-col items-center justify-center space-y-5 text-center">
      <div className="space-y-1.5">
        <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 flex items-center justify-center mx-auto mb-2">
          <CheckCircle2 className="w-6 h-6" />
        </div>
        <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-[#191919] dark:text-[#F5F1E7]">
          Setup Complete!
        </h2>
        <p className="font-sans text-xs text-[#77776E] dark:text-[#A6A49B]">
          Pentone is primed and ready to automate and assist you on the web
        </p>
      </div>

      <div className="w-full space-y-3 text-left">
        <div className="bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-2xl p-4 space-y-3 shadow-xs">
          <div className="flex items-center justify-between text-xs">
            <span className="font-sans font-semibold text-[#191919] dark:text-[#F5F1E7] flex items-center gap-2">
              <Mic className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8]" />
              Microphone Access
            </span>
            <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400 font-bold">
              {state.micPermissionGranted ? 'Granted' : 'Limited'}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="font-sans font-semibold text-[#191919] dark:text-[#F5F1E7] flex items-center gap-2">
              <Cpu className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8]" />
              Chrome Built-in AI
            </span>
            <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400 font-bold">
              {state.modelAvailable ? 'Active' : 'On-Device'}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="font-sans font-semibold text-[#191919] dark:text-[#F5F1E7] flex items-center gap-2">
              <Volume2 className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8]" />
              Speech Recognition
            </span>
            <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400 font-bold">
              {state.speechRecognitionAvailable ? 'Available' : 'Limited'}
            </span>
          </div>
        </div>

        {/* Quick Tips */}
        <div className="p-3.5 bg-[#E9D2FF]/30 dark:bg-[#CDB0F3]/20 border border-[#D5B8F6] dark:border-[#513E6B] rounded-2xl space-y-1.5 text-xs text-[#191919] dark:text-[#F5F1E7]">
          <div className="flex items-center gap-1.5 font-semibold text-[#005447] dark:text-[#67E2C8]">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Quick Start Tips</span>
          </div>
          <ul className="text-[11px] text-[#56564E] dark:text-[#A6A49B] space-y-1 pl-4 list-disc leading-relaxed">
            <li>Click the mic or hold Space to issue voice instructions</li>
            <li>Try commands like: "Summarize this page" or "Open YouTube"</li>
            <li>Select any text to reveal quick explain and rewrite options</li>
          </ul>
        </div>
      </div>

      <button
        onClick={nextStep}
        className="w-full bg-[#005447] hover:bg-[#003F36] dark:bg-[#67E2C8] dark:hover:bg-[#52C5AD] text-white dark:text-[#171816] px-6 py-3 rounded-xl font-sans font-semibold text-xs tracking-wide transition-all shadow-sm flex items-center justify-center gap-2"
      >
        <span>Start Exploring Pentone</span>
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  )
}
