import test from 'node:test'
import assert from 'node:assert/strict'
import { WhisperASRService } from '../lib/audio/whisper-asr-service'

test('Suite G: ONNX & Whisper Session Lifecycle and Concurrency', async (t) => {

  await t.test('1. Shared initialization promise prevents duplicate model instances', async () => {
    let mockInitCount = 0

    // Override factory for deterministic testing
    WhisperASRService.pipelineFactoryOverride = async (modelId: string) => {
      mockInitCount++
      await new Promise(r => setTimeout(r, 40))
      return {
        transcribe: async () => ({ text: 'mock transcription' })
      }
    }

    const whisperA = WhisperASRService.getInstance()
    const whisperB = new WhisperASRService()

    // Launch concurrent initializations
    await Promise.all([
      whisperA.initialize('test-model-concurrency'),
      whisperB.initialize('test-model-concurrency'),
      whisperA.initialize('test-model-concurrency')
    ])

    assert.equal(mockInitCount, 1, 'Concurrent initializations must share single promise and instantiate once')
    assert.equal(whisperA.isReady(), true)
    assert.equal(whisperB.isReady(), true)

    WhisperASRService.pipelineFactoryOverride = null
  })

  await t.test('2. Reuses existing loaded session immediately on subsequent calls', async () => {
    let callCount = 0
    WhisperASRService.pipelineFactoryOverride = async (modelId: string) => {
      callCount++
      return { transcribe: async () => ({ text: 'mock' }) }
    }

    const whisper = WhisperASRService.getInstance()
    await whisper.initialize('test-reuse-model')
    assert.equal(callCount, 1)

    // Call initialize again with same model
    await whisper.initialize('test-reuse-model')
    assert.equal(callCount, 1, 'Must reuse pipeline without re-initialization')

    WhisperASRService.pipelineFactoryOverride = null
  })

  await t.test('3. Failed initialization clears promise allowing clean subsequent recovery', async () => {
    let attempts = 0
    WhisperASRService.pipelineFactoryOverride = async (modelId: string) => {
      attempts++
      if (attempts === 1) {
        throw new Error('Simulated WASM memory allocation failure')
      }
      return { transcribe: async () => ({ text: 'recovered' }) }
    }

    const whisper = new WhisperASRService()

    // Attempt 1 fails
    await assert.rejects(async () => {
      await whisper.initialize('fail-then-recover-model')
    }, /Failed to initialize Whisper ASR model/)

    assert.equal(whisper.isReady(), false)

    // Attempt 2 succeeds cleanly
    await whisper.initialize('fail-then-recover-model')
    assert.equal(whisper.isReady(), true)
    assert.equal(attempts, 2)

    WhisperASRService.pipelineFactoryOverride = null
  })
})
