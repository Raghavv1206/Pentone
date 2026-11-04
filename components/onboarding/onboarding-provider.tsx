import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'

export type OnboardingStep = 'welcome' | 'purpose' | 'microphone' | 'model' | 'features' | 'complete' | null

interface OnboardingState {
  currentStep: OnboardingStep
  isComplete: boolean
  micPermissionGranted: boolean
  modelAvailable: boolean
  speechRecognitionAvailable: boolean
  localModelsReady?: boolean
  geminiNanoVerified?: boolean
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
  setLocalModelsReady: (ready: boolean) => void
  setGeminiNanoVerified: (verified: boolean) => void
  resetOnboarding: () => void
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null)

const STORAGE_KEY = 'pentone_onboarding_complete'
const LEGACY_STORAGE_KEY = 'marionette_onboarding_complete'

const steps: OnboardingStep[] = ['welcome', 'microphone', 'model', 'complete']

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
    speechRecognitionAvailable: false,
    localModelsReady: false,
    geminiNanoVerified: false
  })

  // Load onboarding state from storage
  useEffect(() => {
    chrome.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY], (result) => {
      if (result[STORAGE_KEY] || result[LEGACY_STORAGE_KEY]) {
        setState(prev => ({ ...prev, isComplete: true, currentStep: null }))
      } else {
        setState(prev => ({ ...prev, currentStep: 'welcome' }))
      }
    })
  }, [])

  const nextStep = useCallback(() => {
    setState(prev => {
      const current = prev.currentStep
      // Normalize legacy steps if needed
      const effectiveStep = (current === 'purpose') ? 'welcome' : (current === 'features') ? 'model' : current
      const currentIndex = steps.indexOf(effectiveStep!)
      if (currentIndex >= 0 && currentIndex < steps.length - 1) {
        return { ...prev, currentStep: steps[currentIndex + 1] }
      } else if (prev.currentStep === 'complete') {
        chrome.storage.local.set({ [STORAGE_KEY]: true, [LEGACY_STORAGE_KEY]: true })
        return { ...prev, currentStep: null, isComplete: true }
      }
      return prev
    })
  }, [])

  const prevStep = useCallback(() => {
    setState(prev => {
      const current = prev.currentStep
      const effectiveStep = (current === 'purpose') ? 'welcome' : (current === 'features') ? 'model' : current
      const currentIndex = steps.indexOf(effectiveStep!)
      if (currentIndex > 0) {
        return { ...prev, currentStep: steps[currentIndex - 1] }
      }
      return prev
    })
  }, [])

  const skipOnboarding = useCallback(() => {
    chrome.storage.local.set({ [STORAGE_KEY]: true, [LEGACY_STORAGE_KEY]: true })
    setState(prev => ({ ...prev, currentStep: null, isComplete: true }))
  }, [])

  const setMicPermission = useCallback((granted: boolean) => {
    setState(prev => prev.micPermissionGranted === granted ? prev : ({ ...prev, micPermissionGranted: granted }))
  }, [])

  const setModelAvailability = useCallback((available: boolean) => {
    setState(prev => prev.modelAvailable === available ? prev : ({ ...prev, modelAvailable: available }))
  }, [])

  const setSpeechRecognition = useCallback((available: boolean) => {
    setState(prev => prev.speechRecognitionAvailable === available ? prev : ({ ...prev, speechRecognitionAvailable: available }))
  }, [])

  const setLocalModelsReady = useCallback((ready: boolean) => {
    setState(prev => prev.localModelsReady === ready ? prev : ({ ...prev, localModelsReady: ready }))
  }, [])

  const setGeminiNanoVerified = useCallback((verified: boolean) => {
    setState(prev => prev.geminiNanoVerified === verified ? prev : ({ ...prev, geminiNanoVerified: verified }))
  }, [])

  const resetOnboarding = useCallback(() => {
    chrome.storage.local.remove([STORAGE_KEY, LEGACY_STORAGE_KEY])
    setState({
      currentStep: 'welcome',
      isComplete: false,
      micPermissionGranted: false,
      modelAvailable: false,
      speechRecognitionAvailable: false,
      localModelsReady: false,
      geminiNanoVerified: false
    })
  }, [])

  const contextValue = useMemo(() => ({
    state,
    isPopup,
    nextStep,
    prevStep,
    skipOnboarding,
    setMicPermission,
    setModelAvailability,
    setSpeechRecognition,
    setLocalModelsReady,
    setGeminiNanoVerified,
    resetOnboarding
  }), [
    state, 
    isPopup, 
    nextStep, 
    prevStep, 
    skipOnboarding, 
    setMicPermission, 
    setModelAvailability, 
    setSpeechRecognition,
    setLocalModelsReady,
    setGeminiNanoVerified,
    resetOnboarding
  ])

  return (
    <OnboardingContext.Provider value={contextValue}>
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
