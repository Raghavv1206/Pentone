import test from 'node:test'
import assert from 'node:assert/strict'
import { parseToolCallDetailed, validateToolCallSchema } from '../lib/tool-parser'

test('Suite B: Tool Parser, Malformed Recovery, & Candidate Extraction', async (t) => {

  await t.test('1. Valid JSON tool call inside <function_call> tags', () => {
    const content = '<function_call>{"function": "openTab", "arguments": {"url": "https://www.youtube.com"}}</function_call>'
    const res = parseToolCallDetailed(content)
    assert.equal(res.success, true)
    assert.equal(res.toolCall?.function, 'openTab')
    assert.equal(res.toolCall?.arguments.url, 'https://www.youtube.com')
  })

  await t.test('2. Multiple candidates: ignores malformed text and extracts first valid tool call', () => {
    const content = `
I will first think about this.
<function_call>{"function": "invalidToolName", "arguments": {}}</function_call>
Here is the actual plan:
<function_call>{"function": "findElements", "arguments": {"query": "video results"}}</function_call>
`
    const res = parseToolCallDetailed(content)
    assert.equal(res.success, true)
    assert.equal(res.toolCall?.function, 'findElements')
    assert.equal(res.toolCall?.arguments.query, 'video results')
  })

  await t.test('3. Malformed JSON with single quotes, unquoted keys, and missing closing brace', () => {
    const raw = `<function_call>{function: 'clickElement', arguments: {index: 4</function_call>`
    const res = parseToolCallDetailed(raw)
    assert.equal(res.success, true)
    assert.equal(res.toolCall?.function, 'clickElement')
    assert.equal(res.toolCall?.arguments.index, 4)
  })

  await t.test('4. Streaming fragment: tool call surrounded by conversational text', () => {
    const content = `Certainly! I will open YouTube for you right now.\n\n<function_call>{"function": "openTab", "arguments": {"url": "https://www.youtube.com"}}</function_call>\n\nPlease wait a moment.`
    const res = parseToolCallDetailed(content)
    assert.equal(res.success, true)
    assert.equal(res.toolCall?.function, 'openTab')
  })

  await t.test('5. Non-tool conversational output returns no tool call error cleanly', () => {
    const content = 'Hello! How can I help you today? I can search YouTube, open tabs, and automate web tasks.'
    const res = parseToolCallDetailed(content)
    assert.equal(res.success, false)
    assert.equal(res.toolCall, undefined)
    assert.ok(res.error?.includes('No tool call patterns detected'))
  })

  await t.test('6. Missing required parameter returns structured schema error with corrective hint', () => {
    const content = '<function_call>{"function": "clickElement", "arguments": {}}</function_call>'
    const res = parseToolCallDetailed(content)
    assert.equal(res.success, false)
    assert.ok(res.structuredError)
    assert.equal(res.structuredError.toolName, 'clickElement')
    assert.equal(res.structuredError.invalidArgument, 'index')
    assert.equal(res.structuredError.failureStage, 'SCHEMA_VALIDATION')
  })
})
