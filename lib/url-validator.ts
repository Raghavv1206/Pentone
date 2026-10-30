/**
 * URL Validator and Sanitizer
 * Pure utility module with 0 dependencies to prevent circular imports.
 */

export interface UrlValidationResult {
  valid: boolean
  url?: string
  error?: string
}

/**
 * Validates that a URL is well-formed and restricts navigation strictly to http: and https:
 * Blocks javascript:, data:, file:, vbscript:, chrome:, chrome-extension:, about:, edge:.
 */
export function validateAndSanitizeUrl(rawUrl: string): UrlValidationResult {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, error: 'URL must be a non-empty string' }
  }

  try {
    let toTest = rawUrl.trim()
    // Strip accidental wrapping quotes or backticks
    toTest = toTest.replace(/^["'`]|["'`]$/g, '').trim()

    // Explicitly reject dangerous or internal browser protocols
    if (/^(javascript|data|file|vbscript|chrome|chrome-extension|about|edge):/i.test(toTest)) {
      return { valid: false, error: `Dangerous or internal protocol prohibited: ${toTest.split(':')[0]}:` }
    }

    // Auto-prepend https:// if user provided bare domain (e.g. "www.youtube.com" or "youtube.com")
    if (!/^https?:\/\//i.test(toTest)) {
      toTest = 'https://' + toTest
    }

    const parsed = new URL(toTest)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, error: `Only http: and https: protocols are permitted, got ${parsed.protocol}` }
    }

    let resultUrl = parsed.toString()
    if (!toTest.endsWith('/') && resultUrl.endsWith('/') && parsed.pathname === '/') {
      resultUrl = resultUrl.slice(0, -1)
    }

    return { valid: true, url: resultUrl }
  } catch (err: any) {
    return { valid: false, error: `Invalid URL format: ${err?.message || 'parse failure'}` }
  }
}
