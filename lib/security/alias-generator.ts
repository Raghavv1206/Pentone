/**
 * Offline Disposable Alias & Sub-Addressing Generator
 * Generates secure, domain-specific plus-addressing email aliases on the fly without external relays.
 */

export interface GeneratedAliasInfo {
  alias: string
  serviceName: string
  masterEmail: string
  domain: string
  isSubAddressable: boolean
}

/**
 * Normalizes a website hostname into a human-friendly service tag
 * e.g., "auth.spotify.com" -> "spotify", "app.coursera.org" -> "coursera"
 */
export function extractServiceSlug(hostname: string): string {
  if (!hostname) return 'service'
  const clean = hostname.replace(/^www\./, '').toLowerCase().trim().replace(/:\d+$/, '')
  const parts = clean.split('.')

  if (parts.length === 1) return parts[0]

  // If compound TLD (e.g. amazon.co.uk)
  const compoundTLDs = ['co.uk', 'com.au', 'co.in', 'org.uk', 'gov.in']
  const lastTwo = parts.slice(-2).join('.')
  if (compoundTLDs.includes(lastTwo) && parts.length > 2) {
    return parts[parts.length - 3]
  }

  // Standard TLD (e.g. spotify.com -> spotify)
  return parts[parts.length - 2] || parts[0]
}

/**
 * Generates an offline sub-addressed email alias
 * e.g., master: "alex.taylor@gmail.com", host: "reddit.com" -> "alex.taylor+reddit@gmail.com"
 */
export function generateSubAddressAlias(
  masterEmail: string,
  hostname: string,
  options?: { randomSuffix?: boolean; customTag?: string }
): GeneratedAliasInfo {
  if (!masterEmail || !masterEmail.includes('@')) {
    return {
      alias: masterEmail,
      serviceName: 'unknown',
      masterEmail,
      domain: '',
      isSubAddressable: false
    }
  }

  const [rawUser, domain] = masterEmail.split('@')
  // Strip any existing plus alias to keep primary identity clean
  const baseUser = rawUser.split('+')[0]
  const serviceSlug = extractServiceSlug(hostname).replace(/[^a-z0-9]/g, '') || 'web'

  let tag = options?.customTag ? options.customTag.replace(/[^a-z0-9]/g, '') : serviceSlug

  if (options?.randomSuffix) {
    const rand = Math.random().toString(36).substring(2, 6)
    tag = `${tag}.${rand}`
  }

  const alias = `${baseUser}+${tag}@${domain}`

  return {
    alias,
    serviceName: serviceSlug,
    masterEmail,
    domain,
    isSubAddressable: true
  }
}

/**
 * Inspects whether an incoming email was sent to a Pentone-generated sub-address alias
 */
export function parseSubAddress(email: string): { baseUser: string; tag?: string; domain: string } | null {
  if (!email || !email.includes('@')) return null
  const [userPart, domain] = email.split('@')
  const plusIdx = userPart.indexOf('+')

  if (plusIdx === -1) {
    return { baseUser: userPart, domain }
  }

  return {
    baseUser: userPart.substring(0, plusIdx),
    tag: userPart.substring(plusIdx + 1),
    domain
  }
}
