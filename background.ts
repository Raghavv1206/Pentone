import think from './lib/tools/think'
import getPageTitle from './lib/tools/getPageTitle'
import openTab from './lib/tools/openTab'
import captureScreenshot from './lib/tools/captureScreenshot'
import getAccessibilitySnapshot from './lib/tools/getAccessibilitySnapshot'
import findElements from './lib/tools/findElements'
import clickElement from './lib/tools/clickElement'
import fillInput from './lib/tools/fillInput'
import listenHandler from './lib/tools/listen'
import storeMemory from './lib/tools/storeMemory'
import getMemories from './lib/tools/getMemories'
import scrollUp from './lib/tools/scrollUp'
import scrollDown from './lib/tools/scrollDown'
import pressKey from './lib/tools/pressKey'
import highlightSelector from './lib/tools/highlightSelector'
import highlightText from './lib/tools/highlightText'
import captureCurrentPage from './lib/tools/captureCurrentPage'
import searchVault from './lib/tools/searchVault'
import getVaultStats from './lib/tools/getVaultStats'
import getPlaybook from './lib/tools/getPlaybook'
import summarizePageHandler from './lib/tools/summarizePage'
import getTabs from './lib/tools/getTabs'
import switchTab from './lib/tools/switchTab'
import closeTab from './lib/tools/closeTab'
import navigatePage from './lib/tools/navigatePage'
import controlMedia from './lib/tools/controlMedia'
import zoomPage from './lib/tools/zoomPage'
import dismissModal from './lib/tools/dismissModal'
import copyToClipboard from './lib/tools/copyToClipboard'
import selectOption from './lib/tools/selectOption'
import autofillForm from './lib/tools/autofillForm'
import scanPrivacyRisk from './lib/tools/scanPrivacyRisk'
import clipToVault from './lib/tools/clipToVault'
import voiceSurfer from './lib/tools/voiceSurfer'
import checkPhishingRisk from './lib/tools/checkPhishingRisk'
import { loadAutofillProfile, saveAutofillProfile } from './lib/autofill/profile-vault'
import { isValidTool, findSimilarTools, validateToolArguments } from './lib/tool-registry'
import { autoCapturePage } from './lib/auto-capture'
import {
  getLanguageModelAPI,
  checkLanguageModelAvailability,
  createLMSession
} from './lib/chrome-ai-helpers'
import { improveTextHeuristically, writeTextHeuristically } from './lib/heuristics/text-improver'

import { ensureOffscreenDocument } from './lib/offscreen'

// Background script for Pentone extension

// Tool handler registry - maps tool names to their implementations
type ToolHandler = (params: any, context?: string) => Promise<any>

// Wrapper for Plasmo message handlers
const plasmoWrapper = (handler: any): ToolHandler => {
  return async (params: any) => {
    return new Promise((resolve) => {
      handler({ name: '', body: params }, { 
        send: (response: any) => {
          // Convert Plasmo response format to our format
          if (response.error) {
            resolve({ success: false, error: response.error })
          } else {
            resolve({ success: true, ...response })
          }
        }
      })
    })
  }
}

const toolHandlers: Record<string, ToolHandler> = {
  think,
  getPageTitle,
  openTab,
  captureScreenshot,
  getAccessibilitySnapshot,
  findElements,
  clickElement,
  fillInput,
  listen: plasmoWrapper(listenHandler),
  storeMemory,
  getMemories,
  scrollUp,
  scrollDown,
  pressKey,
  highlightSelector,
  highlightText,
  captureCurrentPage,
  searchVault,
  getVaultStats,
  getPlaybook,
  summarizePage: plasmoWrapper(summarizePageHandler),
  getTabs,
  switchTab,
  closeTab,
  navigatePage,
  controlMedia,
  zoomPage,
  dismissModal,
  copyToClipboard,
  selectOption,
  autofillForm,
  scanPrivacyRisk,
  clipToVault,
  voiceSurfer,
  checkPhishingRisk,
  goBack: (p) => navigatePage({ action: 'back', ...p }),
  goForward: (p) => navigatePage({ action: 'forward', ...p }),
  reloadPage: (p) => navigatePage({ action: 'reload', ...p })
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('Pentone extension installed')
  // Configure side panel to open on toolbar action click
  if (typeof chrome !== 'undefined' && chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
      console.warn('[Background] Failed to set side panel behavior on install:', err)
    })
  }

  // Set up smart context menus
  if (typeof chrome !== 'undefined' && chrome.contextMenus) {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'pentone-clip-vault',
        title: 'Pentone: Clip to Memory / Vault',
        contexts: ['selection']
      })
      chrome.contextMenus.create({
        id: 'pentone-scan-privacy',
        title: 'Pentone: Scan Privacy & Terms',
        contexts: ['page']
      })
    })
  }
})

// Context menu click listener
if (typeof chrome !== 'undefined' && chrome.contextMenus?.onClicked) {
  chrome.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId === 'pentone-clip-vault') {
      clipToVault({ text: info.selectionText })
    } else if (info.menuItemId === 'pentone-scan-privacy') {
      scanPrivacyRisk()
    }
  })
}

// Configure side panel to open automatically when extension icon is clicked
if (typeof chrome !== 'undefined' && chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
    console.warn('[Background] Failed to set side panel behavior:', err)
  })
}

// Fallback action click listener to open side panel
if (typeof chrome !== 'undefined' && chrome.action?.onClicked) {
  chrome.action.onClicked.addListener((tab) => {
    if (tab.id && chrome.sidePanel?.open) {
      chrome.sidePanel.open({ tabId: tab.id }).catch((err) => {
        console.warn('[Background] Failed to open side panel:', err)
      })
    }
  })
}

// Auto-capture pages after they load
chrome.webNavigation.onCompleted.addListener((details) => {
  // Only capture main frame (not iframes)
  if (details.frameId !== 0) {
    return
  }
  
  // Wait 3 seconds for page to settle before capturing
  setTimeout(() => {
    autoCapturePage(details.tabId, details.url).catch(error => {
      console.error('[Background] Auto-capture failed:', error)
    })
  }, 3000)
})

// Handle tool execution messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message.type !== 'string') return false
  // Handle screenshot capture requests (for explainer)
  if (message.type === 'capture_screenshot') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (!tab?.id || !tab.windowId) {
          sendResponse({ success: false, error: 'No active tab found' })
          return
        }

        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
        sendResponse({ success: true, dataUrl })
      } catch (error: any) {
        sendResponse({ success: false, error: error.message })
      }
    })()
    return true // Indicates async response
  }
  
  // Handle audio capture requests (for explainer)
  if (message.type === 'capture_audio') {
    (async () => {
      try {
        const { duration = 5 } = message
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (!tab?.id) {
          sendResponse({ success: false, error: 'No active tab found' })
          return
        }

        if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
          sendResponse({ success: false, error: 'Cannot capture audio from this page' })
          return
        }

        // Get stream ID
        const streamId = await new Promise<string>((resolve, reject) => {
          chrome.tabCapture.getMediaStreamId({ consumerTabId: tab.id }, (streamId) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message))
            } else if (streamId) {
              resolve(streamId)
            } else {
              reject(new Error('Failed to get media stream ID'))
            }
          })
        })

        // Send to content script to capture
        const audioResult = await new Promise<{ result?: string; error?: string }>((resolve) => {
          chrome.tabs.sendMessage(tab.id!, {
            type: 'capture_tab_audio',
            streamId: streamId,
            duration: duration
          }, (response) => {
            if (chrome.runtime.lastError) {
              resolve({ error: chrome.runtime.lastError.message })
            } else {
              resolve(response || { error: 'No response from content script' })
            }
          })
        })

        if (audioResult.error) {
          sendResponse({ success: false, error: audioResult.error })
        } else {
          sendResponse({ success: true, audioDataUrl: audioResult.result })
        }
      } catch (error: any) {
        sendResponse({ success: false, error: error.message })
      }
    })()
    return true // Indicates async response
  }
  
  if (message.type === 'open_popup') {
    // Check if sidepanel is already open
    chrome.runtime.sendMessage({ type: 'ping_sidepanel' }).then(() => {
      // Sidepanel responded, it's open - don't open popup
      console.log('[Background] Sidepanel is open, not opening popup')
      sendResponse({ success: true, sidepanelOpen: true })
    }).catch(() => {
      // Sidepanel not open, open popup instead
      console.log('[Background] Sidepanel not open, opening popup')
      chrome.action.openPopup().catch(err => {
        console.log('[Background] Could not open popup:', err)
        sendResponse({ success: false, error: err.message })
      })
      sendResponse({ success: true, sidepanelOpen: false })
    })
    return true
  }

  // Handle opening all Chrome AI flags in tabs
  if (message.type === 'open_chrome_flags') {
    chrome.tabs.create({ url: 'chrome://flags/#optimization-guide-on-device-model' })
    chrome.tabs.create({ url: 'chrome://flags/#prompt-api-for-gemini-nano' })
    chrome.tabs.create({ url: 'chrome://flags/#writer-api-for-gemini-nano' })
    chrome.tabs.create({ url: 'chrome://flags/#rewriter-api-for-gemini-nano' })
    sendResponse({ success: true })
    return true
  }

  // Handle opening Chrome components page in a tab
  if (message.type === 'open_chrome_components') {
    chrome.tabs.create({ url: 'chrome://components' })
    sendResponse({ success: true })
    return true
  }

  // Handle opening a specific individual Chrome flag in a tab
  if (message.type === 'open_specific_flag') {
    const flagUrl = message.url || 'chrome://flags/#optimization-guide-on-device-model'
    chrome.tabs.create({ url: flagUrl })
    sendResponse({ success: true })
    return true
  }

  // Handle AI rewrite requests from content scripts (proxy fallback)
  if (message.type === 'pentone_ai_rewrite') {
    (async () => {
      try {
        const { selectedText, instruction, tone = 'as-is', length = 'as-is', pageContext = '' } = message.payload || {}
        const toneInstruction = tone === 'more-formal' ? 'Make the tone formal and professional.' : tone === 'more-casual' ? 'Make the tone casual and friendly.' : 'Keep the tone natural.'
        const lengthInstruction = length === 'shorter' ? 'Make it concise and shorter than the original.' : length === 'longer' ? 'Expand and provide rich detail.' : 'Maintain similar length.'
        const systemPrompt = `You are an expert real-time text rewriting assistant.\nUser Instruction: ${instruction}\nStyle: ${toneInstruction} ${lengthInstruction}\n${pageContext}\n\nCRITICAL RULES:\n1. Output ONLY the rewritten replacement text.\n2. NEVER include conversational filler, preamble, intros, greetings, or explanations.\n3. NEVER wrap the output in quotes.\n4. Output only the pure rewritten text ready to be pasted directly into the document.`

        // Try 1: Sidepanel extension window (if currently open and responsive)
        try {
          const sidepanelResult = await new Promise<string | null>((resolve) => {
            const timeout = setTimeout(() => resolve(null), 1500)
            chrome.runtime.sendMessage({
              type: 'pentone_sidepanel_rewrite',
              payload: { selectedText, instruction, systemPrompt }
            }, (res) => {
              clearTimeout(timeout)
              if (chrome.runtime.lastError || !res?.success) {
                resolve(null)
              } else {
                resolve(res.result || null)
              }
            })
          })
          if (sidepanelResult) {
            sendResponse({ success: true, result: sidepanelResult })
            return
          }
        } catch (spErr) {
          console.warn('[background] Sidepanel rewrite attempt failed, continuing fallback:', spErr)
        }

        // Try 2: Dedicated Offscreen Document (Extension Origin with Gemini Nano + Prompt & Rewriter APIs)
        try {
          const hasOffscreen = await ensureOffscreenDocument()
          if (hasOffscreen) {
            const offscreenResult = await new Promise<string | null>((resolve) => {
              const timeout = setTimeout(() => resolve(null), 6000)
              chrome.runtime.sendMessage({
                type: 'pentone_offscreen_rewrite',
                payload: { selectedText, instruction, tone, length, pageContext }
              }, (res) => {
                clearTimeout(timeout)
                if (chrome.runtime.lastError || !res?.success) {
                  resolve(null)
                } else {
                  resolve(res.result || null)
                }
              })
            })
            if (offscreenResult) {
              sendResponse({ success: true, result: offscreenResult })
              return
            }
          }
        } catch (offErr) {
          console.warn('[background] Offscreen rewrite attempt failed, continuing fallback:', offErr)
        }

        // Try 3: Active tab MAIN world execution fallback
        try {
          const targetTabId = sender?.tab?.id || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id
          if (targetTabId) {
            const results = await chrome.scripting.executeScript({
              target: { tabId: targetTabId },
              world: 'MAIN',
              func: async (text: string, promptText: string, instructionText: string) => {
                const win = window as any

                // 1. Try Rewriter API in MAIN world
                const Rewriter = win.Rewriter || win.ai?.rewriter
                if (Rewriter && typeof Rewriter.create === 'function') {
                  try {
                    let rAvail = 'no'
                    try {
                      rAvail = typeof Rewriter.availability === 'function' ? await Rewriter.availability({ outputLanguage: 'en' }) : 'no'
                    } catch {
                      try {
                        rAvail = await Rewriter.availability()
                      } catch {}
                    }
                    if (rAvail === 'readily' || rAvail === 'available' || rAvail === 'after-download') {
                      let rw: any
                      try {
                        rw = await Rewriter.create({ outputLanguage: 'en', format: 'plain-text', sharedContext: instructionText })
                      } catch {
                        rw = await Rewriter.create({ format: 'plain-text', sharedContext: instructionText })
                      }
                      const res = await rw.rewrite(text)
                      rw.destroy?.()
                      const cleaned = (res || '').trim().replace(/^["'`]|["'`]$/g, '').trim()
                      if (cleaned) return cleaned
                    }
                  } catch {}
                }

                // 2. Try LanguageModel Prompt API in MAIN world
                const LM = win.LanguageModel || win.ai?.languageModel
                if (LM) {
                  let avail = 'no'
                  try {
                    avail = typeof LM.availability === 'function'
                      ? await LM.availability({ expectedOutputs: [{ type: 'text', languages: ['en'] }], outputLanguage: 'en' })
                      : (await LM.capabilities?.())?.available
                  } catch {
                    try {
                      avail = await LM.availability?.()
                    } catch {}
                  }
                  if (avail === 'readily' || avail === 'available' || avail === 'after-download' || avail === 'downloadable') {
                    let session: any
                    try {
                      session = await LM.create({
                        systemPrompt: promptText,
                        expectedOutputs: [{ type: 'text', languages: ['en'] }],
                        outputLanguage: 'en'
                      })
                    } catch {
                      session = await LM.create({
                        systemPrompt: promptText,
                        outputLanguage: 'en'
                      })
                    }
                    const res = await session.prompt(`Rewrite the following text:\n"${text}"`)
                    session.destroy?.()
                    return (res || '').trim().replace(/^["'`]|["'`]$/g, '').trim()
                  }
                }
                return null
              },
              args: [selectedText, systemPrompt, instruction]
            })
            const tabResult = results?.[0]?.result
            if (tabResult) {
              sendResponse({ success: true, result: tabResult })
              return
            }
          }
        } catch (tabErr) {
          console.warn('[background] Tab MAIN world rewrite fallback failed:', tabErr)
        }

        // Try 4: Resilient local heuristic fallback (instant grammar & tone correction)
        const heuristicResult = improveTextHeuristically(selectedText, instruction, tone, length)
        if (heuristicResult && heuristicResult.trim().length > 0) {
          sendResponse({ success: true, result: heuristicResult })
          return
        }

        sendResponse({ success: false, error: 'Gemini Nano is not ready. Please enable Gemini Nano in chrome://flags and check chrome://components.' })
      } catch (err: any) {
        sendResponse({ success: false, error: err.message || 'Background rewrite failed' })
      }
    })()
    return true
  }

  // Handle AI write requests from content scripts (proxy fallback)
  if (message.type === 'pentone_ai_write') {
    (async () => {
      try {
        const { prompt, pageContext = '' } = message.payload || {}
        const systemPrompt = `You are an expert writing assistant.\nTask: Write high-quality, clear, polished content based on the user's prompt.\n${pageContext}\n\nCRITICAL RULES:\n1. Output ONLY the written content to insert into the document or input box.\n2. NEVER include conversational filler, preamble, intros, greetings, or explanations.\n3. NEVER wrap the output in quotes.\n4. Output only the pure written text.`

        // Try 1: Dedicated Offscreen Document (Extension Origin with Gemini Nano + Writer API)
        try {
          const hasOffscreen = await ensureOffscreenDocument()
          if (hasOffscreen) {
            const offscreenResult = await new Promise<string | null>((resolve) => {
              const timeout = setTimeout(() => resolve(null), 8000)
              chrome.runtime.sendMessage({
                type: 'pentone_offscreen_write',
                payload: { prompt, pageContext }
              }, (res) => {
                clearTimeout(timeout)
                if (chrome.runtime.lastError || !res?.success) {
                  resolve(null)
                } else {
                  resolve(res.result || null)
                }
              })
            })
            if (offscreenResult) {
              sendResponse({ success: true, result: offscreenResult })
              return
            }
          }
        } catch (offErr) {
          console.warn('[background] Offscreen write attempt failed, continuing fallback:', offErr)
        }

        // Try 2: Active tab MAIN world execution fallback
        try {
          const targetTabId = sender?.tab?.id || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id
          if (targetTabId) {
            const results = await chrome.scripting.executeScript({
              target: { tabId: targetTabId },
              world: 'MAIN',
              func: async (userPrompt: string, promptText: string) => {
                const win = window as any
                const LM = win.LanguageModel || win.ai?.languageModel
                if (LM) {
                  let avail = 'no'
                  try {
                    avail = typeof LM.availability === 'function' 
                      ? await LM.availability({ outputLanguage: 'en', expectedOutputs: [{ type: 'text', languages: ['en'] }] }) 
                      : (await LM.capabilities?.())?.available
                  } catch {}
                  if (avail === 'readily' || avail === 'available' || avail === 'after-download' || avail === 'downloadable') {
                    const session = await LM.create({
                      systemPrompt: promptText,
                      expectedOutputs: [{ type: 'text', languages: ['en'] }],
                      outputLanguage: 'en'
                    })
                    const res = await session.prompt(userPrompt)
                    session.destroy?.()
                    return (res || '').trim().replace(/^["'`]|["'`]$/g, '').trim()
                  }
                }
                return null
              },
              args: [prompt, systemPrompt]
            })
            const tabResult = results?.[0]?.result
            if (tabResult) {
              sendResponse({ success: true, result: tabResult })
              return
            }
          }
        } catch (tabErr) {
          console.warn('[background] Tab MAIN world write fallback failed:', tabErr)
        }

        // Try 3: Heuristic offline writer fallback (instant response even without Chrome flags)
        const heuristicResult = writeTextHeuristically(prompt, pageContext)
        if (heuristicResult && heuristicResult.trim().length > 0) {
          sendResponse({ success: true, result: heuristicResult })
          return
        }

        sendResponse({ success: false, error: 'Gemini Nano is not ready. Please enable Gemini Nano in chrome://flags and check chrome://components.' })
      } catch (err: any) {
        sendResponse({ success: false, error: err.message || 'Background write failed' })
      }
    })()
    return true
  }
  
  // Handle adaptive learning updates from form field modifications
  if (message.type === 'pentone_update_profile_field') {
    (async () => {
      try {
        const { label, value } = message.payload || {}
        if (!label || !value || typeof value !== 'string') {
          sendResponse({ success: false, error: 'Missing or invalid field data' })
          return
        }
        const profile = await loadAutofillProfile()
        const lower = label.toLowerCase().trim()

        if (lower.includes('first name') || lower === 'fname') {
          profile.personal.firstName = value.trim()
        } else if (lower.includes('last name') || lower === 'lname') {
          profile.personal.lastName = value.trim()
        } else if (lower.includes('full name')) {
          profile.personal.fullName = value.trim()
        } else if (lower.includes('email')) {
          profile.personal.email = value.trim()
        } else if (lower.includes('phone') || lower.includes('mobile') || lower.includes('cell')) {
          profile.personal.phone = value.trim()
        } else if (lower.includes('address line 2') || lower.includes('suite') || lower.includes('apt')) {
          profile.personal.addressLine2 = value.trim()
        } else if (lower.includes('address') || lower.includes('street')) {
          profile.personal.addressLine1 = value.trim()
        } else if (lower.includes('city') || lower.includes('town')) {
          profile.personal.city = value.trim()
        } else if (lower.includes('state') || lower.includes('province')) {
          profile.personal.state = value.trim()
        } else if (lower.includes('zip') || lower.includes('postal')) {
          profile.personal.postalCode = value.trim()
        } else if (lower.includes('country')) {
          profile.personal.country = value.trim()
        } else if (lower.includes('company') || lower.includes('employer')) {
          if (profile.workExperience.length === 0) {
            profile.workExperience.push({
              id: `exp-${Date.now()}`,
              company: value.trim(),
              title: '',
              location: '',
              startDate: '',
              endDate: 'Present',
              current: true,
              description: '',
              bulletPoints: []
            })
          } else {
            profile.workExperience[0].company = value.trim()
          }
        } else if (lower.includes('position') || lower.includes('job title')) {
          if (profile.workExperience.length === 0) {
            profile.workExperience.push({
              id: `exp-${Date.now()}`,
              company: '',
              title: value.trim(),
              location: '',
              startDate: '',
              endDate: 'Present',
              current: true,
              description: '',
              bulletPoints: []
            })
          } else {
            profile.workExperience[0].title = value.trim()
          }
        } else if (lower.includes('linkedin')) {
          profile.online.linkedinUrl = value.trim()
        } else if (lower.includes('github')) {
          profile.online.githubUrl = value.trim()
        } else if (lower.includes('website') || lower.includes('portfolio')) {
          profile.online.portfolioUrl = value.trim()
        }

        profile.lastUpdated = Date.now()
        await saveAutofillProfile(profile)
        sendResponse({ success: true, updatedField: label, value })
      } catch (err: any) {
        sendResponse({ success: false, error: err?.message || 'Failed to update profile vault' })
      }
    })()
    return true
  }

  if (message.type === 'run_tool') {
    const { toolName, parameters = {}, context } = message.payload || {}
    if (typeof toolName !== 'string' || !parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
      sendResponse({ success: false, error: 'Invalid tool request' }); return false
    }
    
    // Validate tool exists in registry
    if (!isValidTool(toolName)) {
      const similarTools = findSimilarTools(toolName)
      let errorMessage = `Unknown tool: ${toolName}`
      
      if (similarTools.length > 0) {
        errorMessage += `\n\nDid you mean one of these?\n- ${similarTools.join('\n- ')}`
        errorMessage += '\n\nIMPORTANT: If you tried to use a playbook name as a tool, remember that playbooks are NOT tools. You must first call getPlaybook("playbook-name") to retrieve the instructions, then follow those instructions using actual tools.'
      }
      
      sendResponse({ success: false, error: errorMessage })
      return true
    }
    
    const argumentError = validateToolArguments(toolName, parameters)
    if (argumentError) { sendResponse({ success: false, error: argumentError }); return false }

    // Execute tool handler
    const handler = toolHandlers[toolName]
    if (handler) {
      handler(parameters, context).then(sendResponse).catch(error => {
        sendResponse({ success: false, error: error.message })
      })
    } else {
      sendResponse({ success: false, error: `Tool ${toolName} not implemented` })
    }
    
    return true // Keep message channel open for async response
  }
})
