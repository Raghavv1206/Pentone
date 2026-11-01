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
  isNoiseOrHallucination?: boolean
  isSelfHearingEcho?: boolean
}

export interface ProcessTranscriptOptions {
  recentAssistantUtterances?: string[]
  isAudibleTabActive?: boolean
}

export class ASROrchestrator {
  private lastTranscribedText = ''
  private lastTranscriptTimestamp = 0
  private static readonly DEDUPE_WINDOW_MS = 2500

  /**
   * Detects acoustic self-hearing echo where assistant TTS output bleeds into the microphone
   */
  public isSelfHearingEcho(transcript: string, recentAssistantUtterances?: string[]): boolean {
    if (!transcript || !recentAssistantUtterances || recentAssistantUtterances.length === 0) {
      return false
    }

    const cleanInput = transcript.toLowerCase().replace(/[.,!?;:'"()[\]{}]/g, '').trim()
    if (!cleanInput) return false

    const inputWords = cleanInput.split(/\s+/).filter(w => w.length > 1)
    if (inputWords.length === 0) return false

    for (const rawAssistant of recentAssistantUtterances) {
      const cleanAssistant = (rawAssistant || '').toLowerCase().replace(/[.,!?;:'"()[\]{}]/g, '').trim()
      if (!cleanAssistant) continue

      // 1. Direct inclusion
      if (cleanAssistant.includes(cleanInput) || cleanInput.includes(cleanAssistant)) {
        return true
      }

      // 2. Token overlap (Jaccard similarity on non-trivial words)
      const assistantWords = new Set(cleanAssistant.split(/\s+/).filter(w => w.length > 1))
      let matchCount = 0
      for (const w of inputWords) {
        if (assistantWords.has(w)) {
          matchCount++
        }
      }

      const overlapRatio = matchCount / inputWords.length
      if (overlapRatio >= 0.50 && matchCount >= 2) {
        return true
      }

      if (inputWords.length >= 3 && matchCount >= 3) {
        return true
      }
    }

    return false
  }

  /**
   * Identifies background noise, repetitive token loops, and Whisper hallucination artifacts
   */
  public isHallucinationOrNoise(text: string): boolean {
    const raw = (text || '').trim()
    if (!raw) return true

    // 1. Pure punctuation, symbols, or music notes
    if (!/[a-zA-Z0-9]/.test(raw)) return true
    if (/^[♪♫♬♩\s]+$/.test(raw)) return true

    // 2. Transcribed acoustic tags: e.g. [Music], (Applause), [Laughter], [Silence]
    if (/^(\[|\()(music|applause|laughter|silence|singing|cheering|noise|groan|cough|throat-clearing)(\]|\))$/i.test(raw)) {
      return true
    }

    // 3. Standalone isolated single consonant (mic pops / clicks)
    if (/^[bcdfghjklmnpqrstvwxyz][.!?]?$/i.test(raw)) {
      return true
    }

    const clean = raw.toLowerCase().replace(/[.,!?;:'"()[\]{}]/g, '').trim()

    // 4. Known Whisper silence/noise hallucination phrases
    const hallucinationPhrases = [
      'thank you',
      'thank you very much',
      'thank you so much',
      'thanks for watching',
      'thank you for watching',
      'subtitles by',
      'subtitles by the amaraorg community',
      'translated by',
      'transcribed by',
      'see you next time',
      'see you in the next video',
      'like and subscribe',
      'please subscribe',
      'please like and subscribe',
      'dont forget to subscribe',
      'dont forget to like and subscribe',
      'mbc',
      'sbs',
      'kbs'
    ]

    if (hallucinationPhrases.includes(clean)) {
      return true
    }

    // Subtitle attribution prefix
    if (clean.startsWith('subtitles by') || clean.startsWith('translated by') || clean.startsWith('transcribed by')) {
      return true
    }

    // 5. Repetitive degenerative loop detection: e.g. "you you you you", "the the the"
    const words = clean.split(/\s+/)
    if (words.length >= 3) {
      const firstWord = words[0]
      if (words.every(w => w === firstWord)) {
        return true
      }
    }
    if (words.length >= 6) {
      const pair = `${words[0]} ${words[1]}`
      let isAllPair = true
      for (let i = 0; i < words.length - 1; i += 2) {
        if (`${words[i]} ${words[i + 1]}` !== pair) {
          isAllPair = false
          break
        }
      }
      if (isAllPair) return true
    }

    return false
  }

  /**
   * Processes a raw Whisper transcript through the intent validation pipeline
   */
  public processTranscript(rawTranscript: string, options?: ProcessTranscriptOptions): ProcessedVoiceIntent {
    const trimmed = (rawTranscript || '').trim()

    // 1. Acoustic Self-Hearing Echo check: drop assistant TTS bleed captured by microphone
    if (this.isSelfHearingEcho(trimmed, options?.recentAssistantUtterances)) {
      console.log(`[ASROrchestrator] Filtered acoustic self-hearing echo of assistant speech: "${trimmed}"`)
      return {
        originalTranscript: trimmed,
        effectiveQuery: '',
        isAmbiguous: false,
        shouldClarify: false,
        isNavigationMatch: false,
        isDuplicate: false,
        isNoiseOrHallucination: true,
        isSelfHearingEcho: true
      }
    }

    if (!trimmed || this.isHallucinationOrNoise(trimmed)) {
      if (trimmed) {
        console.log(`[ASROrchestrator] Noise artifact or Whisper hallucination filtered: "${trimmed}"`)
      }
      return {
        originalTranscript: trimmed,
        effectiveQuery: '',
        isAmbiguous: false,
        shouldClarify: false,
        isNavigationMatch: false,
        isDuplicate: false,
        isNoiseOrHallucination: true
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
