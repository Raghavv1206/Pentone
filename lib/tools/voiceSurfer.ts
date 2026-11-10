/**
 * Tool: voiceSurfer
 * Controls hands-free voice element navigation by showing or clicking numbered badges on screen.
 */

import type { ToolSpec } from '../tool-registry'

interface VoiceSurferParams {
  action?: 'show' | 'hide' | 'click'
  index?: number
}

export async function voiceSurfer(params: VoiceSurferParams) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      return { success: false, error: 'No active tab found' }
    }

    const action = params?.action || (params?.index !== undefined ? 'click' : 'show')

    // 1. Try sending direct message to content script
    try {
      const response = await new Promise<any>((resolve) => {
        chrome.tabs.sendMessage(tab.id!, {
          type: 'pentone_voice_surfer',
          action,
          index: params?.index
        }, (res) => {
          if (chrome.runtime.lastError) {
            resolve(null)
          } else {
            resolve(res)
          }
        })
      })

      if (response) {
        return {
          success: response.success === true,
          error: response.success ? undefined : response.error || response.message || 'Voice action failed',
          result: response.message || `Voice surfer action "${action}" completed.`,
          count: response.count
        }
      }
    } catch {
      // Content script may not be loaded or responded, fallback to injection
    }

    return { success: false, error: 'Voice navigation is unavailable on this page. Reload a web page and try again.' }
  } catch (err: any) {
    return {
      success: false,
      error: `Voice surfer notice: ${err?.message || 'Unable to interact with page'}`
    }
  }
}

export const spec: ToolSpec = {
  name: 'voiceSurfer',
  description: 'Hands-free voice browsing: Displays numbered badges on all visible interactive buttons and links on screen, or clicks an element by its number.',
  parameters: [
    {
      name: 'action',
      type: 'string',
      description: 'The action to perform: "show" (display numbers), "hide" (dismiss numbers), or "click" (activate a number)',
      required: false
    },
    {
      name: 'index',
      type: 'number',
      description: 'The badge number to click or activate (e.g. 1, 4, 12)',
      required: false
    }
  ],
  spokenLine: 'Updating element voice badges on screen',
  examples: [
    'User: "show numbers" → voiceSurfer with action: "show"',
    'User: "show links" → voiceSurfer with action: "show"',
    'User: "click 4" → voiceSurfer with action: "click", index: 4',
    'User: "open 12" → voiceSurfer with action: "click", index: 12',
    'User: "hide numbers" → voiceSurfer with action: "hide"'
  ]
}

export default voiceSurfer
