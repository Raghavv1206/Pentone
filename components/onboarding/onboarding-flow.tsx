import React from 'react'
import { X } from 'lucide-react'
import { useOnboarding, type OnboardingStep } from './onboarding-provider'
import { WelcomeStep } from './steps/welcome-step'
import { MicPermissionStep } from './steps/mic-permission-step'
import { ModelAvailabilityStep } from './steps/model-availability-step'
import { CompleteStep } from './steps/complete-step'

const ACTIVE_STEPS: { key: OnboardingStep; label: string }[] = [
  { key: 'welcome', label: 'Welcome' },
  { key: 'microphone', label: 'Microphone' },
  { key: 'model', label: 'Local AI' },
  { key: 'complete', label: 'Ready' }
]

export const OnboardingFlow = () => {
  const { state, skipOnboarding } = useOnboarding()

  if (state.isComplete || !state.currentStep) {
    return null
  }

  const renderStep = () => {
    switch (state.currentStep) {
      case 'welcome':
      case 'purpose':
        return <WelcomeStep />
      case 'microphone':
        return <MicPermissionStep />
      case 'model':
      case 'features':
        return <ModelAvailabilityStep />
      case 'complete':
        return <CompleteStep />
      default:
        return <WelcomeStep />
    }
  }

  const getCurrentStepIndex = () => {
    const current = state.currentStep
    const effective = (current === 'purpose') ? 'welcome' : (current === 'features') ? 'model' : current
    const index = ACTIVE_STEPS.findIndex(s => s.key === effective)
    return index >= 0 ? index : 0
  }

  const currentIndex = getCurrentStepIndex()

  return (
    <div className="fixed inset-0 z-50 flex flex-col min-h-0 overflow-hidden select-none bg-[#FFFEEF] dark:bg-[#171816] text-[#191919] dark:text-[#F5F1E7]">
      {/* Header with progress */}
      <div className="flex-shrink-0 border-b border-[#DDDCCB] dark:border-[#373832] p-3 sm:p-4 bg-[#FFFEEF]/95 dark:bg-[#171816]/95 backdrop-blur-md">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <span className="font-display font-bold text-sm tracking-tight text-[#005447] dark:text-[#67E2C8]">
              PENTONE
            </span>
            <span className="text-[11px] font-mono text-[#77776E] dark:text-[#A6A49B]">
              Step {currentIndex + 1} of {ACTIVE_STEPS.length}: {ACTIVE_STEPS[currentIndex].label}
            </span>
          </div>
          {state.currentStep !== 'model' && (
            <button
              onClick={skipOnboarding}
              className="p-1 text-[#77776E] dark:text-[#A6A49B] hover:text-[#191919] dark:hover:text-[#F5F1E7] hover:bg-[#F3F1DF] dark:hover:bg-[#22231F] rounded-lg transition-colors text-xs font-sans flex items-center gap-1 cursor-pointer"
              title="Skip onboarding and configure later"
            >
              <span>Skip</span>
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        
        {/* Progress bar */}
        <div className="flex gap-1.5">
          {ACTIVE_STEPS.map((step, i) => (
            <div
              key={step.key || i}
              className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                i <= currentIndex 
                  ? 'bg-[#005447] dark:bg-[#67E2C8]' 
                  : 'bg-[#DDDCCB] dark:bg-[#373832]'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Step content - responsive centered container */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 sm:p-6 flex flex-col items-center justify-start sm:justify-center">
        <div className="w-full max-w-sm sm:max-w-md mx-auto">
          {renderStep()}
        </div>
      </div>
    </div>
  )
}
