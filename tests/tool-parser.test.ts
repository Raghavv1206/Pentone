import test from 'node:test'
import assert from 'node:assert/strict'
import { parseToolCallDetailed, validateToolCallSchema } from '../lib/tool-parser'
import { validateAndSanitizeUrl } from '../lib/url-validator'

test('Tool Parser: Valid standard JSON function call', () => {
  const content = '<function_call>{"function": "openTab", "arguments": {"url": "https://www.youtube.com"}}</function_call>'
  const result = parseToolCallDetailed(content)

  assert.equal(result.success, true)
  assert.equal(result.toolCall?.function, 'openTab')
  assert.equal(result.toolCall?.arguments.url, 'https://www.youtube.com')
})

test('Tool Parser: Gemma 4 variant closing with </function_end>', () => {
  const content = '<function_call>{"function": "openTab", "arguments": {"url": "https://www.google.com"}}</function_end>'
  const result = parseToolCallDetailed(content)

  assert.equal(result.success, true)
  assert.equal(result.toolCall?.function, 'openTab')
  assert.equal(result.toolCall?.arguments.url, 'https://www.google.com')
})

test('Tool Parser: Gemma 4 comma-separated format with unquoted URL', () => {
  const content = '<function_call>openTab,arguments: "open"https://www.youtube.com"</function_end>'
  const result = parseToolCallDetailed(content)

  assert.equal(result.success, true)
  assert.equal(result.toolCall?.function, 'openTab')
  assert.equal(result.toolCall?.arguments.url, 'https://www.youtube.com')
})

test('Tool Parser: URL with query parameters, hashes and punctuation', () => {
  const targetUrl = 'https://www.google.com/search?q=gemma+ai&hl=en#section'
  const content = `<function_call>openTab,arguments: "${targetUrl}"</function_call>`
  const result = parseToolCallDetailed(content)

  assert.equal(result.success, true)
  assert.equal(result.toolCall?.function, 'openTab')
  assert.equal(result.toolCall?.arguments.url, targetUrl)
})

test('Tool Parser: Quoted string containing commas and special characters', () => {
  const content = '<function_call>{"function": "fillInput", "arguments": {"index": 3, "value": "Doe, Jane #42"}}</function_call>'
  const result = parseToolCallDetailed(content)

  assert.equal(result.success, true)
  assert.equal(result.toolCall?.function, 'fillInput')
  assert.equal(result.toolCall?.arguments.index, 3)
  assert.equal(result.toolCall?.arguments.value, 'Doe, Jane #42')
})

test('Tool Parser: Python-style signature syntax', () => {
  const content = '<function_call>openTab(url="https://github.com")</function_call>'
  const result = parseToolCallDetailed(content)

  assert.equal(result.success, true)
  assert.equal(result.toolCall?.function, 'openTab')
  assert.equal(result.toolCall?.arguments.url, 'https://github.com')
})

test('Tool Parser: Abutting-brace syntax: summarizePage{length:short_medium}', () => {
  const content = '<function_call>summarizePage{length:short_medium}</function_call>'
  const result = parseToolCallDetailed(content)

  assert.equal(result.success, true)
  assert.equal(result.toolCall?.function, 'summarizePage')
  // short_medium is normalized to medium
  assert.equal(result.toolCall?.arguments.length, 'medium')
})

test('Tool Parser: Abutting-brace syntax with URL: openTab{url: "https://www.youtube.com"}', () => {
  const content = '<function_call>openTab{url: "https://www.youtube.com"}</function_call>'
  const result = parseToolCallDetailed(content)

  assert.equal(result.success, true)
  assert.equal(result.toolCall?.function, 'openTab')
  assert.equal(result.toolCall?.arguments.url, 'https://www.youtube.com')
})

test('Tool Parser: Abutting-brace syntax with empty args: getPageTitle{}', () => {
  const content = '<function_call>getPageTitle{}</function_call>'
  const result = parseToolCallDetailed(content)

  assert.equal(result.success, true)
  assert.equal(result.toolCall?.function, 'getPageTitle')
  assert.deepEqual(result.toolCall?.arguments, {})
})

test('Tool Parser: Code block wrapper around JSON', () => {
  const content = '```json\n{"function": "captureScreenshot", "arguments": {}}\n```'
  const result = parseToolCallDetailed(content)

  assert.equal(result.success, true)
  assert.equal(result.toolCall?.function, 'captureScreenshot')
})

test('Tool Parser: Incomplete/truncated model JSON recovery (auto-closed braces)', () => {
  const content = '<function_call>{"function": "openTab", "arguments": {"url": "https://example.org"'
  const result = parseToolCallDetailed(content)

  assert.equal(result.success, true)
  assert.equal(result.toolCall?.function, 'openTab')
  assert.equal(result.toolCall?.arguments.url, 'https://example.org')
})

test('Tool Parser: Rejects unknown tools not in allowlist', () => {
  const content = '<function_call>{"function": "maliciousShellCommand", "arguments": {}}</function_call>'
  const result = parseToolCallDetailed(content)

  assert.equal(result.success, false)
  assert.match(result.error || '', /not registered in the tool allowlist/i)
})

test('Tool Parser: Schema validation enforces required parameters', () => {
  const content = '<function_call>{"function": "fillInput", "arguments": {"index": 4}}</function_call>'
  const result = parseToolCallDetailed(content)

  // fillInput requires both 'index' and 'value'
  assert.equal(result.success, false)
  assert.match(result.error || '', /Missing required parameter "value"/i)
})

test('Tool Parser: Schema validation rejects invalid enum values for summarizePage', () => {
  const invalidLength = validateToolCallSchema('summarizePage', { length: 'super_extra_gigantic' })
  assert.equal(invalidLength.valid, false)
  assert.match(invalidLength.error || '', /Invalid length parameter/i)

  const invalidType = validateToolCallSchema('summarizePage', { type: 'dissertation' })
  assert.equal(invalidType.valid, false)
  assert.match(invalidType.error || '', /Invalid type parameter/i)

  const valid = validateToolCallSchema('summarizePage', { length: 'short', type: 'key-points' })
  assert.equal(valid.valid, true)
  assert.equal(valid.toolCall?.arguments.length, 'short')
  assert.equal(valid.toolCall?.arguments.type, 'key-points')
})

test('Tool Parser: Security validation blocks javascript: and dangerous schemes', () => {
  const dangerousUrls = [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'chrome://settings',
    'chrome-extension://malicious'
  ]

  for (const url of dangerousUrls) {
    const check = validateAndSanitizeUrl(url)
    assert.equal(check.valid, false, `Should reject ${url}`)

    const content = `<function_call>{"function": "openTab", "arguments": {"url": "${url}"}}</function_call>`
    const result = parseToolCallDetailed(content)
    assert.equal(result.success, false, `Parser should reject ${url}`)
  }
})

test('Tool Parser: Validates element index as integer and blocks negative indices', () => {
  const valid = validateToolCallSchema('clickElement', { index: 5 })
  assert.equal(valid.valid, true)
  assert.equal(valid.toolCall?.arguments.index, 5)

  const negative = validateToolCallSchema('clickElement', { index: -1 })
  assert.equal(negative.valid, false)

  const nonInteger = validateToolCallSchema('clickElement', { index: 'abc' })
  assert.equal(nonInteger.valid, false)
})

test('Tool Parser: Gemma 4 colon-tag opener with truncated JSON recovery (<function_call:...)</function_call>)', () => {
  const content = '<function_call:{"function": "findElements", "arguments": {"query": "video"}</function_call>'
  const result = parseToolCallDetailed(content)

  assert.equal(result.success, true)
  assert.equal(result.toolCall?.function, 'findElements')
  assert.equal(result.toolCall?.arguments.query, 'video')
})

test('Tool Parser: Handles loose clickElement with missing index cleanly without misidentifying as openTab', () => {
  const content = '<function_call>clickElement,arguments="index" /></function_call>'
  const result = parseToolCallDetailed(content)

  // Must not succeed with fake parameters, and must NOT hallucinate openTab
  assert.equal(result.success, false)
  assert.match(result.error || '', /clickElement/i)
  assert.doesNotMatch(result.error || '', /openTab/i)
})

test('Tool Parser: Format 5 strictly disallows tools requiring parameters (openTab, clickElement, fillInput)', () => {
  // If the content is just a bare word inside tags for a tool that requires arguments, it must NOT return empty args
  const openTabResult = parseToolCallDetailed('<function_call>openTab</function_call>')
  assert.equal(openTabResult.success, false)

  const clickResult = parseToolCallDetailed('<function_call>clickElement</function_call>')
  assert.equal(clickResult.success, false)

  // But parameterless tools succeed cleanly
  const titleResult = parseToolCallDetailed('<function_call>getPageTitle</function_call>')
  assert.equal(titleResult.success, true)
  assert.equal(titleResult.toolCall?.function, 'getPageTitle')

  const screenshotResult = parseToolCallDetailed('<function_call>captureScreenshot</function_call>')
  assert.equal(screenshotResult.success, true)
  assert.equal(screenshotResult.toolCall?.function, 'captureScreenshot')
})
