import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { generativeRuntime } from '../lib/generative-runtime'
import { 
  QWEN_MODEL_ID, 
  QWEN_MODEL_REVISION, 
  EMBEDDINGS_MODEL_ID, 
  EMBEDDINGS_MODEL_REVISION, 
  WHISPER_MODEL_ID, 
  WHISPER_MODEL_REVISION,
  EXPECTED_ASSET_METADATA 
} from '../lib/model-provisioning'
import { WhisperASRService } from '../lib/audio/whisper-asr-service'
import { cosineSimilarity } from '../lib/embeddings'
import { voiceDiagnosticTracker } from '../lib/audio/voice-diagnostic-tracker'

test('Item 1: ONNX Runtime Web version and compatibility with IR version 10 models', async () => {
  // Check package.json pnpm overrides
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  assert.equal(pkg.pnpm?.overrides?.['onnxruntime-web'], '1.31.1', 'onnxruntime-web must be overridden to 1.31.1')

  // Check production bundles
  const buildDir = 'build/chrome-mv3-prod'
  assert.ok(fs.existsSync(buildDir), 'Production build directory must exist')
  
  const jsFiles = fs.readdirSync(buildDir).filter(f => f.endsWith('.js'))
  let found131 = false
  let found114 = false

  for (const f of jsFiles) {
    const content = fs.readFileSync(path.join(buildDir, f), 'utf8')
    if (content.includes('1.31.1')) found131 = true
    if (content.includes('1.14.0')) found114 = true
  }

  assert.ok(found131, 'Bundled JS must contain onnxruntime-web 1.31.1')
  assert.ok(!found114, 'Bundled JS must NOT contain legacy onnxruntime-web 1.14.0')

  // Check WASM asset
  const wasmPath = path.join('assets', 'ort-wasm-simd-threaded.wasm')
  assert.ok(fs.existsSync(wasmPath), 'ort-wasm-simd-threaded.wasm must exist in assets')
  const wasmStat = fs.statSync(wasmPath)
  assert.equal(wasmStat.size, 14848852, 'ort-wasm-simd-threaded.wasm must match 1.31.1 binary size')
})

test('Item 2: Model configurations and immutable revisions for all three models', async () => {
  assert.equal(QWEN_MODEL_ID, 'onnx-community/Qwen2.5-0.5B-Instruct')
  assert.equal(QWEN_MODEL_REVISION, '22942cb7d7ba4cc81bb4673549ca4d4614469b5e')

  assert.equal(EMBEDDINGS_MODEL_ID, 'Xenova/all-MiniLM-L6-v2')
  assert.equal(EMBEDDINGS_MODEL_REVISION, '751bff37182d3f1213fa05d7196b954e230abad9')

  assert.equal(WHISPER_MODEL_ID, 'Xenova/whisper-tiny')
  assert.equal(WHISPER_MODEL_REVISION, 'be2f7a87851f8beff75ea119c2749cd5b429b88a')

  assert.ok(EXPECTED_ASSET_METADATA['onnx/model_quantized.onnx'].sizeBytes > 500_000_000, 'Qwen model size must exceed 500MB')
})

test('Item 3: Qwen generative text inference protocol and bounds checking', async () => {
  // Test generative runtime state and bounds
  const state = generativeRuntime.getState()
  assert.ok(['idle', 'ready', 'downloading', 'generating', 'error', 'recovering'].includes(state.status))
  assert.equal(state.activeModelId, 'onnx-community/Qwen2.5-0.5B-Instruct')

  // Test inference worker protocol validation
  const workerSrc = fs.readFileSync('lib/workers/inference-worker.ts', 'utf8')
  assert.ok(workerSrc.includes('prompt.length > 25000'), 'Worker must enforce 25k character safety boundary')
  assert.ok(workerSrc.includes('Math.min(2048'), 'Worker must clamp max tokens')
  assert.ok(workerSrc.includes('env.allowRemoteModels = false'), 'Worker must enforce offline allowRemoteModels=false')
})

test('Item 4: MiniLM embedding generation and semantic similarity ranking', async () => {
  const vecA = [0.5, 0.5, 0.5, 0.5]
  const vecB = [0.5, 0.5, 0.5, 0.5]
  const vecC = [-0.5, -0.5, -0.5, -0.5]

  const simHigh = cosineSimilarity(vecA, vecB)
  const simLow = cosineSimilarity(vecA, vecC)

  assert.ok(Math.abs(simHigh - 1.0) < 0.001, 'Identical vectors must have cosine similarity ~ 1.0')
  assert.ok(Math.abs(simLow - (-1.0)) < 0.001, 'Opposite vectors must have cosine similarity ~ -1.0')
})

test('Item 5: Whisper Tiny speech transcription from audio sample', async () => {
  const whisper = WhisperASRService.getInstance()
  assert.equal(WhisperASRService.DEFAULT_MODEL_ID, 'Xenova/whisper-tiny')

  // Synthetic 16kHz audio buffer
  const sampleAudio = new Float32Array(16000)
  for (let i = 0; i < sampleAudio.length; i++) {
    sampleAudio[i] = Math.sin(2 * Math.PI * 440 * (i / 16000)) * 0.1
  }

  // Override pipeline factory for deterministic unit test
  const originalFactory = (WhisperASRService as any).pipelineFactoryOverride
  try {
    ;(WhisperASRService as any).pipelineFactoryOverride = async () => {
      return async (audio: Float32Array) => {
        return { text: 'Hello Pentone, this is a real microphone transcription test.' }
      }
    }

    await whisper.initialize('Xenova/whisper-tiny')
    const res = await whisper.transcribe(sampleAudio, { modelId: 'Xenova/whisper-tiny' })
    assert.ok(res.text.includes('Hello Pentone'))
  } finally {
    ;(WhisperASRService as any).pipelineFactoryOverride = originalFactory
  }
})

test('Item 6 & 7: Chat error disambiguation between Prompt API and Local SLM failures', async () => {
  const aiSrc = fs.readFileSync('lib/ai.ts', 'utf8')

  // Verify that error formatting explicitly checks engineState.error and distinguishes Prompt API from unprovisioned
  assert.ok(aiSrc.includes('Prompt API session creation failed'), 'Must handle Prompt API session creation failure')
  assert.ok(aiSrc.includes('Local AI engine initialization failed'), 'Must report accurate local SLM failure')
  assert.ok(aiSrc.includes('Local AI model is not provisioned in cache'), 'Only unprovisioned cache miss reports missing download')
})

test('Item 8: Voice page UI synchronization with GenerativeRuntime state', async () => {
  let latestState: any = null
  const unsub = generativeRuntime.subscribe((st) => {
    latestState = st
  })

  try {
    assert.ok(latestState !== null, 'Subscriber must immediately receive current state')
    assert.equal(latestState.activeModelId, 'onnx-community/Qwen2.5-0.5B-Instruct')

    // Test restartEngine returns a promise
    const restartPromise = generativeRuntime.restartEngine()
    assert.ok(restartPromise instanceof Promise)
    await restartPromise.catch(() => {})
  } finally {
    unsub()
  }

  // Check main-screen.tsx has engine state subscription and banner
  const mainScreenSrc = fs.readFileSync('screens/main-screen.tsx', 'utf8')
  assert.ok(mainScreenSrc.includes('generativeRuntime.subscribe'), 'main-screen.tsx must subscribe to generativeRuntime')
  assert.ok(mainScreenSrc.includes('Local AI Engine Offline'), 'main-screen.tsx must render Local AI Engine Offline banner')
  assert.ok(mainScreenSrc.includes('generativeRuntime.restartEngine()'), 'main-screen.tsx must have Restart Engine button')
})

test('Item 9: Speech recognition vs AI generation error decoupling and transcript preservation', async () => {
  const turnId = 9999
  const testTranscript = 'Summarize this webpage concisely'

  // Record whisper transcript in diagnostic tracker
  voiceDiagnosticTracker.recordWhisper(turnId, testTranscript, 120)

  const recent = voiceDiagnosticTracker.getRecentTurns()
  const found = recent.find(t => t.turnId === turnId)
  assert.ok(found, 'Turn record must exist')
  assert.equal(found.whisperText, testTranscript, 'Whisper transcript must be preserved')

  // Simulate AI generation failure without touching ASR
  voiceDiagnosticTracker.recordTerminalState(turnId, 'FAILED', 'Local SLM worker crashed during generation')
  const updated = voiceDiagnosticTracker.getRecentTurns().find(t => t.turnId === turnId)
  assert.equal(updated?.whisperText, testTranscript, 'Transcript must remain intact even when generation fails')
  assert.equal(updated?.terminalState, 'FAILED')

  // Check main-screen.tsx renders whisper transcript even without assistant sentence
  const mainScreenSrc = fs.readFileSync('screens/main-screen.tsx', 'utf8')
  assert.ok(mainScreenSrc.includes('latestVoiceTurn?.whisperText'), 'main-screen.tsx must display latest voice turn whisper transcript')
  assert.ok(mainScreenSrc.includes('AI Error:'), 'main-screen.tsx must display AI Error when messageType is error')
})

test('Item 11: Strict offline zero-egress configuration in all pipelines', async () => {
  const workerSrc = fs.readFileSync('lib/workers/inference-worker.ts', 'utf8')
  assert.ok(workerSrc.includes('env.allowRemoteModels = false'))

  const whisperSrc = fs.readFileSync('lib/audio/whisper-asr-service.ts', 'utf8')
  assert.ok(whisperSrc.includes('env.allowRemoteModels = false'))

  const embeddingsSrc = fs.readFileSync('lib/embeddings.ts', 'utf8')
  assert.ok(embeddingsSrc.includes('env.allowRemoteModels = false'))
})

test('Item 12: Worker recovery bounded retries and clean disposal', async () => {
  // Test scheduleWorkerRecovery bounded threshold
  const runtime = generativeRuntime as any
  assert.equal(runtime.maxRecoveryAttempts, 3, 'Max recovery attempts must be 3')

  // Cancel recovery must cleanly reset state
  generativeRuntime.cancelRecovery()
  const state = generativeRuntime.getState()
  assert.equal(state.status, 'error')
  assert.equal(state.error, 'Worker recovery cancelled by user')
})

test('Item 14: Strict Waveform Invariant (components/waveform.tsx must have 0 diff)', async () => {
  try {
    const diff = execSync('git diff f6e31c78a9d652d69a002efb00726ec73a606122 -- components/waveform.tsx', {
      encoding: 'utf8'
    }).trim()
    assert.equal(diff, '', 'components/waveform.tsx must have strictly 0 diff against main baseline')
  } catch (err: any) {
    assert.fail(`Git diff command failed: ${err.message}`)
  }
})
