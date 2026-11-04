import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import {
  DEFAULT_SLM_MODEL_ID,
  DEFAULT_SLM_MODEL_REVISION,
  QWEN_MODEL_ID,
  REQUIRED_MODEL_FILES,
  EXPECTED_ASSET_METADATA,
  MODEL_REGISTRY
} from '../lib/model-provisioning'
import { DEFAULT_LOCAL_LLM_ID, DEFAULT_LOCAL_LLM_REVISION, generativeRuntime } from '../lib/generative-runtime'
import { capabilityRegistry } from '../lib/models/capability-registry'
import { modelRouter } from '../lib/models/model-router'
import { getActiveSessionMetadata } from '../lib/ai'

test('SmolLM-135M Integration: Model constants and registry configuration', () => {
  assert.strictEqual(DEFAULT_SLM_MODEL_ID, 'onnx-community/SmolLM-135M-Instruct-ONNX')
  assert.strictEqual(DEFAULT_SLM_MODEL_REVISION, '7e78273381b84cc2dae12daceb53552c8b115eef')
  assert.strictEqual(QWEN_MODEL_ID, DEFAULT_SLM_MODEL_ID)

  const descriptor = MODEL_REGISTRY.qwen
  assert.strictEqual(descriptor.modelId, 'onnx-community/SmolLM-135M-Instruct-ONNX')
  assert.strictEqual(descriptor.revision, '7e78273381b84cc2dae12daceb53552c8b115eef')
  assert.ok(descriptor.name.includes('SmolLM-135M-Instruct'))
  assert.ok(descriptor.estimatedBytes < 200 * 1024 * 1024, 'Estimated bytes must be < 200MB')

  // Required files verification
  assert.ok(REQUIRED_MODEL_FILES.includes('config.json'))
  assert.ok(REQUIRED_MODEL_FILES.includes('generation_config.json'))
  assert.ok(REQUIRED_MODEL_FILES.includes('tokenizer.json'))
  assert.ok(REQUIRED_MODEL_FILES.includes('tokenizer_config.json'))
  assert.ok(REQUIRED_MODEL_FILES.includes('special_tokens_map.json'))
  assert.ok(REQUIRED_MODEL_FILES.includes('vocab.json'))
  assert.ok(REQUIRED_MODEL_FILES.includes('merges.txt'))
  assert.ok(REQUIRED_MODEL_FILES.includes('onnx/model_quantized.onnx'))

  // Metadata verification
  const onnxMeta = EXPECTED_ASSET_METADATA['onnx/model_quantized.onnx']
  assert.ok(onnxMeta, 'onnx/model_quantized.onnx metadata must exist')
  assert.strictEqual(onnxMeta.sizeBytes, 135658353)
  assert.strictEqual(onnxMeta.sha256, 'bec65cbd7d2aed51d35659629f9f20169367de1ed4de87bbb5d66de9eff214e7')
})

test('SmolLM-135M Integration: GenerativeRuntime and worker defaults', () => {
  assert.strictEqual(DEFAULT_LOCAL_LLM_ID, 'onnx-community/SmolLM-135M-Instruct-ONNX')
  assert.strictEqual(DEFAULT_LOCAL_LLM_REVISION, '7e78273381b84cc2dae12daceb53552c8b115eef')

  const runtimeState = generativeRuntime.getState()
  assert.strictEqual(runtimeState.activeModelId, 'onnx-community/SmolLM-135M-Instruct-ONNX')
})

test('SmolLM-135M Integration: Capability Registry and Model Router', () => {
  const model = capabilityRegistry.getModel('onnx-community/SmolLM-135M-Instruct-ONNX')
  assert.ok(model, 'SmolLM-135M-Instruct-ONNX must be registered in capability registry')
  assert.ok(model.capabilities.includes('text-generation'))
  assert.ok(model.capabilities.includes('reasoning'))

  const route = modelRouter.resolveRoute({
    capabilities: ['text-generation']
  })
  assert.strictEqual(route.primaryModelId, 'onnx-community/SmolLM-135M-Instruct-ONNX')
  assert.strictEqual(route.executionMode, 'local')
})

test('SmolLM-135M Integration: Invariant Verification on components/waveform.tsx', () => {
  const baselineCommit = 'f6e31c78a9d652d69a002efb00726ec73a606122'
  const diff = execSync(`git diff ${baselineCommit} -- components/waveform.tsx`, { encoding: 'utf8' })
  assert.strictEqual(diff.trim(), '', 'components/waveform.tsx must remain strictly 0 bytes diff against baseline')
})
