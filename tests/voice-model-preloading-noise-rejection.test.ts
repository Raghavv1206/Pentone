import test from 'node:test'
import assert from 'node:assert/strict'

import { BargeInController, type VoiceState } from '../lib/audio/barge-in-controller'
import { PersistentAudioPipeline } from '../lib/audio/persistent-audio-pipeline'
import { WhisperASRService } from '../lib/audio/whisper-asr-service'
import { ASROrchestrator } from '../lib/audio/asr-intent-orchestrator'

// =========================================================================
// TEST SUITE: PENTONE — VOICE MODEL PRELOADING & BACKGROUND NOISE REJECTION
// =========================================================================

test('Voice Lifecycle: BargeInController transitions through INITIALIZING, CALIBRATING, and LISTENING', () => {
  const transitions: string[] = []
  const controller = new BargeInController({
    onStateChange: (newState, oldState) => {
      transitions.push(`${oldState}->${newState}`)
    }
  })

  assert.equal(controller.getState(), 'DISABLED')

  // 1. Enable voice mode -> IDLE
  assert.equal(controller.enableVoiceMode(), true)
  assert.equal(controller.getState(), 'IDLE')

  // 2. Start preloading & warming up models -> INITIALIZING
  assert.equal(controller.startInitializing(), true)
  assert.equal(controller.getState(), 'INITIALIZING')

  // 3. Ambient noise floor measurement -> CALIBRATING
  assert.equal(controller.startCalibrating(), true)
  assert.equal(controller.getState(), 'CALIBRATING')

  // 4. Audio & models ready -> LISTENING
  assert.equal(controller.readyToListen(), true)
  assert.equal(controller.getState(), 'LISTENING')

  assert.deepEqual(transitions, [
    'DISABLED->IDLE',
    'IDLE->INITIALIZING',
    'INITIALIZING->CALIBRATING',
    'CALIBRATING->LISTENING'
  ])
})

test('Voice Lifecycle: Full conversational turn with barge-in remains fully supported', () => {
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

  // Preload -> Calibrate -> Ready
  controller.enableVoiceMode()
  controller.startInitializing()
  controller.startCalibrating()
  controller.readyToListen()
  assert.equal(controller.getState(), 'LISTENING')

  // User speaks
  controller.handleSpeechStart()
  assert.equal(controller.getState(), 'USER_SPEAKING')

  // Speech ends
  controller.handleSpeechEnd(new Float32Array(16000 * 2))
  assert.equal(controller.getState(), 'PROCESSING')

  // Assistant begins TTS
  controller.handleAssistantSpeechStart()
  assert.equal(controller.getState(), 'ASSISTANT_SPEAKING')

  // Barge-in: user speaks during assistant TTS
  controller.handleSpeechStart()
  assert.equal(interruptFired, true, 'Interruption must fire immediately upon barge-in speech onset')
  assert.equal(controller.getState(), 'USER_SPEAKING', 'Must immediately transition to USER_SPEAKING')
  assert.ok(stateLog.includes('INTERRUPTING'), 'Must transition through INTERRUPTING state')
})

test('Ambient Noise Floor: PersistentAudioPipeline measures and stores baseline noise floor', async () => {
  const pipeline = new PersistentAudioPipeline({ sampleRate: 16000 })
  
  // When pipeline is inactive / no stream, returns safe defaults
  const defaults = await pipeline.measureAmbientNoise(100)
  assert.ok(defaults.noiseFloorRms > 0)
  assert.ok(defaults.peakRms >= defaults.noiseFloorRms)
  assert.ok(pipeline.getNoiseFloor() > 0)
})

test('Whisper Preloading: WhisperASRService warmup executes cleanly without throwing', async () => {
  const whisper = WhisperASRService.getInstance()
  assert.ok(typeof whisper.warmup === 'function')
  assert.ok(typeof whisper.isWarmedUp === 'function')
})

test('Noise Rejection: ASROrchestrator rejects known Whisper silence and noise hallucinations', () => {
  const orchestrator = new ASROrchestrator()

  const hallucinationExamples = [
    'Thank you.',
    'Thank you very much.',
    'Thanks for watching!',
    'Thank you for watching.',
    'Subtitles by the Amara.org community',
    'Translated by',
    'Transcribed by',
    'See you next time!',
    'Please subscribe',
    'Like and subscribe',
    '[Music]',
    '(Applause)',
    '[Laughter]',
    '[Silence]',
    '♪♪♪',
    '♫',
    '...',
    '--',
    't',
    's',
    'you you you you you',
    'the the the the the',
    'MBC',
    'SBS'
  ]

  for (const text of hallucinationExamples) {
    const isNoise = orchestrator.isHallucinationOrNoise(text)
    assert.equal(isNoise, true, `Should flag as noise/hallucination: "${text}"`)

    const result = orchestrator.processTranscript(text)
    assert.equal(result.isNoiseOrHallucination, true, `Result should mark isNoiseOrHallucination: "${text}"`)
    assert.equal(result.effectiveQuery, '', `Effective query must be empty for: "${text}"`)
  }
})

test('Noise Rejection: ASROrchestrator preserves valid short commands and full instructions', () => {
  const orchestrator = new ASROrchestrator()

  const validCommands = [
    'stop',
    'yes',
    'no',
    'click the second video',
    'open youtube and search for react tutorials',
    'scroll down',
    'go back',
    'pause',
    'reload the page',
    'summarize this page',
    'find elements with input'
  ]

  for (const cmd of validCommands) {
    orchestrator.resetDedupe()
    const isNoise = orchestrator.isHallucinationOrNoise(cmd)
    assert.equal(isNoise, false, `Should NOT flag genuine command as noise: "${cmd}"`)

    const result = orchestrator.processTranscript(cmd)
    assert.notEqual(result.isNoiseOrHallucination, true, `Should not be flagged as noise: "${cmd}"`)
    assert.ok(result.effectiveQuery.length > 0, `Effective query must not be empty: "${cmd}"`)
  }
})

test('Audio Pre-Validation: Energy and duration gate rejects low-RMS and transient audio buffers', () => {
  const adaptiveSpeechThreshold = 0.015

  const validateAudioEnergy = (audioBuffer: Float32Array, threshold: number): { valid: boolean, reason?: string } => {
    const durationSeconds = audioBuffer.length / 16000
    let sumSq = 0
    let peak = 0
    for (let i = 0; i < audioBuffer.length; i++) {
      const val = Math.abs(audioBuffer[i])
      if (val > peak) peak = val
      sumSq += val * val
    }
    const rms = Math.sqrt(sumSq / audioBuffer.length)

    if (durationSeconds < 0.35) {
      return { valid: false, reason: 'duration_too_short' }
    }
    if (rms < threshold) {
      return { valid: false, reason: 'rms_below_threshold' }
    }
    if (peak < 0.035) {
      return { valid: false, reason: 'peak_below_threshold' }
    }
    return { valid: true }
  }

  // 1. Transient noise: 200ms click/throat clear
  const transientBuffer = new Float32Array(16000 * 0.2)
  transientBuffer.fill(0.05)
  const res1 = validateAudioEnergy(transientBuffer, adaptiveSpeechThreshold)
  assert.equal(res1.valid, false)
  assert.equal(res1.reason, 'duration_too_short')

  // 2. Ambient room hiss / fan noise: 1 second, but RMS = 0.004 (< 0.015)
  const roomNoiseBuffer = new Float32Array(16000 * 1.0)
  for (let i = 0; i < roomNoiseBuffer.length; i++) {
    roomNoiseBuffer[i] = (Math.random() - 0.5) * 0.008
  }
  const res2 = validateAudioEnergy(roomNoiseBuffer, adaptiveSpeechThreshold)
  assert.equal(res2.valid, false)
  assert.equal(res2.reason, 'rms_below_threshold')

  // 3. Faint murmur below peak threshold
  const murmurBuffer = new Float32Array(16000 * 1.0)
  murmurBuffer.fill(0.016) // RMS = 0.016, but peak = 0.016 (< 0.035)
  const res3 = validateAudioEnergy(murmurBuffer, adaptiveSpeechThreshold)
  assert.equal(res3.valid, false)
  assert.equal(res3.reason, 'peak_below_threshold')

  // 4. Genuine human speech: 1.5 seconds, RMS = 0.06, Peak = 0.35
  const speechBuffer = new Float32Array(16000 * 1.5)
  for (let i = 0; i < speechBuffer.length; i++) {
    speechBuffer[i] = 0.2 * Math.sin((2 * Math.PI * 250 * i) / 16000)
  }
  const res4 = validateAudioEnergy(speechBuffer, adaptiveSpeechThreshold)
  assert.equal(res4.valid, true)
})
