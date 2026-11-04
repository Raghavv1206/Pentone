import { test } from 'node:test'
import assert from 'node:assert'
import zlib from 'node:zlib'
import { documentProcessor } from '../lib/document-processor'
import { tryDeterministicTaskExecution } from '../lib/capability-router-helpers'
import { classifyTool, evaluateHighImpact } from '../lib/audio/tool-authorization-classifier'
import { voiceAuthorizationManager } from '../lib/audio/voice-authorization-manager'
import { validateToolCallSchema } from '../lib/tool-parser'

// Helper for minimal mock file
function createMockFile(name: string, bytes: Uint8Array, type: string): File {
  return {
    name,
    size: bytes.length,
    type,
    lastModified: Date.now(),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    text: async () => new TextDecoder('utf-8').decode(bytes)
  } as unknown as File
}

function createZipArchive(files: Record<string, string>): Uint8Array {
  const localHeaders: Buffer[] = []
  const cdEntries: Buffer[] = []
  let offset = 0

  for (const [filename, content] of Object.entries(files)) {
    const fnBuf = Buffer.from(filename, 'utf-8')
    const contentBuf = Buffer.from(content, 'utf-8')
    const compBuf = zlib.deflateRawSync(contentBuf)

    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(0, 6)
    lh.writeUInt16LE(8, 8)
    lh.writeUInt32LE(0, 10)
    lh.writeUInt32LE(0x12345678, 14)
    lh.writeUInt32LE(compBuf.length, 18)
    lh.writeUInt32LE(contentBuf.length, 22)
    lh.writeUInt16LE(fnBuf.length, 26)
    lh.writeUInt16LE(0, 28)

    localHeaders.push(lh, fnBuf, compBuf)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0, 8)
    cd.writeUInt16LE(8, 10)
    cd.writeUInt32LE(0, 12)
    cd.writeUInt32LE(0x12345678, 16)
    cd.writeUInt32LE(compBuf.length, 20)
    cd.writeUInt32LE(contentBuf.length, 24)
    cd.writeUInt16LE(fnBuf.length, 28)
    cd.writeUInt16LE(0, 30)
    cd.writeUInt16LE(0, 32)
    cd.writeUInt16LE(0, 34)
    cd.writeUInt16LE(0, 36)
    cd.writeUInt32LE(0, 38)
    cd.writeUInt32LE(offset, 42)

    cdEntries.push(cd, fnBuf)
    offset += 30 + fnBuf.length + compBuf.length
  }

  const localData = Buffer.concat(localHeaders)
  const cdData = Buffer.concat(cdEntries)

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(Object.keys(files).length, 8)
  eocd.writeUInt16LE(Object.keys(files).length, 10)
  eocd.writeUInt32LE(cdData.length, 12)
  eocd.writeUInt32LE(localData.length, 16)
  eocd.writeUInt16LE(0, 20)

  return new Uint8Array(Buffer.concat([localData, cdData, eocd]))
}

test('DEF-01 Verification: Tool authorization classifier and origin gating', () => {
  // 1. All 26 tools are classified
  const toolNames = [
    'think', 'getPageTitle', 'captureScreenshot', 'getAccessibilitySnapshot', 'findElements',
    'listen', 'captureAudio', 'writeContent', 'summarizePage', 'getMemories',
    'translateText', 'detectLanguage', 'captureCurrentPage', 'searchVault', 'getVaultStats',
    'getPlaybook', 'getTabs', 'openTab', 'closeTab', 'clickElement',
    'fillInput', 'scrollUp', 'scrollDown', 'pressKey', 'highlightSelector',
    'highlightText', 'storeMemory', 'switchTab'
  ]

  for (const name of toolNames) {
    const classification = classifyTool(name)
    assert.ok(classification, `Tool '${name}' must be classified in TOOL_CLASSIFICATIONS`)
    assert.ok(['READ_ONLY', 'MUTATING'].includes(classification.actionType))
  }

  // 2. High-impact check enforcement
  const normalNav = evaluateHighImpact('openTab', { url: 'https://example.com' })
  assert.strictEqual(normalNav.isHighImpact, false)

  const sensitiveNav = evaluateHighImpact('openTab', { url: 'https://banking.chase.com/login' })
  assert.strictEqual(sensitiveNav.isHighImpact, true)
  assert.ok(sensitiveNav.reason?.includes('sensitive'))

  const sensitiveClick = evaluateHighImpact('clickElement', { description: 'Confirm Payment and Checkout' })
  assert.strictEqual(sensitiveClick.isHighImpact, true)

  const sensitiveInput = evaluateHighImpact('fillInput', { fieldName: 'password', value: 'secret' })
  assert.strictEqual(sensitiveInput.isHighImpact, true)
})

test('DEF-01 Verification: Voice authorization gate rejects invalid/unauthorized voice calls', () => {
  const rejected = voiceAuthorizationManager.validateAndConsume(undefined, {
    toolName: 'openTab',
    parameters: { url: 'https://example.com' }
  })
  assert.strictEqual(rejected.authorized, false)
  assert.strictEqual(rejected.reason, 'MISSING_TOKEN')
})

test('DEF-02 Verification: DocumentProcessor decompressing DOCX with zero dummy rows', async () => {
  const docxXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Production Report 2026</w:t></w:r></w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Service</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Status</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Local SLM</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Operational</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`

  const zip = createZipArchive({ 'word/document.xml': docxXml })
  const file = createMockFile('status.docx', zip, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  const res = await documentProcessor.processDocument(file)

  assert.strictEqual(res.fileType, 'docx')
  assert.strictEqual(res.tables.length, 1)
  assert.deepStrictEqual(res.tables[0].headers, ['Service', 'Status'])
  assert.deepStrictEqual(res.tables[0].rows, [['Local SLM', 'Operational']])
  assert.ok(!res.fullText.includes('Document Table Column 1'))
})

test('DEF-02 Verification: DocumentProcessor decompressing PPTX with zero dummy notes', async () => {
  const slide1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide One Title</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`

  const notes1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Actual speaker note content</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:notes>`

  const zip = createZipArchive({
    'ppt/slides/slide1.xml': slide1,
    'ppt/notesSlides/notesSlide1.xml': notes1
  })
  const file = createMockFile('deck.pptx', zip, 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
  const res = await documentProcessor.processDocument(file)

  assert.strictEqual(res.fileType, 'pptx')
  assert.strictEqual(res.slides?.[0]?.title, 'Slide One Title')
  assert.strictEqual(res.slides?.[0]?.notes, 'Actual speaker note content')
  assert.ok(!res.fullText.includes('Speaker notes preserved'))
})

test('DEF-05 Verification: Structured JSON entity extraction deterministic routing', () => {
  const prompt = `Extract the person name, email, and company as JSON from: 'Contact Alice Smith at alice@example.com from Acme Corp.'`
  const result = tryDeterministicTaskExecution(prompt)

  assert.ok(result, 'Deterministic extraction must resolve for structured JSON extraction')
  const parsed = JSON.parse(result.text)
  assert.strictEqual(parsed.name, 'Alice Smith')
  assert.strictEqual(parsed.email, 'alice@example.com')
  assert.strictEqual(parsed.company, 'Acme Corp')
})

test('DEF-05 Verification: Active voice grammatical rewriting', () => {
  const prompt = `Rewrite the following sentence from passive to active voice: 'The report was submitted by the auditor yesterday.'`
  const result = tryDeterministicTaskExecution(prompt)

  assert.ok(result, 'Deterministic rewrite must resolve for passive-to-active conversion')
  assert.strictEqual(result.text, 'The auditor submitted the report yesterday.')
})
