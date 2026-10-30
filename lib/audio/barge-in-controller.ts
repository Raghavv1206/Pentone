/**
 * Pentone Barge-In Controller & Conversational State Machine
 * 
 * Implements an 8-state finite state machine governing full-duplex voice interactions.
 * 
 * States:
 * - DISABLED: Voice mode is turned off; mic hardware released.
 * - IDLE: Voice mode enabled; audio pipeline initialized.
 * - LISTENING: Mic stream active, VAD monitoring for speech onset.
 * - USER_SPEAKING: User is speaking (VAD active); frames buffering.
 * - PROCESSING: User finished speaking; ASR / agent execution in progress.
 * - ASSISTANT_SPEAKING: Assistant TTS is playing; mic remains open with native AEC.
 * - INTERRUPTING: User began speaking while assistant was speaking; TTS halted immediately.
 * - ERROR: Hardware permission or device error.
 */

export type VoiceState =
  | 'DISABLED'
  | 'IDLE'
  | 'LISTENING'
  | 'USER_SPEAKING'
  | 'PROCESSING'
  | 'ASSISTANT_SPEAKING'
  | 'INTERRUPTING'
  | 'ERROR'

export interface BargeInControllerCallbacks {
  onStateChange?: (newState: VoiceState, oldState: VoiceState) => void
  onInterrupt?: () => void
  onSpeechEnd?: (audio: Float32Array) => void
  onError?: (error: Error) => void
}

export class BargeInController {
  private currentState: VoiceState = 'DISABLED'
  private lastSpeechStartTime = 0

  // Allowed state transitions table
  private static readonly VALID_TRANSITIONS: Record<VoiceState, VoiceState[]> = {
    DISABLED: ['IDLE', 'ERROR'],
    IDLE: ['LISTENING', 'DISABLED', 'ERROR'],
    LISTENING: ['USER_SPEAKING', 'ASSISTANT_SPEAKING', 'DISABLED', 'ERROR'],
    USER_SPEAKING: ['PROCESSING', 'LISTENING', 'DISABLED', 'ERROR'],
    PROCESSING: ['ASSISTANT_SPEAKING', 'LISTENING', 'INTERRUPTING', 'USER_SPEAKING', 'DISABLED', 'ERROR'],
    ASSISTANT_SPEAKING: ['LISTENING', 'INTERRUPTING', 'USER_SPEAKING', 'DISABLED', 'ERROR'],
    INTERRUPTING: ['USER_SPEAKING', 'LISTENING', 'DISABLED', 'ERROR'],
    ERROR: ['IDLE', 'DISABLED']
  }

  constructor(private callbacks: BargeInControllerCallbacks = {}) {}

  /**
   * Returns current conversational state
   */
  getState(): VoiceState {
    return this.currentState
  }

  /**
   * Internal transition validator and emitter
   */
  private transitionTo(nextState: VoiceState): boolean {
    const oldState = this.currentState
    if (oldState === nextState) return true

    const allowed = BargeInController.VALID_TRANSITIONS[oldState]
    if (!allowed || !allowed.includes(nextState)) {
      console.warn(`[BargeInController] Invalid state transition: ${oldState} -> ${nextState}`)
      return false
    }

    console.log(`[BargeInController] Transition: ${oldState} -> ${nextState}`)
    this.currentState = nextState
    this.callbacks.onStateChange?.(nextState, oldState)
    return true
  }

  /**
   * Called when the user enables voice mode
   */
  enableVoiceMode(): boolean {
    if (this.currentState === 'DISABLED') {
      return this.transitionTo('IDLE')
    }
    return true
  }

  /**
   * Called when voice mode is disabled or panel unmounts
   */
  disableVoiceMode(): boolean {
    return this.transitionTo('DISABLED')
  }

  /**
   * Called when audio hardware & VAD are ready to listen
   */
  readyToListen(): boolean {
    if (this.currentState === 'IDLE' || this.currentState === 'PROCESSING' || this.currentState === 'INTERRUPTING') {
      return this.transitionTo('LISTENING')
    }
    return false
  }

  /**
   * VAD Event: User begins speaking
   */
  handleSpeechStart(): void {
    const now = Date.now()
    if (this.currentState === 'USER_SPEAKING' && now - this.lastSpeechStartTime < 150) {
      return
    }
    this.lastSpeechStartTime = now

    if (this.currentState === 'ASSISTANT_SPEAKING' || this.currentState === 'PROCESSING') {
      console.log(`[BargeInController] Barge-in triggered! State was ${this.currentState}. Interrupted by user speech.`)
      // 1. Immediately transition to INTERRUPTING
      this.transitionTo('INTERRUPTING')
      // 2. Invoke interruption hook (cancels TTS, stops LLM chunk generation, preserves tasks)
      this.callbacks.onInterrupt?.()
      // 3. Move immediately to USER_SPEAKING to capture the new command
      this.transitionTo('USER_SPEAKING')
      return
    }

    if (this.currentState === 'LISTENING') {
      this.transitionTo('USER_SPEAKING')
    }
  }

  /**
   * VAD Event: User finishes speaking
   */
  handleSpeechEnd(audio: Float32Array): void {
    if (this.currentState === 'USER_SPEAKING') {
      this.transitionTo('PROCESSING')
      this.callbacks.onSpeechEnd?.(audio)
    }
  }

  /**
   * VAD Event: Transient noise or misfire
   */
  handleVADMisfire(): void {
    if (this.currentState === 'USER_SPEAKING' || this.currentState === 'INTERRUPTING') {
      // Return to listening if false start was rejected
      this.transitionTo('LISTENING')
    }
  }

  /**
   * Agent Event: Assistant begins speaking TTS
   */
  handleAssistantSpeechStart(): void {
    if (this.currentState === 'PROCESSING' || this.currentState === 'LISTENING') {
      this.transitionTo('ASSISTANT_SPEAKING')
    }
  }

  /**
   * Agent Event: Assistant finished speaking all sentences in queue
   */
  handleAssistantSpeechEnd(): void {
    if (this.currentState === 'ASSISTANT_SPEAKING') {
      this.transitionTo('LISTENING')
    }
  }

  /**
   * Error Event
   */
  handleError(error: Error): void {
    console.error('[BargeInController] Error occurred:', error)
    this.transitionTo('ERROR')
    this.callbacks.onError?.(error)
  }

  /**
   * Helper to check if microphone should be streaming
   */
  isMicrophoneActive(): boolean {
    return this.currentState !== 'DISABLED' && this.currentState !== 'ERROR'
  }

  /**
   * Helper to check if user speech can interrupt
   */
  isInterruptible(): boolean {
    return this.currentState === 'ASSISTANT_SPEAKING' || this.currentState === 'PROCESSING'
  }
}
