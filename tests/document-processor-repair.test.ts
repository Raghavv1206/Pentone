import { test } from 'node:test'
import assert from 'node:assert'
import zlib from 'node:zlib'
import { documentProcessor } from '../lib/document-processor'

// Helper to construct a minimal valid ZIP archive in memory containing compressed files
function createZipArchive(files: Record<string, string>): Uint8Array {
  const localHeaders: Buffer[] = []
  const cdEntries: Buffer[] = []
  let offset = 0

  for (const [filename, content] of Object.entries(files)) {
    const fnBuf = Buffer.from(filename, 'utf-8')
    const contentBuf = Buffer.from(content, 'utf-8')
    const compBuf = zlib.deflateRawSync(contentBuf)

    // Local Header (30 bytes + fn + data)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4) // version
    lh.writeUInt16LE(0, 6) // flags
    lh.writeUInt16LE(8, 8) // deflate
    lh.writeUInt32LE(0, 10) // time/date
    lh.writeUInt32LE(0x12345678, 14) // crc32
    lh.writeUInt32LE(compBuf.length, 18) // compressed size
    lh.writeUInt32LE(contentBuf.length, 22) // uncompressed size
    lh.writeUInt16LE(fnBuf.length, 26) // fn len
    lh.writeUInt16LE(0, 28) // extra len

    localHeaders.push(lh, fnBuf, compBuf)

    // Central Directory Entry (46 bytes + fn)
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

// Minimal mock File for node testing
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

test('DocumentProcessor DEF-02 Repair: Genuine DOCX extraction with real paragraphs and tables', async () => {
  const docxXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Quarterly Financial Results - Q3 2026</w:t></w:r></w:p>
    <w:p><w:r><w:t>Revenue exceeded expectations across all regions.</w:t></w:r></w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Department</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Budget</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Actual</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Engineering</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>$1,200,000</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>$1,150,000</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Marketing</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>$500,000</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>$480,000</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
    <w:p><w:r><w:t>Conclusion: Operating margins improved by 4.2%.</w:t></w:r></w:p>
  </w:body>
</w:document>`

  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>Q3 2026 Financial Executive Summary</dc:title>
  <dc:creator>Finance Team</dc:creator>
</cp:coreProperties>`

  const zipBytes = createZipArchive({
    'word/document.xml': docxXml,
    'docProps/core.xml': coreXml
  })

  const file = createMockFile('financial_report.docx', zipBytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  const result = await documentProcessor.processDocument(file)

  assert.strictEqual(result.fileType, 'docx')
  assert.strictEqual(result.title, 'Q3 2026 Financial Executive Summary')
  assert.ok(result.fullText.includes('Quarterly Financial Results - Q3 2026'))
  assert.ok(result.fullText.includes('Revenue exceeded expectations across all regions.'))
  assert.ok(result.fullText.includes('Conclusion: Operating margins improved by 4.2%.'))

  // Invariant: Zero dummy table headers
  assert.strictEqual(result.tables.length, 1)
  assert.deepStrictEqual(result.tables[0].headers, ['Department', 'Budget', 'Actual'])
  assert.strictEqual(result.tables[0].rows.length, 2)
  assert.deepStrictEqual(result.tables[0].rows[0], ['Engineering', '$1,200,000', '$1,150,000'])
  assert.deepStrictEqual(result.tables[0].rows[1], ['Marketing', '$500,000', '$480,000'])

  assert.ok(!result.fullText.includes('Document Table Column 1'), 'Must not contain hardcoded dummy table column')
  assert.ok(!result.fullText.includes('Extracted Table Data'), 'Must not contain hardcoded dummy table data')
})

test('DocumentProcessor DEF-02 Repair: Genuine PPTX extraction with multiple slides, notes, and tables', async () => {
  const slide1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp><p:txBody><a:p><a:r><a:t>Pentone Architecture Overview</a:t></a:r></a:p></p:txBody></p:sp>
      <p:sp><p:txBody><a:p><a:r><a:t>High-Performance Local-First Chrome Extension</a:t></a:r></a:p></p:txBody></p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`

  const notes1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Remind the team to focus on memory efficiency during slide 1.</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:notes>`

  const slide2Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp><p:txBody><a:p><a:r><a:t>Model Specifications</a:t></a:r></a:p></p:txBody></p:sp>
      <p:graphicFrame>
        <a:graphic>
          <a:graphicData>
            <a:tbl>
              <a:tr>
                <a:tc><a:txBody><a:p><a:r><a:t>Model</a:t></a:r></a:p></a:txBody></a:tc>
                <a:tc><a:txBody><a:p><a:r><a:t>Parameters</a:t></a:r></a:p></a:txBody></a:tc>
              </a:tr>
              <a:tr>
                <a:tc><a:txBody><a:p><a:r><a:t>SmolLM</a:t></a:r></a:p></a:txBody></a:tc>
                <a:tc><a:txBody><a:p><a:r><a:t>135M</a:t></a:r></a:p></a:txBody></a:tc>
              </a:tr>
            </a:tbl>
          </a:graphicData>
        </a:graphic>
      </p:graphicFrame>
    </p:spTree>
  </p:cSld>
</p:sld>`

  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>Pentone Engineering Deck</dc:title>
</cp:coreProperties>`

  const zipBytes = createZipArchive({
    'ppt/slides/slide1.xml': slide1Xml,
    'ppt/notesSlides/notesSlide1.xml': notes1Xml,
    'ppt/slides/slide2.xml': slide2Xml,
    'docProps/core.xml': coreXml
  })

  const file = createMockFile('engineering_deck.pptx', zipBytes, 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
  const result = await documentProcessor.processDocument(file)

  assert.strictEqual(result.fileType, 'pptx')
  assert.strictEqual(result.title, 'Pentone Engineering Deck')
  assert.strictEqual(result.pageOrSlideCount, 2)
  assert.strictEqual(result.slides?.length, 2)

  // Slide 1 checks
  assert.strictEqual(result.slides[0].title, 'Pentone Architecture Overview')
  assert.strictEqual(result.slides[0].notes, 'Remind the team to focus on memory efficiency during slide 1.')

  // Slide 2 checks
  assert.strictEqual(result.slides[1].title, 'Model Specifications')
  assert.strictEqual(result.slides[1].notes, undefined) // Slide 2 has no notes file
  assert.strictEqual(result.slides[1].tables?.length, 1)
  assert.deepStrictEqual(result.slides[1].tables[0].headers, ['Model', 'Parameters'])
  assert.deepStrictEqual(result.slides[1].tables[0].rows, [['SmolLM', '135M']])

  // Invariant: Zero dummy notes
  assert.ok(!result.fullText.includes('Speaker notes preserved'), 'Must not contain hardcoded dummy slide notes string')
})
