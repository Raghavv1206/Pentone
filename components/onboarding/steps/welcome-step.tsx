import React from 'react'
import { ArrowRight, Mic, ShieldCheck, Zap } from 'lucide-react'
import { useOnboarding } from '../onboarding-provider'

export const WelcomeStep: React.FC = () => {
  const { nextStep } = useOnboarding()

  return (
    <div className="flex flex-col items-center justify-center text-center space-y-6">
      <div className="space-y-1.5">
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#191919] dark:text-[#F5F1E7]">
          Welcome to Pentone
        </h1>
        <p className="font-sans text-xs sm:text-sm text-[#77776E] dark:text-[#A6A49B]">
          Private, voice-first browser intelligence
        </p>
      </div>

      <div className="w-full space-y-3 text-left bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-2xl p-5 shadow-xs">
        <div className="flex items-start gap-3">
          <div className="w-7 h-7 rounded-lg bg-[#EBE7D0] dark:bg-[#2A2B26] flex items-center justify-center text-[#005447] dark:text-[#67E2C8] shrink-0 mt-0.5">
            <Mic className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-sans font-semibold text-xs text-[#191919] dark:text-[#F5F1E7]">
              Voice-First Control
            </h3>
            <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B] mt-0.5 leading-relaxed">
              Navigate, search, and command websites naturally using speech without touch.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <div className="w-7 h-7 rounded-lg bg-[#EBE7D0] dark:bg-[#2A2B26] flex items-center justify-center text-[#005447] dark:text-[#67E2C8] shrink-0 mt-0.5">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-sans font-semibold text-xs text-[#191919] dark:text-[#F5F1E7]">
              On-Device AI
            </h3>
            <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B] mt-0.5 leading-relaxed">
              AI runs on this device using Chrome's Prompt API. Browser speech recognition may use an online service.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <div className="w-7 h-7 rounded-lg bg-[#EBE7D0] dark:bg-[#2A2B26] flex items-center justify-center text-[#005447] dark:text-[#67E2C8] shrink-0 mt-0.5">
            <Zap className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-sans font-semibold text-xs text-[#191919] dark:text-[#F5F1E7]">
              Deep Browser Automation
            </h3>
            <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B] mt-0.5 leading-relaxed">
              Read and summarize pages, fill out complex forms, click elements, and store memory.
            </p>
          </div>
        </div>
      </div>

      <button
        onClick={nextStep}
        className="w-full bg-[#005447] hover:bg-[#003F36] dark:bg-[#67E2C8] dark:hover:bg-[#52C5AD] text-white dark:text-[#171816] px-6 py-3 rounded-xl font-sans font-semibold text-xs tracking-wide transition-all flex items-center justify-center gap-2 shadow-sm"
      >
        <span>Get Started</span>
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  )
}
