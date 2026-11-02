/**
 * Module-level lock for half-duplex microphone and audio hardware synchronization.
 * Decoupled from React UI contexts so it can be safely used across background,
 * TTS, and audio pipeline modules without circular dependencies or runtime reference errors.
 */

let isMicActive = false

export function isMicHardwareBusy(): boolean {
  return isMicActive
}

export function setMicHardwareBusy(busy: boolean): void {
  isMicActive = busy
}

export function releaseMicHardwareLock(): void {
  isMicActive = false
}
