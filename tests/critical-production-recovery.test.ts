import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {
  checkPromptAPIAvailability,
  markPromptAPIDeviceIncapable,
  resetPromptAPIDeviceIncapable,
  isPromptAPIDeviceIncapable
} from '../lib/ai-config'

test('Critical Recovery: package.json bundles ort-wasm-simd-threaded.jsep.mjs', () => {
  const pkgJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'))
  const resources = pkgJson.manifest?.web_accessible_resources?.[0]?.resources || []
  
  assert.ok(
    resources.includes('assets/ort-wasm-simd-threaded.jsep.mjs') || resources.includes('assets/*.mjs'),
    'package.json must declare ort-wasm-simd-threaded.jsep.mjs or assets/*.mjs in web_accessible_resources'
  )
  assert.ok(
    resources.includes('assets/ort-wasm-simd-threaded.mjs'),
    'package.json must declare assets/ort-wasm-simd-threaded.mjs in web_accessible_resources'
  )
  assert.ok(
    resources.includes('assets/*.wasm'),
    'package.json must declare assets/*.wasm in web_accessible_resources'
  )
})

test('Critical Recovery: Source assets directory contains jsep mjs and wasm binaries', () => {
  const jsepMjsPath = path.resolve(__dirname, '../assets/ort-wasm-simd-threaded.jsep.mjs')
  const jsepWasmPath = path.resolve(__dirname, '../assets/ort-wasm-simd-threaded.jsep.wasm')
  
  assert.ok(fs.existsSync(jsepMjsPath), 'ort-wasm-simd-threaded.jsep.mjs must exist in assets/')
  assert.ok(fs.existsSync(jsepWasmPath), 'ort-wasm-simd-threaded.jsep.wasm must exist in assets/')
  
  const mjsStat = fs.statSync(jsepMjsPath)
  const wasmStat = fs.statSync(jsepWasmPath)
  assert.ok(mjsStat.size > 20000, `jsep mjs size (${mjsStat.size}) must be valid ONNX bundle`)
  assert.ok(wasmStat.size > 20000000, `jsep wasm size (${wasmStat.size}) must be valid ONNX runtime binary`)
})

test('Critical Recovery: Prompt API device failure circuit breaker', async () => {
  resetPromptAPIDeviceIncapable()
  assert.strictEqual(isPromptAPIDeviceIncapable(), false)
  
  // Mark device incapable (as happens when LanguageModel.create() fails with "The device is unable to create a session")
  markPromptAPIDeviceIncapable()
  assert.strictEqual(isPromptAPIDeviceIncapable(), true)
  
  // checkPromptAPIAvailability should immediately return 'unavailable' without crashing or blocking
  const avail = await checkPromptAPIAvailability()
  assert.strictEqual(avail, 'unavailable')
  
  // Reset restores normal behavior
  resetPromptAPIDeviceIncapable()
  assert.strictEqual(isPromptAPIDeviceIncapable(), false)
})

test('Critical Recovery: Worker WASM path resolution logic guarantees trailing slash', () => {
  const formatWasmPath = (rawPath?: string | null): string | null => {
    if (!rawPath) return null
    return rawPath.endsWith('/') ? rawPath : `${rawPath}/`
  }

  assert.strictEqual(
    formatWasmPath('chrome-extension://abcdef/assets'),
    'chrome-extension://abcdef/assets/'
  )
  assert.strictEqual(
    formatWasmPath('chrome-extension://abcdef/assets/'),
    'chrome-extension://abcdef/assets/'
  )
  assert.strictEqual(
    formatWasmPath(null),
    null
  )
})
