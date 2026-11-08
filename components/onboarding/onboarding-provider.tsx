import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'

export type OnboardingStep = 'welcome' | 'purpose' | 'microphone' | 'model' | 'features' | 'complete' | null

interface OnboardingState {
  currentStep: OnboardingStep
  isComplete: boolean
  micPermissionGranted: boolean
  modelAvailable: boolean
  speechRecognitionAvailable: boolean
}

interface OnboardingContextValue {
  state: OnboardingState
  isPopup: boolean
  nextStep: () => void
  prevStep: () => void
  skipOnboarding: () => void
  setMicPermission: (granted: boolean) => void
  setModelAvailability: (available: boolean) => void
  setSpeechRecognition: (available: boolean) => void
  resetOnboarding: () => void
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null)

const STORAGE_KEY = 'pentone_onboarding_complete'
const LEGACY_STORAGE_KEY = 'pentone_legacy_onboarding_complete'

const steps: OnboardingStep[] = ['welcome', 'purpose', 'microphone', 'model', 'features', 'complete']

interface OnboardingProviderProps {
  children: ReactNode
  isPopup?: boolean
}

export const OnboardingProvider = ({ children, isPopup = false }: OnboardingProviderProps) => {
  const [state, setState] = useState<OnboardingState>({
    currentStep: null,
    isComplete: false,
    micPermissionGranted: false,
    modelAvailable: false,
    speechRecognitionAvailable: false
  })

  // Load onboarding state from storage & verify if Chrome Built-in AI flags are enabled
  useEffect(() => {
    chrome.storage?.local?.get([STORAGE_KEY, LEGACY_STORAGE_KEY, 'pentone_offline_mode_selected'], async (result) => {
      // Actively verify if Chrome AI flags are enabled
      const win = typeof window !== 'undefined' ? (window as any) : null
      const LM = win?.LanguageModel || win?.ai?.languageModel
      let flagsActive = false
      if (LM) {
        try {
          const avail = typeof LM.availability === 'function' ? await LM.availability() : (await LM.capabilities?.())?.available
          if (avail === 'readily' || avail === 'available' || avail === 'after-download' || avail === 'downloadable') {
            flagsActive = true
          }
        } catch {}
      }

      const offlineExplicitlyChosen = result?.['pentone_offline_mode_selected'] === true

      // If flags are active, or if user explicitly chose offline mode, bypass setup screen:
      if ((result?.[STORAGE_KEY] && flagsActive) || offlineExplicitlyChosen) {
        setState(prev => ({ ...prev, isComplete: true, currentStep: null, modelAvailable: flagsActive }))
      } else {
        // Flags are NOT enabled and user didn't explicitly select offline:
        // Always display the setup screen with 1-click flags openers!
        setState(prev => ({ ...prev, currentStep: 'model', isComplete: false, modelAvailable: flagsActive }))
      }
    })
  }, [])

  const nextStep = useCallback(() => {
    setState(prev => {
      const currentIndex = steps.indexOf(prev.currentStep!)
      if (currentIndex < steps.length - 1) {
        return { ...prev, currentStep: steps[currentIndex + 1] }
      } else if (prev.currentStep === 'complete') {
        chrome.storage?.local?.set({ [STORAGE_KEY]: true })
        return { ...prev, currentStep: null, isComplete: true }
      }
      return prev
    })
  }, [])

  const prevStep = useCallback(() => {
    setState(prev => {
      const currentIndex = steps.indexOf(prev.currentStep!)
      if (currentIndex > 0) {
        return { ...prev, currentStep: steps[currentIndex - 1] }
      }
      return prev
    })
  }, [])

  const skipOnboarding = useCallback(() => {
    chrome.storage?.local?.set({ [STORAGE_KEY]: true, pentone_offline_mode_selected: true })
    setState(prev => ({ ...prev, currentStep: null, isComplete: true }))
  }, [])

  const setMicPermission = useCallback((granted: boolean) => {
    setState(prev => ({ ...prev, micPermissionGranted: granted }))
  }, [])

  const setModelAvailability = useCallback((available: boolean) => {
    setState(prev => ({ ...prev, modelAvailable: available }))
  }, [])

  const setSpeechRecognition = useCallback((available: boolean) => {
    setState(prev => ({ ...prev, speechRecognitionAvailable: available }))
  }, [])

  const resetOnboarding = useCallback(() => {
    chrome.storage?.local?.remove([STORAGE_KEY, LEGACY_STORAGE_KEY, 'pentone_offline_mode_selected'])
    setState({
      currentStep: 'model',
      isComplete: false,
      micPermissionGranted: false,
      modelAvailable: false,
      speechRecognitionAvailable: false
    })
  }, [])

  const value = useMemo<OnboardingContextValue>(() => ({
    state,
    isPopup,
    nextStep, 
    prevStep, 
    skipOnboarding,
    setMicPermission,
    setModelAvailability,
    setSpeechRecognition,
    resetOnboarding
  }), [state, isPopup, nextStep, prevStep, skipOnboarding, setMicPermission, setModelAvailability, setSpeechRecognition, resetOnboarding])

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  )
}

export const useOnboarding = () => {
  const context = useContext(OnboardingContext)
  if (!context) {
    throw new Error('useOnboarding must be used within OnboardingProvider')
  }
  return context
}
