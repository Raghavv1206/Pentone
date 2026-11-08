/**
 * Tool: clipToVault
 * Clips highlighted text or web articles into Pentone's local semantic memory or Profile Vault.
 */

import type { ToolSpec } from '../tool-registry'
import storeMemory from './storeMemory'
import { ensureSession } from '../ai'

interface ClipParams {
  text?: string
  category?: 'job' | 'contact' | 'note' | 'auto'
}

export async function clipToVault(params?: ClipParams) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      return { success: false, error: 'No active tab found' }
    }

    let textToClip = params?.text || ''

    if (!textToClip) {
      // Get selection from active tab
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.getSelection()?.toString() || ''
      })
      textToClip = results?.[0]?.result || ''
    }

    if (!textToClip || textToClip.trim().length < 5) {
      return {
        success: false,
        error: 'Please highlight text on the page first to clip it into memory.'
      }
    }

    const cleanText = textToClip.trim().slice(0, 4000)
    let title = 'Web Clip'
    let content = cleanText

    // Attempt Gemini Nano structured extraction
    try {
      const session = await ensureSession()
      const prompt = `Extract a clean, concise 3-5 word title and structured summary from this clipped text:
"""
${cleanText}
"""
Respond as JSON: {"title": "concise title", "summary": "clean structured summary"}`
      const response = await session.prompt(prompt)
      const parsed = JSON.parse(response.replace(/^```json|^```|```$/gm, '').trim())
      if (parsed.title) title = parsed.title
      if (parsed.summary) content = parsed.summary
    } catch {
      title = cleanText.split('\n')[0].slice(0, 40)
    }

    // Save to Pentone Memory
    const memoryResult = await storeMemory({
      key: `clip-${Date.now()}`,
      value: `[${title}] (Source: ${tab.url || 'Webpage'})\n${content}`
    })

    // Show floating confirmation pill on the active page
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (clipTitle: string) => {
        const host = document.createElement('div')
        host.id = 'pentone-clip-toast'
        host.style.cssText = `
          position: fixed;
          bottom: 24px;
          right: 24px;
          z-index: 2147483647;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `
        const shadow = host.attachShadow({ mode: 'open' })
        shadow.innerHTML = `
          <style>
            .toast {
              background: rgba(23, 24, 22, 0.96);
              border: 1px solid rgba(103, 226, 200, 0.6);
              box-shadow: 0 12px 32px rgba(0, 0, 0, 0.65), 0 0 16px rgba(103, 226, 200, 0.25);
              border-radius: 12px;
              padding: 10px 16px;
              color: #F5F1E7;
              display: flex;
              align-items: center;
              gap: 10px;
              font-size: 12px;
              backdrop-filter: blur(14px);
              animation: pSlideUp 0.3s ease;
            }
            @keyframes pSlideUp {
              from { opacity: 0; transform: translateY(10px); }
              to { opacity: 1; transform: translateY(0); }
            }
            .icon { color: #67E2C8; font-size: 13px; font-weight: bold; }
          </style>
          <div class="toast">
            <span class="icon">✓</span>
            <span>Clipped to Memory: <strong>${clipTitle}</strong></span>
          </div>
        `
        document.body.appendChild(host)
        setTimeout(() => host.remove(), 3500)
      },
      args: [title]
    })

    return {
      success: true,
      result: `Successfully clipped "${title}" to your offline memory vault.`,
      title,
      content
    }
  } catch (err: any) {
    return {
      success: false,
      error: `Failed to clip to vault: ${err?.message || 'Unknown error'}`
    }
  }
}

export const spec: ToolSpec = {
  name: 'clipToVault',
  description: 'Clips selected web text, job postings, or notes into Pentone\'s local offline memory vault with AI-structured formatting.',
  parameters: [
    {
      name: 'text',
      type: 'string',
      description: 'The text snippet to save into memory (defaults to currently selected text if omitted)',
      required: false
    }
  ],
  spokenLine: 'Saving clip to your local memory vault',
  examples: [
    'User: "clip this job to memory" → clipToVault',
    'User: "save this note" → clipToVault'
  ]
}

export default clipToVault
