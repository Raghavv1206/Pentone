import { test } from 'node:test'
import assert from 'node:assert'
import zlib from 'node:zlib'
import { executeUITool } from '../lib/ui-tools'
import { DocumentProcessor } from '../lib/document-processor'
import { evaluateHighImpact } from '../lib/audio/tool-authorization-classifier'
import { TOOL_REGISTRY, isValidTool } from '../lib/tool-registry'

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

test('Phase 6: UI Tool Authorization Gate - Allows text origin without voice token', async () => {
  // Test text origin: Should NOT fail with MISSING_TOKEN
  const res = await executeUITool(
    { function: 'writeContent', arguments: { task: 'Draft brief email to team' } },
    undefined,
    undefined,
    { origin: 'text' }
  )

  // It should execute or report execution results, NOT fail with MISSING_TOKEN
  assert.notStrictEqual(res.code, 'MISSING_TOKEN', 'Text origin must not be rejected with MISSING_TOKEN')
})

test('Phase 6: UI Tool Authorization Gate - Enforces MISSING_TOKEN on voice origin', async () => {
  // Test voice origin without token: MUST fail closed with MISSING_TOKEN
  const res = await executeUITool(
    { function: 'writeContent', arguments: { task: 'Draft brief email to team' } },
    undefined,
    undefined,
    { origin: 'voice' }
  )

  assert.strictEqual(res.success, false, 'Voice turn without token must fail')
  assert.strictEqual(res.code, 'MISSING_TOKEN', 'Must reject with MISSING_TOKEN')
})

test('Phase 6: PPTX Presentation Order - Respects presentation.xml manifest over numerical filenames', async () => {
  // Create presentation where slide 2 is listed BEFORE slide 1 in presentation.xml
  const presXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId2"/>
    <p:sldId id="257" r:id="rId1"/>
  </p:sldIdLst>
</p:presentation>`

  const presRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
</Relationships>`

  const slide1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide 1: Second in presentation</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`

  const slide2Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide 2: First in presentation</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`

  // Slide 2 relationship pointing to notesSlide2
  const slide2RelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide2.xml"/>
</Relationships>`

  const notesSlide2Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Note: Intro speech for first slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:notes>`

  const zipBytes = createZipArchive({
    'ppt/presentation.xml': presXml,
    'ppt/_rels/presentation.xml.rels': presRelsXml,
    'ppt/slides/slide1.xml': slide1Xml,
    'ppt/slides/slide2.xml': slide2Xml,
    'ppt/slides/_rels/slide2.xml.rels': slide2RelsXml,
    'ppt/notesSlides/notesSlide2.xml': notesSlide2Xml
  })

  const file = new File([zipBytes], 'manifest-order.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
  const processor = DocumentProcessor.getInstance()
  const result = await processor.processDocument(file)

  assert.strictEqual(result.slides?.length, 2, 'Must extract exactly 2 slides')
  // Slide 1 in the presentation is slide2.xml because rId2 comes first in presentation.xml!
  assert.strictEqual(result.slides[0].title, 'Slide 2: First in presentation', 'First slide must be slide2.xml per presentation manifest order')
  assert.strictEqual(result.slides[0].notes, 'Note: Intro speech for first slide', 'Slide 2 must have its associated speaker notes')
  assert.strictEqual(result.slides[1].title, 'Slide 1: Second in presentation', 'Second slide must be slide1.xml per presentation manifest order')
})

test('Phase 6: Tool Registry Cardinality - Contains all registered tools', () => {
  assert.strictEqual(TOOL_REGISTRY.length, 27, 'Registry must contain exactly 27 registered tools')
  for (const t of TOOL_REGISTRY) {
    assert.ok(isValidTool(t.name), `Tool ${t.name} must be recognized by isValidTool`)
  }
})
