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

test('Tool Parser: findElements canonical parameter and equivalent alias normalization', () => {
  // 1. Canonical query parameter
  const canonicalCall = '<function_call>{"function": "findElements", "arguments": {"query": "second video"}}</function_call>'
  const canonicalRes = parseToolCallDetailed(canonicalCall)
  assert.equal(canonicalRes.success, true)
  assert.equal(canonicalRes.toolCall?.function, 'findElements')
  assert.equal(canonicalRes.toolCall?.arguments.query, 'second video')

  // 2. Model-generated selector normalized to query
  const selectorCall = '<function_call>{"function": "findElements", "arguments": {"selector": "second video"}}</function_call>'
  const selectorRes = parseToolCallDetailed(selectorCall)
  assert.equal(selectorRes.success, true)
  assert.equal(selectorRes.toolCall?.function, 'findElements')
  assert.equal(selectorRes.toolCall?.arguments.query, 'second video')

  // 3. Model-generated CSS selector normalized to query
  const cssCall = '<function_call>{"function": "findElements", "arguments": {"selector": "[data-pentone-1]"}}</function_call>'
  const cssRes = parseToolCallDetailed(cssCall)
  assert.equal(cssRes.success, true)
  assert.equal(cssRes.toolCall?.function, 'findElements')
  assert.equal(cssRes.toolCall?.arguments.query, '[data-pentone-1]')

  // 3b. Model-generated text / search / element aliases normalized to query
  const textCall = '<function_call>{"function": "findElements", "arguments": {"text": "Search button"}}</function_call>'
  const textRes = parseToolCallDetailed(textCall)
  assert.equal(textRes.success, true)
  assert.equal(textRes.toolCall?.arguments.query, 'Search button')

  const searchCall = '<function_call>{"function": "findElements", "arguments": {"search": "login link"}}</function_call>'
  const searchRes = parseToolCallDetailed(searchCall)
  assert.equal(searchRes.success, true)
  assert.equal(searchRes.toolCall?.arguments.query, 'login link')

  const elementCall = '<function_call>{"function": "findElements", "arguments": {"element": "submit form"}}</function_call>'
  const elementRes = parseToolCallDetailed(elementCall)
  assert.equal(elementRes.success, true)
  assert.equal(elementRes.toolCall?.arguments.query, 'submit form')

  // 4. Missing query and selector
  const missingCall = '<function_call>{"function": "findElements", "arguments": {}}</function_call>'
  const missingRes = parseToolCallDetailed(missingCall)
  assert.equal(missingRes.success, false)
  assert.match(missingRes.error || '', /Missing required parameter "query"/i)

  // 5. Unrelated invalid parameter strictly rejected
  const invalidParamCall = '<function_call>{"function": "findElements", "arguments": {"selector": "video", "unrelated_flag": true}}</function_call>'
  const invalidParamRes = parseToolCallDetailed(invalidParamCall)
  assert.equal(invalidParamRes.success, false)
  assert.match(invalidParamRes.error || '', /Unexpected parameter "unrelated_flag"/i)

  // 6. Malformed JSON handled gracefully
  const malformedCall = '<function_call>{"function": "findElements", "arguments": {invalid JSON content}</function_call>'
  const malformedRes = parseToolCallDetailed(malformedCall)
  assert.equal(malformedRes.success, false)
})

test('Tool Parser: clickElement index normalization and strict rejection of id parameter', () => {
  // 1. Canonical index
  const validIndex = validateToolCallSchema('clickElement', { index: 1 })
  assert.equal(validIndex.valid, true)
  assert.equal(validIndex.toolCall?.arguments.index, 1)

  // 2. Demonstrably equivalent elementIndex normalized to index
  const elemIndex = validateToolCallSchema('clickElement', { elementIndex: 2 })
  assert.equal(elemIndex.valid, true)
  assert.equal(elemIndex.toolCall?.arguments.index, 2)

  // 3. String id parameter is NOT mapped to index and is strictly rejected
  const idParam = validateToolCallSchema('clickElement', { id: 'search-button' })
  assert.equal(idParam.valid, false)
  assert.match(idParam.error || '', /Unexpected parameter "id"/i)

  // 4. Negative index rejected
  const negIndex = validateToolCallSchema('clickElement', { index: -1 })
  assert.equal(negIndex.valid, false)
})

test('Tool Parser: openTab parameter normalization strips extraneous tabid / tabId / tab_id', () => {
  // 1. Standard openTab
  const standard = validateToolCallSchema('openTab', { url: 'https://www.youtube.com' })
  assert.equal(standard.valid, true)
  assert.equal(standard.toolCall?.arguments.url, 'https://www.youtube.com')

  // 2. Extraneous tabid generated by LLM is stripped without schema validation rejection
  const withTabIdLower = validateToolCallSchema('openTab', { url: 'https://www.youtube.com', tabid: 1 })
  assert.equal(withTabIdLower.valid, true)
  assert.equal(withTabIdLower.toolCall?.arguments.url, 'https://www.youtube.com')
  assert.equal(withTabIdLower.toolCall?.arguments.tabid, undefined)

  // 3. Extraneous tabId camelCase is stripped
  const withTabIdCamel = validateToolCallSchema('openTab', { url: 'https://www.youtube.com', tabId: 2 })
  assert.equal(withTabIdCamel.valid, true)
  assert.equal(withTabIdCamel.toolCall?.arguments.url, 'https://www.youtube.com')
  assert.equal(withTabIdCamel.toolCall?.arguments.tabId, undefined)

  // 4. Extraneous tab_id snake_case is stripped
  const withTabIdSnake = validateToolCallSchema('openTab', { url: 'https://www.youtube.com', tab_id: 3 })
  assert.equal(withTabIdSnake.valid, true)
  assert.equal(withTabIdSnake.toolCall?.arguments.url, 'https://www.youtube.com')
  assert.equal(withTabIdSnake.toolCall?.arguments.tab_id, undefined)
})
