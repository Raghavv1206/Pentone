/**
 * Phishing & Domain Deception Guard
 * 100% Offline, on-device heuristics to detect spoofed domains, typosquatting,
 * Punycode homoglyphs, and deceptive form action destinations.
 */

export interface PhishingSecurityReport {
  isSafe: boolean
  threatLevel: 'safe' | 'suspicious' | 'dangerous'
  spoofedTarget?: string
  currentHost: string
  reasons: string[]
  details: {
    isHttp: boolean
    isPunycode: boolean
    isHomoglyph: boolean
    isSubdomainSpoof: boolean
    isTyposquatted: boolean
    mismatchedFormActions: string[]
  }
}

// Well-known high-value brand domains frequently targeted by phishing campaigns
export const PROTECTED_TARGETS: { name: string; domain: string }[] = [
  { name: 'Google', domain: 'google.com' },
  { name: 'PayPal', domain: 'paypal.com' },
  { name: 'Apple', domain: 'apple.com' },
  { name: 'Microsoft', domain: 'microsoft.com' },
  { name: 'Amazon', domain: 'amazon.com' },
  { name: 'Netflix', domain: 'netflix.com' },
  { name: 'Facebook', domain: 'facebook.com' },
  { name: 'Instagram', domain: 'instagram.com' },
  { name: 'LinkedIn', domain: 'linkedin.com' },
  { name: 'GitHub', domain: 'github.com' },
  { name: 'Twitter / X', domain: 'x.com' },
  { name: 'Twitter', domain: 'twitter.com' },
  { name: 'Dropbox', domain: 'dropbox.com' },
  { name: 'Slack', domain: 'slack.com' },
  { name: 'Chase Bank', domain: 'chase.com' },
  { name: 'Bank of America', domain: 'bankofamerica.com' },
  { name: 'Wells Fargo', domain: 'wellsfargo.com' },
  { name: 'Citibank', domain: 'citi.com' },
  { name: 'Coinbase', domain: 'coinbase.com' },
  { name: 'Binance', domain: 'binance.com' }
]

/**
 * Levenshtein distance algorithm for calculating minimum edit distance
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      )
    }
  }
  return dp[m][n]
}

/**
 * Extracts base domain name (e.g., "login.paypal.com" -> "paypal.com")
 */
export function extractBaseDomain(hostname: string): string {
  const clean = hostname.toLowerCase().trim().replace(/:\d+$/, '')
  const parts = clean.split('.')
  if (parts.length <= 2) return clean

  // Handle common compound TLDs like .co.uk, .com.au, .gov.in
  const compoundTLDs = ['co.uk', 'com.au', 'co.in', 'org.uk', 'gov.in', 'edu.au']
  const lastTwo = parts.slice(-2).join('.')
  if (compoundTLDs.includes(lastTwo) && parts.length > 2) {
    return parts.slice(-3).join('.')
  }

  return parts.slice(-2).join('.')
}

/**
 * Detects Cyrillic and Greek unicode characters commonly used in homoglyph domain attacks
 */
export function containsHomoglyphs(text: string): boolean {
  // Matches Cyrillic range (\u0400-\u04FF) and Greek range (\u0370-\u03FF)
  return /[\u0400-\u04FF\u0370-\u03FF]/.test(text)
}

/**
 * Inspects a URL and its form actions for phishing, typosquatting, and deception risks
 */
export function inspectSecurityRisk(urlStr: string, formActions: string[] = []): PhishingSecurityReport {
  const report: PhishingSecurityReport = {
    isSafe: true,
    threatLevel: 'safe',
    currentHost: '',
    reasons: [],
    details: {
      isHttp: false,
      isPunycode: false,
      isHomoglyph: false,
      isSubdomainSpoof: false,
      isTyposquatted: false,
      mismatchedFormActions: []
    }
  }

  let parsed: URL
  try {
    parsed = new URL(urlStr)
  } catch {
    report.isSafe = false
    report.threatLevel = 'suspicious'
    report.reasons.push('Invalid or unparseable URL format.')
    return report
  }

  const hostname = parsed.hostname.toLowerCase()
  report.currentHost = hostname

  // Exclude local development environments from threat classification
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.local') || parsed.protocol === 'chrome-extension:') {
    return report
  }

  const baseDomain = extractBaseDomain(hostname)

  // 1. Insecure HTTP check
  if (parsed.protocol === 'http:') {
    report.details.isHttp = true
    report.reasons.push('Connection is unencrypted (HTTP). Transmitting credentials or personal data is insecure.')
    report.threatLevel = 'suspicious'
    report.isSafe = false
  }

  // 2. Punycode check (xn--)
  if (hostname.includes('xn--')) {
    report.details.isPunycode = true
    report.reasons.push('Internationalized Punycode domain detected. Attackers often use Punycode to mask lookalike domains.')
    report.threatLevel = 'dangerous'
    report.isSafe = false
  }

  // URL.hostname converts Unicode domains to ASCII. Inspect the original authority
  // too, excluding credentials, path and query text from the hostname check.
  const rawHost = (urlStr.trim().match(/^[a-z][a-z0-9+.-]*:\/\/([^/\\?#]*)/i)?.[1] || '').split('@').pop() || ''
  if (containsHomoglyphs(hostname) || containsHomoglyphs(rawHost)) {
    report.details.isHomoglyph = true
    report.reasons.push('Unicode homoglyph characters detected in domain/URL.')
    report.threatLevel = 'dangerous'
    report.isSafe = false
  }

  // 4. Subdomain mimicry check (e.g. "paypal.com.verify-access.net" or "google.com-portal.cc")
  for (const target of PROTECTED_TARGETS) {
    const brandName = target.domain.split('.')[0]
    const exactTargetDomain = target.domain

    // If current site is legitimately this brand or its subdomain, it's safe
    if (baseDomain === exactTargetDomain) {
      continue
    }

    // Check if brand domain appears in the subdomain (e.g., paypal.com.attacker.org, google.com-alert.top)
    if (
      hostname.includes(`${exactTargetDomain}.`) || 
      hostname.includes(`${exactTargetDomain}-`) || 
      hostname.includes(`${brandName}-`)
    ) {
      report.details.isSubdomainSpoof = true
      report.spoofedTarget = target.name
      report.reasons.push(`Subdomain mimicry: Hostname mimics ${target.name} (${target.domain}), but base domain is actually "${baseDomain}".`)
      report.threatLevel = 'dangerous'
      report.isSafe = false
      break
    }
  }

  // 5. Typosquatting / Levenshtein Distance Check
  const domainNoTld = baseDomain.split('.')[0]
  for (const target of PROTECTED_TARGETS) {
    const targetNoTld = target.domain.split('.')[0]

    // Skip if exact match
    if (baseDomain === target.domain) continue

    // Normalize visually similar substitutions (e.g. 0 -> o, 1 -> l, rn -> m)
    const normalizedCurrent = domainNoTld.replace(/0/g, 'o').replace(/1/g, 'l').replace(/rn/g, 'm')
    const rawDist = levenshteinDistance(domainNoTld, targetNoTld)
    const normDist = levenshteinDistance(normalizedCurrent, targetNoTld)

    // Exact visual substitution (paypa1 -> paypal, g00gle -> google)
    const isVisualSubstitution = normDist === 0 && domainNoTld !== targetNoTld
    // Edit distance typosquatting
    const isTypoDistance = (rawDist > 0 && rawDist <= 2) || (normDist > 0 && normDist <= 2)

    if ((isVisualSubstitution || isTypoDistance) && domainNoTld.length >= 4) {
      report.details.isTyposquatted = true
      report.spoofedTarget = target.name
      report.reasons.push(`Typosquatting alert: Domain "${baseDomain}" is suspiciously similar to legitimate brand "${target.domain}".`)
      report.threatLevel = 'dangerous'
      report.isSafe = false
      break
    }
  }

  // 6. Form Action Hijack Check
  if (formActions && formActions.length > 0) {
    for (const action of formActions) {
      if (!action || action === '#' || action.startsWith('javascript:')) continue

      try {
        const actionUrl = new URL(action, parsed.origin)
        // If action points to an entirely different foreign base domain
        if (actionUrl.hostname) {
          const actionBase = extractBaseDomain(actionUrl.hostname)
          if (actionBase !== baseDomain) {
            report.details.mismatchedFormActions.push(actionUrl.origin)
            report.reasons.push(`Cross-origin form submission: Form submits data to foreign origin "${actionUrl.origin}".`)
            if (report.threatLevel === 'safe') {
              report.threatLevel = 'suspicious'
              report.isSafe = false
            }
          }
        }
      } catch {
        // Ignored if invalid relative URL
      }
    }
  }

  return report
}

/**
 * In-Page UI Shield: Renders an isolated security warning modal when a phishing or spoofing threat is found
 */
export function showPhishingWarningModal(report: PhishingSecurityReport): Promise<boolean> {
  const escapeHTML = (value: string) => { const el = document.createElement('span'); el.textContent = value; return el.innerHTML }
  return new Promise((resolve) => {
    // Dismiss existing modal if present
    document.getElementById('pentone-phishing-guard-host')?.remove()

    const host = document.createElement('div')
    host.id = 'pentone-phishing-guard-host'
    host.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(12, 13, 11, 0.85);
      backdrop-filter: blur(16px);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `

    const shadow = host.attachShadow({ mode: 'open' })

    const targetNotice = report.spoofedTarget ? `This website appears to imitate <strong>${escapeHTML(report.spoofedTarget)}</strong>.` : ''
    const reasonsList = report.reasons.map(r => `<li>${escapeHTML(r)}</li>`).join('')

    shadow.innerHTML = `
      <style>
        .modal {
          background: #171816;
          border: 1px solid rgba(239, 68, 68, 0.45);
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.8), 0 0 24px rgba(239, 68, 68, 0.2);
          border-radius: 16px;
          padding: 24px 28px;
          max-width: 480px;
          width: 90%;
          color: #F5F1E7;
          box-sizing: border-box;
          animation: pop 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes pop {
          from { transform: scale(0.95); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 14px;
        }
        .icon {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          background: rgba(239, 68, 68, 0.15);
          border: 1px solid rgba(239, 68, 68, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
        }
        .title {
          font-size: 17px;
          font-weight: 700;
          color: #EF4444;
          letter-spacing: -0.01em;
        }
        .desc {
          font-size: 13px;
          line-height: 1.5;
          color: #DDDCCB;
          margin-bottom: 14px;
        }
        .reasons {
          background: rgba(34, 35, 31, 0.8);
          border: 1px solid rgba(55, 56, 50, 0.7);
          border-radius: 10px;
          padding: 10px 14px;
          margin-bottom: 18px;
          font-size: 12px;
          color: #EF4444;
        }
        .reasons ul {
          margin: 4px 0 0 0;
          padding-left: 18px;
          color: #DDDCCB;
          line-height: 1.4;
        }
        .buttons {
          display: flex;
          gap: 10px;
          justify-content: flex-end;
        }
        .btn {
          border: none;
          padding: 8px 16px;
          border-radius: 8px;
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.18s ease;
        }
        .btn-safe {
          background: #EF4444;
          color: #FFFFFF;
        }
        .btn-safe:hover {
          background: #DC2626;
        }
        .btn-override {
          background: transparent;
          color: #A6A49B;
          border: 1px solid rgba(166, 164, 155, 0.3);
        }
        .btn-override:hover {
          color: #F5F1E7;
          border-color: #DDDCCB;
        }
      </style>
      <div class="modal">
        <div class="header">
          <div class="icon">🛡️</div>
          <div class="title">Security Shield Alert</div>
        </div>
        <div class="desc">
          Pentone detected suspicious domain deception indicators on <strong>${escapeHTML(report.currentHost)}</strong>.
          ${targetNotice} Autofill has been paused to protect your vault credentials.
        </div>
        <div class="reasons">
          <strong>Threat indicators detected:</strong>
          <ul>
            ${reasonsList}
          </ul>
        </div>
        <div class="buttons">
          <button id="p-btn-abort" class="btn btn-safe">Abort & Close</button>
        </div>
      </div>
    `

    document.body.appendChild(host)

    shadow.getElementById('p-btn-abort')?.addEventListener('click', () => {
      host.remove()
      resolve(false)
    })

    shadow.getElementById('p-btn-override')?.addEventListener('click', () => {
      host.remove()
      resolve(true)
    })
  })
}
