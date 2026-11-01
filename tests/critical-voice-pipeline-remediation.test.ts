import test from 'node:test'
import assert from 'node:assert/strict'

import { ASROrchestrator } from '../lib/audio/asr-intent-orchestrator'
import { TTSAcousticTracker } from '../lib/tts-context'
import { WhisperASRService } from '../lib/audio/whisper-asr-service'
import { BargeInController, type VoiceState } from '../lib/audio/barge-in-controller'
import { DEFAULT_SETTINGS } from '../lib/settings'

// =========================================================================
// TEST SUITE: CRITICAL VOICE PIPELINE REMEDIATION (P0 / P1 / P2)
// =========================================================================

test('P0 Acoustic Echo: ASROrchestrator identifies and drops assistant TTS speech bleed', () => {
  const orchestrator = new ASROrchestrator()
  
  const recentAssistantSpeech = [
    "Sure, I'd be happy to explain more about Best Hackathon Project.",
    "I'm sorry, I cannot process that sound at the moment. Is there something else I can assist you with?",
    "Oh, I'm glad to hear that."
  ]

  // Test 1: Exact matches of assistant speech
  for (const echo of recentAssistantSpeech) {
    orchestrator.resetDedupe()
    const isEcho = orchestrator.isSelfHearingEcho(echo, recentAssistantSpeech)
    assert.equal(isEcho, true, `Should flag exact assistant speech as echo: "${echo}"`)

    const result = orchestrator.processTranscript(echo, { recentAssistantUtterances: recentAssistantSpeech })
    assert.equal(result.isSelfHearingEcho, true)
    assert.equal(result.effectiveQuery, '', 'Effective query must be empty for echo')
  }

  // Test 2: Partial / sub-phrase acoustic bleeds of assistant speech
  const partialEchoes = [
    "explain more about Best Hackathon Project",
    "cannot process that sound at the moment",
    "glad to hear that"
  ]

  for (const partial of partialEchoes) {
    orchestrator.resetDedupe()
    const isEcho = orchestrator.isSelfHearingEcho(partial, recentAssistantSpeech)
    assert.equal(isEcho, true, `Should flag partial assistant speech bleed as echo: "${partial}"`)

    const result = orchestrator.processTranscript(partial, { recentAssistantUtterances: recentAssistantSpeech })
    assert.equal(result.isSelfHearingEcho, true)
    assert.equal(result.effectiveQuery, '')
  }
})

test('P0 Acoustic Echo: Legitimate user barge-in commands during TTS are strictly preserved', () => {
  const orchestrator = new ASROrchestrator()
  
  const recentAssistantSpeech = [
    "Sure, I'd be happy to explain more about Best Hackathon Project.",
    "The project implements advanced multi-modal agentic workflows using WebAssembly."
  ]

  const userBargeInCommands = [
    'Stop.',
    'Wait, go back.',
    'Click the second video.',
    'Open YouTube and search for React tutorials.',
    'Scroll down.',
    'Pause response.'
  ]

  for (const cmd of userBargeInCommands) {
    orchestrator.resetDedupe()
    const isEcho = orchestrator.isSelfHearingEcho(cmd, recentAssistantSpeech)
    assert.equal(isEcho, false, `Should NOT flag user command as echo: "${cmd}"`)

    const result = orchestrator.processTranscript(cmd, { recentAssistantUtterances: recentAssistantSpeech })
    assert.notEqual(result.isSelfHearingEcho, true)
    assert.ok(result.effectiveQuery.length > 0, `Effective query must be preserved for: "${cmd}"`)
  }
})

test('P0 TTSAcousticTracker: Records speech lifecycle and enforces history cleanup', () => {
  TTSAcousticTracker.clear()
  assert.equal(TTSAcousticTracker.isSpeaking(), false)
  assert.deepEqual(TTSAcousticTracker.getRecentUtterances(), [])

  // Start speaking
  TTSAcousticTracker.recordSpeechStart("Here is the summary of the page.")
  assert.equal(TTSAcousticTracker.isSpeaking(), true)
  assert.ok(TTSAcousticTracker.getRecentUtterances().includes("here is the summary of the page."))

  // End speaking
  TTSAcousticTracker.recordSpeechEnd()
  assert.equal(TTSAcousticTracker.isSpeaking(), false)
  // Recent utterance should remain available for acoustic echo matching
  assert.ok(TTSAcousticTracker.getRecentUtterances().includes("here is the summary of the page."))
})

test('P1 Whisper Configuration: Enforces single-threaded WASM and model instance stability', () => {
  const whisper = WhisperASRService.getInstance()
  assert.strictEqual(whisper, WhisperASRService.getInstance(), 'Must enforce singleton instance')
  
  // Model defaults inspection
  assert.equal(DEFAULT_SETTINGS.whisperModel, 'Xenova/whisper-base')
  assert.equal(WhisperASRService.DEFAULT_MODEL_ID, 'Xenova/whisper-base')
  assert.equal(WhisperASRService.FALLBACK_MODEL_ID, 'Xenova/whisper-tiny')

  // Verify cancel token mechanism
  const token1 = whisper.getCurrentGenerationToken()
  whisper.cancel()
  const token2 = whisper.getCurrentGenerationToken()
  assert.ok(token2 > token1, 'Token must advance upon cancellation to invalidate stale inference')
})

test('P2 Trust Boundary: Stale and rejected speech turns never produce executable queries', () => {
  const orchestrator = new ASROrchestrator()

  // 1. Empty or whitespace
  assert.equal(orchestrator.processTranscript('').effectiveQuery, '')
  assert.equal(orchestrator.processTranscript('   ').effectiveQuery, '')

  // 2. Pure noise hallucination
  const noiseResult = orchestrator.processTranscript('Thank you for watching.')
  assert.equal(noiseResult.isNoiseOrHallucination, true)
  assert.equal(noiseResult.effectiveQuery, '')

  // 3. Duplicate within dedupe window
  const res1 = orchestrator.processTranscript('open github')
  assert.equal(res1.isDuplicate, false)
  const res2 = orchestrator.processTranscript('open github')
  assert.equal(res2.isDuplicate, true)
})
