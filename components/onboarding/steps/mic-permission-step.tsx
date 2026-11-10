import React, { useState, useEffect } from 'react'
import { Mic, AlertCircle, CheckCircle2, ArrowRight, ArrowLeft, Loader2 } from 'lucide-react'
import { useOnboarding } from '../onboarding-provider'
import { openPermissionsPage } from '../../../lib/alert-context'

type PermissionState = 'unchecked' | 'checking' | 'granted' | 'denied' | 'unavailable'

export const MicPermissionStep: React.FC = () => {
  const { nextStep, prevStep, setMicPermission, setSpeechRecognition } = useOnboarding()
  const [permissionState, setPermissionState] = useState<PermissionState>('unchecked')
  const [errorMessage, setErrorMessage] = useState<string>('')

  useEffect(() => {
    checkPermissions()
  }, [])

  const checkPermissions = async () => {
    try {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      if (!SpeechRecognition) {
        setPermissionState('unavailable')
        setErrorMessage('Speech recognition is not supported in this browser.')
        setSpeechRecognition(false)
        return
      }
      setSpeechRecognition(true)

      const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName })
      if (permissionStatus.state === 'granted') {
        setPermissionState('granted')
        setMicPermission(true)
      } else if (permissionStatus.state === 'denied') {
        setPermissionState('denied')
        setMicPermission(false)
      }

      permissionStatus.onchange = () => {
        if (permissionStatus.state === 'granted') {
          setPermissionState('granted')
          setMicPermission(true)
        } else if (permissionStatus.state === 'denied') {
          setPermissionState('denied')
          setMicPermission(false)
        }
      }
    } catch (error) {
      console.error('Failed to check microphone permissions:', error)
    }
  }

  const requestPermission = async () => {
    setPermissionState('checking')
    setErrorMessage('')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach(track => track.stop())
      setPermissionState('granted')
      setMicPermission(true)
    } catch (error: any) {
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        setPermissionState('denied')
        setErrorMessage('Microphone access was denied. Please allow microphone in Chrome settings.')
        setMicPermission(false)
      } else if (error.name === 'NotFoundError') {
        setPermissionState('denied')
        setErrorMessage('No microphone device found on your computer.')
        setMicPermission(false)
      } else {
        setPermissionState('denied')
        setErrorMessage(error.message || 'Failed to access microphone.')
        setMicPermission(false)
      }
    }
  }

  const canProceed = permissionState === 'granted'

  return (
    <div className="flex flex-col items-center justify-center space-y-5 text-center">
      <div className="space-y-1.5">
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-2 transition-colors ${
          permissionState === 'granted' 
            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400' 
            : permissionState === 'denied'
            ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400'
            : 'bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#005447] dark:text-[#67E2C8]'
        }`}>
          <Mic className="w-6 h-6" />
        </div>
        <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-[#191919] dark:text-[#F5F1E7]">
          Microphone Permission
        </h2>
        <p className="font-sans text-xs text-[#77776E] dark:text-[#A6A49B]">
          Allow Pentone to capture speech for zero-latency local commands
        </p>
      </div>

      <div className="w-full bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-2xl p-5 space-y-4 shadow-xs text-left">
        {permissionState === 'unchecked' && (
          <button
            onClick={requestPermission}
            className="w-full bg-[#005447] hover:bg-[#003F36] dark:bg-[#67E2C8] dark:hover:bg-[#52C5AD] text-white dark:text-[#171816] px-5 py-3 rounded-xl font-sans font-semibold text-xs tracking-wide transition-all shadow-sm flex items-center justify-center gap-2"
          >
            <Mic className="w-4 h-4" />
            <span>Enable Microphone Access</span>
          </button>
        )}

        {permissionState === 'checking' && (
          <div className="flex items-center justify-center gap-2 py-3 text-xs text-[#005447] dark:text-[#67E2C8]">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Requesting Chrome permission...</span>
          </div>
        )}

        {permissionState === 'granted' && (
          <div className="flex items-center gap-3 text-emerald-700 dark:text-emerald-400 p-2">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <span className="font-sans text-xs font-semibold">
              Microphone access granted. You are ready to speak!
            </span>
          </div>
        )}

        {(permissionState === 'denied' || permissionState === 'unavailable') && (
          <div className="space-y-3">
            <div className="flex items-start gap-2.5 text-rose-600 dark:text-rose-400">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <p className="text-xs">{errorMessage}</p>
            </div>

            {permissionState === 'denied' && (
              <div className="flex gap-2">
                <button
                  onClick={openPermissionsPage}
                  className="flex-1 bg-[#EBE7D0] hover:bg-[#DDDCCB] dark:bg-[#2A2B26] dark:hover:bg-[#373832] text-[#191919] dark:text-[#F5F1E7] px-3 py-2 rounded-xl text-xs font-medium transition-colors"
                >
                  Chrome Settings
                </button>
                <button
                  onClick={requestPermission}
                  className="flex-1 bg-[#005447] dark:bg-[#67E2C8] text-white dark:text-[#171816] px-3 py-2 rounded-xl text-xs font-medium transition-colors"
                >
                  Try Again
                </button>
              </div>
            )}
          </div>
        )}
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
          disabled={!canProceed}
          className="flex-1 bg-[#005447] hover:bg-[#003F36] dark:bg-[#67E2C8] dark:hover:bg-[#52C5AD] text-white dark:text-[#171816] px-4 py-2.5 rounded-xl font-sans text-xs font-semibold transition-all flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span>Continue</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
