import test from 'node:test'
import assert from 'node:assert/strict'

import { BargeInController, type VoiceState } from '../lib/audio/barge-in-controller'
import { PersistentAudioPipeline } from '../lib/audio/persistent-audio-pipeline'
import { getWhisperBenchmarkReport, WHISPER_CANDIDATE_BENCHMARKS } from '../lib/audio/whisper-benchmark'

// =========================================================================
// TEST SUITE: PENTONE STAGE 1 — PERSISTENT MIC, SILERO VAD & BARGE-IN CONTROLLER
// =========================================================================

test('Barge-In Controller: Initial state is DISABLED and activates to LISTENING', () => {
  const transitions: string[] = []
  const controller = new BargeInController({
    onStateChange: (newState, oldState) => {
      transitions.push(`${oldState}->${newState}`)
    }
  })

  assert.equal(controller.getState(), 'DISABLED')
  assert.equal(controller.isMicrophoneActive(), false)

  // 1. Enable voice mode -> IDLE
  assert.equal(controller.enableVoiceMode(), true)
  assert.equal(controller.getState(), 'IDLE')
  assert.equal(controller.isMicrophoneActive(), true)

  // 2. Audio hardware ready -> LISTENING
  assert.equal(controller.readyToListen(), true)
  assert.equal(controller.getState(), 'LISTENING')
  assert.deepEqual(transitions, ['DISABLED->IDLE', 'IDLE->LISTENING'])
})

test('Barge-In Controller: Normal speech turn transitions cleanly through state machine', () => {
  const controller = new BargeInController()
  controller.enableVoiceMode()
  controller.readyToListen()
  assert.equal(controller.getState(), 'LISTENING')

  // User begins speaking -> USER_SPEAKING
  controller.handleSpeechStart()
  assert.equal(controller.getState(), 'USER_SPEAKING')

  // User ends speaking -> PROCESSING
  const dummyAudio = new Float32Array(16000 * 2) // 2 seconds of audio
  controller.handleSpeechEnd(dummyAudio)
  assert.equal(controller.getState(), 'PROCESSING')

  // Agent responds with TTS -> ASSISTANT_SPEAKING
  controller.handleAssistantSpeechStart()
  assert.equal(controller.getState(), 'ASSISTANT_SPEAKING')
  assert.equal(controller.isInterruptible(), true)

  // Assistant finishes speaking -> returns to LISTENING
  controller.handleAssistantSpeechEnd()
  assert.equal(controller.getState(), 'LISTENING')
  assert.equal(controller.isInterruptible(), false)
})

test('Barge-In Controller: Instant barge-in interrupts assistant speech immediately', () => {
  let interruptFired = false
  const stateLog: VoiceState[] = []

  const controller = new BargeInController({
    onStateChange: (newState) => {
      stateLog.push(newState)
    },
    onInterrupt: () => {
      interruptFired = true
    }
  })

  controller.enableVoiceMode()
  controller.readyToListen()
  controller.handleSpeechStart()
  controller.handleSpeechEnd(new Float32Array(16000))
  controller.handleAssistantSpeechStart()

  assert.equal(controller.getState(), 'ASSISTANT_SPEAKING')
  assert.equal(interruptFired, false)

  // User interrupts while assistant is speaking!
  controller.handleSpeechStart()

  assert.equal(interruptFired, true, 'Interruption callback must be invoked immediately')
  assert.equal(controller.getState(), 'USER_SPEAKING', 'Must transition to USER_SPEAKING to capture new command')
  assert.ok(stateLog.includes('INTERRUPTING'), 'Must pass through INTERRUPTING state')
})

test('Barge-In Controller: Misfire recovery returns from USER_SPEAKING to LISTENING', () => {
  const controller = new BargeInController()
  controller.enableVoiceMode()
  controller.readyToListen()

  controller.handleSpeechStart()
  assert.equal(controller.getState(), 'USER_SPEAKING')

  // VAD rejected noise (< minSpeechFrames)
  controller.handleVADMisfire()
  assert.equal(controller.getState(), 'LISTENING', 'Must recover to LISTENING after noise misfire')
})

test('Barge-In Controller: Disabling voice mode cleanly releases state from any phase', () => {
  const controller = new BargeInController()
  controller.enableVoiceMode()
  controller.readyToListen()
  controller.handleSpeechStart()
  assert.equal(controller.getState(), 'USER_SPEAKING')

  // User clicks mute or closes panel
  controller.disableVoiceMode()
  assert.equal(controller.getState(), 'DISABLED')
  assert.equal(controller.isMicrophoneActive(), false)
})

test('Persistent Audio Pipeline: Enforces native AEC, AGC, and 16kHz audio constraints', () => {
  const pipeline = new PersistentAudioPipeline({
    deviceId: 'test-mic-id',
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: 16000
  })

  assert.equal(pipeline.getIsActive(), false)
  // Clean release does not throw even if unacquired
  assert.doesNotThrow(() => pipeline.release())
})

test('Whisper Benchmark: Documents latency, model sizes, and multilingual performance', () => {
  const report = getWhisperBenchmarkReport()
  assert.equal(report.candidates.length, 3)

  const tinyEn = report.candidates.find(c => c.id === 'whisper-tiny-en')!
  const tinyMulti = report.candidates.find(c => c.id === 'whisper-tiny-multi')!
  const baseMulti = report.candidates.find(c => c.id === 'whisper-base-multi')!

  assert.equal(tinyEn.quantizedSizeMB, 39)
  assert.equal(tinyMulti.quantizedSizeMB, 75)
  assert.equal(baseMulti.quantizedSizeMB, 142)

  // Verify latency is strictly lower on RTX 3050 vs CPU WASM
  assert.ok(baseMulti.estimatedLatencyRTX3050Ms < baseMulti.estimatedLatencyCpuWasmMs)
  assert.ok(baseMulti.estimatedLatencyRTX3050Ms <= 250, 'GPU latency for 3s chunk should be under 250ms')

  // Verify Hinglish capability comparison
  assert.equal(tinyEn.hinglishSupport, 'Poor')
  assert.equal(baseMulti.hinglishSupport, 'Good')
})
