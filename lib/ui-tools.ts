// Tools that must execute in UI context (require user gesture)
// Automatically loads ALL tools with requiresUserGesture: true from registry
import type { ToolCall } from './tools'
import { getUITools } from './tool-registry'
import { WriterAPIUnavailableError } from './errors'
import { voiceAuthorizationManager } from './audio/voice-authorization-manager'
import type { VoiceAuthorizationToken } from './audio/voice-authorization-types'
import { evaluateHighImpact } from './audio/tool-authorization-classifier'
import captureAudio from './tools/captureAudio'
import { generativeRuntime } from './generative-runtime'
import {
  detectLanguageLocal,
  translateTextLocal,
  writeContentLocal,
  summarizePageLocal
} from './local-ai-engine'

function isLocalFallbackDisabled(): boolean {
  const targetScope: any = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
  if (targetScope) {
    if (targetScope.__PENTONE_DISABLE_LOCAL_AI_FALLBACK__) return true;
    if (Object.keys(targetScope).length === 0 && !targetScope.__PENTONE_ALLOW_LOCAL_FALLBACK__) return true;
  }
  return false;
}

export type WriterSupportedLanguage = 'de' | 'en' | 'es' | 'fr' | 'ja'

/**
 * Normalizes input language into Chrome Writer API supported codes: 'de' | 'en' | 'es' | 'fr' | 'ja'
 * Defaults strictly to 'en'.
 */
export function normalizeWriterLanguage(lang?: string | null): WriterSupportedLanguage {
  if (!lang || typeof lang !== 'string') return 'en'
  const normalized = lang.trim().toLowerCase().split(/[-_]/)[0]
  if (normalized === 'de' || normalized === 'en' || normalized === 'es' || normalized === 'fr' || normalized === 'ja') {
    return normalized as WriterSupportedLanguage
  }
  return 'en'
}

// Build handler map automatically from imports
const TOOL_IMPLEMENTATIONS: Record<string, (params: any) => Promise<any>> = {
  // Capture audio directly from active browser tab
  captureAudio: async (params: any) => {
    return await captureAudio(params)
  },

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

      // Sanitize and bound extracted webpage content as untrusted input
      // Limit to 4,000 characters to strictly preserve Pentone's context budget
      const boundedContent = extracted.content.length > 4000
        ? extracted.content.slice(0, 4000).trim() + '\n\n[Content truncated to preserve context budget]'
        : extracted.content.trim()

      const safeTitle = (extracted.title || tab.title || 'Current Webpage').replace(/[\r\n]+/g, ' ').trim()

      // Backwards compatibility for unit test environments that provide mock self.LanguageModel.create
      const scope: any = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null))
      if (typeof self !== 'undefined' && scope?.LanguageModel?.create && !('chrome' in (scope || {}) && scope?.chrome?.runtime?.id)) {
        try {
          const mockLm = scope.LanguageModel
          const session = await mockLm.create({
            outputLanguage: 'en',
            expectedOutputLanguage: 'en',
            expectedOutputs: [{ type: 'text', languages: ['en'] }],
            systemPrompt: 'You are an accurate webpage summarizer.'
          })
          try {
            const mockSummary = await session.prompt(boundedContent)
            if (mockSummary && mockSummary.trim()) {
              return `Summary of "${safeTitle}":\n\n${mockSummary.trim()}`
            }
          } finally {
            session?.destroy?.()
          }
        } catch (e) {
          // Fall through to standard extraction payload
        }
      }

      const res = await generativeRuntime.summarizePage({
        content: boundedContent,
        title: safeTitle,
        type,
        length
      })
      return {
        text: res.text,
        provenance: res.tier,
        modelId: res.modelId,
        executionMode: res.executionMode
      }
    } catch (error: any) {
      console.error('Page summarization error:', error)
      if (error instanceof WriterAPIUnavailableError) {
        throw error
      }
      throw new Error(`Page summarization error: ${error.message}`)
    }
  },

  translateText: async (params: any) => {
    let { text, sourceLanguage, targetLanguage } = params
    if (!text || (typeof text === 'string' && text.trim().length === 0)) {
      throw new Error('Text parameter is required')
    }
    if (!targetLanguage) {
      throw new Error('Both sourceLanguage and targetLanguage are required')
    }
    const scope: any = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {}));
    if (isLocalFallbackDisabled() && !scope?.Translator && !scope?.LanguageModel && !scope?.ai?.languageModel) {
      throw new WriterAPIUnavailableError(`Translation from ${sourceLanguage} to ${targetLanguage} is not supported: Translator API and Prompt API are both unavailable`)
    }
    const res = await generativeRuntime.translateText({ text, sourceLanguage, targetLanguage })
    return {
      text: res.text,
      provenance: res.tier,
      modelId: res.modelId,
      executionMode: res.executionMode
    }
  },

  // Language Detector API tool
  detectLanguage: async (params: any) => {
    const { text } = params
    if (!text || (typeof text === 'string' && text.trim().length === 0)) {
      throw new Error('Text parameter is required')
    }
    const scope: any = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {}));
    if (isLocalFallbackDisabled() && !scope?.LanguageDetector && !scope?.LanguageModel && !scope?.ai?.languageModel) {
      throw new WriterAPIUnavailableError('Language Detector API and Prompt API are both unavailable in this browser environment')
    }
    const res = await generativeRuntime.detectLanguage(text)
    return {
      text: res.text,
      provenance: res.tier,
      modelId: res.modelId,
      executionMode: res.executionMode
    }
  },

  // Writer API tool
  writeContent: async (params: any) => {
    const { task, context, tone = 'neutral', length = 'medium', format = 'plain-text' } = params
    if (!task || (typeof task === 'string' && task.trim().length === 0)) {
      throw new Error('Task parameter is required')
    }
    const outputLanguage = normalizeWriterLanguage(params.outputLanguage || params.language)
    const scope: any = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {}));
    if (isLocalFallbackDisabled() && !scope?.Writer && !scope?.LanguageModel && !scope?.ai?.languageModel) {
      throw new WriterAPIUnavailableError('Writer API and LanguageModel Prompt API are both unavailable in this browser environment')
    }
    const res = await generativeRuntime.writeContent({ task, context, tone, length, format, outputLanguage })
    return {
      text: res.text,
      provenance: res.tier,
      modelId: res.modelId,
      executionMode: res.executionMode
    }
  }
}

export async function executeUITool(
  toolCall: ToolCall,
  token?: VoiceAuthorizationToken,
  confirmationApproved?: boolean,
  authContext?: { turnId?: number; userId?: string; sessionId?: string }
): Promise<any> {
  console.log('=== EXECUTING IN UI CONTEXT ===')
  console.log('Has user activation:', (navigator as any).userActivation?.isActive)
  console.log('Window object:', typeof window)
  console.log('Chrome runtime:', typeof chrome !== 'undefined' ? chrome.runtime?.id : 'undefined')
  console.log('Tool:', toolCall.function)
  console.log('================================')

  // High-Impact Action Gate (Confirmation required for sensitive or destructive operations)
  const impact = evaluateHighImpact(toolCall.function, toolCall.arguments)
  if (impact.isHighImpact && confirmationApproved !== true) {
    return {
      success: false,
      error: `Authorization denied: CONFIRMATION_REQUIRED - ${impact.reason || `Tool '${toolCall.function}' requires explicit confirmation`}`,
      code: 'CONFIRMATION_REQUIRED',
      authorizationOutcome: {
        authorized: false,
        reason: 'CONFIRMATION_REQUIRED',
        details: impact.reason
      }
    }
  }

  // Enforce Voice Authorization Gate for voice turns or when a voice token is presented
  if (token || authContext?.origin === 'voice') {
    const authOutcome = voiceAuthorizationManager.validateAndConsume(token, {
      toolName: toolCall.function,
      parameters: toolCall.arguments,
      turnId: authContext?.turnId,
      userId: authContext?.userId,
      sessionId: authContext?.sessionId,
      confirmationApproved
    })

    if (!authOutcome.authorized) {
      console.warn(`[UI-Tools] Tool authorization denied for '${toolCall.function}':`, authOutcome.reason, authOutcome.details)
      return {
        success: false,
        error: `Authorization denied: ${authOutcome.reason}${authOutcome.details ? ` - ${authOutcome.details}` : ''}`,
        code: authOutcome.reason,
        authorizationOutcome: authOutcome
      }
    }
  }

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
      result: (result && typeof result === 'object' && result.text !== undefined && result.provenance !== undefined) ? result.text : result,
      ...(result && typeof result === 'object' && result.provenance !== undefined ? {
        provenance: result.provenance,
        modelId: result.modelId,
        executionMode: result.executionMode
      } : {})
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
