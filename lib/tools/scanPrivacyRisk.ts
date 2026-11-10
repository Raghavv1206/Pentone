/**
 * Tool: scanPrivacyRisk
 * Audits Terms of Service, Privacy Policies, or legal agreements using local Gemini Nano
 * to surface red flags (data selling, binding arbitration, recurring subscriptions).
 */

import type { ToolSpec } from '../tool-registry'
import { promptLocalTask } from '../local-ai-task'

interface PrivacyRiskResult {
  riskLevel: 'HIGH' | 'MODERATE' | 'LOW'
  summary: string
  redFlags: string[]
}

function auditTermsHeuristically(text: string): PrivacyRiskResult {
  const redFlags: string[] = []
  const lower = text.toLowerCase()

  // 1. Mandatory Arbitration / Waiver of Jury Trial
  if (
    /\b(binding\s*arbitration|waive\s*any\s*right\s*to\s*a\s*jury\s*trial|class\s*action\s*waiver|arbitration\s*clause)\b/i.test(lower)
  ) {
    redFlags.push('Mandatory Arbitration: You waive the right to trial by jury or participating in a class-action lawsuit.')
  }

  // 2. Data Selling / Third-Party Tracking
  if (
    /\b(sell\s*your\s*personal\s*information|share\s*with\s*(third\s*parties|advertisers|data\s*brokers)|targeted\s*advertising)\b/i.test(lower)
  ) {
    redFlags.push('Data Sharing: Your personal data may be shared with or sold to third-party advertising partners and data brokers.')
  }

  // 3. Auto-Renewals / Hidden Recurring Billing
  if (
    /\b(automatically\s*renew|recurring\s*basis|recurring\s*subscription|non-refundable\s*fees)\b/i.test(lower)
  ) {
    redFlags.push('Recurring Billing: Subscriptions automatically renew and may charge payment methods without separate renewal notice.')
  }

  // 4. Unilateral Modifications
  if (
    /\b(modify\s*these\s*terms\s*at\s*any\s*time|without\s*(prior\s*)?notice|terminate\s*your\s*account\s*at\s*our\s*sole\s*discretion)\b/i.test(lower)
  ) {
    redFlags.push('Unilateral Changes: The company reserves the right to alter pricing, terms, or terminate accounts at sole discretion without notice.')
  }

  let riskLevel: 'HIGH' | 'MODERATE' | 'LOW' = 'LOW'
  if (redFlags.length >= 3) {
    riskLevel = 'HIGH'
  } else if (redFlags.length >= 1) {
    riskLevel = 'MODERATE'
  }

  const summary = redFlags.length === 0
    ? 'No matching risk phrases found in this limited automated check. Review the full agreement before accepting.'
    : `Found ${redFlags.length} consumer risk clause${redFlags.length === 1 ? '' : 's'} in this agreement.`

  return { riskLevel, summary, redFlags }
}

export async function scanPrivacyRisk() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      return { success: false, error: 'No active tab found' }
    }

    // 1. Extract text from the active tab
    const extractResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const article = document.querySelector('article, main, .content, #content') || document.body
        return article ? (article as HTMLElement).innerText || '' : ''
      }
    })

    const rawText = extractResults?.[0]?.result as string || ''
    if (!rawText || rawText.trim().length < 60) {
      return {
        success: false,
        error: 'No substantive terms or agreement text was found on this page.'
      }
    }

    const truncated = rawText.slice(0, 12000)
    let analysis: PrivacyRiskResult

    // 2. Try Gemini Nano Prompt API first
    try {
      const prompt = `You are an expert consumer privacy & legal risk auditor.
Analyze the following Terms of Service or Privacy Policy text.
Identify key risks in:
1. Data selling / broker sharing
2. Mandatory arbitration / class action waivers
3. Auto-renewal subscription charges
4. Unilateral policy changes without notice

Text:
"""
${truncated.slice(0, 4000)}
"""

Respond in this exact JSON format:
{
  "riskLevel": "HIGH" | "MODERATE" | "LOW",
  "summary": "One clear sentence summary",
  "redFlags": ["specific clause 1", "specific clause 2"]
}`
      const response = await promptLocalTask(prompt)
      const cleanJson = response.replace(/^```json|^```|```$/gm, '').trim()
      analysis = JSON.parse(cleanJson)
      if (!['HIGH', 'MODERATE', 'LOW'].includes(analysis.riskLevel) || typeof analysis.summary !== 'string' ||
          !Array.isArray(analysis.redFlags) || analysis.redFlags.some(f => typeof f !== 'string')) throw new Error('Invalid risk analysis')
    } catch {
      // Robust heuristic fallback
      analysis = auditTermsHeuristically(truncated)
    }

    // 3. Render isolated Shadow DOM floating HUD on the page
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (res: PrivacyRiskResult) => {
        const escapeHTML = (value: string) => { const el = document.createElement('span'); el.textContent = value; return el.innerHTML }
        const existing = document.getElementById('pentone-privacy-hud')
        if (existing) existing.remove()

        const host = document.createElement('div')
        host.id = 'pentone-privacy-hud'
        host.style.cssText = `
          position: fixed;
          top: 24px;
          right: 24px;
          z-index: 2147483647;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `
        const shadow = host.attachShadow({ mode: 'open' })

        const badgeColor = res.riskLevel === 'HIGH' ? '#FF5F56' : res.riskLevel === 'MODERATE' ? '#FFBD2E' : '#67E2C8'
        const badgeBg = res.riskLevel === 'HIGH' ? 'rgba(255, 95, 86, 0.15)' : res.riskLevel === 'MODERATE' ? 'rgba(255, 189, 46, 0.15)' : 'rgba(103, 226, 200, 0.15)'

        shadow.innerHTML = `
          <style>
            .card {
              background: rgba(23, 24, 22, 0.96);
              border: 1px solid ${badgeColor};
              box-shadow: 0 14px 40px rgba(0, 0, 0, 0.7), 0 0 20px ${badgeColor}33;
              border-radius: 14px;
              padding: 14px 18px;
              color: #F5F1E7;
              width: 320px;
              backdrop-filter: blur(14px);
              animation: pSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            }
            @keyframes pSlideIn {
              from { opacity: 0; transform: translateY(-12px); }
              to { opacity: 1; transform: translateY(0); }
            }
            .header {
              display: flex;
              align-items: center;
              justify-content: space-between;
              margin-bottom: 8px;
            }
            .badge {
              font-size: 11px;
              font-weight: 700;
              color: ${badgeColor};
              background: ${badgeBg};
              border: 1px solid ${badgeColor}40;
              padding: 3px 8px;
              border-radius: 6px;
            }
            .close-btn {
              background: transparent;
              border: none;
              color: #77776E;
              cursor: pointer;
              font-size: 14px;
            }
            .close-btn:hover { color: #F5F1E7; }
            .summary {
              font-size: 12px;
              color: #DDDCCB;
              line-height: 1.4;
              margin-bottom: 8px;
            }
            .flags-list {
              font-size: 11px;
              color: #A6A49B;
              padding-left: 16px;
              margin: 0;
              display: flex;
              flex-direction: column;
              gap: 4px;
            }
            .flags-list li {
              line-height: 1.35;
            }
          </style>
          <div class="card">
            <div class="header">
              <span class="badge">${res.riskLevel} RISK POLICY</span>
              <button id="p-close" class="close-btn">✕</button>
            </div>
            <div class="summary">${escapeHTML(res.summary)}</div>
            ${res.redFlags && res.redFlags.length > 0 ? `
              <ul class="flags-list">
                ${res.redFlags.map(f => `<li>${escapeHTML(f)}</li>`).join('')}
              </ul>
            ` : ''}
          </div>
        `
        document.body.appendChild(host)
        shadow.getElementById('p-close')?.addEventListener('click', () => host.remove())
        setTimeout(() => {
          if (document.body.contains(host)) host.remove()
        }, 12000)
      },
      args: [analysis]
    })

    return {
      success: true,
      result: `Audit complete (${analysis.riskLevel} Risk): ${analysis.summary}`,
      analysis
    }
  } catch (err: any) {
    return {
      success: false,
      error: `Privacy scan failed: ${err?.message || 'Unknown error'}`
    }
  }
}

export const spec: ToolSpec = {
  name: 'scanPrivacyRisk',
  description: 'Audits Terms of Service, Privacy Policies, and EULA agreements using local Gemini Nano to identify consumer risks (data selling, binding arbitration, subscription auto-renewals).',
  parameters: [],
  spokenLine: 'Scanning terms and privacy policy for consumer risks',
  examples: [
    'User: "audit these terms of service" → scanPrivacyRisk',
    'User: "is this privacy policy safe?" → scanPrivacyRisk',
    'User: "scan this agreement for hidden fees" → scanPrivacyRisk'
  ]
}

export default scanPrivacyRisk
