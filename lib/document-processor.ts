/**
 * Pentone Local Multi-Format Document Processor
 * 
 * Supports offline, zero-egress extraction, chunking, and semantic analysis for:
 * 1. PDF Documents (page extraction, metadata, scanned-page detection).
 * 2. Word Documents (.docx paragraph, heading, and table extraction via genuine ZIP/OOXML decompression).
 * 3. PowerPoint Presentations (.pptx slide text, notes, tables, and slide relationships via genuine ZIP/OOXML decompression).
 * 4. Text, Markdown, HTML, and JSON files.
 * 
 * Invariants:
 * - Real decompression via ZipExtractor (no raw byte regex on compressed streams).
 * - Zero hardcoded or dummy table rows/slide notes.
 * - Accurate reporting of scanned PDFs without simulated OCR.
 */

import { extractDetailedTextFromPDF, getPDFMetadata } from './pdf-parser'
import { ZipExtractor } from './zip-extractor'

export interface ExtractedTable {
  headers: string[]
  rows: string[][]
}

export interface ExtractedSlide {
  slideNumber: number
  title?: string
  content: string[]
  notes?: string
  tables?: ExtractedTable[]
  hasImages?: boolean
}

export interface ProcessedDocumentResult {
  fileName: string
  fileType: 'pdf' | 'docx' | 'pptx' | 'text' | 'html' | 'markdown' | 'json' | 'unknown'
  title?: string
  fullText: string
  wordCount: number
  pageOrSlideCount?: number
  tables: ExtractedTable[]
  slides?: ExtractedSlide[]
  chunks: string[]
  metadata: Record<string, any>
}

export class DocumentProcessor {
  private static instance: DocumentProcessor | null = null

  private constructor() {}

  public static getInstance(): DocumentProcessor {
    if (!DocumentProcessor.instance) {
      DocumentProcessor.instance = new DocumentProcessor()
    }
    return DocumentProcessor.instance
  }

  /**
   * Main entry point to process any supported document file.
   */
  public async processDocument(file: File): Promise<ProcessedDocumentResult> {
    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    
    if (ext === 'pdf' || file.type === 'application/pdf') {
      return this.processPDF(file)
    }

    if (ext === 'docx' || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      return this.processDOCX(file)
    }

    if (ext === 'pptx' || file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
      return this.processPPTX(file)
    }

    // Fallback to text / plaintext formats
    return this.processPlainText(file, ext)
  }

  /**
   * Processes PDF documents using PDF.js with metadata extraction and scanned-page detection.
   */
  private async processPDF(file: File): Promise<ProcessedDocumentResult> {
    const detailed = await extractDetailedTextFromPDF(file)
    let title: string | undefined

    try {
      const meta = await getPDFMetadata(file)
      title = meta.title || undefined
    } catch {}

    const chunks = this.chunkText(detailed.fullText, 1000, 150)
    const wordCount = detailed.fullText.split(/\s+/).filter(Boolean).length

    return {
      fileName: file.name,
      fileType: 'pdf',
      title: title || file.name,
      fullText: detailed.fullText,
      wordCount,
      pageOrSlideCount: detailed.pageCount,
      tables: [],
      chunks,
      metadata: {
        fileSize: file.size,
        lastModified: file.lastModified,
        isScanned: detailed.isScanned,
        ocrStatus: detailed.isScanned ? 'scanned_pdf_local_ocr_unavailable' : 'text_layer_extracted'
      }
    }
  }

  /**
   * Processes Microsoft Word .docx files.
   * Decompresses the OOXML ZIP archive and parses document paragraphs and tables.
   */
  public async processDOCX(file: File): Promise<ProcessedDocumentResult> {
    try {
      const arrayBuffer = await file.arrayBuffer()
      const zip = await ZipExtractor.fromBuffer(arrayBuffer)

      // 1. Read word/document.xml
      const documentXml = await zip.readText('word/document.xml')
      if (!documentXml) {
        throw new Error('word/document.xml not found in DOCX archive')
      }

      // 2. Extract Document Title from docProps/core.xml if present
      let title = file.name.replace(/\.docx$/i, '')
      try {
        const coreXml = await zip.readText('docProps/core.xml')
        if (coreXml) {
          const titleMatch = coreXml.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i)
          if (titleMatch && titleMatch[1]?.trim()) {
            title = titleMatch[1].trim()
          }
        }
      } catch {}

      // 3. Extract Tables from documentXml (<w:tbl> ... </w:tbl>)
      const tables: ExtractedTable[] = []
      const tblRegex = /<w:tbl[\s>][\s\S]*?<\/w:tbl>/gi
      let tblMatch: RegExpExecArray | null

      while ((tblMatch = tblRegex.exec(documentXml)) !== null) {
        const tblContent = tblMatch[0]
        const rowRegex = /<w:tr[\s>][\s\S]*?<\/w:tr>/gi
        const rows: string[][] = []
        let rowMatch: RegExpExecArray | null

        while ((rowMatch = rowRegex.exec(tblContent)) !== null) {
          const rowContent = rowMatch[0]
          const cellRegex = /<w:tc[\s>][\s\S]*?<\/w:tc>/gi
          const cells: string[] = []
          let cellMatch: RegExpExecArray | null

          while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
            const cellText = this.extractTextFromXmlRuns(cellMatch[0])
            cells.push(cellText.trim())
          }

          if (cells.length > 0) {
            rows.push(cells)
          }
        }

        if (rows.length > 0) {
          const headers = rows[0]
          const dataRows = rows.slice(1)
          tables.push({ headers, rows: dataRows })
        }
      }

      // 4. Extract Paragraphs in exact document order (<w:p> ... </w:p>)
      // (Exclude paragraphs that are nested inside tables to prevent duplication)
      const xmlWithoutTables = documentXml.replace(/<w:tbl[\s>][\s\S]*?<\/w:tbl>/gi, '\n')
      const pRegex = /<w:p[\s>][\s\S]*?<\/w:p>/gi
      const paragraphs: string[] = []
      let pMatch: RegExpExecArray | null

      while ((pMatch = pRegex.exec(xmlWithoutTables)) !== null) {
        const text = this.extractTextFromXmlRuns(pMatch[0]).trim()
        if (text) {
          paragraphs.push(text)
        }
      }

      // 5. Build full text including table contents
      const fullTextParts: string[] = [...paragraphs]
      for (const t of tables) {
        if (t.headers.length > 0) {
          fullTextParts.push(`Table: ${t.headers.join(' | ')}`)
          for (const r of t.rows) {
            fullTextParts.push(`Row: ${r.join(' | ')}`)
          }
        }
      }

      const fullText = fullTextParts.join('\n\n')
      const chunks = this.chunkText(fullText, 1000, 150)
      const wordCount = fullText.split(/\s+/).filter(Boolean).length

      return {
        fileName: file.name,
        fileType: 'docx',
        title,
        fullText,
        wordCount,
        tables,
        chunks,
        metadata: {
          fileSize: file.size,
          lastModified: file.lastModified,
          paragraphCount: paragraphs.length,
          tableCount: tables.length
        }
      }
    } catch (err: any) {
      throw new Error(`Failed to extract text from DOCX file ${file.name}: ${err?.message || err}`)
    }
  }

  /**
   * Processes Microsoft PowerPoint .pptx presentations.
   * Decompresses the OOXML presentation archive and extracts ordered slides, slide text,
   * actual speaker notes, and presentation tables.
   */
  public async processPPTX(file: File): Promise<ProcessedDocumentResult> {
    try {
      const arrayBuffer = await file.arrayBuffer()
      const zip = await ZipExtractor.fromBuffer(arrayBuffer)

      // 1. Identify slide entries and establish presentation order from manifest metadata
      const fileNames = zip.getFileNames()
      let slideFiles: string[] = []

      try {
        if (zip.hasFile('ppt/presentation.xml') && zip.hasFile('ppt/_rels/presentation.xml.rels')) {
          const presXml = await zip.readText('ppt/presentation.xml')
          const relsXml = await zip.readText('ppt/_rels/presentation.xml.rels')

          if (presXml && relsXml) {
            // Map relationship IDs to target slide files
            const relMap = new Map<string, string>()
            const relRegex = /<Relationship[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/gi
            let m: RegExpExecArray | null
            while ((m = relRegex.exec(relsXml)) !== null) {
              let target = m[2].replace(/^\/?ppt\//i, '').replace(/^\.\//, '')
              if (!target.startsWith('ppt/')) {
                target = `ppt/${target}`
              }
              relMap.set(m[1], target)
            }

            // Extract slide sequence from <p:sldIdLst> in presentation.xml
            const sldRegex = /<p:sldId[^>]*?r:id="([^"]+)"/gi
            while ((m = sldRegex.exec(presXml)) !== null) {
              const rId = m[1]
              const target = relMap.get(rId)
              if (target && zip.hasFile(target) && !slideFiles.includes(target)) {
                slideFiles.push(target)
              }
            }
          }
        }
      } catch (err) {
        console.warn('[DocumentProcessor] Could not parse presentation relationships, falling back to filename order:', err)
      }

      // Fallback: If relationship manifest was absent or empty, sort slide filenames
      if (slideFiles.length === 0) {
        slideFiles = fileNames
          .filter(f => /^ppt\/slides\/slide\d+\.xml$/i.test(f))
          .sort((a, b) => {
            const numA = parseInt(a.replace(/^[^\d]*(\d+)[^\d]*$/i, '$1') || '0', 10)
            const numB = parseInt(b.replace(/^[^\d]*(\d+)[^\d]*$/i, '$1') || '0', 10)
            return numA - numB
          })
      }

      if (slideFiles.length === 0) {
        throw new Error('No slides found in PPTX presentation archive')
      }

      let presentationTitle = file.name.replace(/\.pptx$/i, '')
      try {
        const coreXml = await zip.readText('docProps/core.xml')
        if (coreXml) {
          const titleMatch = coreXml.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i)
          if (titleMatch && titleMatch[1]?.trim()) {
            presentationTitle = titleMatch[1].trim()
          }
        }
      } catch {}

      const slides: ExtractedSlide[] = []
      const allTextRuns: string[] = []

      for (let i = 0; i < slideFiles.length; i++) {
        const slidePath = slideFiles[i]
        const slideNumber = i + 1
        const slideXml = await zip.readText(slidePath)

        if (!slideXml) continue

        // Extract slide text lines from <a:p> and <a:t>
        const slideTextRuns: string[] = []
        const pRegex = /<a:p[\s>][\s\S]*?<\/a:p>/gi
        let pMatch: RegExpExecArray | null

        while ((pMatch = pRegex.exec(slideXml)) !== null) {
          const line = this.extractTextFromXmlRuns(pMatch[0], 'a:t').trim()
          if (line) {
            slideTextRuns.push(line)
          }
        }

        const title = slideTextRuns.length > 0 ? slideTextRuns[0] : `Slide ${slideNumber}`

        // Extract slide tables (<a:tbl>)
        const slideTables: ExtractedTable[] = []
        const tblRegex = /<a:tbl[\s>][\s\S]*?<\/a:tbl>/gi
        let tblMatch: RegExpExecArray | null

        while ((tblMatch = tblRegex.exec(slideXml)) !== null) {
          const tblContent = tblMatch[0]
          const rowRegex = /<a:tr[\s>][\s\S]*?<\/a:tr>/gi
          const rows: string[][] = []
          let rowMatch: RegExpExecArray | null

          while ((rowMatch = rowRegex.exec(tblContent)) !== null) {
            const cellRegex = /<a:tc[\s>][\s\S]*?<\/a:tc>/gi
            const cells: string[] = []
            let cellMatch: RegExpExecArray | null

            while ((cellMatch = cellRegex.exec(rowMatch[0])) !== null) {
              const cellText = this.extractTextFromXmlRuns(cellMatch[0], 'a:t').trim()
              cells.push(cellText)
            }
            if (cells.length > 0) rows.push(cells)
          }

          if (rows.length > 0) {
            slideTables.push({ headers: rows[0], rows: rows.slice(1) })
          }
        }

        // Check for genuine speaker notes: inspect slide relationship first, then fallback
        let speakerNotes: string | undefined
        const slideBaseName = slidePath.split('/').pop() || ''
        const slideRelsPath = `ppt/slides/_rels/${slideBaseName}.rels`
        let targetNotesPath: string | null = null

        if (zip.hasFile(slideRelsPath)) {
          try {
            const slideRelsXml = await zip.readText(slideRelsPath)
            if (slideRelsXml) {
              const notesRelMatch = slideRelsXml.match(/<Relationship[^>]*?Type="[^"]*\/notesSlide"[^>]*?Target="([^"]+)"/i)
              if (notesRelMatch) {
                let relTarget = notesRelMatch[1].replace(/^\.\.\//, 'ppt/')
                if (!relTarget.startsWith('ppt/')) relTarget = `ppt/${relTarget}`
                if (zip.hasFile(relTarget)) {
                  targetNotesPath = relTarget
                }
              }
            }
          } catch {}
        }

        if (!targetNotesPath) {
          const fallbackPath = `ppt/notesSlides/notesSlide${slideNumber}.xml`
          if (zip.hasFile(fallbackPath)) {
            targetNotesPath = fallbackPath
          }
        }

        if (targetNotesPath) {
          const notesXml = await zip.readText(targetNotesPath)
          if (notesXml) {
            const noteText = this.extractTextFromXmlRuns(notesXml, 'a:t').trim()
            // Filter out slide number references from notes slides
            if (noteText && noteText !== String(slideNumber)) {
              speakerNotes = noteText
            }
          }
        }

        slides.push({
          slideNumber,
          title,
          content: slideTextRuns,
          notes: speakerNotes,
          tables: slideTables.length > 0 ? slideTables : undefined,
          hasImages: slideXml.includes('<p:pic')
        })

        allTextRuns.push(`Slide ${slideNumber}: ${title}`)
        if (slideTextRuns.length > 1) {
          allTextRuns.push(slideTextRuns.slice(1).join('\n'))
        }
        if (speakerNotes) {
          allTextRuns.push(`Speaker Notes: ${speakerNotes}`)
        }
      }

      const fullText = allTextRuns.join('\n\n')
      const chunks = this.chunkText(fullText, 1000, 150)
      const wordCount = fullText.split(/\s+/).filter(Boolean).length

      return {
        fileName: file.name,
        fileType: 'pptx',
        title: presentationTitle,
        fullText,
        wordCount,
        pageOrSlideCount: slides.length,
        tables: slides.flatMap(s => s.tables || []),
        slides,
        chunks,
        metadata: {
          fileSize: file.size,
          lastModified: file.lastModified,
          slideCount: slides.length
        }
      }
    } catch (err: any) {
      throw new Error(`Failed to extract text from PPTX file ${file.name}: ${err?.message || err}`)
    }
  }

  /**
   * Extracts text from XML text elements (e.g. <w:t> or <a:t>).
   */
  private extractTextFromXmlRuns(xmlSnippet: string, tagName: 'w:t' | 'a:t' = 'w:t'): string {
    const regex = new RegExp(`<${tagName}[^>]*>([^<]*)<\\/${tagName}>`, 'gi')
    let text = ''
    let match: RegExpExecArray | null

    while ((match = regex.exec(xmlSnippet)) !== null) {
      if (match[1]) {
        text += match[1]
      }
    }
    return text
  }

  /**
   * Handles plain text, markdown, HTML, and JSON files.
   */
  private async processPlainText(file: File, ext: string): Promise<ProcessedDocumentResult> {
    const fullText = await file.text()
    const chunks = this.chunkText(fullText, 1000, 150)
    const wordCount = fullText.split(/\s+/).filter(Boolean).length

    let fileType: ProcessedDocumentResult['fileType'] = 'text'
    if (ext === 'md') fileType = 'markdown'
    else if (ext === 'html') fileType = 'html'
    else if (ext === 'json') fileType = 'json'

    return {
      fileName: file.name,
      fileType,
      title: file.name,
      fullText,
      wordCount,
      tables: [],
      chunks,
      metadata: { fileSize: file.size }
    }
  }

  /**
   * Splits document text into overlapping chunks suitable for semantic embeddings.
   */
  public chunkText(text: string, chunkSize = 1000, overlap = 150): string[] {
    if (!text || text.trim().length === 0) return []
    if (text.length <= chunkSize) return [text.trim()]

    const chunks: string[] = []
    let start = 0

    while (start < text.length) {
      let end = start + chunkSize

      // Snap to word boundary if not at end of text
      if (end < text.length) {
        const lastSpace = text.lastIndexOf(' ', end)
        if (lastSpace > start + chunkSize / 2) {
          end = lastSpace
        }
      }

      const chunk = text.substring(start, end).trim()
      if (chunk.length > 0) {
        chunks.push(chunk)
      }

      start = end - overlap
      if (start >= text.length - overlap) break
    }

    return chunks
  }
}

export const documentProcessor = DocumentProcessor.getInstance()
