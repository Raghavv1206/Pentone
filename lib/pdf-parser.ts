// PDF text extraction using pdf.js
// Use legacy build for browser extensions
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

// Load worker from assets folder when running in browser extension context
if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('assets/pdf.worker.min.mjs')
}

export interface PDFExtractionResult {
  fullText: string
  pageTexts: string[]
  pageCount: number
  isScanned: boolean
}

/**
 * Extract structured text content and scan status from a PDF file
 */
export async function extractDetailedTextFromPDF(file: File): Promise<PDFExtractionResult> {
  try {
    console.log('[PDF Parser] Extracting text from:', file.name)
    const arrayBuffer = await file.arrayBuffer()
    
    const loadingTask = pdfjsLib.getDocument({ 
      data: arrayBuffer,
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true
    })
    const pdf = await loadingTask.promise
    console.log('[PDF Parser] PDF loaded, pages:', pdf.numPages)

    const pageTexts: string[] = []
    let totalTextLength = 0

    // Extract pages in strict sequential order
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const pageText = await extractPageText(pdf, pageNum)
      pageTexts.push(pageText)
      totalTextLength += pageText.trim().length
    }

    const fullText = pageTexts.filter(t => t.trim().length > 0).join('\n\n')
    const isScanned = pdf.numPages > 0 && totalTextLength === 0

    return {
      fullText,
      pageTexts,
      pageCount: pdf.numPages,
      isScanned
    }
  } catch (error: any) {
    console.error('[PDF Parser] Error extracting text:', error)
    throw new Error(`Failed to extract text from PDF: ${error.message}`)
  }
}

/**
 * Extract text content from a PDF file
 * @param file - PDF file to extract text from
 * @returns Extracted text content
 */
export async function extractTextFromPDF(file: File): Promise<string> {
  const result = await extractDetailedTextFromPDF(file)
  return result.fullText
}

/**
 * Extract text from a single PDF page
 */
async function extractPageText(
  pdf: pdfjsLib.PDFDocumentProxy,
  pageNum: number
): Promise<string> {
  const page = await pdf.getPage(pageNum)
  const textContent = await page.getTextContent()
  
  // Combine text items with spaces
  const pageText = textContent.items
    .map((item: any) => item.str)
    .join(' ')
    .trim()
  
  return pageText
}

/**
 * Get metadata from PDF file
 */
export async function getPDFMetadata(file: File): Promise<{
  title?: string
  author?: string
  subject?: string
  keywords?: string
  creator?: string
  producer?: string
  creationDate?: string
  modificationDate?: string
  pageCount: number
}> {
  try {
    const arrayBuffer = await file.arrayBuffer()
    const loadingTask = pdfjsLib.getDocument({ 
      data: arrayBuffer,
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true
    })
    const pdf = await loadingTask.promise
    
    const metadata = await pdf.getMetadata()
    const info = metadata.info as any // Type assertion for PDF metadata
    
    return {
      title: info?.Title,
      author: info?.Author,
      subject: info?.Subject,
      keywords: info?.Keywords,
      creator: info?.Creator,
      producer: info?.Producer,
      creationDate: info?.CreationDate,
      modificationDate: info?.ModDate,
      pageCount: pdf.numPages
    }
  } catch (error: any) {
    console.error('[PDF Parser] Error getting metadata:', error)
    return { pageCount: 0 }
  }
}
