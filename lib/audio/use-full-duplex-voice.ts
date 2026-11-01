/**
 * Pentone Full-Duplex Conversational Voice Hook
 * 
 * Coordinates persistent microphone capture, Silero VAD, and the 8-state Barge-In Controller.
 * Provides:
 * 1. Single toggle to enable/disable persistent conversational voice mode.
 * 2. Instant barge-in: interrupts assistant speech immediately upon human speech detection.
 * 3. Real-time voice state indicator (Listening, User Speaking, Assistant Speaking, Interrupted).
 * 4. Automatic hardware cleanup on Side Panel unmount or voice mode disable.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { PersistentAudioPipeline, isPipelineLive, type AudioMetrics } from './persistent-audio-pipeline'
import { SileroVADService } from './silero-vad-service'
import { BargeInController, type VoiceState } from './barge-in-controller'
import { WhisperASRService } from './whisper-asr-service'
import { ASROrchestrator } from './asr-intent-orchestrator'
import { SpeakerVerificationEngine } from './speaker-verification-engine'
import { PersistentProfileVaultManager } from './speaker-profile-vault'
import { voiceAuthorizationManager } from './voice-authorization-manager'
import { voiceDiagnosticTracker } from './voice-diagnostic-tracker'
import { BiometricAudioExtractor } from './biometric-audio-extractor'
import { neuralNoiseReductionService } from './neural-noise-reduction-service'
import type { VoiceAuthorizationToken, VoiceTurnGrant } from './voice-authorization-types'
import type { SpeakerVerificationResult, VoiceProfileState, UnencryptedSpeakerProfile } from './speaker-types'
import { useTTS, TTSAcousticTracker } from '../tts-context'
import { useChatContext } from '../chat-context'
import { useMediaDevice } from '../media-device-context'
import { loadSettings, loadActiveUserId } from '../settings'

import { wakeWordActivationManager } from './wake-word-activation-manager'
import { PTTStateMachine, isEditableElement, type PTTPhase } from './ptt-state-machine'

export type PttLifecycleState =
  | 'READY'
  | 'IDLE'
  | 'PRESS_PENDING'
  | 'LISTENING'
  | 'RECORDING'
  | 'FINALIZING'
  | 'TRANSCRIBING'
  | 'PROCESSING'
  | 'EXECUTING'
  | 'CANCELLED'
  | 'ERROR'

export interface FullDuplexVoiceReturn {
  isFullDuplexEnabled: boolean
  voiceState: VoiceState
  pttState: PttLifecycleState
  volumeLevel: number
  toggleVoiceMode: () => Promise<void>
  startPtt: (source?: 'keyboard' | 'pointer') => Promise<void>
  stopPtt: (source?: 'keyboard' | 'pointer') => Promise<void>
  cancelPtt: (reason?: string) => void
  handleKeyDown: (e: KeyboardEvent | any) => boolean
  handleKeyUp: (e: KeyboardEvent | any) => boolean
  handleBlurOrVisibilityChange: (hidden?: boolean) => void
  muteImmediately: () => void
  profileState: VoiceProfileState
  hasEnrolledProfile: boolean
  error: string | null
  isTabAudioPlaying: boolean
}

export { isPipelineLive }

export const useFullDuplexVoice = (): FullDuplexVoiceReturn => {
  const [isFullDuplexEnabled, setIsFullDuplexEnabled] = useState(false)
  const [voiceState, setVoiceState] = useState<VoiceState>('DISABLED')
  const [volumeLevel, setVolumeLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [profileState, setProfileState] = useState<VoiceProfileState>('PROFILE_IDLE')
  const [pttState, setPttState] = useState<PttLifecycleState>('READY')
  const [isTabAudioPlaying, setIsTabAudioPlaying] = useState<boolean>(false)

  const isPttActiveRef = useRef<boolean>(false)
  const currentPttTurnIdRef = useRef<number>(0)
  const pttAudioChunksRef = useRef<Float32Array[]>([])
  const pttChunkUnsubRef = useRef<(() => void) | null>(null)

  const { selectedMicId } = useMediaDevice()
  const { isSpeaking, stop: stopTTS } = useTTS()
  const { sendMessage, interruptChat } = useChatContext()
  const orchestratorRef = useRef(new ASROrchestrator())
  const activeSpeechTurnRef = useRef<number>(0)
  const adaptiveSpeechThresholdRef = useRef<number>(0.012)
  const activeUserIdRef = useRef<string>('default_user')
  const loadingProfilePromiseRef = useRef<Promise<UnencryptedSpeakerProfile | null> | null>(null)

  // References to keep instances alive across renders
  const pipelineRef = useRef<PersistentAudioPipeline | null>(null)
  const vadServiceRef = useRef<SileroVADService | null>(null)
  const controllerRef = useRef<BargeInController | null>(null)
  const vaultManagerRef = useRef<PersistentProfileVaultManager | null>(null)
  if (!vaultManagerRef.current) {
    vaultManagerRef.current = new PersistentProfileVaultManager()
  }
  const cachedProfileRef = useRef<UnencryptedSpeakerProfile | null>(null)
  const lastInterruptionTimeRef = useRef<number>(0)
  const sessionIdRef = useRef<string>(`session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`)

  // Authoritative, deduplicated profile loader
  const loadProfileForUser = useCallback(async (userId: string): Promise<UnencryptedSpeakerProfile | null> => {
    const normId = (userId || 'default_user').trim()
    activeUserIdRef.current = normId

    if (loadingProfilePromiseRef.current) {
      return loadingProfilePromiseRef.current
    }

    setProfileState('PROFILE_LOADING')

    const loader = (async () => {
      try {
        const vault = vaultManagerRef.current || new PersistentProfileVaultManager()
        const has = await vault.hasProfile(normId)
        if (!has) {
          cachedProfileRef.current = null
          setProfileState('PROFILE_NOT_ENROLLED')
          return null
        }

        const prof = await vault.loadProfile(normId)
        cachedProfileRef.current = prof
        setProfileState('PROFILE_LOADED')
        console.log(`[FullDuplexVoice] Profile resolved successfully for '${normId}'`)
        return prof
      } catch (err: any) {
        cachedProfileRef.current = null
        const msg = err?.message || ''
        if (msg.includes('ProfileNotFound')) {
          setProfileState('PROFILE_NOT_ENROLLED')
        } else if (msg.includes('UnrecoverableKeyError') || msg.includes('decrypt') || msg.includes('tamper') || msg.includes('mismatch')) {
          setProfileState('PROFILE_DECRYPTION_FAILED')
        } else {
          setProfileState('PROFILE_STORAGE_ERROR')
        }
        console.warn(`[FullDuplexVoice] Profile resolution for '${normId}' failed: ${msg}`)
        return null
      } finally {
        loadingProfilePromiseRef.current = null
      }
    })()

    loadingProfilePromiseRef.current = loader
    return loader
  }, [])

  // Proactive profile initialization on mount
  useEffect(() => {
    loadActiveUserId().then((id) => {
      loadProfileForUser(id)
    }).catch(() => {
      loadProfileForUser('default_user')
    })
  }, [loadProfileForUser])

  // Safeguard: Periodically query audible tabs to detect active tab audio
  useEffect(() => {
    let isMounted = true
    const checkTabAudio = async () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
          const audibleTabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
            chrome.tabs.query({ audible: true }, (tabs) => resolve(tabs || []))
          })
          if (isMounted) {
            setIsTabAudioPlaying(Boolean(audibleTabs && audibleTabs.length > 0))
          }
        }
      } catch {}
    }

    checkTabAudio()
    const timer = setInterval(checkTabAudio, 2500)
    return () => {
      isMounted = false
      clearInterval(timer)
    }
  }, [])

  // Listen for active account changes in chrome storage
  useEffect(() => {
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'local' && changes.pentone_active_user_id?.newValue) {
        const newUserId = changes.pentone_active_user_id.newValue
        if (newUserId !== activeUserIdRef.current) {
          console.log(`[FullDuplexVoice] Active account changed to '${newUserId}', reloading profile...`)
          cachedProfileRef.current = null
          loadProfileForUser(newUserId)
        }
      }
    }
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(handleStorageChange)
      return () => chrome.storage.onChanged.removeListener(handleStorageChange)
    }
  }, [loadProfileForUser])

  // Track assistant speaking status for state machine synchronization
  const isSpeakingRef = useRef(isSpeaking)
  isSpeakingRef.current = isSpeaking

  // Initialize Barge-In Controller
  if (!controllerRef.current) {
    controllerRef.current = new BargeInController({
      onStateChange: (newState) => {
        setVoiceState(newState)
      },
      onInterrupt: () => {
        const interruptT0 = Date.now()
        lastInterruptionTimeRef.current = interruptT0
        console.log('[FullDuplexVoice] Interruption action: cancelling TTS, cancelling in-flight Whisper, cancelling verification, and aborting turn...')
        activeSpeechTurnRef.current++
        TTSAcousticTracker.recordSpeechEnd()
        WhisperASRService.getInstance().cancel()
        SpeakerVerificationEngine.getInstance().cancel()
        orchestratorRef.current.resetDedupe()
        stopTTS()
        interruptChat()
        voiceDiagnosticTracker.recordBargeIn(activeSpeechTurnRef.current, Date.now() - interruptT0)
      },
      onSpeechEnd: async (audioBuffer, vadMetadata) => {
        // Extract separate biometric audio segment excluding 250ms prePad and 450ms redemption silence
        const biometricSegment = BiometricAudioExtractor.extractBiometricSegment(audioBuffer, vadMetadata)

        // 1. Audio Energy & Duration Pre-Validation Gate BEFORE allocating speech turn
        // Evaluate using actual voiced duration and RMS
        const durationSeconds = biometricSegment.voicedDurationSeconds
        const rawDurationSeconds = biometricSegment.rawDurationSeconds
        let sumSq = 0
        let peak = 0
        for (let i = 0; i < audioBuffer.length; i++) {
          const val = Math.abs(audioBuffer[i])
          if (val > peak) peak = val
          sumSq += val * val
        }
        const rms = Math.sqrt(sumSq / audioBuffer.length)
        let threshold = adaptiveSpeechThresholdRef.current || 0.012

        // Detect if background media is playing in another Chrome tab (e.g. YouTube)
        let isAudibleTabActive = false
        try {
          if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
            const audibleTabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
              chrome.tabs.query({ audible: true }, (tabs) => resolve(tabs || []))
            })
            if (audibleTabs && audibleTabs.length > 0) {
              isAudibleTabActive = true
            }
          }
        } catch {}

        if (isAudibleTabActive) {
          threshold = threshold * 1.4
        }

        // Check if assistant was speaking (speaker acoustic bleed into mic)
        const wasAssistantSpeaking = isSpeakingRef.current || TTSAcousticTracker.isSpeaking()
        if (wasAssistantSpeaking) {
          // Require deliberate elevated voice for barge-in over speaker leakage
          const minInterruptionThreshold = Math.max(0.035, threshold * 1.8)
          if (rms < minInterruptionThreshold) {
            console.log(`[FullDuplexVoice] Discarded speaker acoustic bleed during assistant speech: RMS=${rms.toFixed(4)} < ${minInterruptionThreshold.toFixed(4)}`)
            controllerRef.current?.readyToListen()
            return
          }
        }

        // Reject transient noise (< 0.35s), low-energy buffers (< threshold), or faint murmurs (peak < 0.035)
        if (durationSeconds < 0.35 || rms < threshold || peak < 0.035) {
          console.log(`[FullDuplexVoice] Discarded ambient noise / transient audio: duration=${durationSeconds.toFixed(2)}s, RMS=${rms.toFixed(4)}, peak=${peak.toFixed(4)} (threshold=${threshold.toFixed(4)})`)
          controllerRef.current?.readyToListen()
          return
        }

        const settings = await loadSettings().catch(() => null)
        const currentVoiceModel = settings?.voiceInteractionModel || 'push_to_talk'

        // Phase 7 Intentional Activation Guard:
        // In Push-to-Talk mode, continuous audio detected without active PTT hold is discarded immediately
        if (currentVoiceModel === 'push_to_talk' && !isPttActiveRef.current) {
          console.log(`[FullDuplexVoice] Continuous speech detected without active Push-to-Talk hold (mode=${currentVoiceModel}) — discarded without authorization.`)
          controllerRef.current?.readyToListen()
          return
        }

        // Active Tab Audio Guard:
        // Continuous speech during active tab audio is rejected to prevent TV/YouTube video speech execution
        if (isAudibleTabActive && !isPttActiveRef.current) {
          console.log('[FullDuplexVoice] Discarded speech during active audible tab playback without deliberate Push-to-Talk.')
          controllerRef.current?.readyToListen()
          return
        }

        // Deliberate user speech confirmed -> Allocate new turn and emit diagnostic start
        const turnId = ++activeSpeechTurnRef.current
        const turnStartTime = Date.now()
        const activeUserId = voiceAuthorizationManager.getActiveContext().userId || 'default_user'
        const sessionId = sessionIdRef.current
        const audioSegmentId = `seg_${turnId}_${Date.now()}`
        voiceDiagnosticTracker.startTurn(turnId, activeUserId, sessionId)
        voiceDiagnosticTracker.recordSpeechEnd(turnId, durationSeconds, rms)

        console.log(`[FullDuplexVoice] [Turn ${turnId}] Spoken audio validated (RMS=${rms.toFixed(4)}, duration=${durationSeconds.toFixed(2)}s). Running Whisper ASR and CAM++ Speaker Verification concurrently...`)
        try {
          const whisper = WhisperASRService.getInstance()
          const settings = await loadSettings().catch(() => null)
          const modelId = settings?.whisperModel || WhisperASRService.DEFAULT_MODEL_ID
          const language = settings?.speechLanguage || 'en-IN'

          // Pre-execution interruption check
          if (turnStartTime < lastInterruptionTimeRef.current) {
            console.log(`[FullDuplexVoice] [Turn ${turnId}] Turn cancelled by user barge-in before execution started.`)
            voiceDiagnosticTracker.recordCancellation(turnId, 'Interrupted by barge-in before execution started')
            controllerRef.current?.readyToListen()
            return
          }

          // Stage 1: Neural Noise Reduction (16 kHz mono enhancement)
          const denoiseT0 = Date.now()
          const { enhancedAudio, metrics: noiseMetrics } = await neuralNoiseReductionService.enhanceAudio(audioBuffer)
          const denoiseDuration = Date.now() - denoiseT0
          console.log(`[FullDuplexVoice] [Turn ${turnId}] Neural Noise Reduction: ${denoiseDuration}ms (In RMS: ${noiseMetrics.inputRms.toFixed(4)}, Out RMS: ${noiseMetrics.outputRms.toFixed(4)}, SNR Gain: ${noiseMetrics.estimatedSnrGainDb.toFixed(1)}dB, Speech Prob: ${(noiseMetrics.speechProbability * 100).toFixed(0)}%)`)

          // Pre-execution interruption check
          if (turnStartTime < lastInterruptionTimeRef.current) {
            console.log(`[FullDuplexVoice] [Turn ${turnId}] Turn cancelled by user barge-in before Whisper inference started.`)
            voiceDiagnosticTracker.recordCancellation(turnId, 'Interrupted by barge-in before execution started')
            controllerRef.current?.readyToListen()
            return
          }

          // Stage 2: Whisper ASR Transcription on Enhanced Audio
          const whisperT0 = Date.now()
          const transcription = await whisper.transcribe(enhancedAudio, { modelId, language })
          const whisperDuration = Date.now() - whisperT0

          // Check if user barged in during ASR inference
          if (turnStartTime < lastInterruptionTimeRef.current) {
            console.log(`[FullDuplexVoice] [Turn ${turnId}] Turn cancelled by user barge-in during inference.`)
            voiceDiagnosticTracker.recordCancellation(turnId, 'Interrupted by barge-in during inference')
            controllerRef.current?.readyToListen()
            return
          }

          // Optional diagnostic speaker evaluation (non-blocking, decoupled from command gating)
          let diagScore: number | undefined = undefined
          let diagDecision: string = 'UNIVERSAL_SPEAKER'
          if (cachedProfileRef.current) {
            try {
              const engine = SpeakerVerificationEngine.getInstance()
              const sim = await engine.verifySpeech({
                requestId: `diag_${turnId}_${Date.now()}`,
                turnId,
                audioBuffer,
                expectedUserId: activeUserId,
                capturedAt: Date.now(),
              }, cachedProfileRef.current)
              diagScore = sim.similarityScore
              diagDecision = sim.decision
            } catch (e) {
              // Ignore diagnostic errors
            }
          }

          voiceDiagnosticTracker.recordCAM(
            turnId,
            diagDecision,
            diagScore,
            undefined,
            undefined,
            'UNIVERSAL_VOICE',
            whisperDuration,
            undefined,
            'BYPASSED',
            {
              audioSegmentId,
              detectedSpeaker: 'VERIFIED_USER',
              profileLookupStatus: cachedProfileRef.current ? 'FOUND' : 'PROFILE_NOT_FOUND',
              transcriptSpeakerAssociation: 'VERIFIED_USER',
              detectedSegmentsCount: 1,
              scoringPolicy: 'UNIVERSAL_VOICE',
              rawBufferDurationSeconds: rawDurationSeconds,
              actualVoicedDurationSeconds: durationSeconds,
            }
          )

          // Inspect Whisper output
          if (!transcription || !transcription.text) {
            console.log(`[FullDuplexVoice] [Turn ${turnId}] Empty or failed transcription, returning to listening`)
            voiceDiagnosticTracker.recordWhisper(turnId, undefined, whisperDuration, 'Empty or failed transcription')
            controllerRef.current?.readyToListen()
            return
          }

          console.log(`[FullDuplexVoice] [Turn ${turnId}] Recognized text: "${transcription.text}"`)
          voiceDiagnosticTracker.recordWhisper(turnId, transcription.text, whisperDuration)

          // Echo and Hallucination Filter
          const recentUtterances = TTSAcousticTracker.getRecentUtterances()
          const processed = orchestratorRef.current.processTranscript(transcription.text, {
            recentAssistantUtterances: recentUtterances,
            isAudibleTabActive
          })

          // Filter out acoustic self-hearing echo of assistant speech
          if (processed.isSelfHearingEcho) {
            console.log(`[FullDuplexVoice] [Turn ${turnId}] Discarded acoustic self-hearing echo: "${transcription.text}". Resuming listening.`)
            controllerRef.current?.readyToListen()
            return
          }

          // Filter out noise artifacts, Whisper hallucinations (subtitles, "thank you for watching", loops)
          if (processed.isNoiseOrHallucination || !processed.effectiveQuery) {
            console.log(`[FullDuplexVoice] [Turn ${turnId}] Filtered out noise/hallucination: "${transcription.text}". Resuming listening.`)
            controllerRef.current?.readyToListen()
            return
          }

          if (processed.isDuplicate) {
            console.log(`[FullDuplexVoice] [Turn ${turnId}] Ignoring duplicate utterance`)
            controllerRef.current?.readyToListen()
            return
          }

          const isWakeActive = wakeWordActivationManager.isWindowActive()
          let isWakeWordTrigger = false
          let wakeWordRemainder: string | undefined

          if (currentVoiceModel === 'wake_word' && !isWakeActive) {
            const wakeCheck = wakeWordActivationManager.evaluateTranscript(transcription.text, turnId)
            if (wakeCheck.detected) {
              isWakeWordTrigger = true
              wakeWordRemainder = wakeCheck.remainingCommand
              console.log(`[FullDuplexVoice] [Turn ${turnId}] Wake phrase detected ("${wakeCheck.detectedPhrase}"). Opened 5s command window.`)
              stopTTS()
              interruptChat()
            } else {
              console.log(`[FullDuplexVoice] [Turn ${turnId}] Speech outside wake-word window ignored: "${transcription.text}"`)
              controllerRef.current?.readyToListen()
              return
            }
          }

          if (isWakeWordTrigger && !wakeWordRemainder) {
            console.log(`[FullDuplexVoice] [Turn ${turnId}] Wake word acknowledged. Waiting for user command in 5-second capture window...`)
            controllerRef.current?.readyToListen()
            return
          }

          // Stage 3: Universal Voice Capability Token Issuance
          voiceAuthorizationManager.setActiveContext({
            userId: activeUserId,
            sessionId,
            turnId,
          })
          voiceAuthorizationManager.advanceTurn(turnId)

          const activationMethod = isPttActiveRef.current
            ? ('PUSH_TO_TALK' as const)
            : (isWakeActive || isWakeWordTrigger)
            ? ('WAKE_WORD' as const)
            : ('UNAUTHORIZED_CONTINUOUS' as const)

          const mintParams = {
            turnId,
            userId: activeUserId,
            sessionId,
            mode: 'UNIVERSAL_VOICE' as const,
            activationMethod,
            isPttActive: isPttActiveRef.current,
            isWakeWordActive: isWakeActive || isWakeWordTrigger,
          }

          let token: VoiceAuthorizationToken = voiceAuthorizationManager.mintToken(mintParams)
          const turnGrant: VoiceTurnGrant = voiceAuthorizationManager.mintTurnGrant(mintParams)

          try {
            voiceDiagnosticTracker.recordTurnGrant(turnId, turnGrant.grantId, turnGrant.absoluteDeadlineMs)
          } catch {}

          // Synchronize token to background service worker for background tool execution
          if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            try {
              const bgResponse = await new Promise<any>((resolve) => {
                chrome.runtime.sendMessage({ type: 'auth_mint_token', payload: mintParams }, resolve)
              })
              if (bgResponse?.success && bgResponse.token) {
                token = bgResponse.token
                voiceAuthorizationManager.registerToken(token)
              }
            } catch (err) {
              console.warn(`[FullDuplexVoice] [Turn ${turnId}] Background token synchronization notice:`, err)
            }
          }

          voiceDiagnosticTracker.recordAuth(turnId, 'UNIVERSAL_GRANTED', token.scope)

          // Verification check: ensure token scope is not DENIED
          if (token.scope === 'DENIED') {
            console.log(`[FullDuplexVoice] [Turn ${turnId}] Suppressed conversational response: token scope is DENIED`)
            voiceDiagnosticTracker.recordTerminalState(turnId, 'DENIED', 'Universal authorization token scope was DENIED')
            controllerRef.current?.readyToListen()
            return
          }

          // Final pre-dispatch barge-in check
          if (turnStartTime < lastInterruptionTimeRef.current) {
            console.log(`[FullDuplexVoice] [Turn ${turnId}] Turn cancelled by user barge-in before dispatch. Discarding output: "${processed.effectiveQuery}"`)
            voiceDiagnosticTracker.recordCancellation(turnId, 'Interrupted by barge-in before dispatch')
            controllerRef.current?.readyToListen()
            return
          }

          if (processed.shouldClarify && processed.clarificationPrompt) {
            console.log(`[FullDuplexVoice] [Turn ${turnId}] Spoken command ambiguous, routing clarification to agent:`, processed.clarificationPrompt)
            await sendMessage(processed.originalTranscript, {
              turnGrant,
              token,
              turnId,
              userId: activeUserId,
              sessionId,
            })
            controllerRef.current?.readyToListen()
            return
          }

          const queryToDispatch = wakeWordRemainder || processed.effectiveQuery
          console.log(`[FullDuplexVoice] [Turn ${turnId}] Dispatching command to agent with ${token.scope} token:`, queryToDispatch)
          await sendMessage(queryToDispatch, {
            turnGrant,
            token,
            turnId,
            userId: activeUserId,
            sessionId,
          })
          if (activationMethod === 'WAKE_WORD') {
            wakeWordActivationManager.closeWindow()
          }
          controllerRef.current?.readyToListen()
        } catch (err: any) {
          if (err.name === 'TranscriptionCancelledError' || err.message?.includes('cancelled')) {
            console.log(`[FullDuplexVoice] [Turn ${turnId}] Transcription cancelled cleanly: ${err.message}`)
          } else {
            console.warn(`[FullDuplexVoice] [Turn ${turnId}] Transcription or agent dispatch error:`, err)
          }
          controllerRef.current?.readyToListen()
        }
      },
      onError: (err) => {
        setError(err.message)
      }
    })
  }

  // Sync assistant speaking transitions with controller
  useEffect(() => {
    if (!controllerRef.current) return

    if (isSpeaking) {
      controllerRef.current.handleAssistantSpeechStart()
    } else {
      controllerRef.current.handleAssistantSpeechEnd()
    }
  }, [isSpeaking])

  // Cleanup helper
  const teardownAudio = useCallback(async () => {
    console.log('[FullDuplexVoice] Tearing down full-duplex audio session...')
    activeSpeechTurnRef.current++
    adaptiveSpeechThresholdRef.current = 0.012
    WhisperASRService.getInstance().cancel()
    SpeakerVerificationEngine.getInstance().cancel()
    if (vaultManagerRef.current) {
      vaultManagerRef.current.close()
      vaultManagerRef.current = null
    }
    stopTTS()
    interruptChat()
    if (vadServiceRef.current) {
      await vadServiceRef.current.destroy()
      vadServiceRef.current = null
    }

    if (pipelineRef.current) {
      pipelineRef.current.release()
      pipelineRef.current = null
    }

    if (controllerRef.current) {
      controllerRef.current.disableVoiceMode()
    }

    setVolumeLevel(0)
    setIsFullDuplexEnabled(false)
  }, [])

  // Immediate mute control
  const muteImmediately = useCallback(() => {
    console.log('[FullDuplexVoice] Immediate mute requested')
    teardownAudio().catch(e => console.warn('[FullDuplexVoice] Teardown error:', e))
  }, [teardownAudio])

  // Toggle voice mode
  const toggleVoiceMode = useCallback(async () => {
    if (isFullDuplexEnabled) {
      await teardownAudio()
      return
    }

    try {
      setError(null)
      console.log('[FullDuplexVoice] Enabling persistent full-duplex voice mode...')

      // 1. Mark enabled and enter INITIALIZING state
      setIsFullDuplexEnabled(true)
      const controller = controllerRef.current!
      controller.enableVoiceMode()
      controller.startInitializing()

      // 2. Initialize persistent audio pipeline
      const pipeline = new PersistentAudioPipeline({
        deviceId: selectedMicId,
        echoCancellation: true,
        noiseSuppression: false, // Match enrollment: avoid acoustic formant distortion for CAM++
        autoGainControl: false,  // Match enrollment: avoid dynamic amplitude compression
        sampleRate: 16000
      })
      pipelineRef.current = pipeline

      // Volume monitoring for UI waveform, idle suspension, and slow online noise floor adaptation
      let silenceDurationMs = 0
      let lastMetricTime = Date.now()
      pipeline.onMetrics((metrics: AudioMetrics) => {
        setVolumeLevel(metrics.volume)

        const now = Date.now()
        const dt = Math.min(200, now - lastMetricTime)
        lastMetricTime = now

        // Stage 2: Check if session is idle for > 5 minutes (300,000ms) to suspend ONNX session
        if (dt > 0) {
          SpeakerVerificationEngine.getInstance().suspendIfIdle(300_000).catch(() => {})
        }

        // Stage 3: Slow EMA noise floor adaptation strictly during confirmed silence
        if (
          controller.getState() === 'LISTENING' &&
          !isSpeakingRef.current &&
          !TTSAcousticTracker.isSpeaking() &&
          metrics.volume <= 0.025
        ) {
          silenceDurationMs += dt
          if (silenceDurationMs >= 3000) {
            pipeline.updateAdaptiveNoiseFloor(metrics.volume)
            const adapted = pipeline.getNoiseFloor() * 2.5
            // Safe bounded limits: floor 0.012, ceiling 0.030
            adaptiveSpeechThresholdRef.current = Math.min(0.030, Math.max(0.012, adapted))
          }
        } else {
          // Immediately freeze adaptation upon speech or background audio
          silenceDurationMs = 0
        }
      })

      // 3. Acquire mic stream
      await pipeline.acquire()

      // Synchronize canonical active account ID from persistent storage
      const canonicalUserId = await loadActiveUserId().catch(() => 'default_user')
      voiceAuthorizationManager.switchAccount(canonicalUserId)

      // Phase 2: Authoritative profile preloading strictly completed BEFORE VAD or capture begins
      await loadProfileForUser(canonicalUserId)

      // 4. Preload & warm up Whisper ASR and CAM++ Engine in parallel
      const settings = await loadSettings().catch(() => null)
      const modelId = settings?.whisperModel || WhisperASRService.DEFAULT_MODEL_ID
      const whisper = WhisperASRService.getInstance()

      console.log(`[FullDuplexVoice] Preloading & warming up voice models: Whisper (${modelId}) & CAM++ Speaker Verification...`)

      await Promise.all([
        whisper.warmup(modelId),
        SpeakerVerificationEngine.getInstance().initialize().catch(err => {
          console.warn('[FullDuplexVoice] CAM++ Engine pre-initialization notice:', err?.message)
        }),
      ])

      // 5. Calibrate ambient background noise floor
      controller.startCalibrating()
      const { noiseFloorRms, peakRms } = await pipeline.measureAmbientNoise(500)
      adaptiveSpeechThresholdRef.current = Math.max(0.012, noiseFloorRms * 2.5)
      console.log(`[FullDuplexVoice] Ambient noise calibrated (floor: ${noiseFloorRms.toFixed(4)}, peak: ${peakRms.toFixed(4)}). Adaptive speech threshold set to: ${adaptiveSpeechThresholdRef.current.toFixed(4)}`)

      // 6. Arm Silero VAD service strictly AFTER models and profile are ready
      const vadService = new SileroVADService(
        pipeline,
        {
          onSpeechStart: () => {
            // Rapid interruption check: immediately halt assistant speech on candidate user voice
            if (isSpeakingRef.current || TTSAcousticTracker.isSpeaking()) {
              controller.handleSpeechStart()
            }
          },
          onSpeechRealStart: () => {
            console.log('[FullDuplexVoice] Deliberate speech validated (onSpeechRealStart)')
            controller.handleSpeechStart()
          },
          onSpeechEnd: (audio) => controller.handleSpeechEnd(audio),
          onVADMisfire: () => controller.handleVADMisfire(),
          onError: (err) => controller.handleError(err)
        },
        {
          positiveSpeechThreshold: 0.70,
          negativeSpeechThreshold: 0.45,
          minSpeechMs: 320,
          redemptionMs: 450,
          preSpeechPadMs: 250
        }
      )
      vadServiceRef.current = vadService
      await vadService.start()

      // 7. Transition to READY & LISTENING
      controller.readyToListen()
      console.log('[FullDuplexVoice] Full-duplex persistent listening ready and active')
    } catch (err: any) {
      console.error('[FullDuplexVoice] Failed to enable full-duplex mode:', err)
      setError(err.message || 'Failed to initialize voice capture')
      await teardownAudio()
    }
  }, [isFullDuplexEnabled, selectedMicId, teardownAudio, loadProfileForUser])

  // Handle device switching seamlessly
  useEffect(() => {
    if (isFullDuplexEnabled && pipelineRef.current && selectedMicId) {
      pipelineRef.current.switchDevice(selectedMicId).catch(err => {
        console.warn('[FullDuplexVoice] Device switch error:', err)
      })
    }
  }, [selectedMicId, isFullDuplexEnabled])

  // Clean up on component unmount (e.g. Side Panel closure)
  useEffect(() => {
    return () => {
      console.log('[FullDuplexVoice] Unmount detected, cleaning up persistent audio tracks...')

      // Detect whether a PTT turn is active across any active phase on unmount and cancel immediately
      const activeTurn = currentPttTurnIdRef.current || (pttStateMachineRef.current?.getCurrentTurnId() || 0)
      const smPhase = pttStateMachineRef.current?.getPhase()
      const isActivePhase = ['PRESS_PENDING', 'RECORDING', 'FINALIZING', 'TRANSCRIBING', 'PROCESSING', 'EXECUTING'].includes(smPhase || '')

      if (activeTurn > 0 || isPttActiveRef.current || isActivePhase) {
        console.log(`[FullDuplexVoice] Unmount detected during active PTT turn ${activeTurn} (phase=${smPhase}) — cancelling turn and revoking tokens.`)
        isPttActiveRef.current = false
        currentPttTurnIdRef.current = 0
        activeSpeechTurnRef.current++
        WhisperASRService.getInstance().cancel()
        if (activeTurn > 0) {
          voiceAuthorizationManager.cancelTurn(activeTurn, 'Side Panel unmounted')
          if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            try {
              chrome.runtime.sendMessage({
                type: 'auth_cancel_turn',
                payload: { turnId: activeTurn, reason: 'Side panel unmounted' }
              }).catch(() => {})
            } catch {}
          }
        }
      }

      if (pttChunkUnsubRef.current) {
        pttChunkUnsubRef.current()
        pttChunkUnsubRef.current = null
      }
      if (pipelineRef.current) {
        pipelineRef.current.release()
        pipelineRef.current = null
      }
      if (vadServiceRef.current) {
        vadServiceRef.current.destroy()
      }
    }
  }, [])

  // Start Push-to-Talk intentional capture session (internal pipeline starter)
  const startRecordingPipeline = useCallback(async (turnId: number) => {
    console.log(`[FullDuplexVoice] [Turn ${turnId}] Push-to-Talk activated by user interaction`)

    // 1. Immediate TTS interruption upon PTT activation
    stopTTS()
    interruptChat()
    lastInterruptionTimeRef.current = Date.now()

    // 2. Allocate fresh PTT turn
    activeSpeechTurnRef.current = turnId
    currentPttTurnIdRef.current = turnId
    isPttActiveRef.current = true
    pttAudioChunksRef.current = []
    setPttState('LISTENING')

    // 3. Ensure persistent audio pipeline is active
    try {
      const targetDeviceId = selectedMicId || null
      let pipeline = pipelineRef.current

      // Verify whether existing pipeline is active, has live tracks, and matches selected device
      const isLive = isPipelineLive(pipeline)
      const isDeviceMatched = pipeline && typeof pipeline.getActiveDeviceId === 'function'
        ? pipeline.getActiveDeviceId() === targetDeviceId
        : true

      if (!pipeline || !isLive || !isDeviceMatched) {
        // If existing pipeline is stale, ended, device-mismatched, or unusable, safely release it
        if (pipeline) {
          try {
            pipeline.release()
          } catch (e) {
            console.warn('[FullDuplexVoice] Error releasing stale pipeline:', e)
          }
          pipelineRef.current = null
        }

        pipeline = new PersistentAudioPipeline({
          deviceId: selectedMicId,
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 16000
        })
        pipelineRef.current = pipeline
        pipeline.onMetrics((metrics) => setVolumeLevel(metrics.volume))
        await pipeline.acquire(selectedMicId)
      }

      // Ensure AudioContext is resumed (browser autoplay/user activation requirements)
      if (pipeline && typeof pipeline.resumeAudioContext === 'function') {
        await pipeline.resumeAudioContext()
      }

      // Subscribe to raw 16 kHz Float32 PCM chunks (guarantee single listener, no leaks)
      if (pttChunkUnsubRef.current) {
        pttChunkUnsubRef.current()
        pttChunkUnsubRef.current = null
      }
      pttChunkUnsubRef.current = pipeline.onAudioChunk((chunk) => {
        if (isPttActiveRef.current) {
          pttAudioChunksRef.current.push(chunk)
          if (pttAudioChunksRef.current.length % 15 === 0) {
            console.log(`[PTTDiag] [Turn ${turnId}] Audio chunk received: count=${pttAudioChunksRef.current.length}, lastChunkLen=${chunk.length}`)
          }
        }
      })

      // Synchronize canonical active user ID
      const canonicalUserId = await loadActiveUserId().catch(() => 'default_user')
      voiceAuthorizationManager.switchAccount(canonicalUserId)

      // Start diagnostic tracking
      try {
        voiceDiagnosticTracker.startTurn(turnId, canonicalUserId, sessionIdRef.current)
      } catch {}
    } catch (err: any) {
      console.error('[FullDuplexVoice] Failed to start PTT capture:', err)
      // Release partially acquired or faulty pipeline resources on error
      if (pipelineRef.current && !isPipelineLive(pipelineRef.current)) {
        try {
          pipelineRef.current.release()
        } catch {}
        pipelineRef.current = null
      }
      if (pttChunkUnsubRef.current) {
        pttChunkUnsubRef.current()
        pttChunkUnsubRef.current = null
      }
      pttAudioChunksRef.current = []
      isPttActiveRef.current = false
      setPttState('ERROR')
      setError(
        err?.name === 'NotAllowedError'
          ? 'Microphone permission denied. Please allow microphone access in Chrome settings.'
          : (err?.message || 'Microphone error during Push-to-Talk activation')
      )
      setTimeout(() => {
        setPttState((prev) => (prev === 'ERROR' ? 'READY' : prev))
      }, 2500)
      throw err
    }
  }, [selectedMicId, stopTTS, interruptChat])

  // Stop Push-to-Talk and finalize utterance processing
  const stopRecordingPipeline = useCallback(async (targetTurnId?: number) => {
    if (!isPttActiveRef.current) return
    isPttActiveRef.current = false

    if (pttChunkUnsubRef.current) {
      pttChunkUnsubRef.current()
      pttChunkUnsubRef.current = null
    }

    const turnId = targetTurnId ?? currentPttTurnIdRef.current
    setPttState('FINALIZING')

    // Superceded or cancelled check
    if (turnId !== activeSpeechTurnRef.current || voiceAuthorizationManager.isTurnCancelled(turnId)) {
      console.log(`[FullDuplexVoice] [Turn ${turnId}] PTT session superseded or cancelled.`)
      setPttState('READY')
      return
    }

    const chunks = pttAudioChunksRef.current
    pttAudioChunksRef.current = []

    let totalSamples = 0
    for (const c of chunks) totalSamples += c.length
    const durationSeconds = totalSamples / 16000
    console.log(`[PTTDiag] [Turn ${turnId}] Audio collection finalized: totalChunks=${chunks.length}, totalSamples=${totalSamples}, duration=${durationSeconds.toFixed(2)}s`)

    // Minimum speech duration: at least 0.20s (3,200 samples)
    if (totalSamples < 3200) {
      console.log(`[FullDuplexVoice] [Turn ${turnId}] PTT utterance too brief (${(totalSamples / 16000).toFixed(2)}s). Returning to READY.`)
      setPttState('READY')
      return
    }

    const audioBuffer = new Float32Array(totalSamples)
    let offset = 0
    for (const c of chunks) {
      audioBuffer.set(c, offset)
      offset += c.length
    }

    let sumSq = 0
    for (let i = 0; i < totalSamples; i++) sumSq += audioBuffer[i] * audioBuffer[i]
    const rms = Math.sqrt(sumSq / totalSamples)

    try {
      voiceDiagnosticTracker.recordSpeechEnd(turnId, durationSeconds, rms)
    } catch {}

    let processedQuery: string | null = null
    let token: VoiceAuthorizationToken | null = null
    let activeUserId = 'default_user'
    let sessionId = sessionIdRef.current

    try {
      const whisper = WhisperASRService.getInstance()
      const settings = await loadSettings().catch(() => null)
      const modelId = settings?.whisperModel || WhisperASRService.DEFAULT_MODEL_ID
      const language = settings?.speechLanguage || 'en-IN'

      if (turnId !== activeSpeechTurnRef.current || voiceAuthorizationManager.isTurnCancelled(turnId)) {
        setPttState('READY')
        return
      }

      // Stage 1: Classical Bark Wiener Denoising
      const denoiseT0 = Date.now()
      const { enhancedAudio } = await neuralNoiseReductionService.enhanceAudio(audioBuffer)

      if (turnId !== activeSpeechTurnRef.current || voiceAuthorizationManager.isTurnCancelled(turnId)) {
        setPttState('READY')
        return
      }

      // Stage 2: Whisper ASR
      const whisperT0 = Date.now()
      const transcription = await whisper.transcribe(enhancedAudio, { modelId, language })
      const whisperDuration = Date.now() - whisperT0

      if (turnId !== activeSpeechTurnRef.current || voiceAuthorizationManager.isTurnCancelled(turnId)) {
        console.log(`[FullDuplexVoice] [Turn ${turnId}] PTT session cancelled during transcription.`)
        setPttState('READY')
        return
      }

      if (!transcription || !transcription.text || !transcription.text.trim()) {
        console.log(`[FullDuplexVoice] [Turn ${turnId}] Empty transcription from PTT.`)
        setPttState('READY')
        return
      }

      try {
        voiceDiagnosticTracker.recordWhisper(turnId, transcription.text, whisperDuration)
      } catch {}

      // Stage 3: Orchestrator filter
      const processed = orchestratorRef.current.processTranscript(transcription.text, {
        recentAssistantUtterances: TTSAcousticTracker.getRecentUtterances(),
        isAudibleTabActive: isTabAudioPlaying
      })

      if (processed.isNoiseOrHallucination || !processed.effectiveQuery) {
        console.log(`[FullDuplexVoice] [Turn ${turnId}] PTT audio filtered as noise/hallucination: "${transcription.text}"`)
        setPttState('READY')
        return
      }

      processedQuery = processed.effectiveQuery

      // Stage 4: Mint Intentional PTT Capability Token
      activeUserId = voiceAuthorizationManager.getActiveContext().userId || 'default_user'
      sessionId = sessionIdRef.current

      voiceAuthorizationManager.setActiveContext({ userId: activeUserId, sessionId, turnId })
      voiceAuthorizationManager.advanceTurn(turnId)

      const mintParams = {
        turnId,
        userId: activeUserId,
        sessionId,
        mode: 'UNIVERSAL_VOICE' as const,
        activationMethod: 'PUSH_TO_TALK' as const,
        isPttActive: true,
      }

      token = voiceAuthorizationManager.mintToken(mintParams)
      const turnGrant = voiceAuthorizationManager.mintTurnGrant(mintParams)

      try {
        voiceDiagnosticTracker.recordTurnGrant(turnId, turnGrant.grantId, turnGrant.absoluteDeadlineMs)
      } catch {}

      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        try {
          const bgResponse = await new Promise<any>((resolve) => {
            chrome.runtime.sendMessage({ type: 'auth_mint_token', payload: mintParams }, resolve)
          })
          if (bgResponse?.success && bgResponse.token) {
            token = bgResponse.token
            voiceAuthorizationManager.registerToken(token)
          }
        } catch (err) {}
      }

      try {
        voiceDiagnosticTracker.recordAuth(turnId, 'UNIVERSAL_GRANTED', token.scope)
      } catch {}

      if (token.scope === 'DENIED') {
        console.log(`[FullDuplexVoice] [Turn ${turnId}] PTT authorization denied: token scope is DENIED`)
        try {
          voiceDiagnosticTracker.recordTerminalState(turnId, 'DENIED', 'PTT authorization token scope was DENIED')
        } catch {}
        setPttState('READY')
        return
      }
    } catch (asrErr: any) {
      console.error(`[FullDuplexVoice] [Turn ${turnId}] ASR/Whisper transcription error:`, asrErr)
      try {
        voiceDiagnosticTracker.recordWhisper(turnId, undefined, undefined, asrErr?.message || 'ASR error')
        voiceDiagnosticTracker.recordTerminalState(turnId, 'ASR_FAILED', asrErr?.message || 'ASR transcription failed')
      } catch {}
      setError(asrErr?.message || 'Speech recognition failed')
      setPttState('READY')
      return
    }

    // Stage 5: Dispatch to Agent (Isolated execution boundary: agent failures do NOT cause MIC ERROR)
    if (processedQuery && token) {
      if (turnId !== activeSpeechTurnRef.current || voiceAuthorizationManager.isTurnCancelled(turnId)) {
        console.log(`[FullDuplexVoice] [Turn ${turnId}] Aborting agent dispatch: turn cancelled or revoked.`)
        setPttState('READY')
        return
      }
      try {
        setPttState('EXECUTING')
        const grant = voiceAuthorizationManager.getTurnGrant(turnId)
        if (!grant || grant.revoked) {
          console.log(`[FullDuplexVoice] [Turn ${turnId}] Aborting agent dispatch: grant missing or revoked.`)
          setPttState('READY')
          return
        }
        await sendMessage(processedQuery, {
          turnGrant: grant,
          token,
          turnId,
          userId: activeUserId,
          sessionId,
        })
      } catch (agentErr: any) {
        console.error(`[FullDuplexVoice] [Turn ${turnId}] Agent execution error (non-microphone):`, agentErr)
      } finally {
        // Return cleanly to READY without delay so subsequent PTT activations work immediately
        setPttState('READY')
      }
    } else {
      setPttState('READY')
    }
  }, [sendMessage, isTabAudioPlaying])

  // Internal cancellation implementation
  const cancelPttInternal = useCallback((targetTurnId?: number, reason?: string) => {
    const cancellationReason = reason || 'User cancelled PTT'
    console.log(`[PTTDiag] PTT session cancelled: reason='${cancellationReason}'`)
    isPttActiveRef.current = false
    if (pttChunkUnsubRef.current) {
      pttChunkUnsubRef.current()
      pttChunkUnsubRef.current = null
    }

    const cancelledTurn = targetTurnId ?? currentPttTurnIdRef.current
    currentPttTurnIdRef.current = 0
    activeSpeechTurnRef.current++ // Invalidate turn ID immediately

    WhisperASRService.getInstance().cancel()
    if (cancelledTurn > 0) {
      voiceAuthorizationManager.cancelTurn(cancelledTurn, cancellationReason)
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'auth_cancel_turn', payload: { turnId: cancelledTurn, reason: cancellationReason } }).catch(() => {})
      }
      voiceDiagnosticTracker.recordCancellation(cancelledTurn, cancellationReason)
    }

    pttAudioChunksRef.current = []
    setPttState('CANCELLED')

    setTimeout(() => {
      setPttState((prev) => (prev === 'CANCELLED' ? 'READY' : prev))
    }, 400)
  }, [])

  // Mutable ref holding active PTT pipeline callbacks so PTTStateMachine is NEVER destroyed on re-render
  const pttCallbacksRef = useRef({
    startRecordingPipeline,
    stopRecordingPipeline,
    cancelPttInternal,
  })
  pttCallbacksRef.current = {
    startRecordingPipeline,
    stopRecordingPipeline,
    cancelPttInternal,
  }

  // PTT State Machine initialization and synchronization (persisted across renders)
  const pttStateMachineRef = useRef<PTTStateMachine | null>(null)
  if (!pttStateMachineRef.current) {
    pttStateMachineRef.current = new PTTStateMachine({
      holdThresholdMs: 150,
      onStartRecording: async (turnId) => {
        await pttCallbacksRef.current.startRecordingPipeline(turnId)
      },
      onStopRecording: async (turnId) => {
        await pttCallbacksRef.current.stopRecordingPipeline(turnId)
      },
      onCancel: (turnId, reason) => {
        pttCallbacksRef.current.cancelPttInternal(turnId, reason)
      },
      onPhaseChange: (phase) => {
        if (phase === 'PRESS_PENDING') {
          setPttState('PRESS_PENDING')
        } else if (phase === 'RECORDING') {
          setPttState('LISTENING')
        } else if (phase === 'FINALIZING') {
          setPttState('FINALIZING')
        } else if (phase === 'TRANSCRIBING') {
          setPttState('TRANSCRIBING')
        } else if (phase === 'PROCESSING') {
          setPttState('PROCESSING')
        } else if (phase === 'EXECUTING') {
          setPttState('EXECUTING')
        } else if (phase === 'CANCELLED') {
          setPttState('CANCELLED')
        } else if (phase === 'ERROR') {
          setPttState('ERROR')
        } else {
          setPttState('READY')
        }
      }
    })
  }

  // Teardown PTTStateMachine ONLY on true hook unmount
  useEffect(() => {
    return () => {
      if (pttStateMachineRef.current) {
        pttStateMachineRef.current.destroy()
        pttStateMachineRef.current = null
      }
    }
  }, [])

  // Public PTT control triggers bound to state machine
  const startPtt = useCallback(async (source: 'keyboard' | 'pointer' = 'pointer') => {
    if (pttStateMachineRef.current) {
      if (source === 'pointer') {
        pttStateMachineRef.current.handlePointerDown()
      } else {
        pttStateMachineRef.current.handleKeyDown({ code: 'Space', repeat: false })
      }
    } else {
      const turnId = ++activeSpeechTurnRef.current
      await pttCallbacksRef.current.startRecordingPipeline(turnId)
    }
  }, [])

  const stopPtt = useCallback(async (source: 'keyboard' | 'pointer' = 'pointer') => {
    if (pttStateMachineRef.current) {
      if (source === 'pointer') {
        pttStateMachineRef.current.handlePointerUp()
      } else {
        pttStateMachineRef.current.handleKeyUp({ code: 'Space' })
      }
    } else {
      await pttCallbacksRef.current.stopRecordingPipeline(currentPttTurnIdRef.current)
    }
  }, [])

  const cancelPtt = useCallback((reason?: string) => {
    if (pttStateMachineRef.current) {
      pttStateMachineRef.current.cancel(reason || 'User cancelled PTT')
    } else {
      cancelPttInternal(currentPttTurnIdRef.current, reason)
    }
  }, [cancelPttInternal])

  const handleKeyDown = useCallback((e: KeyboardEvent | any): boolean => {
    return pttStateMachineRef.current?.handleKeyDown(e) ?? false
  }, [])

  const handleKeyUp = useCallback((e: KeyboardEvent | any): boolean => {
    return pttStateMachineRef.current?.handleKeyUp(e) ?? false
  }, [])

  const handleBlurOrVisibilityChange = useCallback((hidden?: boolean) => {
    pttStateMachineRef.current?.handleBlurOrVisibilityChange(hidden)
  }, [])

  return {
    isFullDuplexEnabled,
    voiceState,
    pttState,
    volumeLevel,
    toggleVoiceMode,
    startPtt,
    stopPtt,
    cancelPtt,
    handleKeyDown,
    handleKeyUp,
    handleBlurOrVisibilityChange,
    muteImmediately,
    profileState,
    hasEnrolledProfile: profileState === 'PROFILE_LOADED',
    error,
    isTabAudioPlaying
  }
}
