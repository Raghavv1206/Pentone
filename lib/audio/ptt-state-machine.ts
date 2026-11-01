/**
 * Push-to-Talk (PTT) Deterministic State Machine
 * 
 * Formal Lifecycle:
 * IDLE → PRESS_PENDING (150ms hold threshold) → RECORDING → FINALIZING → TRANSCRIBING → PROCESSING → IDLE
 * 
 * Guarantees:
 * 1. Ignore event.repeat and duplicate keydown events.
 * 2. 150ms hold threshold prevents short space taps from starting recording.
 * 3. Exact tracking of physical key/pointer state vs async mic acquisition lifecycle.
 * 4. Keyup during mic acquisition immediately finalizes once acquisition completes.
 * 5. Single finalization per turn (keyup never required twice).
 * 6. Automatic cleanup on window.blur, document.visibilitychange, unmount.
 * 7. Ignores Spacebar when typing in input, textarea, contenteditable, or role="textbox".
 * 8. Watchdogs prevent stuck states across all phases.
 * 9. Per-turn isolation via incrementing turnId. Late events from old turns are rejected.
 * 10. Distinct inputSource tracking ('keyboard' vs 'pointer') prevents pointer events from cancelling keyboard sessions.
 * 11. Comprehensive event-level diagnostics logged with [PTTDiag] prefix.
 */

export type PTTPhase = 
  | 'IDLE' 
  | 'PRESS_PENDING' 
  | 'RECORDING' 
  | 'FINALIZING' 
  | 'TRANSCRIBING' 
  | 'PROCESSING' 
  | 'EXECUTING' 
  | 'ERROR' 
  | 'CANCELLED'

export type PTTInputSource = 'keyboard' | 'pointer' | null

export interface PTTStateMachineOptions {
  holdThresholdMs?: number
  maxRecordingMs?: number
  processingTimeoutMs?: number
  onStartRecording: (turnId: number) => Promise<void>
  onStopRecording: (turnId: number) => Promise<void>
  onCancel: (turnId: number, reason?: string) => void
  onPhaseChange?: (phase: PTTPhase, turnId: number) => void
}

export function isEditableElement(target: any): boolean {
  if (!target) return false
  const tagName = (target.tagName || '').toUpperCase()
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return true
  if (target.isContentEditable) return true
  const role = typeof target.getAttribute === 'function' ? target.getAttribute('role') : target.role
  if (role === 'textbox' || role === 'searchbox' || role === 'combobox') return true
  if (typeof target.closest === 'function') {
    if (target.closest('[contenteditable="true"], [role="textbox"], [role="searchbox"]')) return true
  }
  return false
}

export class PTTStateMachine {
  private phase: PTTPhase = 'IDLE'
  private physicalKeyDown: boolean = false
  private inputSource: PTTInputSource = null
  private currentTurnId: number = 0
  private holdTimer: any = null
  private watchdogTimer: any = null
  private isAcquiring: boolean = false
  private pendingFinalizeDuringAcquire: boolean = false
  private destroyed: boolean = false

  // Diagnostics Timestamps & Telemetry
  private keyDownTime: number = 0
  private keyUpTime: number = 0
  private pointerDownTime: number = 0
  private pointerUpTime: number = 0
  private micAcquireStartTime: number = 0
  private micAcquireEndTime: number = 0
  private cancellationReason: string | null = null

  private readonly holdThresholdMs: number
  private readonly maxRecordingMs: number
  private readonly processingTimeoutMs: number
  private readonly onStartRecording: (turnId: number) => Promise<void>
  private readonly onStopRecording: (turnId: number) => Promise<void>
  private readonly onCancel: (turnId: number, reason?: string) => void
  private readonly onPhaseChange?: (phase: PTTPhase, turnId: number) => void

  constructor(options: PTTStateMachineOptions) {
    this.holdThresholdMs = options.holdThresholdMs ?? 150
    this.maxRecordingMs = options.maxRecordingMs ?? 30000 // 30s max recording watchdog
    this.processingTimeoutMs = options.processingTimeoutMs ?? 45000 // 45s max processing watchdog
    this.onStartRecording = options.onStartRecording
    this.onStopRecording = options.onStopRecording
    this.onCancel = options.onCancel
    this.onPhaseChange = options.onPhaseChange
  }

  public async waitForIdle(timeoutMs: number = 2000): Promise<void> {
    const start = Date.now()
    while (this.phase !== 'IDLE' && Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 10))
    }
  }

  public getPhase(): PTTPhase {
    return this.phase
  }

  public getInputSource(): PTTInputSource {
    return this.inputSource
  }

  public isKeyDepressed(): boolean {
    return this.physicalKeyDown
  }

  public getCurrentTurnId(): number {
    return this.currentTurnId
  }

  private setPhase(newPhase: PTTPhase): void {
    if (this.destroyed) return
    const prevPhase = this.phase
    this.phase = newPhase
    console.log(`[PTTDiag] [Turn ${this.currentTurnId}] State transition: ${prevPhase} -> ${newPhase} (source=${this.inputSource})`)
    try {
      this.onPhaseChange?.(newPhase, this.currentTurnId)
    } catch (e) {
      console.warn('[PTTStateMachine] Error in onPhaseChange callback:', e)
    }
  }

  private clearHoldTimer(): void {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer)
      this.holdTimer = null
    }
  }

  private clearWatchdog(): void {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer)
      this.watchdogTimer = null
    }
  }

  private armWatchdog(timeoutMs: number, reason: string): void {
    this.clearWatchdog()
    this.watchdogTimer = setTimeout(() => {
      console.warn(`[PTTStateMachine] [PTTDiag] Watchdog timeout (${timeoutMs}ms) triggered for turn ${this.currentTurnId}: ${reason}. Force resetting to IDLE.`)
      this.forceReset()
    }, timeoutMs)
  }

  /**
   * Spacebar keydown event handler
   */
  public handleKeyDown(e: KeyboardEvent | { code?: string; repeat?: boolean; target?: any; preventDefault?: () => void }): boolean {
    if (this.destroyed) return false

    // Check editable controls
    if (isEditableElement(e.target || (typeof document !== 'undefined' ? document.activeElement : null))) {
      return false
    }

    if (e.code !== 'Space') return false

    // Always prevent default page scroll for Spacebar
    if (typeof e.preventDefault === 'function') {
      e.preventDefault()
    }

    // Ignore key repeat without restarting or resetting session
    if (e.repeat) {
      return false
    }

    // Ignore duplicate keydowns if already held
    if (this.physicalKeyDown) {
      return false
    }

    // If currently finalizing, transcribing, or processing, don't interrupt active inference
    if (['FINALIZING', 'TRANSCRIBING', 'PROCESSING', 'EXECUTING'].includes(this.phase)) {
      console.log('[PTTDiag] Prior turn still processing, ignoring new press.')
      return false
    }

    // If somehow stuck in RECORDING or PRESS_PENDING from an unexpected anomaly, clean it first
    if (this.phase === 'RECORDING' || this.phase === 'PRESS_PENDING') {
      this.clearHoldTimer()
      this.clearWatchdog()
      this.onCancel(this.currentTurnId)
      this.setPhase('IDLE')
    }

    this.inputSource = 'keyboard'
    this.physicalKeyDown = true
    this.keyDownTime = Date.now()
    this.keyUpTime = 0
    this.cancellationReason = null

    // Allocate fresh speech turn for this press
    this.currentTurnId++
    const turnId = this.currentTurnId
    console.log(`[PTTDiag] [Turn ${turnId}] Spacebar keydown registered at ${this.keyDownTime} (source=keyboard).`)
    this.setPhase('PRESS_PENDING')

    // Arm 150ms hold threshold
    this.clearHoldTimer()
    this.holdTimer = setTimeout(async () => {
      this.holdTimer = null
      if (this.destroyed || turnId !== this.currentTurnId) return

      // Verify physical key is still depressed
      if (!this.physicalKeyDown) {
        // Quick tap (< 150ms)! Transition back to IDLE without recording.
        console.log(`[PTTDiag] [Turn ${turnId}] Quick spacebar tap (<150ms) released before hold threshold. Returning to IDLE.`)
        this.setPhase('IDLE')
        return
      }

      // Transition to RECORDING
      this.setPhase('RECORDING')
      this.armWatchdog(this.maxRecordingMs, 'Max recording duration exceeded')

      this.isAcquiring = true
      this.pendingFinalizeDuringAcquire = false
      this.micAcquireStartTime = Date.now()
      console.log(`[PTTDiag] [Turn ${turnId}] Microphone acquisition starting at ${this.micAcquireStartTime}...`)

      try {
        await this.onStartRecording(turnId)
        this.micAcquireEndTime = Date.now()
        console.log(`[PTTDiag] [Turn ${turnId}] Microphone acquisition completed in ${this.micAcquireEndTime - this.micAcquireStartTime}ms.`)
      } catch (err) {
        console.error(`[PTTDiag] [Turn ${turnId}] Failed to start recording:`, err)
        this.clearWatchdog()
        this.setPhase('ERROR')
        setTimeout(() => {
          if (this.phase === 'ERROR' && turnId === this.currentTurnId) {
            this.setPhase('IDLE')
          }
        }, 1500)
        return
      } finally {
        this.isAcquiring = false
      }

      // Edge case: User released space while onStartRecording was in-flight!
      if (this.pendingFinalizeDuringAcquire || !this.physicalKeyDown) {
        if (turnId === this.currentTurnId && this.phase === 'RECORDING') {
          console.log(`[PTTDiag] [Turn ${turnId}] Spacebar released during mic acquisition; finalizing immediately.`)
          await this.triggerFinalization(turnId)
        }
      }
    }, this.holdThresholdMs)

    return true
  }

  /**
   * Spacebar keyup event handler
   */
  public handleKeyUp(e: KeyboardEvent | { code?: string; target?: any; preventDefault?: () => void }): boolean {
    if (this.destroyed) return false

    if (isEditableElement(e.target || (typeof document !== 'undefined' ? document.activeElement : null))) {
      return false
    }

    if (e.code !== 'Space') return false

    // If active turn was initiated by pointer, Spacebar keyup must not finalize or cancel it
    if (this.inputSource === 'pointer') {
      return false
    }

    if (typeof e.preventDefault === 'function') {
      e.preventDefault()
    }

    this.keyUpTime = Date.now()
    const holdDuration = this.keyDownTime > 0 ? this.keyUpTime - this.keyDownTime : 0
    console.log(`[PTTDiag] [Turn ${this.currentTurnId}] Spacebar keyup registered at ${this.keyUpTime} (holdDuration=${holdDuration}ms, source=keyboard).`)

    this.physicalKeyDown = false
    const turnId = this.currentTurnId

    // Case 1: Released during PRESS_PENDING (Tap < 150ms)
    if (this.phase === 'PRESS_PENDING') {
      this.clearHoldTimer()
      this.setPhase('IDLE')
      return true
    }

    // Case 2: Released during RECORDING
    if (this.phase === 'RECORDING') {
      if (this.isAcquiring) {
        // Mic acquisition is currently awaiting; flag for immediate finalization once resolved
        this.pendingFinalizeDuringAcquire = true
        return true
      }

      // Finalize recording once
      this.triggerFinalization(turnId)
      return true
    }

    return false
  }

  /**
   * Pointer down event handler (for UI button)
   */
  public handlePointerDown(): boolean {
    if (this.destroyed) return false
    if (this.physicalKeyDown) return false
    if (['FINALIZING', 'TRANSCRIBING', 'PROCESSING', 'EXECUTING'].includes(this.phase)) {
      console.log('[PTTDiag] Prior turn still processing, ignoring new pointer press.')
      return false
    }

    if (this.phase === 'RECORDING' || this.phase === 'PRESS_PENDING') {
      this.clearHoldTimer()
      this.clearWatchdog()
      this.onCancel(this.currentTurnId)
      this.setPhase('IDLE')
    }

    this.inputSource = 'pointer'
    this.physicalKeyDown = true
    this.pointerDownTime = Date.now()
    this.pointerUpTime = 0
    this.cancellationReason = null

    this.currentTurnId++
    const turnId = this.currentTurnId
    console.log(`[PTTDiag] [Turn ${turnId}] Pointer down registered at ${this.pointerDownTime} (source=pointer).`)
    this.setPhase('PRESS_PENDING')

    this.clearHoldTimer()
    this.holdTimer = setTimeout(async () => {
      this.holdTimer = null
      if (this.destroyed || turnId !== this.currentTurnId) return
      if (!this.physicalKeyDown) {
        console.log(`[PTTDiag] [Turn ${turnId}] Quick pointer tap (<150ms) released before hold threshold. Returning to IDLE.`)
        this.setPhase('IDLE')
        return
      }

      this.setPhase('RECORDING')
      this.armWatchdog(this.maxRecordingMs, 'Max recording duration exceeded')
      this.isAcquiring = true
      this.pendingFinalizeDuringAcquire = false
      this.micAcquireStartTime = Date.now()
      console.log(`[PTTDiag] [Turn ${turnId}] Pointer mic acquisition starting at ${this.micAcquireStartTime}...`)

      try {
        await this.onStartRecording(turnId)
        this.micAcquireEndTime = Date.now()
        console.log(`[PTTDiag] [Turn ${turnId}] Pointer mic acquisition completed in ${this.micAcquireEndTime - this.micAcquireStartTime}ms.`)
      } catch (err) {
        console.error(`[PTTDiag] [Turn ${turnId}] Failed to start recording:`, err)
        this.clearWatchdog()
        this.setPhase('ERROR')
        setTimeout(() => {
          if (this.phase === 'ERROR' && turnId === this.currentTurnId) {
            this.setPhase('IDLE')
          }
        }, 1500)
        return
      } finally {
        this.isAcquiring = false
      }

      if (this.pendingFinalizeDuringAcquire || !this.physicalKeyDown) {
        if (turnId === this.currentTurnId && this.phase === 'RECORDING') {
          console.log(`[PTTDiag] [Turn ${turnId}] Pointer released during mic acquisition; finalizing immediately.`)
          await this.triggerFinalization(turnId)
        }
      }
    }, this.holdThresholdMs)

    return true
  }

  /**
   * Pointer up event handler (for UI button)
   */
  public handlePointerUp(): boolean {
    if (this.destroyed) return false

    // If active turn was initiated by keyboard, pointer release must not finalize or cancel it
    if (this.inputSource === 'keyboard') {
      return false
    }

    this.pointerUpTime = Date.now()
    const holdDuration = this.pointerDownTime > 0 ? this.pointerUpTime - this.pointerDownTime : 0
    console.log(`[PTTDiag] [Turn ${this.currentTurnId}] Pointer up registered at ${this.pointerUpTime} (holdDuration=${holdDuration}ms, source=pointer).`)

    this.physicalKeyDown = false
    const turnId = this.currentTurnId

    if (this.phase === 'PRESS_PENDING') {
      this.clearHoldTimer()
      this.setPhase('IDLE')
      return true
    }

    if (this.phase === 'RECORDING') {
      if (this.isAcquiring) {
        this.pendingFinalizeDuringAcquire = true
        return true
      }
      this.triggerFinalization(turnId)
      return true
    }

    return false
  }

  /**
   * Internal finalization runner
   */
  private async triggerFinalization(turnId: number): Promise<void> {
    if (turnId !== this.currentTurnId) return
    if (this.phase !== 'RECORDING') return

    this.setPhase('FINALIZING')
    this.armWatchdog(this.processingTimeoutMs, 'Finalization and transcription timed out')

    try {
      await this.onStopRecording(turnId)
    } catch (err) {
      console.error(`[PTTDiag] [Turn ${turnId}] Error during recording finalization:`, err)
      this.setPhase('ERROR')
    } finally {
      this.clearWatchdog()
      // Transition cleanly back to IDLE
      const activePhase = this.phase as PTTPhase
      if (turnId === this.currentTurnId && (activePhase === 'FINALIZING' || activePhase === 'TRANSCRIBING' || activePhase === 'PROCESSING' || activePhase === 'EXECUTING')) {
        this.setPhase('IDLE')
      }
    }
  }

  /**
   * Explicit phase update from downstream transcription / agent processing
   */
  public reportPhase(phase: PTTPhase, turnId?: number): void {
    if (this.destroyed) return
    if (turnId !== undefined && turnId !== this.currentTurnId) {
      // Ignore late phase reports from old turns
      return
    }
    this.setPhase(phase)
    if (phase === 'IDLE' || phase === 'ERROR' || phase === 'CANCELLED') {
      this.clearWatchdog()
    }
  }

  /**
   * Window blur or visibility loss: safely cancel active recording and revoke authorization
   */
  public handleBlurOrVisibilityChange(hidden?: boolean): void {
    if (this.destroyed) return
    const isHidden = hidden !== undefined 
      ? hidden 
      : (typeof document !== 'undefined' ? (document.hidden || !document.hasFocus()) : true)
    console.log(`[PTTDiag] [Turn ${this.currentTurnId}] Blur/Visibility event (hidden=${isHidden}, source=${this.inputSource}, physicalDown=${this.physicalKeyDown}, phase=${this.phase}).`)

    // Requirement 6: Internal non-hidden focus shift inside the Side Panel preserves active keyboard session
    if (hidden === false && this.inputSource === 'keyboard' && this.physicalKeyDown) {
      console.log(`[PTTDiag] [Turn ${this.currentTurnId}] Preserving active keyboard PTT session during internal non-hidden focus shift.`)
      return
    }

    this.physicalKeyDown = false

    if (this.phase === 'PRESS_PENDING') {
      this.clearHoldTimer()
      this.setPhase('IDLE')
    } else if (this.phase === 'RECORDING') {
      const turnId = this.currentTurnId
      this.clearHoldTimer()
      this.clearWatchdog()
      this.pendingFinalizeDuringAcquire = false
      console.log(`[PTTDiag] [Turn ${turnId}] Cancelling active recording due to window blur / focus loss.`)
      this.cancellationReason = 'Focus lost during recording'
      this.onCancel(turnId, 'Focus lost during recording')
      this.setPhase('CANCELLED')
      setTimeout(() => {
        if (this.phase === 'CANCELLED' && turnId === this.currentTurnId) {
          this.setPhase('IDLE')
        }
      }, 400)
    }
  }

  /**
   * Explicit cancellation (Escape key, cancel button, or pointercancel)
   */
  public cancel(reason: string = 'User cancelled'): void {
    if (this.destroyed) return

    // Pointer cancellation events must not cancel an active keyboard session
    if (this.inputSource === 'keyboard' && reason.toLowerCase().includes('pointer')) {
      console.log(`[PTTDiag] [Turn ${this.currentTurnId}] Ignoring pointer cancellation for active keyboard session: reason='${reason}'.`)
      return
    }

    this.cancellationReason = reason
    console.log(`[PTTDiag] [Turn ${this.currentTurnId}] Explicit cancellation invoked: reason='${reason}', phase=${this.phase}, source=${this.inputSource}.`)
    this.physicalKeyDown = false
    this.clearHoldTimer()
    this.clearWatchdog()

    const turnId = this.currentTurnId
    this.onCancel(turnId, reason)
    this.setPhase('CANCELLED')

    setTimeout(() => {
      if (this.phase === 'CANCELLED' && turnId === this.currentTurnId) {
        this.setPhase('IDLE')
      }
    }, 400)
  }

  /**
   * Emergency force reset to clean IDLE state
   */
  public forceReset(): void {
    this.physicalKeyDown = false
    this.isAcquiring = false
    this.pendingFinalizeDuringAcquire = false
    this.clearHoldTimer()
    this.clearWatchdog()
    this.onCancel(this.currentTurnId, 'Force reset')
    this.setPhase('IDLE')
  }

  /**
   * Teardown on unmount across all active phases
   */
  public destroy(): void {
    this.physicalKeyDown = false
    this.clearHoldTimer()
    this.clearWatchdog()
    if (['PRESS_PENDING', 'RECORDING', 'FINALIZING', 'TRANSCRIBING', 'PROCESSING', 'EXECUTING'].includes(this.phase)) {
      console.log(`[PTTDiag] [Turn ${this.currentTurnId}] Destroying state machine while active (phase=${this.phase}): cancelling turn ${this.currentTurnId}.`)
      this.onCancel(this.currentTurnId, 'State machine destroyed')
    }
    this.phase = 'IDLE'
    this.destroyed = true
  }
}
