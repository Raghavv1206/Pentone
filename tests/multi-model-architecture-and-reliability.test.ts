import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { capabilityRegistry } from '../lib/models/capability-registry'
import { modelRouter } from '../lib/models/model-router'
import { onlineProviderAdapter, OnlineProviderDisabledError, ConsentRequiredError } from '../lib/models/online-provider-adapter'
import { visionService } from '../lib/vision-service'
import { documentProcessor } from '../lib/document-processor'
import { isSupportedFileType } from '../lib/file-embedder'
import { WhisperASRService } from '../lib/audio/whisper-asr-service'
import { generativeRuntime } from '../lib/generative-runtime'
import { voiceDiagnosticTracker } from '../lib/audio/voice-diagnostic-tracker'

test('1. Capability Registry: Declarations, health states, and model isolation', async () => {
  const models = capabilityRegistry.getAllModels()
  assert.ok(models.length >= 7, 'Must register at least 7 distinct models/services')

  const qwen = capabilityRegistry.getModel('onnx-community/Qwen2.5-0.5B-Instruct')
  assert.ok(qwen, 'Qwen model must be registered')
  assert.deepEqual(qwen.capabilities, ['text-generation', 'reasoning', 'tool-planning'])

  const whisper = capabilityRegistry.getModel('Xenova/whisper-tiny')
  assert.ok(whisper, 'Whisper model must be registered')
  assert.deepEqual(whisper.capabilities, ['speech-recognition'])

  const vision = capabilityRegistry.getModel('pentone-vision-engine')
  assert.ok(vision, 'Vision model must be registered')
  assert.ok(vision.capabilities.includes('image-understanding'))

  // Health report must return granular status per capability
  const health = capabilityRegistry.getHealthReport()
  assert.ok(health['text-generation'], 'Must track text-generation capability')
  assert.ok(health['speech-recognition'], 'Must track speech-recognition capability')
  assert.ok(health['image-understanding'], 'Must track image-understanding capability')
  assert.ok(health['document-extraction'], 'Must track document-extraction capability')
  assert.ok(health['embeddings'], 'Must track embeddings capability')

  // Test failure isolation: updating vision status does not alter whisper
  capabilityRegistry.updateModelStatus('pentone-vision-engine', 'error', 'Synthetic vision failure')
  const updatedHealth = capabilityRegistry.getHealthReport()
  assert.equal(updatedHealth['image-understanding'].status, 'error')
  assert.notEqual(updatedHealth['speech-recognition'].status, 'error')
})

test('2. Model Router: Task requirement analysis and capability-based routing', async () => {
  // Case A: Image input routes to image-understanding
  const imgRoute = modelRouter.resolveRoute({
    capabilities: ['image-understanding'],
    hasImage: true
  })
  assert.equal(imgRoute.capabilities[0], 'image-understanding')
  assert.equal(imgRoute.primaryModelId, 'pentone-vision-engine')

  // Case B: Audio input routes to Whisper
  const audioRoute = modelRouter.resolveRoute({
    capabilities: ['speech-recognition'],
    hasAudio: true
  })
  assert.equal(audioRoute.capabilities[0], 'speech-recognition')
  assert.equal(audioRoute.primaryModelId, 'Xenova/whisper-tiny')

  // Case C: Document input routes to document extractor
  const docRoute = modelRouter.resolveRoute({
    capabilities: ['document-extraction'],
    hasDocument: true
  })
  assert.equal(docRoute.capabilities[0], 'document-extraction')
  assert.equal(docRoute.primaryModelId, 'pentone-document-extractor')

  // Case D: Text reasoning routes to local Qwen SLM or Prompt API
  const textRoute = modelRouter.resolveRoute({
    capabilities: ['text-generation', 'reasoning']
  })
  assert.ok(['chrome-prompt-api', 'onnx-community/Qwen2.5-0.5B-Instruct'].includes(textRoute.primaryModelId))
})

test('3. Hybrid Online Adapter: Strict local-first security and consent enforcement', async () => {
  assert.equal(onlineProviderAdapter.isEnabled(), false, 'Online provider must be disabled by default')
  assert.equal(onlineProviderAdapter.isLocalOnly(), true, 'Must default to local-only mode')

  // Attempting to call online provider without enabling must throw OnlineProviderDisabledError
  await assert.rejects(
    async () => {
      await onlineProviderAdapter.generateText('test query', false)
    },
    OnlineProviderDisabledError,
    'Must throw OnlineProviderDisabledError when disabled'
  )

  // Updating config to enabled without user consent must throw ConsentRequiredError
  await onlineProviderAdapter.updateConfig({ enabled: true, localOnlyMode: false, apiKey: 'dummy-key' })
  await assert.rejects(
    async () => {
      await onlineProviderAdapter.generateText('test query', false)
    },
    ConsentRequiredError,
    'Must throw ConsentRequiredError when consent is false'
  )

  // With explicit consent, generation succeeds
  const res = await onlineProviderAdapter.generateText('hello online', true)
  assert.ok(res.includes('OPENAI'))

  // Reset to default secure state
  await onlineProviderAdapter.updateConfig({ enabled: false, localOnlyMode: true, apiKey: '' })
  assert.equal(onlineProviderAdapter.isEnabled(), false)
})

test('4. Vision Service: Local screenshot, UI element, and chart analysis', async () => {
  const dummyImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

  // Analyze general screenshot
  const report = await visionService.analyzeImage(dummyImage, { prompt: 'Analyze UI buttons and chart' })
  assert.ok(report.summary.includes('Visual analysis of image'))
  assert.ok(report.dimensions.width > 0)
  assert.ok(report.dimensions.height > 0)
  assert.equal(report.modelId, 'pentone-vision-engine')

  // Analyze chart specifically
  const chartReport = await visionService.analyzeImage(dummyImage, { mode: 'chart', prompt: 'Explain the sales graph' })
  assert.ok(chartReport.chartAnalysis, 'Must produce chart analysis')
  assert.equal(chartReport.chartAnalysis?.chartType, 'bar')
  assert.ok(chartReport.chartAnalysis?.detectedTrends.length > 0)

  // Format prompt context for conversational reasoning model
  const formatted = visionService.formatForPrompt(chartReport)
  assert.ok(formatted.includes('[ATTACHED IMAGE ANALYSIS]'))
  assert.ok(formatted.includes('Resolution:'))
  assert.ok(formatted.includes('Chart Type:'))
})

test('5. Document Processor: Extraction and chunking for PDF, DOCX, and PPTX', async () => {
  // Test plain text chunking algorithm
  const sampleLongText = 'Pentone offline AI assistant. '.repeat(100)
  const chunks = documentProcessor.chunkText(sampleLongText, 500, 100)
  assert.ok(chunks.length > 1, 'Must chunk long documents into multiple parts')
  assert.ok(chunks[0].length <= 500, 'Chunk must not exceed maximum size')

  // Test DOCX processor
  const dummyDocxFile = new File([new TextEncoder().encode('<w:document><w:t>Pentone Architecture Overview</w:t></w:document>')], 'overview.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  })
  const docxRes = await documentProcessor.processDOCX(dummyDocxFile)
  assert.equal(docxRes.fileType, 'docx')
  assert.ok(docxRes.fullText.includes('Pentone Architecture Overview'))

  // Test PPTX processor
  const dummyPptxFile = new File([new TextEncoder().encode('<p:presentation><a:t>Slide 1: Hybrid AI Assistant</a:t></p:presentation>')], 'deck.pptx', {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  })
  const pptxRes = await documentProcessor.processPPTX(dummyPptxFile)
  assert.equal(pptxRes.fileType, 'pptx')
  assert.ok(pptxRes.fullText.includes('Slide 1: Hybrid AI Assistant'))

  // Verify FileEmbedder recognizes .docx and .pptx
  assert.ok(isSupportedFileType('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'test.docx'))
  assert.ok(isSupportedFileType('application/vnd.openxmlformats-officedocument.presentationml.presentation', 'test.pptx'))
})

test('6. Production Asset Resolution & Offline Invariant', async () => {
  // Verify assets/ort-wasm-simd-threaded.wasm is 14.8MB
  const wasmFile = path.join('assets', 'ort-wasm-simd-threaded.wasm')
  assert.ok(fs.existsSync(wasmFile), 'ort-wasm-simd-threaded.wasm must exist in assets')
  assert.equal(fs.statSync(wasmFile).size, 14848852)

  // Verify jsep assets exist
  assert.ok(fs.existsSync(path.join('assets', 'ort-wasm-simd-threaded.jsep.wasm')), 'JSEP wasm must exist')
  assert.ok(fs.existsSync(path.join('assets', 'ort-wasm-simd-threaded.jsep.mjs')), 'JSEP mjs must exist')

  // Verify embeddings.ts has wasmPaths configured
  const embeddingsSrc = fs.readFileSync('lib/embeddings.ts', 'utf8')
  assert.ok(embeddingsSrc.includes('wasmPaths = chrome.runtime.getURL(\'assets/\')'), 'embeddings.ts must configure wasmPaths')

  // Verify whisper-asr-service.ts has wasmPaths configured
  const whisperSrc = fs.readFileSync('lib/audio/whisper-asr-service.ts', 'utf8')
  assert.ok(whisperSrc.includes('wasmPaths = chrome.runtime.getURL(\'assets/\')'), 'whisper-asr-service.ts must configure wasmPaths')

  // Verify inference-worker.ts has wasmPaths configured
  const workerSrc = fs.readFileSync('lib/workers/inference-worker.ts', 'utf8')
  assert.ok(workerSrc.includes('wasmPaths = chrome.runtime.getURL(\'assets/\')'), 'inference-worker.ts must configure wasmPaths')

  // Verify transformers-test.ts does NOT disable local models
  const testSrc = fs.readFileSync('lib/transformers-test.ts', 'utf8')
  assert.ok(!testSrc.includes('env.allowLocalModels = false'), 'transformers-test.ts must not disable local models')
})

test('7. Speech vs AI Decoupling: Transcript preserved on AI generation failure', async () => {
  const turnId = 12345
  const userSpokenText = 'Summarize page and extract action items'

  // Record whisper recognition
  voiceDiagnosticTracker.recordWhisper(turnId, userSpokenText, 150)
  const turn = voiceDiagnosticTracker.getRecentTurns().find(t => t.turnId === turnId)
  assert.equal(turn?.whisperText, userSpokenText)

  // Record AI generation failure
  voiceDiagnosticTracker.recordTerminalState(turnId, 'FAILED', 'Prompt API session creation failed')
  const afterFailure = voiceDiagnosticTracker.getRecentTurns().find(t => t.turnId === turnId)
  assert.equal(afterFailure?.whisperText, userSpokenText, 'Transcript must remain intact and displayed')
  assert.equal(afterFailure?.terminalState, 'FAILED')
})

test('8. Strict Waveform File Invariant (0 diff against baseline)', async () => {
  const diff = execSync('git diff f6e31c78a9d652d69a002efb00726ec73a606122 -- components/waveform.tsx', {
    encoding: 'utf8'
  }).trim()
  assert.equal(diff, '', 'components/waveform.tsx must have strictly 0 diff against main baseline')
})
