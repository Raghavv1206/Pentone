import React from 'react'
import { ArrowRight, Mic, ShieldCheck, Sparkles, Command } from 'lucide-react'
import { useOnboarding } from '../onboarding-provider'

export const WelcomeStep = () => {
  const { nextStep } = useOnboarding()

  return (
    <div className="flex flex-col items-center justify-center py-2 sm:py-4">
      <div className="w-full text-center space-y-5">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#005447] dark:text-[#67E2C8] text-xs font-medium mb-1">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Local-First Chrome Assistant</span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#191919] dark:text-[#F5F1E7]">
            Welcome to Pentone
          </h1>
          <p className="font-sans text-xs sm:text-sm text-[#77776E] dark:text-[#A6A49B] max-w-sm mx-auto">
            Your private voice and AI companion for seamless browser navigation and automation.
          </p>
        </div>

        <div className="space-y-3 text-left">
          <div className="p-3.5 rounded-xl bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] flex items-start gap-3">
            <div className="p-2 rounded-lg bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#005447] dark:text-[#67E2C8] shrink-0 mt-0.5">
              <Mic className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-sans font-semibold text-xs sm:text-sm text-[#191919] dark:text-[#F5F1E7]">
                Natural Voice Interaction
              </h3>
              <p className="font-sans text-[11px] sm:text-xs text-[#77776E] dark:text-[#A6A49B] mt-0.5">
                Push-to-Talk (hold Spacebar) or hands-free conversation with real-time speech recognition.
              </p>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] flex items-start gap-3">
            <div className="p-2 rounded-lg bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#005447] dark:text-[#67E2C8] shrink-0 mt-0.5">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-sans font-semibold text-xs sm:text-sm text-[#191919] dark:text-[#F5F1E7]">
                100% Private & On-Device
              </h3>
              <p className="font-sans text-[11px] sm:text-xs text-[#77776E] dark:text-[#A6A49B] mt-0.5">
                Language models and vector embeddings run completely offline on your computer. No user audio or data leaves your browser.
              </p>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] flex items-start gap-3">
            <div className="p-2 rounded-lg bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#005447] dark:text-[#67E2C8] shrink-0 mt-0.5">
              <Command className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-sans font-semibold text-xs sm:text-sm text-[#191919] dark:text-[#F5F1E7]">
                27 Autonomous Browser Tools
              </h3>
              <p className="font-sans text-[11px] sm:text-xs text-[#77776E] dark:text-[#A6A49B] mt-0.5">
                Inspect web pages, click elements, fill forms, summarize articles, and manage tabs seamlessly.
              </p>
            </div>
          </div>
        </div>

        <div className="pt-2">
          <button
            onClick={nextStep}
            className="w-full bg-[#005447] hover:bg-[#003F36] dark:bg-[#67E2C8] dark:hover:bg-[#52C5AD] text-white dark:text-[#171816] px-5 py-3 rounded-xl font-sans font-semibold text-xs sm:text-sm transition-all duration-200 flex items-center justify-center gap-2 shadow-sm"
          >
            <span>Begin Setup</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
