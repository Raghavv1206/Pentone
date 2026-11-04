import React from 'react'
import { Shield, ArrowRight, ArrowLeft, Eye, Zap, Lock, ExternalLink, Github } from 'lucide-react'
import { useOnboarding } from '../onboarding-provider'

export const PurposeStep: React.FC = () => {
  const { nextStep, prevStep } = useOnboarding()

  return (
    <div className="flex flex-col items-center justify-center space-y-5 text-center">
      <div className="space-y-1.5">
        <div className="w-10 h-10 rounded-2xl bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#005447] dark:text-[#67E2C8] flex items-center justify-center mx-auto mb-2">
          <Shield className="w-5 h-5" />
        </div>
        <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-[#191919] dark:text-[#F5F1E7]">
          Privacy-First Architecture
        </h2>
        <p className="font-sans text-xs text-[#77776E] dark:text-[#A6A49B]">
          100% on-device AI navigation and page comprehension
        </p>
      </div>

      <div className="w-full space-y-3 text-left">
        <div className="bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-2xl p-4 space-y-3.5 shadow-xs">
          <div className="flex items-start gap-3">
            <Lock className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-sans font-semibold text-xs text-[#191919] dark:text-[#F5F1E7]">Zero Cloud Telemetry</div>
              <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B] mt-0.5 leading-relaxed">
                All voice understanding and DOM perception execute entirely inside your local browser.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Eye className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-sans font-semibold text-xs text-[#191919] dark:text-[#F5F1E7]">Semantic Page Understanding</div>
              <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B] mt-0.5 leading-relaxed">
                Read articles, extract tabular data, find interactive elements, and navigate seamlessly.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Zap className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <div className="font-sans font-semibold text-xs text-[#191919] dark:text-[#F5F1E7]">Autonomous Workflow Execution</div>
              <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B] mt-0.5 leading-relaxed">
                Execute complex multi-step browser tasks using 26 built-in declarative tools.
              </p>
            </div>
          </div>
        </div>

        <div className="p-3 bg-[#E9D2FF]/30 dark:bg-[#CDB0F3]/20 border border-[#D5B8F6] dark:border-[#513E6B] rounded-xl text-[11px] text-[#191919] dark:text-[#F5F1E7] leading-relaxed">
          Pentone runs strictly on your machine. Your audio recordings, page contents, and memories are never transmitted over the internet.
        </div>
      </div>

      <div className="flex gap-2.5 w-full pt-1">
        <button
          onClick={prevStep}
          className="flex-1 bg-[#F3F1DF] hover:bg-[#EBE7D0] dark:bg-[#22231F] dark:hover:bg-[#2A2B26] border border-[#DDDCCB] dark:border-[#373832] text-[#56564E] dark:text-[#A6A49B] px-4 py-2.5 rounded-xl font-sans text-xs font-semibold transition-all flex items-center justify-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back</span>
        </button>
        <button
          onClick={nextStep}
          className="flex-1 bg-[#005447] hover:bg-[#003F36] dark:bg-[#67E2C8] dark:hover:bg-[#52C5AD] text-white dark:text-[#171816] px-4 py-2.5 rounded-xl font-sans text-xs font-semibold transition-all flex items-center justify-center gap-1.5 shadow-sm"
        >
          <span>Continue</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
