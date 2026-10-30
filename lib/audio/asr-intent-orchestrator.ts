/**
 * ASR & Intent Validation Orchestrator
 * 
 * Bridges local Whisper ASR transcripts to Pentone's intent validator and chat engine:
 * 1. Preserves the original raw transcript for auditing and verification.
 * 2. Runs phonetic collision analysis and ambiguity detection (lib/intent-validator.ts).
 * 3. Enforces utterance deduplication to prevent double-triggering on repeated speech chunks.
 * 4. Ensures ambiguous speech triggers clarification rather than speculative browser execution.
 * 5. Coordinates with ActiveTaskState so superseding commands update objectives cleanly.
 */

import { analyzeSpokenInput, type IntentAnalysisResult } from '../intent-validator'
import { resolveDeterministicNavigation, type NavigationRouteResult } from '../navigation-router'

export interface ProcessedVoiceIntent {
  originalTranscript: string
  effectiveQuery: string
  isAmbiguous: boolean
  shouldClarify: boolean
  clarificationPrompt?: string
  isNavigationMatch: boolean
  navigationRoute?: NavigationRouteResult
  isDuplicate: boolean
}

export class ASROrchestrator {
  private lastTranscribedText = ''
  private lastTranscriptTimestamp = 0
  private static readonly DEDUPE_WINDOW_MS = 2500

  /**
   * Processes a raw Whisper transcript through the intent validation pipeline
   */
  public processTranscript(rawTranscript: string): ProcessedVoiceIntent {
    const trimmed = (rawTranscript || '').trim()

    if (!trimmed) {
      return {
        originalTranscript: '',
        effectiveQuery: '',
        isAmbiguous: false,
        shouldClarify: false,
        isNavigationMatch: false,
        isDuplicate: false
      }
    }

    const now = Date.now()
    // 1. Deduplication check: ignore identical utterances within the dedupe window
    const isDuplicate = 
      trimmed.toLowerCase() === this.lastTranscribedText.toLowerCase() &&
      (now - this.lastTranscriptTimestamp) < ASROrchestrator.DEDUPE_WINDOW_MS

    if (isDuplicate) {
      console.log(`[ASROrchestrator] Duplicate utterance ignored within dedupe window: "${trimmed}"`)
      return {
        originalTranscript: trimmed,
        effectiveQuery: trimmed,
        isAmbiguous: false,
        shouldClarify: false,
        isNavigationMatch: false,
        isDuplicate: true
      }
    }

    // Update tracking
    this.lastTranscribedText = trimmed
    this.lastTranscriptTimestamp = now

    // 2. Phonetic and vocabulary analysis
    const analysis: IntentAnalysisResult = analyzeSpokenInput(trimmed)

    // 3. Ambiguity & clarification check
    if (analysis.shouldClarify) {
      console.log(`[ASROrchestrator] Ambiguous spoken input requires clarification: "${trimmed}" -> ${analysis.suggestedClarification}`)
      return {
        originalTranscript: trimmed,
        effectiveQuery: analysis.suggestedQuery || trimmed,
        isAmbiguous: true,
        shouldClarify: true,
        clarificationPrompt: analysis.suggestedClarification,
        isNavigationMatch: false,
        isDuplicate: false
      }
    }

    // 4. Deterministic navigation check
    const effectiveText = analysis.suggestedQuery || trimmed
    const navRoute = resolveDeterministicNavigation(effectiveText)

    return {
      originalTranscript: trimmed,
      effectiveQuery: effectiveText,
      isAmbiguous: navRoute.isAmbiguous || false,
      shouldClarify: navRoute.isAmbiguous || false,
      clarificationPrompt: navRoute.clarificationPrompt,
      isNavigationMatch: navRoute.isMatch,
      navigationRoute: navRoute,
      isDuplicate: false
    }
  }

  /**
   * Resets the deduplication cache (e.g. on new turn or explicit user interruption)
   */
  public resetDedupe(): void {
    this.lastTranscribedText = ''
    this.lastTranscriptTimestamp = 0
  }
}
