/**
 * Wake-Word Activation Manager
 * 
 * Provides an optional, gated intentional activation window triggered by a wake phrase
 * (e.g., "Hey Marionette" or "Pentone").
 * 
 * CRITICAL SECURITY INVARIANTS:
 * 1. A wake-word detection DOES NOT automatically authorize browser actions.
 * 2. It merely opens an intentional, time-bounded command-capture window (5 seconds).
 * 3. Commands must be captured only after a valid activation event.
 * 4. False wake-word detections do NOT execute any action unless a valid subsequent command
 *    is explicitly received within the window.
 * 5. Wake-word mode is strictly optional and NOT the default (Push-to-Talk is the default).
 */

export interface WakeWordCheckResult {
  readonly detected: boolean;
  readonly windowOpened: boolean;
  readonly expiresAt: number;
  readonly remainingCommand?: string;
  readonly detectedPhrase?: string;
}

export class WakeWordActivationManager {
  private static instance: WakeWordActivationManager | null = null;
  private readonly windowDurationMs = 5000; // 5-second capture window
  private windowExpiresAt = 0;
  private lastActivationTurnId: number | null = null;

  // Recognizable wake phrases (case-insensitive)
  private readonly wakePhrases = [
    'hey marionette',
    'marionette',
    'hey pentone',
    'pentone',
    'ok pentone',
    'ok marionette',
  ];

  public static getInstance(): WakeWordActivationManager {
    if (!WakeWordActivationManager.instance) {
      WakeWordActivationManager.instance = new WakeWordActivationManager();
    }
    return WakeWordActivationManager.instance;
  }

  /**
   * Evaluates a transcript to check if it contains a wake phrase.
   * If detected, opens the intentional command-capture window.
   */
  public evaluateTranscript(transcript: string, turnId: number, currentTime?: number): WakeWordCheckResult {
    const now = currentTime ?? Date.now();
    const clean = (transcript || '').toLowerCase().trim();

    if (!clean) {
      return { detected: false, windowOpened: false, expiresAt: this.windowExpiresAt };
    }

    for (const phrase of this.wakePhrases) {
      if (clean === phrase) {
        this.windowExpiresAt = now + this.windowDurationMs;
        this.lastActivationTurnId = turnId;
        return {
          detected: true,
          windowOpened: true,
          expiresAt: this.windowExpiresAt,
          detectedPhrase: phrase,
        };
      }

      // Prefix match: "hey marionette open youtube"
      if (clean.startsWith(phrase + ' ') || clean.startsWith(phrase + ',') || clean.startsWith(phrase + '.')) {
        this.windowExpiresAt = now + this.windowDurationMs;
        this.lastActivationTurnId = turnId;
        const remainder = clean.substring(phrase.length).replace(/^[,\.\s]+/, '').trim();
        return {
          detected: true,
          windowOpened: true,
          expiresAt: this.windowExpiresAt,
          remainingCommand: remainder.length > 0 ? remainder : undefined,
          detectedPhrase: phrase,
        };
      }
    }

    return {
      detected: false,
      windowOpened: false,
      expiresAt: this.windowExpiresAt,
    };
  }

  /**
   * Returns true if the intentional command window is currently active.
   */
  public isWindowActive(currentTime?: number): boolean {
    const now = currentTime ?? Date.now();
    return now < this.windowExpiresAt;
  }

  /**
   * Closes the window immediately (e.g. on command completion, cancellation, or user interrupt).
   */
  public closeWindow(): void {
    this.windowExpiresAt = 0;
    this.lastActivationTurnId = null;
  }

  /**
   * Returns remaining window duration in milliseconds.
   */
  public getTimeRemainingMs(currentTime?: number): number {
    const now = currentTime ?? Date.now();
    return Math.max(0, this.windowExpiresAt - now);
  }

  public getLastActivationTurnId(): number | null {
    return this.lastActivationTurnId;
  }
}

export const wakeWordActivationManager = WakeWordActivationManager.getInstance();
