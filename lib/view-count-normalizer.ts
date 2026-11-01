/**
 * View-Count Extraction and Normalization Utility
 * 
 * Accurately extracts and parses view-count representations from YouTube metadata,
 * aria-labels, and web video cards into normalized integer values.
 * 
 * Supports:
 * - K/M/B abbreviations ("1.2K", "450K", "2.3M", "1.5B")
 * - Formatted and raw integers ("1,234,567 views", "85 views", "0 views", "No views")
 * - Indian / Hinglish localized units ("1.5 Lakh views", "2.4 Crore views")
 * - European decimal notations ("1,2 M de vues", "2,5 Mio. Aufrufe")
 * - CJK localized units ("12万回視聴", "1.5亿次播放")
 * - Disambiguation against upload dates ("3 years ago"), video durations ("11 hours, 55 minutes"), and likes.
 */

export interface NormalizedViewCount {
  raw: string
  numeric: number | null
  confidence: 'high' | 'medium' | 'low' | 'none'
  isLiveStream?: boolean
}

/**
 * Normalizes European decimal notation e.g. "1,2 M" -> "1.2 M"
 * while preserving thousands separators in "1,234,567".
 */
function normalizeDecimalSeparator(str: string): string {
  // If comma is followed by a single or double digit and an abbreviation (e.g. "1,2 M" or "1,25M"):
  return str.replace(/(\d+),(\d{1,2})\s*([kmb]|lakh|crore|mio)/gi, '$1.$2 $3')
}

/**
 * Parses an isolated view count snippet (e.g. "1.2M views", "450K", "2,345,678 views").
 */
export function parseViewCountSnippet(rawSnippet: string): NormalizedViewCount {
  if (!rawSnippet || typeof rawSnippet !== 'string') {
    return { raw: '', numeric: null, confidence: 'none' }
  }

  const trimmed = rawSnippet.trim()
  if (!trimmed) {
    return { raw: '', numeric: null, confidence: 'none' }
  }

  // Check for "No views" or "0 views"
  if (/^no\s+views\b/i.test(trimmed) || /^0\s+views\b/i.test(trimmed)) {
    return { raw: trimmed, numeric: 0, confidence: 'high' }
  }

  // Check for live stream watcher indicators
  const isLive = /\b(?:watching|watching\s+now|spectateurs)\b/i.test(trimmed)

  const normalized = normalizeDecimalSeparator(trimmed)

  // 1. Billion / B / Milliarde / Md
  const billionMatch = normalized.match(/([\d.]+)\s*(?:b|billion|milliarden?|md)\b/i)
  if (billionMatch) {
    const val = parseFloat(billionMatch[1])
    if (!isNaN(val)) {
      return { raw: trimmed, numeric: Math.round(val * 1_000_000_000), confidence: 'high', isLiveStream: isLive }
    }
  }

  // 2. Million / M / Mio / млн
  const millionMatch = normalized.match(/([\d.]+)\s*(?:m|million|millions|mio|mln|млн)\b/i)
  if (millionMatch) {
    const val = parseFloat(millionMatch[1])
    if (!isNaN(val)) {
      return { raw: trimmed, numeric: Math.round(val * 1_000_000), confidence: 'high', isLiveStream: isLive }
    }
  }

  // 3. Thousand / K / k / Tsd / тыс
  const thousandMatch = normalized.match(/([\d.]+)\s*(?:k|thousand|tsd|тыс)\b/i)
  if (thousandMatch) {
    const val = parseFloat(thousandMatch[1])
    if (!isNaN(val)) {
      return { raw: trimmed, numeric: Math.round(val * 1_000), confidence: 'high', isLiveStream: isLive }
    }
  }

  // 4. Indian numbering: Crore (1 Crore = 10,000,000)
  const croreMatch = normalized.match(/([\d.]+)\s*(?:crore|cr)\b/i)
  if (croreMatch) {
    const val = parseFloat(croreMatch[1])
    if (!isNaN(val)) {
      return { raw: trimmed, numeric: Math.round(val * 10_000_000), confidence: 'high', isLiveStream: isLive }
    }
  }

  // 5. Indian numbering: Lakh (1 Lakh = 100,000)
  const lakhMatch = normalized.match(/([\d.]+)\s*(?:lakh|lac)\b/i)
  if (lakhMatch) {
    const val = parseFloat(lakhMatch[1])
    if (!isNaN(val)) {
      return { raw: trimmed, numeric: Math.round(val * 100_000), confidence: 'high', isLiveStream: isLive }
    }
  }

  // 6. CJK numbering: 亿 (100,000,000)
  const cjkYiMatch = normalized.match(/([\d.]+)\s*亿/)
  if (cjkYiMatch) {
    const val = parseFloat(cjkYiMatch[1])
    if (!isNaN(val)) {
      return { raw: trimmed, numeric: Math.round(val * 100_000_000), confidence: 'high', isLiveStream: isLive }
    }
  }

  // 7. CJK numbering: 万 (10,000)
  const cjkWanMatch = normalized.match(/([\d.]+)\s*万/)
  if (cjkWanMatch) {
    const val = parseFloat(cjkWanMatch[1])
    if (!isNaN(val)) {
      return { raw: trimmed, numeric: Math.round(val * 10_000), confidence: 'high', isLiveStream: isLive }
    }
  }

  // 8. Raw formatted integer with thousands commas or spaces or periods:
  // e.g. "1,234,567 views", "1.234.567 Aufrufe", "1 234 567 vues", "350 views"
  const rawIntMatch = normalized.match(/([\d][\d.,\s]*)\s*(?:views|aufrufe|vues|visualizaciones|visualizações|views|reproducciones|回視聴|次播放)\b/i)
  if (rawIntMatch) {
    const cleanDigits = rawIntMatch[1].replace(/[.,\s]/g, '')
    const val = parseInt(cleanDigits, 10)
    if (!isNaN(val)) {
      return { raw: trimmed, numeric: val, confidence: 'high', isLiveStream: isLive }
    }
  }

  // 9. Plain numeric string if snippet is strictly digits/separators (e.g. "12345", "1,234")
  if (/^[\d,\s]+$/.test(trimmed)) {
    const clean = trimmed.replace(/[,\s]/g, '')
    const val = parseInt(clean, 10)
    if (!isNaN(val)) {
      return { raw: trimmed, numeric: val, confidence: 'low', isLiveStream: isLive }
    }
  }

  return { raw: trimmed, numeric: null, confidence: 'none' }
}

/**
 * Extracts view counts from composite text (such as YouTube's aria-label).
 * Example aria-label:
 * "React in 100 Seconds by Fireship 3 years ago 2 minutes, 28 seconds 2,345,678 views"
 * or "React Tutorial by Code with Harry 1 year ago 450K views"
 * 
 * Accurately ignores:
 * - Dates ("3 years ago", "2 months ago", "14 days ago", "1 hour ago")
 * - Durations ("2 minutes, 28 seconds", "11 hours, 55 minutes")
 */
export function extractViewCountFromText(compositeText: string): NormalizedViewCount {
  if (!compositeText || typeof compositeText !== 'string') {
    return { raw: '', numeric: null, confidence: 'none' }
  }

  // 1. Look for explicit "... views" patterns first (highest confidence)
  // Match e.g. "2,345,678 views", "1.2M views", "450K views", "1.5 crore views", "12万回視聴"
  const viewsPattern = /(?:^|\s)([\d.,\s]+(?:[kmb]|million|billion|thousand|lakh|crore|mio|mln|万|亿)?)\s*(?:views|aufrufe|vues|visualizaciones|visualizações|回視聴|次播放)\b/i
  const match = compositeText.match(viewsPattern)

  if (match) {
    const candidateSnippet = match[0].trim()
    const parsed = parseViewCountSnippet(candidateSnippet)
    if (parsed.numeric !== null) {
      return parsed
    }
  }

  // 2. Look for live stream watching indicators: "1.2K watching"
  const livePattern = /(?:^|\s)([\d.,\s]+(?:[kmb]|thousand|million)?)\s*(?:watching|watching\s+now)\b/i
  const liveMatch = compositeText.match(livePattern)
  if (liveMatch) {
    const parsed = parseViewCountSnippet(liveMatch[0].trim())
    if (parsed.numeric !== null) {
      return { ...parsed, isLiveStream: true }
    }
  }

  // 3. Fallback: Parse the raw snippet directly
  return parseViewCountSnippet(compositeText)
}

export interface VideoCandidate {
  index: number
  title: string
  channel?: string
  viewCountRaw?: string
  viewCountNumeric?: number
  url?: string
  confidence: 'high' | 'medium' | 'low' | 'none'
  visibility: boolean
}

/**
 * Compares an array of video candidates and selects the one with the verified highest view count.
 * Returns null if no valid candidates have numeric view counts.
 */
export function selectHighestViewVideo(candidates: VideoCandidate[]): VideoCandidate | null {
  const valid = candidates.filter(c => typeof c.viewCountNumeric === 'number' && !isNaN(c.viewCountNumeric))
  if (valid.length === 0) {
    return null
  }

  // Sort descending by numeric view count
  valid.sort((a, b) => (b.viewCountNumeric || 0) - (a.viewCountNumeric || 0))
  return valid[0]
}
