import test from 'node:test'
import assert from 'node:assert/strict'
import { isLocalVoice } from '../lib/tts-context'
import { isRestrictedInternalUrl } from '../lib/url-validator'
import { WriterAPIUnavailableError } from '../lib/errors'

test('Privacy Hardening 1.1: Local-only TTS voice filtering strictly rejects remote cloud voices', () => {
  // Remote Google Cloud voices
  const googleVoice1 = { name: 'Google US English', lang: 'en-US', voiceURI: 'Google US English', default: false, localService: false } as SpeechSynthesisVoice
  const googleVoice2 = { name: 'Google UK English Female', lang: 'en-GB', voiceURI: 'Google UK English Female', default: false, localService: true } as SpeechSynthesisVoice
  const remoteVoice = { name: 'Remote Network Voice', lang: 'en-US', voiceURI: 'remote-voice', default: false, localService: false } as SpeechSynthesisVoice

  // Local OS voices
  const localDavid = { name: 'Microsoft David - English (United States)', lang: 'en-US', voiceURI: 'urn:moz-tts:sapi:Microsoft David', default: true, localService: true } as SpeechSynthesisVoice
  const localZira = { name: 'Microsoft Zira - English (United States)', lang: 'en-US', voiceURI: 'urn:moz-tts:sapi:Microsoft Zira', default: false, localService: true } as SpeechSynthesisVoice
  const localApple = { name: 'Samantha', lang: 'en-US', voiceURI: 'com.apple.speech.synthesis.voice.samantha', default: true, localService: true } as SpeechSynthesisVoice

  assert.equal(isLocalVoice(googleVoice1), false, 'Must reject Google US English')
  assert.equal(isLocalVoice(googleVoice2), false, 'Must reject any voice starting with Google')
  assert.equal(isLocalVoice(remoteVoice), false, 'Must reject voice with localService: false')

  assert.equal(isLocalVoice(localDavid), true, 'Must accept local Microsoft David')
  assert.equal(isLocalVoice(localZira), true, 'Must accept local Microsoft Zira')
  assert.equal(isLocalVoice(localApple), true, 'Must accept local Samantha')
})

test('Privacy Hardening 1.2: Local-only TTS handles null, undefined, or missing properties safely', () => {
  assert.equal(isLocalVoice(null as any), false)
  assert.equal(isLocalVoice(undefined as any), false)
  
  // Test mock environment voice without explicit localService boolean
  const mockTestVoice = { name: 'Mock System Voice', voiceURI: 'mock-sys-1', lang: 'en-US', default: true } as any
  assert.equal(isLocalVoice(mockTestVoice), true, 'Should accept standard mock system voice in test runners')
})

test('Tool Remediation 2.1: isRestrictedInternalUrl correctly classifies dangerous vs permitted URLs', () => {
  const restrictedUrls = [
    'chrome://settings',
    'chrome://extensions',
    'chrome://flags',
    'chrome-extension://ijogpbchahinneehlainppdfnlgekjho/popup.html',
    'edge://settings',
    'about:blank',
    'about:config',
    'file:///C:/secrets.txt',
    'data:text/html,<h1>attack</h1>',
    'javascript:alert(1)',
    'vbscript:msgbox',
    'view-source:https://example.com'
  ]

  for (const url of restrictedUrls) {
    assert.equal(isRestrictedInternalUrl(url), true, `Must reject restricted URL: ${url}`)
  }

  const permittedUrls = [
    'https://www.youtube.com/results?search_query=react',
    'http://localhost:8080/app',
    'http://127.0.0.1:8765/browser-test-page.html',
    'https://developer.chrome.com/docs/ai',
    'https://github.com/microsoft/playwright'
  ]

  for (const url of permittedUrls) {
    assert.equal(isRestrictedInternalUrl(url), false, `Must permit standard web URL: ${url}`)
  }

  // Null/empty/undefined should fail-closed
  assert.equal(isRestrictedInternalUrl(''), true)
  assert.equal(isRestrictedInternalUrl(null), true)
  assert.equal(isRestrictedInternalUrl(undefined), true)
})

test('Tool Remediation 2.2: writeContent falls back to LanguageModel when Writer API is absent', async () => {
  const originalSelf = (globalThis as any).self
  let promptCalledWith = ''

  try {
    ;(globalThis as any).self = {
      LanguageModel: {
        availability: async () => 'available',
        create: async (opts: any) => ({
          prompt: async (p: string) => {
            promptCalledWith = p
            return 'Drafted content from LanguageModel fallback'
          },
          destroy: () => {}
        })
      }
    }

    const { executeUITool } = await import('../lib/ui-tools')
    const { voiceAuthorizationManager } = await import('../lib/audio/voice-authorization-manager')

    voiceAuthorizationManager.setActiveContext({
      turnId: 301,
      userId: 'test_user',
      sessionId: 'test_session'
    })
    const token = voiceAuthorizationManager.mintToken({
      turnId: 301,
      userId: 'test_user',
      sessionId: 'test_session',
      mode: 'UNIVERSAL_VOICE',
      activationMethod: 'PUSH_TO_TALK',
      isPttActive: true
    })

    const res = await executeUITool({
      function: 'writeContent',
      arguments: {
        task: 'Draft a polite follow-up email',
        context: 'Meeting on Friday at 3pm'
      }
    }, token, false, { turnId: 301, userId: 'test_user', sessionId: 'test_session' })

    assert.equal(res.success, true)
    assert.equal(res.result, 'Drafted content from LanguageModel fallback')
    assert.match(promptCalledWith, /Meeting on Friday/i)
  } finally {
    ;(globalThis as any).self = originalSelf
  }
})

test('Tool Remediation 2.3: translateText falls back to LanguageModel when Translator is absent', async () => {
  const originalSelf = (globalThis as any).self

  try {
    ;(globalThis as any).self = {
      LanguageModel: {
        availability: async () => 'available',
        create: async (opts: any) => ({
          prompt: async (text: string) => `Translated(${text}) to Spanish`,
          destroy: () => {}
        })
      }
    }

    const { executeUITool } = await import('../lib/ui-tools')
    const { voiceAuthorizationManager } = await import('../lib/audio/voice-authorization-manager')

    voiceAuthorizationManager.setActiveContext({
      turnId: 302,
      userId: 'test_user',
      sessionId: 'test_session'
    })
    const token = voiceAuthorizationManager.mintToken({
      turnId: 302,
      userId: 'test_user',
      sessionId: 'test_session',
      mode: 'UNIVERSAL_VOICE',
      activationMethod: 'PUSH_TO_TALK',
      isPttActive: true
    })

    const res = await executeUITool({
      function: 'translateText',
      arguments: {
        text: 'Hello world',
        sourceLanguage: 'en',
        targetLanguage: 'es'
      }
    }, token, false, { turnId: 302, userId: 'test_user', sessionId: 'test_session' })

    assert.equal(res.success, true)
    assert.equal(res.result, 'Translated(Hello world) to Spanish')
  } finally {
    ;(globalThis as any).self = originalSelf
  }
})

test('Tool Remediation 2.4: detectLanguage falls back to LanguageModel when LanguageDetector is absent', async () => {
  const originalSelf = (globalThis as any).self

  try {
    ;(globalThis as any).self = {
      LanguageModel: {
        availability: async () => 'available',
        create: async (opts: any) => ({
          prompt: async () => 'fr (98.0%)',
          destroy: () => {}
        })
      }
    }

    const { executeUITool } = await import('../lib/ui-tools')
    const { voiceAuthorizationManager } = await import('../lib/audio/voice-authorization-manager')

    voiceAuthorizationManager.setActiveContext({
      turnId: 303,
      userId: 'test_user',
      sessionId: 'test_session'
    })
    const token = voiceAuthorizationManager.mintToken({
      turnId: 303,
      userId: 'test_user',
      sessionId: 'test_session',
      mode: 'UNIVERSAL_VOICE',
      activationMethod: 'PUSH_TO_TALK',
      isPttActive: true
    })

    const res = await executeUITool({
      function: 'detectLanguage',
      arguments: {
        text: 'Bonjour tout le monde'
      }
    }, token, false, { turnId: 303, userId: 'test_user', sessionId: 'test_session' })

    assert.equal(res.success, true)
    assert.equal(res.result, 'Detected language: fr (98.0%)')
  } finally {
    ;(globalThis as any).self = originalSelf
  }
})

test('Tool Remediation 2.5: Fallback tools reject explicitly when both native API and LanguageModel are unavailable', async () => {
  const originalSelf = (globalThis as any).self

  try {
    // Empty self without Writer, Translator, or LanguageModel
    ;(globalThis as any).self = {}

    const { executeUITool } = await import('../lib/ui-tools')
    const { voiceAuthorizationManager } = await import('../lib/audio/voice-authorization-manager')

    voiceAuthorizationManager.setActiveContext({
      turnId: 304,
      userId: 'test_user',
      sessionId: 'test_session'
    })
    const token = voiceAuthorizationManager.mintToken({
      turnId: 304,
      userId: 'test_user',
      sessionId: 'test_session',
      mode: 'UNIVERSAL_VOICE',
      activationMethod: 'PUSH_TO_TALK',
      isPttActive: true
    })

    const res = await executeUITool({
      function: 'writeContent',
      arguments: { task: 'Write notes' }
    }, token, false, { turnId: 304, userId: 'test_user', sessionId: 'test_session' })

    assert.equal(res.success, false)
    assert.match(res.error, /unavailable/i)
  } finally {
    ;(globalThis as any).self = originalSelf
  }
})
