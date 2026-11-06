// Tools that must execute in UI context (require user gesture)
// Automatically loads ALL tools with requiresUserGesture: true from registry
import type { ToolCall } from './tools'
import { getUITools } from './tool-registry'
import { WriterAPIUnavailableError } from './errors'
import {
  getLanguageModelAPI,
  getSummarizerAPI,
  getWriterAPI,
  getTranslatorAPI,
  getLanguageDetectorAPI,
  checkLanguageModelAvailability,
  checkSummarizerAvailability,
  checkWriterAvailability,
  createLMSession,
  createSummarizerSession,
  createWriterSession
} from './chrome-ai-helpers'

// Helper to determine if a URL is an internal or restricted browser page
const isInternalUrl = (url?: string): boolean => {
  if (!url) return true
  const lower = url.toLowerCase()
  return (
    lower.startsWith('chrome://') ||
    lower.startsWith('chrome-extension://') ||
    lower.startsWith('about:') ||
    lower.startsWith('devtools://') ||
    lower.startsWith('view-source:') ||
    lower.startsWith('edge://') ||
    lower.startsWith('brave://')
  )
}

// Build handler map automatically from imports
const TOOL_IMPLEMENTATIONS: Record<string, (params: any) => Promise<any>> = {
  // Summarizer API tool for current page
  summarizePage: async (params: any) => {
    const { type = 'key-points', length = 'medium' } = params
    
    try {
      // 1. Resolve target tab: if focused tab is internal (e.g. sidepanel or chrome://), look for open web tab
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
      let targetTab = activeTab

      if (isInternalUrl(targetTab?.url)) {
        // Query current window for a standard web tab
        const currentWindowTabs = await chrome.tabs.query({ currentWindow: true })
        const webTab = currentWindowTabs.find(t => !isInternalUrl(t.url))

        if (webTab) {
          targetTab = webTab
        } else {
          // Check other windows
          const allTabs = await chrome.tabs.query({})
          const anyWebTab = allTabs.find(t => !isInternalUrl(t.url))
          if (anyWebTab) {
            targetTab = anyWebTab
          } else {
            return `The currently active page is an internal browser interface ("${activeTab?.title || activeTab?.url || 'New Tab'}"). Internal browser settings and new tab pages do not contain article text to summarize. Please navigate to any webpage or article and try again.`
          }
        }
      }

      if (!targetTab?.id || !targetTab.url) {
        return 'No active webpage found to summarize. Please open an article or webpage.'
      }

      // 2. Inject Readability.js safely
      try {
        await chrome.scripting.executeScript({
          target: { tabId: targetTab.id },
          files: ['assets/Readability.js']
        })
      } catch (injectErr: any) {
        console.warn('[ui-tools] Readability.js injection failed:', injectErr)
        return `Cannot access page content on "${targetTab.title || targetTab.url}". This domain or internal page restricts extension script injection.`
      }

      // 3. Extract content with fallback
      let extracted: any = null
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: targetTab.id },
          func: () => {
            try {
              const structuredData: string[] = []
              
              // Extract emails from mailto links
              const emailLinks = document.querySelectorAll('a[href^="mailto:"]')
              const emails = new Set<string>()
              emailLinks.forEach(link => {
                const href = link.getAttribute('href')
                if (href) {
                  const email = href.replace('mailto:', '').split('?')[0].trim()
                  if (email && email.includes('@')) {
                    emails.add(email)
                  }
                }
              })
              
              // Extract phone numbers from tel links
              const phoneLinks = document.querySelectorAll('a[href^="tel:"]')
              const phones = new Set<string>()
              phoneLinks.forEach(link => {
                const href = link.getAttribute('href')
                if (href) {
                  const phone = href.replace('tel:', '').trim()
                  if (phone) {
                    phones.add(phone)
                  }
                }
              })
              
              const textContent = document.body ? document.body.innerText : ''
              const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g
              const emailMatches = textContent.match(emailRegex)
              if (emailMatches) {
                emailMatches.forEach(email => emails.add(email))
              }
              
              const phoneRegex = /\b(?:\+?1[-.]?)?\(?([0-9]{3})\)?[-.]?([0-9]{3})[-.]?([0-9]{4})\b/g
              const phoneMatches = textContent.match(phoneRegex)
              if (phoneMatches) {
                phoneMatches.forEach(phone => phones.add(phone))
              }
              
              const socialLinks = new Set<string>()
              const socialPatterns = [
                /twitter\.com\/[^\/\s"]+/i,
                /x\.com\/[^\/\s"]+/i,
                /linkedin\.com\/in\/[^\/\s"]+/i,
                /linkedin\.com\/company\/[^\/\s"]+/i,
                /facebook\.com\/[^\/\s"]+/i,
                /instagram\.com\/[^\/\s"]+/i,
                /github\.com\/[^\/\s"]+/i
              ]
              
              document.querySelectorAll('a[href]').forEach(link => {
                const href = link.getAttribute('href')
                if (href) {
                  socialPatterns.forEach(pattern => {
                    const match = href.match(pattern)
                    if (match) {
                      socialLinks.add(match[0])
                    }
                  })
                }
              })
              
              if (emails.size > 0) {
                structuredData.push('\n\nContact Emails: ' + Array.from(emails).join(', '))
              }
              if (phones.size > 0) {
                structuredData.push('\n\nContact Phones: ' + Array.from(phones).join(', '))
              }
              if (socialLinks.size > 0) {
                structuredData.push('\n\nSocial Media: ' + Array.from(socialLinks).join(', '))
              }
              
              // @ts-ignore
              if (typeof Readability !== 'undefined') {
                try {
                  const documentClone = document.cloneNode(true) as Document
                  // @ts-ignore
                  const reader = new Readability(documentClone, {
                    keepClasses: false,
                    charThreshold: 100
                  })
                  const article = reader.parse()
                  if (article && article.textContent && article.textContent.trim().length > 100) {
                    let cleanContent = article.textContent.replace(/\s+/g, ' ').trim()
                    cleanContent += structuredData.join('')
                    return {
                      success: true,
                      title: article.title || document.title,
                      content: cleanContent
                    }
                  }
                } catch {}
              }

              // Fallback to body text
              const mainElement = document.querySelector('main, article, [role="main"], #content')
              const content = mainElement 
                ? (mainElement as HTMLElement).innerText 
                : (document.body ? document.body.innerText : '')
              
              if (!content || content.trim().length < 50) {
                return { success: false, error: 'Insufficient content on page' }
              }
              
              const contentWithStructured = content.replace(/\s+/g, ' ').trim() + structuredData.join('')
              return {
                success: true,
                title: document.title,
                content: contentWithStructured
              }
            } catch (error: any) {
              return { success: false, error: error.message }
            }
          }
        })
        extracted = results?.[0]?.result
      } catch (err: any) {
        console.warn('[ui-tools] Script execution failed:', err)
        return `Unable to read page text from "${targetTab.title || targetTab.url}".`
      }

      if (!extracted || !extracted.success || !extracted.content) {
        return `Unable to find readable article content on "${targetTab.title || 'this page'}". The page may be dynamic, protected, or still loading.`
      }

      let summary: string | null = null

      // 4. PATH 1: Try Chrome's dedicated Summarizer API if available
      const Summarizer = getSummarizerAPI()
      if (Summarizer && typeof Summarizer.create === 'function') {
        try {
          const summarizerAvail = await checkSummarizerAvailability(Summarizer, {
            type,
            format: 'plain-text',
            length
          })

          if (summarizerAvail === 'available' || summarizerAvail === 'after-download') {
            const summarizer = await createSummarizerSession(Summarizer, {
              type,
              format: 'plain-text',
              length
            })

            let content = extracted.content
            let truncationPercentage = 1.0
            const minTruncation = 0.1
            
            while (truncationPercentage >= minTruncation) {
              try {
                const truncatedContent = content.substring(0, Math.floor(content.length * truncationPercentage))
                summary = await summarizer.summarize(truncatedContent)
                break
              } catch (error: any) {
                const errorMessage = error.message?.toLowerCase() || ''
                if (errorMessage.includes('too large') || errorMessage.includes('too long')) {
                  truncationPercentage -= 0.2
                  if (truncationPercentage < minTruncation) break
                } else {
                  break
                }
              }
            }

            summarizer.destroy?.()
          }
        } catch (sumErr) {
          console.warn('[ui-tools] Summarizer API failed, falling back to Prompt API:', sumErr)
        }
      }

      // 5. PATH 2: Universal Fallback using Gemini Nano LanguageModel
      if (!summary) {
        const LM = getLanguageModelAPI()
        if (LM) {
          try {
            const lmAvail = await checkLanguageModelAvailability(LM)
            if (lmAvail === 'available' || lmAvail === 'after-download') {
              const session = await createLMSession(LM, {
                systemPrompt: 'You are an expert webpage summarizer. Summarize the webpage content thoroughly. Provide comprehensive coverage, key points, principles, mechanisms, and details in clean spoken prose.'
              })

              summary = await session.prompt(`Summarize this webpage content from "${extracted.title}":\n\n${extracted.content.slice(0, 15000)}`)
              session.destroy?.()
            }
          } catch (lmErr) {
            console.warn('[ui-tools] Prompt API summarization failed:', lmErr)
          }
        }
      }

      // 6. PATH 3: Structural fallback if on-device models are still downloading
      if (!summary) {
        const cleanContent = extracted.content.slice(0, 500)
        return `Summary of "${extracted.title}":\n\n${cleanContent}...`
      }

      return `Summary of "${extracted.title}":\n\n${summary}`
    } catch (error: any) {
      console.error('Summarizer error:', error)
      return `Unable to summarize page: ${error.message || 'Unknown error'}`
    }
  },
  
  // Translator API tool
  translateText: async (params: any) => {
    const { text, sourceLanguage, targetLanguage } = params
    
    if (!text) {
      throw new Error('Text parameter is required')
    }
    if (!sourceLanguage || !targetLanguage) {
      throw new Error('Both sourceLanguage and targetLanguage are required')
    }
    
    // PATH 1: Try Chrome's dedicated Translator API if available
    const Translator = getTranslatorAPI()
    if (Translator && typeof Translator.create === 'function') {
      try {
        let availability: any = 'no'
        try {
          availability = await Translator.availability({
            sourceLanguage,
            targetLanguage
          })
        } catch {
          try {
            availability = await Translator.availability()
          } catch {}
        }
        
        if (availability === 'available' || availability === 'readily' || availability === 'downloadable' || availability === 'after-download') {
          let translator: any
          try {
            translator = await Translator.create({
              sourceLanguage,
              targetLanguage
            })
          } catch {
            translator = await Translator.create({
              sourceLanguage,
              targetLanguage,
              monitor(m: any) {
                m.addEventListener('downloadprogress', (e: any) => {
                  console.log(`Translator downloading: ${(e.loaded * 100).toFixed(0)}%`)
                })
              }
            })
          }
          
          const result = await translator.translate(text)
          translator.destroy?.()
          if (result) return result
        }
      } catch (transErr) {
        console.warn('[ui-tools] Translator API failed, falling back to LanguageModel:', transErr)
      }
    }

    // PATH 2: Universal Fallback using Gemini Nano LanguageModel
    const LM = getLanguageModelAPI()
    if (LM) {
      try {
        const lmAvail = await checkLanguageModelAvailability(LM)
        if (lmAvail === 'available' || lmAvail === 'after-download') {
          const session = await createLMSession(LM, {
            systemPrompt: `You are an expert multilingual translator. Translate the text accurately from ${sourceLanguage} to ${targetLanguage}. Output ONLY the translated text without conversational preamble or quotes.`
          })

          const result = await session.prompt(text)
          session.destroy?.()
          return result.trim().replace(/^["'`]|["'`]$/g, '')
        }
      } catch (lmErr) {
        console.error('[ui-tools] LanguageModel translation failed:', lmErr)
      }
    }

    throw new WriterAPIUnavailableError('Neither Translator nor LanguageModel API is available in this browser')
  },
  
  // Language Detector API tool
  detectLanguage: async (params: any) => {
    const { text } = params
    
    if (!text) {
      throw new Error('Text parameter is required')
    }
    
    // PATH 1: Try Chrome's dedicated LanguageDetector API if available
    const LanguageDetector = getLanguageDetectorAPI()
    if (LanguageDetector && typeof LanguageDetector.create === 'function') {
      try {
        let availability: any = 'no'
        try {
          availability = await LanguageDetector.availability()
        } catch {}
        
        if (availability === 'available' || availability === 'readily' || availability === 'downloadable' || availability === 'after-download') {
          let detector: any
          try {
            detector = await LanguageDetector.create()
          } catch {
            detector = await LanguageDetector.create({
              monitor(m: any) {
                m.addEventListener('downloadprogress', (e: any) => {
                  console.log(`Language Detector downloading: ${(e.loaded * 100).toFixed(0)}%`)
                })
              }
            })
          }
          
          const results = await detector.detect(text)
          detector.destroy?.()
          
          if (results && results.length > 0) {
            const topResult = results[0]
            const topLanguage = topResult.detectedLanguage
            const topConfidence = (topResult.confidence * 100).toFixed(1)
            
            const alternatives = results.slice(1, 5).map((r: any) => 
              `${r.detectedLanguage} (${(r.confidence * 100).toFixed(1)}%)`
            ).join(', ')
            
            let result = `Detected language: ${topLanguage} (${topConfidence}% confidence)`
            if (alternatives) {
              result += `\nAlternatives: ${alternatives}`
            }
            return result
          }
        }
      } catch (detErr) {
        console.warn('[ui-tools] LanguageDetector API failed, falling back to LanguageModel:', detErr)
      }
    }

    // PATH 2: Universal Fallback using Gemini Nano LanguageModel
    const LM = getLanguageModelAPI()
    if (LM) {
      try {
        const lmAvail = await checkLanguageModelAvailability(LM)
        if (lmAvail === 'available' || lmAvail === 'after-download') {
          const session = await createLMSession(LM, {
            systemPrompt: 'You are an expert language detector. Identify the primary language of the text. Return only the language name and ISO code, for example: English (en) or Hindi (hi).'
          })

          const res = await session.prompt(text)
          session.destroy?.()
          return `Detected language: ${res.trim()}`
        }
      } catch (lmErr) {
        console.error('[ui-tools] LanguageModel language detection failed:', lmErr)
      }
    }

    throw new WriterAPIUnavailableError('Neither LanguageDetector nor LanguageModel API is available in this browser')
  },
  
  // Writer API tool
  writeContent: async (params: any) => {
    const { task, context, tone = 'neutral', length = 'medium', format = 'plain-text' } = params

    // PATH 1: Try Chrome's dedicated Writer API if available
    const Writer = getWriterAPI()
    if (Writer && typeof Writer.create === 'function') {
      try {
        const writerAvail = await checkWriterAvailability(Writer, {
          tone,
          length,
          format
        })
        
        if (writerAvail === 'available' || writerAvail === 'after-download') {
          const writer = await createWriterSession(Writer, {
            tone,
            length,
            format
          })
          
          const result = await writer.write(task, context ? { context } : undefined)
          writer.destroy?.()
          if (result) return result
        }
      } catch (writerErr) {
        console.warn('[ui-tools] Writer API failed, falling back to LanguageModel:', writerErr)
      }
    }

    // PATH 2: Universal Fallback using Gemini Nano LanguageModel
    const LM = getLanguageModelAPI()
    if (LM) {
      try {
        const lmAvail = await checkLanguageModelAvailability(LM)
        if (lmAvail === 'available' || lmAvail === 'after-download') {
          const session = await createLMSession(LM, {
            systemPrompt: `You are an expert writing assistant. Task: ${task}. Context: ${context || 'None'}. Tone: ${tone}. Length: ${length}. Output ONLY the written content without conversational filler or quotes.`
          })

          const result = await session.prompt(task)
          session.destroy?.()
          return result.trim().replace(/^["'`]|["'`]$/g, '')
        }
      } catch (lmErr) {
        console.error('[ui-tools] LanguageModel writeContent failed:', lmErr)
      }
    }

    throw new WriterAPIUnavailableError('Neither Writer nor LanguageModel API is available in this browser')
  }
}

export async function executeUITool(toolCall: ToolCall): Promise<any> {
  console.log('=== EXECUTING IN UI CONTEXT ===')
  console.log('Has user activation:', (navigator as any).userActivation?.isActive)
  console.log('Window object:', typeof window)
  console.log('Chrome runtime:', chrome.runtime?.id)
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
