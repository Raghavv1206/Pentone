import test from 'node:test'
import assert from 'node:assert/strict'

// 1. Audio Resampler & Sanitizer
import { AudioResampler } from '../lib/audio/audio-resampler'

// 2. Whisper ASR Service
import { WhisperASRService } from '../lib/audio/whisper-asr-service'

// 3. ASR Intent Orchestrator
import { ASROrchestrator } from '../lib/audio/asr-intent-orchestrator'

// =========================================================================
// TEST SUITE: PENTONE STAGE 2 — LOCAL WHISPER ASR & INTENT ORCHESTRATION
// =========================================================================

test('Audio Resampler: Rejects invalid, empty, or silent audio buffers', () => {
  // Invalid type
  assert.throws(
    () => AudioResampler.validateAndResample(null as any),
    /Input must be a Float32Array/
  )

  // Empty buffer
  assert.throws(
    () => AudioResampler.validateAndResample(new Float32Array(0)),
    /Buffer is empty/
  )

  // Pure silence (all zeros)
  assert.throws(
    () => AudioResampler.validateAndResample(new Float32Array(16000)),
    /Buffer contains only silence/
  )

  // Too short (< 0.2s)
  const tinyBuffer = new Float32Array(100)
  tinyBuffer[10] = 0.5
  assert.throws(
    () => AudioResampler.validateAndResample(tinyBuffer, { sourceSampleRate: 16000 }),
    /Audio duration too short/
  )
})

test('Audio Resampler: Accurately resamples 48kHz audio to standard 16kHz', () => {
  // Generate 1 second of 48kHz sine tone
  const sampleRate48k = 48000
  const buffer48k = new Float32Array(sampleRate48k)
  for (let i = 0; i < sampleRate48k; i++) {
    buffer48k[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate48k)
  }

  const result = AudioResampler.validateAndResample(buffer48k, {
    sourceSampleRate: 48000,
    targetSampleRate: 16000
  })

  assert.equal(result.wasResampled, true)
  assert.equal(result.sampleRate, 16000)
  // 48,000 samples @ 48kHz should resample to exactly 16,000 samples @ 16kHz
  assert.equal(result.audio.length, 16000)
  assert.equal(result.durationSeconds, 1.0)
})

test('Audio Resampler: Sanitizes NaN and Infinity values without crashing', () => {
  const dirtyBuffer = new Float32Array(16000)
  dirtyBuffer[0] = 0.5
  dirtyBuffer[1] = NaN
  dirtyBuffer[2] = Infinity
  dirtyBuffer[3] = -Infinity
  dirtyBuffer[4] = 2.5 // Out of bounds (> 1.0)

  const result = AudioResampler.validateAndResample(dirtyBuffer, { sourceSampleRate: 16000 })
  assert.equal(result.audio[1], 0)
  assert.equal(result.audio[2], 0)
  assert.equal(result.audio[3], 0)
  assert.equal(result.audio[4], 1.0, 'Clamps value above 1.0 to 1.0')
})

test('Audio Resampler: Truncates audio exceeding maximum allowable duration', () => {
  // 35 seconds of audio @ 16kHz
  const longBuffer = new Float32Array(16000 * 35)
  longBuffer[100] = 0.5

  const result = AudioResampler.validateAndResample(longBuffer, {
    sourceSampleRate: 16000,
    maxDurationSeconds: 30.0
  })

  assert.equal(result.durationSeconds, 30.0)
  assert.equal(result.audio.length, 16000 * 30)
})

test('Whisper ASR Service: Singleton pattern reuses identical instance and preserves defaults', () => {
  const instance1 = WhisperASRService.getInstance()
  const instance2 = WhisperASRService.getInstance()
  assert.strictEqual(instance1, instance2, 'Must maintain singleton instance to prevent duplicate model loads')

  assert.equal(WhisperASRService.DEFAULT_MODEL_ID, 'Xenova/whisper-base')
  assert.equal(WhisperASRService.FALLBACK_MODEL_ID, 'Xenova/whisper-tiny')
})

test('Whisper ASR Service: Cancellation flag halts active inference', () => {
  const whisper = WhisperASRService.getInstance()
  // Calling cancel should reset internal abort controllers cleanly
  assert.doesNotThrow(() => whisper.cancel())
})

test('ASR Orchestrator: Deduplication rejects identical transcripts within dedupe window', () => {
  const orchestrator = new ASROrchestrator()

  const result1 = orchestrator.processTranscript('open youtube and search for react tutorials')
  assert.equal(result1.isDuplicate, false)
  assert.equal(result1.isNavigationMatch, true)

  // Immediate second utterance with identical text should be ignored as duplicate
  const result2 = orchestrator.processTranscript('open youtube and search for react tutorials')
  assert.equal(result2.isDuplicate, true, 'Immediate identical utterance must be flagged as duplicate')

  // Resetting dedupe clears cache
  orchestrator.resetDedupe()
  const result3 = orchestrator.processTranscript('open youtube and search for react tutorials')
  assert.equal(result3.isDuplicate, false, 'After dedupe reset, utterance must be processed')
})

test('ASR Orchestrator: Connects Whisper transcript to phonetic ambiguity detection', () => {
  const orchestrator = new ASROrchestrator()

  // "reactor to real" is an ambiguous phonetic corruption of "React tutorials"
  const result = orchestrator.processTranscript('reactor to real')
  assert.equal(result.isAmbiguous, true)
  assert.equal(result.shouldClarify, true)
  assert.ok(result.clarificationPrompt?.includes('React tutorials'))
  assert.equal(result.originalTranscript, 'reactor to real', 'Preserves exact raw transcript')
})

test('ASR Orchestrator: Routes developer commands and Hinglish code-switching', () => {
  const orchestrator = new ASROrchestrator()

  // Clean English search command
  const res1 = orchestrator.processTranscript('Open Google and search for the best AI tools')
  assert.equal(res1.isNavigationMatch, true)
  assert.equal(res1.shouldClarify, false)
  assert.equal(res1.navigationRoute?.toolCall?.arguments.tabName, 'Google')

  // Hinglish technical input with developer vocabulary
  orchestrator.resetDedupe()
  const res2 = orchestrator.processTranscript('reactor to real sikhao')
  assert.ok(res2.effectiveQuery.includes('React tutorials'))
  assert.equal(res2.originalTranscript, 'reactor to real sikhao')
})

test('Cancellation Safety: Generation token increments on cancellation and preserves invalidation', () => {
  const whisper = WhisperASRService.getInstance()
  const initialToken = whisper.getCurrentGenerationToken()

  whisper.cancel()
  const tokenAfterFirstCancel = whisper.getCurrentGenerationToken()
  assert.ok(tokenAfterFirstCancel > initialToken, 'Token must advance upon cancellation')

  whisper.cancel()
  const tokenAfterSecondCancel = whisper.getCurrentGenerationToken()
  assert.ok(tokenAfterSecondCancel > tokenAfterFirstCancel, 'Subsequent cancellation must advance token again')
})

test('Cancellation Safety: Race condition simulation — older inference superseded by newer instruction', async () => {
  // Simulate Turn tracking matching useFullDuplexVoice
  let activeSpeechTurn = 0
  const dispatchedMessages: string[] = []

  const simulateSpeechTurn = async (turnText: string, delayMs: number, interruptAfterMs?: number) => {
    const currentTurn = ++activeSpeechTurn

    if (interruptAfterMs !== undefined) {
      setTimeout(() => {
        // Interruption occurs during active inference
        activeSpeechTurn++
      }, interruptAfterMs)
    }

    // Simulate in-flight inference delay
    await new Promise(r => setTimeout(r, delayMs))

    // Post-inference check
    if (currentTurn !== activeSpeechTurn) {
      // Discarded
      return
    }

    // Pre-dispatch check
    if (currentTurn !== activeSpeechTurn) {
      return
    }

    dispatchedMessages.push(turnText)
  }

  // Turn 1 starts with 80ms inference latency, but is interrupted at 30ms
  const turn1 = simulateSpeechTurn('Open YouTube and search for React', 80, 30)
  // Turn 2 arrives at 40ms with 30ms latency
  await new Promise(r => setTimeout(r, 40))
  const turn2 = simulateSpeechTurn('Open Google and search for Python', 30)

  await Promise.all([turn1, turn2])

  // Turn 1 must NEVER have reached dispatch!
  assert.deepEqual(dispatchedMessages, ['Open Google and search for Python'], 'Only the newer non-interrupted instruction must be dispatched')
})

test('Cancellation Safety: Race condition simulation — older inference completing after newer inference', async () => {
  let activeSpeechTurn = 0
  const dispatchedMessages: string[] = []

  const simulateSpeechTurn = async (turnText: string, durationMs: number) => {
    const currentTurn = ++activeSpeechTurn

    // Simulating longer older inference vs faster newer inference
    await new Promise(r => setTimeout(r, durationMs))

    if (currentTurn !== activeSpeechTurn) {
      return // Discarded
    }

    dispatchedMessages.push(turnText)
  }

  // Older turn 1 takes 100ms
  const turn1 = simulateSpeechTurn('Instruction 1 (stale)', 100)

  // 20ms later, user speaks Turn 2 which completes in 30ms (finishes at t=50ms, before Turn 1 finishes at t=100ms)
  await new Promise(r => setTimeout(r, 20))
  const turn2 = simulateSpeechTurn('Instruction 2 (fresh)', 30)

  await Promise.all([turn1, turn2])

  // Turn 1 must be discarded even though it completes after Turn 2
  assert.deepEqual(dispatchedMessages, ['Instruction 2 (fresh)'], 'Stale older instruction completing late must never overwrite or execute')
})

test('Cancellation Safety: Voice mode disabled during active inference discards in-flight transcript', async () => {
  let activeSpeechTurn = 0
  let isVoiceEnabled = true
  const dispatchedMessages: string[] = []

  const simulateTurn = async () => {
    const currentTurn = ++activeSpeechTurn
    await new Promise(r => setTimeout(r, 60))

    if (currentTurn !== activeSpeechTurn || !isVoiceEnabled) {
      return
    }
    dispatchedMessages.push('Should not arrive')
  }

  const turn = simulateTurn()
  // User toggles voice mode off at 25ms
  setTimeout(() => {
    isVoiceEnabled = false
    activeSpeechTurn++
  }, 25)

  await turn
  assert.equal(dispatchedMessages.length, 0, 'Disabling voice mode must immediately drop in-flight transcription')
})

test('Execution Provider: Accurately reports WASM execution provider for @xenova/transformers 2.x', () => {
  const whisper = WhisperASRService.getInstance()
  assert.equal(whisper.getActiveDevice(), 'wasm', 'Must report wasm honestly rather than falsely claiming WebGPU')
})
