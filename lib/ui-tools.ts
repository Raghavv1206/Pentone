// Tools that must execute in UI context (require user gesture)
// Automatically loads ALL tools with requiresUserGesture: true from registry
import type { ToolCall } from './tools'
import { getUITools } from './tool-registry'
import { WriterAPIUnavailableError } from './errors'

// Build handler map automatically from imports
const TOOL_IMPLEMENTATIONS: Record<string, (params: any) => Promise<any>> = {
  // Summarizer API tool for current page
  summarizePage: async (params: any) => {
    const { type = 'key-points', length = 'medium' } = params
    
    try {
      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id || !tab.url) {
        throw new Error('No active tab found')
      }

      // Skip internal browser URLs
      if (tab.url.startsWith('chrome://') || 
          tab.url.startsWith('chrome-extension://') ||
          tab.url.startsWith('about:')) {
        throw new Error('Cannot summarize internal browser pages')
      }

      // Inject Readability.js for article fallback
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['assets/Readability.js']
        })
      } catch (err) {
        console.warn('Could not inject Readability.js, using DOM extractor:', err)
      }

      // Extract content with specialized SPA and YouTube support
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          try {
            const hostname = window.location.hostname
            const pathname = window.location.pathname

            // 1. YouTube specialized extraction
            if (hostname.includes('youtube.com')) {
              const isWatch = pathname.startsWith('/watch')
              if (isWatch) {
                const title = (document.querySelector('h1.ytd-watch-metadata, #title h1, h1.title') as HTMLElement)?.innerText?.trim() || document.title
                const channel = (document.querySelector('#owner #channel-name, ytd-channel-name, #upload-info #channel-name') as HTMLElement)?.innerText?.trim() || ''
                const meta = (document.querySelector('#info #info-strings, #metadata-line, ytd-video-meta-block') as HTMLElement)?.innerText?.trim() || ''
                const desc = (document.querySelector('#description-inline-expander, #description, ytd-text-inline-expander') as HTMLElement)?.innerText?.trim() || ''
                
                const ytContent = `Video Title: ${title}\nChannel: ${channel}\nStats: ${meta}\n\nVideo Description:\n${desc}`
                return {
                  success: true,
                  title: title || document.title,
                  content: ytContent
                }
              } else {
                // YouTube Homepage, Search, or Channel Feed
                const activeFilter = (document.querySelector('yt-chip-cloud-chip-renderer[selected]') as HTMLElement)?.innerText?.trim() || 'All'
                const videoNodes = document.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer')
                const videos: string[] = []
                videoNodes.forEach((node) => {
                  const titleEl = node.querySelector('#video-title, #video-title-link, h3') as HTMLElement
                  const channelEl = node.querySelector('#channel-name, ytd-channel-name, .ytd-channel-name') as HTMLElement
                  const metaEl = node.querySelector('#metadata-line, ytd-video-meta-block') as HTMLElement
                  const t = titleEl ? (titleEl.innerText || titleEl.getAttribute('title') || '').trim() : ''
                  const c = channelEl ? channelEl.innerText.trim() : ''
                  const m = metaEl ? metaEl.innerText.replace(/\s+/g, ' ').trim() : ''
                  if (t && !videos.some(item => item.includes(t))) {
                    videos.push(`- "${t}" by ${c}${m ? ` (${m})` : ''}`)
                  }
                })

                if (videos.length > 0) {
                  const feedContent = `Platform: YouTube\nPage: ${document.title}\nActive Filter / Topic: ${activeFilter}\n\nVisible Videos & Recommendations:\n${videos.slice(0, 15).join('\n')}`
                  return {
                    success: true,
                    title: document.title,
                    content: feedContent
                  }
                }
              }
            }

            // 2. Structured data extraction (emails, phones, social links)
            const structuredData: string[] = []
            const emails = new Set<string>()
            document.querySelectorAll('a[href^="mailto:"]').forEach(link => {
              const href = link.getAttribute('href')
              if (href) {
                const email = href.replace('mailto:', '').split('?')[0].trim()
                if (email && email.includes('@')) emails.add(email)
              }
            })
            const phones = new Set<string>()
            document.querySelectorAll('a[href^="tel:"]').forEach(link => {
              const href = link.getAttribute('href')
              if (href) {
                const phone = href.replace('tel:', '').trim()
                if (phone) phones.add(phone)
              }
            })
            if (emails.size > 0) structuredData.push('\n\nContact Emails: ' + Array.from(emails).join(', '))
            if (phones.size > 0) structuredData.push('\n\nContact Phones: ' + Array.from(phones).join(', '))

            // 3. Clone document and clean boilerplate
            const documentClone = document.cloneNode(true) as Document
            const removeSelectors = [
              'script', 'style', 'noscript', 'nav', 'footer', 'header', 'aside',
              '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
              '.nav', '.menu', '.footer', '.header', '.sidebar', '.cookie-banner',
              '[id*="cookie"]', '[id*="consent"]', '[class*="cookie"]', '[class*="consent"]',
              '.ad', '.ads', '[id*="google_ads"]'
            ]
            removeSelectors.forEach(sel => {
              documentClone.querySelectorAll(sel).forEach(el => el.remove())
            })

            // 4. Try Readability for editorial content
            let cleanContent = ''
            let docTitle = document.title
            try {
              // @ts-ignore
              if (typeof Readability !== 'undefined') {
                // @ts-ignore
                const reader = new Readability(documentClone, {
                  keepClasses: false,
                  charThreshold: 100
                })
                const article = reader.parse()
                if (article && article.textContent && article.textContent.trim().length >= 250) {
                  cleanContent = article.textContent.replace(/\s+/g, ' ').trim()
                  docTitle = article.title || document.title
                }
              }
            } catch {}

            // 5. Fallback for dynamic SPAs, dashboards, and structured pages
            if (!cleanContent || cleanContent.length < 250) {
              const mainElement = documentClone.querySelector('main, article, [role="main"], #content, .content, body') as HTMLElement
              if (mainElement) {
                // Extract headings and text
                const sections: string[] = []
                mainElement.querySelectorAll('h1, h2, h3, p, li').forEach(node => {
                  const text = (node as HTMLElement).innerText ? (node as HTMLElement).innerText.trim() : node.textContent?.trim()
                  if (text && text.length > 20 && !sections.includes(text)) {
                    sections.push(text)
                  }
                })
                if (sections.length > 0) {
                  cleanContent = sections.join('\n\n')
                } else {
                  cleanContent = (mainElement.innerText || mainElement.textContent || '').replace(/\s+/g, ' ').trim()
                }
              }
            }

            cleanContent += structuredData.join('')

            if (!cleanContent || cleanContent.length < 50) {
              return { 
                success: false, 
                error: 'Insufficient readable content could be extracted from this webpage. The page may require login, be protected, or contain primarily media/canvas without accessible text.' 
              }
            }

            return {
              success: true,
              title: docTitle,
              content: cleanContent
            }
          } catch (error: any) {
            return { success: false, error: error.message }
          }
        }
      })

      const extracted = results?.[0]?.result as any
      if (!extracted || !extracted.success || !extracted.content) {
        throw new Error(extracted?.error || 'Failed to extract readable content from page')
      }

      // Chunking helper to prevent input overflow
      const chunkText = (text: string, maxChunk: number = 3500): string[] => {
        const paragraphs = text.split(/\n\s*\n/)
        const chunks: string[] = []
        let current = ''
        for (const p of paragraphs) {
          if ((current + '\n\n' + p).length <= maxChunk) {
            current = current ? current + '\n\n' + p : p
          } else {
            if (current) chunks.push(current)
            if (p.length > maxChunk) {
              let rem = p
              while (rem.length > maxChunk) {
                const cutIdx = rem.lastIndexOf('\n', maxChunk) !== -1 
                  ? rem.lastIndexOf('\n', maxChunk)
                  : rem.lastIndexOf('. ', maxChunk) !== -1 
                    ? rem.lastIndexOf('. ', maxChunk) + 1 
                    : maxChunk
                chunks.push(rem.slice(0, cutIdx).trim())
                rem = rem.slice(cutIdx).trim()
              }
              current = rem
            } else {
              current = p
            }
          }
        }
        if (current) chunks.push(current)
        return chunks.length > 0 ? chunks : [text.slice(0, maxChunk)]
      }

      const content = extracted.content
      let summary = ''

      // Check Summarizer API availability
      let summarizerAvailable = false
      if ('Summarizer' in self) {
        try {
          const availability = await (self as any).Summarizer.availability()
          summarizerAvailable = (availability === 'available' || availability === 'readily' || availability === 'downloadable')
        } catch {}
      }

      if (summarizerAvailable) {
        const summarizer = await (self as any).Summarizer.create({
          type,
          format: 'plain-text',
          length,
          outputLanguage: 'en',
          expectedOutputs: [{ type: 'text', languages: ['en'] }]
        })

        try {
          if (content.length > 4000) {
            const chunks = chunkText(content, 3500)
            const chunkSummaries: string[] = []
            for (const chunk of chunks) {
              const res = await summarizer.summarize(chunk)
              if (res && res.trim()) chunkSummaries.push(res.trim())
            }
            if (chunkSummaries.length > 1) {
              const combined = chunkSummaries.join('\n\n')
              if (combined.length > 3500) {
                summary = await summarizer.summarize(combined)
              } else {
                summary = combined
              }
            } else if (chunkSummaries.length === 1) {
              summary = chunkSummaries[0]
            }
          } else {
            summary = await summarizer.summarize(content)
          }
        } finally {
          summarizer.destroy?.()
        }
      } else {
        // Fallback to Chrome LanguageModel (Prompt API)
        const lm = (self as any).LanguageModel || (self as any).ai?.languageModel
        if (!lm) {
          throw new WriterAPIUnavailableError('Neither Summarizer API nor LanguageModel API is available in this browser')
        }
        const session = await lm.create({
          systemPrompt: 'You are an accurate webpage summarizer. Summarize the webpage content thoroughly and factually, focusing on main topics, key points, and essential facts. Do not invent details not present in the content.'
        })
        try {
          summary = await session.prompt(`Summarize the following webpage content (${length} length, format: ${type}):\n\n${content.slice(0, 6000)}`)
        } finally {
          session.destroy?.()
        }
      }

      if (!summary || !summary.trim()) {
        throw new Error('Failed to generate summary from extracted content')
      }

      return `Summary of "${extracted.title}":\n\n${summary.trim()}`
    } catch (error: any) {
      console.error('Page summarization error:', error)
      if (error instanceof WriterAPIUnavailableError) {
        throw error
      }
      throw new Error(`Page summarization error: ${error.message}`)
    }
  },
  
  translateText: async (params: any) => {
    const { text, sourceLanguage, targetLanguage } = params
    
    if (!text) {
      throw new Error('Text parameter is required')
    }
    if (!sourceLanguage || !targetLanguage) {
      throw new Error('Both sourceLanguage and targetLanguage are required')
    }
    
    // Check if Translator API is available
    if (!('Translator' in self)) {
      throw new WriterAPIUnavailableError('Translator API is not available in this browser')
    }
    
    try {
      // Check availability for this language pair
      const availability = await (self as any).Translator.availability({
        sourceLanguage,
        targetLanguage
      })
      
      if (availability === 'no') {
        throw new WriterAPIUnavailableError(`Translation from ${sourceLanguage} to ${targetLanguage} is not supported`)
      }
      
      // Create translator (will download if needed)
      let translator
      if (availability === 'available') {
        // Ready to use immediately
        translator = await (self as any).Translator.create({
          sourceLanguage,
          targetLanguage
        })
      } else if (availability === 'downloadable') {
        // Model needs to be downloaded - this requires user gesture which we have
        console.log(`Translator model needs download for ${sourceLanguage} → ${targetLanguage}`)
        translator = await (self as any).Translator.create({
          sourceLanguage,
          targetLanguage,
          monitor(m: any) {
            m.addEventListener('downloadprogress', (e: any) => {
              console.log(`Translator downloading: ${(e.loaded * 100).toFixed(0)}%`)
            })
          }
        })
      } else {
        throw new WriterAPIUnavailableError(`Translation availability status unknown: ${availability}`)
      }
      
      // Translate the text
      const result = await translator.translate(text)
      
      // Clean up
      translator.destroy?.()
      
      return result
    } catch (error: any) {
      console.error('Translator API error:', error)
      if (error instanceof WriterAPIUnavailableError) {
        throw error
      }
      throw new Error(`Translator API error: ${error.message}`)
    }
  },
  
  // Language Detector API tool
  detectLanguage: async (params: any) => {
    const { text } = params
    
    if (!text) {
      throw new Error('Text parameter is required')
    }
    
    // Check if Language Detector API is available
    if (!('LanguageDetector' in self)) {
      throw new WriterAPIUnavailableError('Language Detector API is not available in this browser')
    }
    
    try {
      // Check availability
      const availability = await (self as any).LanguageDetector.availability()
      
      if (availability === 'no') {
        throw new WriterAPIUnavailableError('Language Detector model is not available')
      }
      
      // Create detector (will download if needed)
      let detector
      if (availability === 'available') {
        // Ready to use immediately
        detector = await (self as any).LanguageDetector.create()
      } else if (availability === 'downloadable') {
        // Model needs to be downloaded - this requires user gesture which we have
        console.log('Language Detector model needs download')
        detector = await (self as any).LanguageDetector.create({
          monitor(m: any) {
            m.addEventListener('downloadprogress', (e: any) => {
              console.log(`Language Detector downloading: ${(e.loaded * 100).toFixed(0)}%`)
            })
          }
        })
      } else {
        throw new WriterAPIUnavailableError(`Language Detector availability status unknown: ${availability}`)
      }
      
      // Detect language
      const results = await detector.detect(text)
      
      // Clean up
      detector.destroy?.()
      
      // Return top result with all candidates as a formatted string
      if (results && results.length > 0) {
        const topResult = results[0]
        const topLanguage = topResult.detectedLanguage
        const topConfidence = (topResult.confidence * 100).toFixed(1)
        
        // Format alternative detections if available
        const alternatives = results.slice(1, 5).map((r: any) => 
          `${r.detectedLanguage} (${(r.confidence * 100).toFixed(1)}%)`
        ).join(', ')
        
        let result = `Detected language: ${topLanguage} (${topConfidence}% confidence)`
        if (alternatives) {
          result += `\nAlternatives: ${alternatives}`
        }
        
        return result
      }
      
      throw new Error('No language detected')
    } catch (error: any) {
      console.error('Language Detector API error:', error)
      if (error instanceof WriterAPIUnavailableError) {
        throw error
      }
      throw new Error(`Language Detector API error: ${error.message}`)
    }
  },
  
  // Writer API tool
  writeContent: async (params: any) => {
    const { task, context, tone = 'neutral', length = 'medium', format = 'plain-text' } = params
    
    // Check if Writer API is available
    if (!('Writer' in self)) {
      throw new WriterAPIUnavailableError('Writer API is not available in this browser')
    }
    
    try {
      // Check availability
      const availability = await (self as any).Writer.availability()
      
      if (availability === 'unavailable') {
        throw new WriterAPIUnavailableError('Writer API model is not available')
      }
      
      // Create writer with options
      const options: any = {
        tone,
        length,
        format
      }
      
      let writer
      if (availability === 'available') {
        // Writer API can be used immediately
        writer = await (self as any).Writer.create(options)
      } else {
        // Model needs to be downloaded
        writer = await (self as any).Writer.create({
          ...options,
          monitor(m: any) {
            m.addEventListener('downloadprogress', (e: any) => {
              console.log(`Writer API downloading: ${(e.loaded * 100).toFixed(0)}%`)
            })
          }
        })
      }
      
      // Generate content (non-streaming for now)
      const result = await writer.write(task, context ? { context } : undefined)
      
      // Clean up
      writer.destroy()
      
      return result
    } catch (error: any) {
      console.error('Writer API error:', error)
      if (error instanceof WriterAPIUnavailableError) {
        throw error
      }
      throw new Error(`Writer API error: ${error.message}`)
    }
  }
}

export async function executeUITool(toolCall: ToolCall): Promise<any> {
  console.log('=== EXECUTING IN UI CONTEXT ===')
  console.log('Has user activation:', (navigator as any).userActivation?.isActive)
  console.log('Window object:', typeof window)
  console.log('Chrome runtime:', chrome.runtime.id)
  console.log('Tool:', toolCall.function)
  console.log('================================')
  
  const handler = TOOL_IMPLEMENTATIONS[toolCall.function]
  
  if (!handler) {
    const { findSimilarTools } = require('./tool-registry')
    const similarTools = findSimilarTools(toolCall.function)
    let errorMessage = `UI tool ${toolCall.function} not implemented in ui-tools.ts`
    
    if (similarTools.length > 0) {
      errorMessage += `\n\nDid you mean one of these?\n- ${similarTools.join('\n- ')}`
    }
    
    return { success: false, error: errorMessage }
  }
  
  try {
    const result = await handler(toolCall.arguments)
    console.log('UI tool result:', result)
    
    // Wrap raw results in expected format
    return { 
      success: true, 
      result: result 
    }
  } catch (error: any) {
    console.error('UI tool error:', error)
    return { 
      success: false, 
      error: error.message 
    }
  }
}

// Validate at runtime that all UI tools from registry are implemented
export function validateUITools(): void {
  const uiToolSpecs = getUITools()
  const missing = uiToolSpecs.filter(spec => !TOOL_IMPLEMENTATIONS[spec.name])
  
  if (missing.length > 0) {
    console.error('❌ Missing UI tool implementations:', missing.map(t => t.name))
    console.error('Add these to ui-tools.ts TOOL_IMPLEMENTATIONS')
  } else {
    console.log('✅ All UI tools implemented:', uiToolSpecs.map(t => t.name))
  }
}
