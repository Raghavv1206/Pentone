import React from 'react'
import { X } from 'lucide-react'
import { useOnboarding } from './onboarding-provider'
import { ModelAvailabilityStep } from './steps/model-availability-step'

export const OnboardingFlow: React.FC = () => {
  const { state, skipOnboarding } = useOnboarding()

  if (state.isComplete || !state.currentStep) {
    return null
  }

  return (
    <div className="fixed inset-0 bg-[#FFFEEF] dark:bg-[#171816] text-[#191919] dark:text-[#F5F1E7] z-50 flex flex-col select-none transition-colors duration-200">
      {/* Sleek Header */}
      <div className="border-b border-[#DDDCCB] dark:border-[#373832] px-4 sm:px-6 py-3 bg-[#FFFEEF]/90 dark:bg-[#171816]/90 backdrop-blur-md flex items-center justify-between w-full min-w-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <span className="font-display text-xs sm:text-sm font-bold tracking-wider text-[#005447] dark:text-[#67E2C8] uppercase shrink-0">
            PENTONE
          </span>
          <span className="text-[11px] sm:text-xs font-mono text-[#77776E] dark:text-[#A6A49B] truncate">
            Automated Model & AI Setup
          </span>
        </div>
        <button
          onClick={skipOnboarding}
          className="text-xs font-medium text-[#77776E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] transition-colors flex items-center gap-1 shrink-0 ml-2"
          title="Skip setup and go directly to main screen"
        >
          <span>Skip Setup</span>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Main Setup View */}
      <div className="flex-1 min-h-0 w-full overflow-y-auto flex flex-col items-center justify-start sm:justify-center p-3 sm:p-6">
        <div className="w-full max-w-md mx-auto py-2 min-w-0">
          <ModelAvailabilityStep />
        </div>
      </div>
    </div>
  )
}
