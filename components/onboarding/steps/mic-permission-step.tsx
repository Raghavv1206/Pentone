import React, { useState, useEffect } from 'react'
import { Mic, CheckCircle2, AlertCircle, ArrowRight, ArrowLeft, Volume2, Shield } from 'lucide-react'
import { useOnboarding } from '../onboarding-provider'

type PermissionState = 'unchecked' | 'checking' | 'granted' | 'denied'

export const MicPermissionStep = () => {
  const { nextStep, prevStep, setMicPermission, setSpeechRecognition } = useOnboarding()
  const [permissionState, setPermissionState] = useState<PermissionState>('unchecked')
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [hasSpeechRecognition, setHasSpeechRecognition] = useState<boolean>(false)

  useEffect(() => {
    // Check speech recognition capability
    const sr = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const srAvailable = Boolean(sr)
    setHasSpeechRecognition(srAvailable)
    setSpeechRecognition(srAvailable)

    // Check existing microphone permission if supported
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      navigator.permissions.query({ name: 'microphone' as PermissionName })
        .then((status) => {
          if (status.state === 'granted') {
            setPermissionState('granted')
            setMicPermission(true)
          } else if (status.state === 'denied') {
            setPermissionState('denied')
            setMicPermission(false)
          }
          status.onchange = () => {
            if (status.state === 'granted') {
              setPermissionState('granted')
              setMicPermission(true)
            } else if (status.state === 'denied') {
              setPermissionState('denied')
              setMicPermission(false)
            }
          }
        })
        .catch(() => {})
    }
  }, [setMicPermission, setSpeechRecognition])

  const requestPermission = async () => {
    setPermissionState('checking')
    setErrorMessage('')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // Release stream after permission confirmation
      stream.getTracks().forEach(track => track.stop())
      setPermissionState('granted')
      setMicPermission(true)
    } catch (err: any) {
      setPermissionState('denied')
      setMicPermission(false)
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setErrorMessage('Microphone access was declined. You can enable it in Chrome site settings or continue in text mode.')
      } else if (err.name === 'NotFoundError') {
        setErrorMessage('No physical microphone found. Connect a microphone or continue in text mode.')
      } else {
        setErrorMessage(err.message || 'Unable to access microphone.')
      }
    }
  }

  return (
    <div className="flex flex-col items-center justify-center py-2 sm:py-4">
      <div className="w-full text-center space-y-5">
        <div className="space-y-1.5">
          <div className="flex justify-center mb-2">
            <div className={`p-3.5 rounded-2xl transition-colors ${
              permissionState === 'granted'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                : permissionState === 'denied'
                ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800'
                : 'bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#005447] dark:text-[#67E2C8] border border-[#DDDCCB] dark:border-[#373832]'
            }`}>
              <Mic className="w-8 h-8" />
            </div>
          </div>
          <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-[#191919] dark:text-[#F5F1E7]">
            Microphone Access
          </h2>
          <p className="font-sans text-xs sm:text-sm text-[#77776E] dark:text-[#A6A49B] max-w-sm mx-auto">
            Pentone uses your microphone for real-time Push-to-Talk and offline voice recognition.
          </p>
        </div>

        {/* Status Card */}
        <div className="p-4 rounded-xl bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] text-left space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-sans font-medium text-xs text-[#191919] dark:text-[#F5F1E7]">
              Permission Status
            </span>
            {permissionState === 'granted' ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" /> Granted
              </span>
            ) : permissionState === 'denied' ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                <AlertCircle className="w-3.5 h-3.5" /> Denied
              </span>
            ) : (
              <span className="text-[11px] font-mono text-[#77776E] dark:text-[#A6A49B]">
                Pending Grant
              </span>
            )}
          </div>

          <div className="text-[11px] text-[#77776E] dark:text-[#A6A49B] space-y-1.5 border-t border-[#DDDCCB] dark:border-[#373832] pt-2.5">
            <div className="flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8] shrink-0" />
              <span>Audio streams are processed locally on device; never sent to cloud servers.</span>
            </div>
            <div className="flex items-center gap-2">
              <Volume2 className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8] shrink-0" />
              <span>
                {hasSpeechRecognition 
                  ? 'Chrome Speech Recognition active with offline Whisper Tiny fallback.' 
                  : 'Universal offline Whisper Tiny speech recognition.'}
              </span>
            </div>
          </div>
        </div>

        {errorMessage && (
          <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-xs text-left">
            {errorMessage}
          </div>
        )}

        {/* CTA: Grant or Proceed */}
        <div className="space-y-2 pt-1">
          {permissionState !== 'granted' && (
            <button
              onClick={requestPermission}
              className="w-full bg-[#005447] hover:bg-[#003F36] dark:bg-[#67E2C8] dark:hover:bg-[#52C5AD] text-white dark:text-[#171816] px-5 py-2.5 rounded-xl font-sans font-semibold text-xs sm:text-sm transition-all duration-200 flex items-center justify-center gap-2 shadow-sm"
            >
              <Mic className="w-4 h-4" />
              <span>{permissionState === 'checking' ? 'Requesting Access...' : 'Grant Microphone Permission'}</span>
            </button>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={prevStep}
              className="flex-1 px-4 py-2.5 rounded-xl border border-[#DDDCCB] dark:border-[#373832] text-[#77776E] dark:text-[#A6A49B] hover:text-[#191919] dark:hover:text-[#F5F1E7] hover:bg-[#F3F1DF] dark:hover:bg-[#22231F] font-sans font-medium text-xs sm:text-sm transition-colors flex items-center justify-center gap-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>

            <button
              onClick={nextStep}
              className={`flex-1 px-4 py-2.5 rounded-xl font-sans font-semibold text-xs sm:text-sm transition-all duration-200 flex items-center justify-center gap-1.5 shadow-sm ${
                permissionState === 'granted'
                  ? 'bg-[#005447] hover:bg-[#003F36] dark:bg-[#67E2C8] dark:hover:bg-[#52C5AD] text-white dark:text-[#171816]'
                  : 'bg-[#EBE7D0] hover:bg-[#DDDCCB] dark:bg-[#2A2B26] dark:hover:bg-[#373832] text-[#191919] dark:text-[#F5F1E7]'
              }`}
            >
              <span>{permissionState === 'granted' ? 'Next: Set Up Local AI' : 'Continue Anyway'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
