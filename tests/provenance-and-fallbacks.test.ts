import test from 'node:test'
import assert from 'node:assert/strict'
import { generativeRuntime } from '../lib/generative-runtime'

test('Provenance: LanguageDetector returns native provenance when available', async () => {
  const originalSelf = (globalThis as any).self
  try {
    ;(globalThis as any).self = {
      LanguageDetector: {
        availability: async () => 'available',
        create: async () => ({
          detect: async () => [{ detectedLanguage: 'fr', confidence: 0.99 }],
          destroy: () => {}
        })
      }
    }

    const res = await generativeRuntime.detectLanguage('Bonjour tout le monde')
    assert.equal(res.tier, 'native', 'Tier must be native when LanguageDetector is available')
    assert.equal(res.modelId, 'chrome-native-language-detector')
    assert.match(res.text, /fr \(99.0% confidence\)/)
  } finally {
    ;(globalThis as any).self = originalSelf
  }
})

test('Provenance: Prompt API Nano returns native provenance when specialist is absent', async () => {
  const originalSelf = (globalThis as any).self
  try {
    ;(globalThis as any).self = {
      LanguageModel: {
        availability: async () => 'available',
        create: async () => ({
          prompt: async () => 'de (95.0%)',
          destroy: () => {}
        })
      }
    }

    const res = await generativeRuntime.detectLanguage('Guten Tag')
    assert.equal(res.tier, 'native', 'Tier must be native when LanguageModel is available')
    assert.equal(res.modelId, 'chrome-prompt-api-nano')
    assert.match(res.text, /de \(95.0%\)/)
  } finally {
    ;(globalThis as any).self = originalSelf
  }
})

test('Provenance: Falls back to deterministic when native APIs and Qwen are absent', async () => {
  const originalSelf = (globalThis as any).self
  try {
    ;(globalThis as any).self = {} // Empty scope

    const res = await generativeRuntime.detectLanguage('Guten Morgen')
    assert.equal(res.tier, 'deterministic', 'Must tag as deterministic when falling back')
    assert.equal(res.modelId, 'pentone-script-lexical-classifier-v2')
    assert.match(res.text, /Detected language: de/)
  } finally {
    ;(globalThis as any).self = originalSelf
  }
})

test('Provenance: Translation tags native vs deterministic accurately', async () => {
  const originalSelf = (globalThis as any).self
  try {
    // 1. Mock native translator
    ;(globalThis as any).self = {
      Translator: {
        availability: async () => 'available',
        create: async () => ({
          translate: async () => 'Hola mundo',
          destroy: () => {}
        })
      }
    }
    const nativeRes = await generativeRuntime.translateText({
      text: 'Hello world',
      sourceLanguage: 'en',
      targetLanguage: 'es'
    })
    assert.equal(nativeRes.tier, 'native')
    assert.equal(nativeRes.text, 'Hola mundo')

    // 2. Clear native translator to trigger deterministic fallback
    ;(globalThis as any).self = {}
    const detRes = await generativeRuntime.translateText({
      text: 'Hello world',
      sourceLanguage: 'en',
      targetLanguage: 'es'
    })
    assert.equal(detRes.tier, 'deterministic')
    assert.equal(detRes.modelId, 'pentone-lexicon-fallback')
    assert.equal(detRes.text, 'Hola mundo')
  } finally {
    ;(globalThis as any).self = originalSelf
  }
})

test('Provenance: Writing tags native vs deterministic accurately', async () => {
  const originalSelf = (globalThis as any).self
  try {
    // 1. Mock native writer
    ;(globalThis as any).self = {
      LanguageModel: {
        availability: async () => 'available',
        create: async () => ({
          prompt: async () => 'Executive Summary: System fully restored.',
          destroy: () => {}
        })
      }
    }
    const nativeRes = await generativeRuntime.writeContent({
      task: 'Rewrite update',
      tone: 'formal'
    })
    assert.equal(nativeRes.tier, 'native')
    assert.match(nativeRes.text, /Executive Summary/)

    // 2. Clear to trigger deterministic fallback
    ;(globalThis as any).self = {}
    const detRes = await generativeRuntime.writeContent({
      task: 'Rewrite update',
      tone: 'formal'
    })
    assert.equal(detRes.tier, 'deterministic')
    assert.equal(detRes.modelId, 'pentone-template-fallback')
  } finally {
    ;(globalThis as any).self = originalSelf
  }
})

test('Provenance: Never returns deterministic output with generative provenance', async () => {
  const originalSelf = (globalThis as any).self
  try {
    ;(globalThis as any).self = {}
    const res = await generativeRuntime.summarizePage({
      content: 'Webpage content for testing',
      title: 'Test',
      type: 'key-points'
    })
    assert.equal(res.tier, 'deterministic')
    assert.notEqual(res.tier, 'generative', 'Must never mislabel fallback as generative')
  } finally {
    ;(globalThis as any).self = originalSelf
  }
})
