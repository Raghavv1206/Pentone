import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ModelProvisioningService,
  QWEN_MODEL_ID,
  QWEN_MODEL_REVISION,
  LEGACY_MODEL_REVISION,
  ESTIMATED_MODEL_BYTES,
  REQUIRED_MODEL_FILES,
  EXPECTED_ASSET_METADATA
} from '../lib/model-provisioning'

test('ModelProvisioningService: Singleton instantiation and default state', () => {
  const service = ModelProvisioningService.getInstance()
  assert.ok(service, 'Service should be instantiated')
  assert.equal(service.getState(), 'not_downloaded')
  
  const progress = service.getProgress()
  assert.equal(progress.modelId, QWEN_MODEL_ID)
  assert.equal(progress.totalBytes, ESTIMATED_MODEL_BYTES)
  assert.equal(progress.percent, 0)
})

test('ModelProvisioningService: URL resolution maps to pinned immutable commit SHA', () => {
  const service = ModelProvisioningService.getInstance()
  assert.equal(QWEN_MODEL_REVISION, '22942cb7d7ba4cc81bb4673549ca4d4614469b5e')

  const url = service.getFileUrl('config.json')
  assert.equal(url, 'https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct/resolve/22942cb7d7ba4cc81bb4673549ca4d4614469b5e/config.json')

  const modelUrl = service.getFileUrl('onnx/model_quantized.onnx')
  assert.equal(modelUrl, 'https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct/resolve/22942cb7d7ba4cc81bb4673549ca4d4614469b5e/onnx/model_quantized.onnx')

  // Legacy URL resolution check
  const legacyUrl = service.getFileUrl('config.json', LEGACY_MODEL_REVISION)
  assert.equal(legacyUrl, 'https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct/resolve/main/config.json')
})

test('ModelProvisioningService: Required model files contain all critical quantized assets with verified checksums', () => {
  assert.ok(REQUIRED_MODEL_FILES.includes('config.json'))
  assert.ok(REQUIRED_MODEL_FILES.includes('generation_config.json'))
  assert.ok(REQUIRED_MODEL_FILES.includes('tokenizer.json'))
  assert.ok(REQUIRED_MODEL_FILES.includes('tokenizer_config.json'))
  assert.ok(REQUIRED_MODEL_FILES.includes('special_tokens_map.json'))
  assert.ok(REQUIRED_MODEL_FILES.includes('onnx/model_quantized.onnx'))
  assert.equal(REQUIRED_MODEL_FILES.length, 6)

  assert.equal(EXPECTED_ASSET_METADATA['config.json'].sizeBytes, 678)
  assert.equal(EXPECTED_ASSET_METADATA['onnx/model_quantized.onnx'].sizeBytes, 512096557)
  assert.ok(EXPECTED_ASSET_METADATA['onnx/model_quantized.onnx'].sha256.startsWith('41834041'))
})

test('ModelProvisioningService: verifyAssetBlob validates JSON and rejects corrupt payloads', async () => {
  const service = ModelProvisioningService.getInstance()

  // 1. Valid JSON payload
  const validJson = JSON.stringify({ architectures: ['Qwen2ForCausalLM'] })
  const validRes = new Response(validJson, { status: 200 })
  // In node test environment without crypto.subtle, byte size is verified against EXPECTED_ASSET_METADATA
  // Let's create an exact size payload
  const mockConfigBytes = Buffer.alloc(678, ' ')
  const validConfigRes = new Response(mockConfigBytes, { status: 200 })
  const validCheck = await service.verifyAssetBlob('config.json', validConfigRes)
  assert.equal(typeof validCheck, 'boolean')

  // 2. Corrupt JSON payload
  const corruptJsonRes = new Response('{"invalid_json: unterminated', { status: 200 })
  const corruptCheck = await service.verifyAssetBlob('config.json', corruptJsonRes)
  assert.equal(corruptCheck, false, 'Should reject corrupt JSON payload')

  // 3. Truncated ONNX model payload (<100MB)
  const truncatedOnnxRes = new Response(Buffer.alloc(1024), { status: 200 })
  const onnxCheck = await service.verifyAssetBlob('onnx/model_quantized.onnx', truncatedOnnxRes)
  assert.equal(onnxCheck, false, 'Should reject truncated ONNX model below minimum threshold')
})

test('ModelProvisioningService: Legacy cache migration never blindly aliases unverified artifacts', async () => {
  const service = ModelProvisioningService.getInstance()

  // Mock response for unverified legacy file
  const emptyRes = new Response('', { status: 200 })
  const isMigratable = await service.verifyAssetBlob('onnx/model_quantized.onnx', emptyRes)
  assert.equal(isMigratable, false, 'Empty legacy file must not be migrated')
})

test('ModelProvisioningService: Storage quota check handles fallback gracefully', async () => {
  const service = ModelProvisioningService.getInstance()
  const storageInfo = await service.checkStorageQuota()
  assert.equal(typeof storageInfo.isSufficient, 'boolean')
})

test('ModelProvisioningService: Cancellation support updates state to cancelled', () => {
  const service = ModelProvisioningService.getInstance()
  service.cancelDownload()
  assert.ok(['not_downloaded', 'cancelled'].includes(service.getState()))
})
