/**
 * Tool: checkPhishingRisk
 * Analyzes the current page or a provided URL for domain spoofing, typosquatting,
 * Punycode homoglyphs, and deceptive cross-origin form action destinations.
 */

import type { ToolSpec } from '../tool-registry'
import { inspectSecurityRisk, showPhishingWarningModal, type PhishingSecurityReport } from '../security/phishing-guard'

interface CheckPhishingParams {
  url?: string
}

export async function checkPhishingRisk(params?: CheckPhishingParams) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id && !params?.url) {
      return { success: false, error: 'No active tab found and no URL provided.' }
    }

    const targetUrl = params?.url || tab?.url || ''

    // Collect in-page form action destinations if inspecting current active tab
    let formActions: string[] = []
    if (tab?.id && (!params?.url || params.url === tab.url)) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            return Array.from(document.querySelectorAll<HTMLFormElement>('form'))
              .map(f => f.getAttribute('action') || '')
              .filter(Boolean)
          }
        })
        formActions = results?.[0]?.result || []
      } catch {
        // Fallback without form actions
      }
    }

    const report: PhishingSecurityReport = inspectSecurityRisk(targetUrl, formActions)

    // If threat detected and inspecting the active page, render security shield modal
    if (!report.isSafe && tab?.id && (!params?.url || params.url === tab.url)) {
      try {
        void chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: showPhishingWarningModal,
          args: [report]
        }).catch(() => {})
      } catch {
        // Overlay fallback
      }
    }

    const summary = report.isSafe
      ? `Website "${report.currentHost}" has no spoofing indicators detected by these checks. This does not guarantee the site is safe.`
      : `⚠️ Security Warning: "${report.currentHost}" flagged as ${report.threatLevel.toUpperCase()}. Reasons: ${report.reasons.join('; ')}`

    return {
      success: true,
      report,
      result: summary
    }
  } catch (err: any) {
    return {
      success: false,
      error: `Security scan error: ${err?.message || 'Unable to audit URL'}`
    }
  }
}

export const spec: ToolSpec = {
  name: 'checkPhishingRisk',
  description: 'Audits the current page or a given URL for phishing, typosquatting, spoofed domains, and deceptive form actions.',
  parameters: [
    {
      name: 'url',
      type: 'string',
      description: 'Optional URL to check. Defaults to the currently active tab.',
      required: false
    }
  ],
  spokenLine: 'Auditing page domain and form security',
  examples: [
    'User: "Is this website safe?" → checkPhishingRisk',
    'User: "Check if this link is a phishing site" → checkPhishingRisk with url',
    'User: "Verify site security" → checkPhishingRisk'
  ]
}

export default checkPhishingRisk
