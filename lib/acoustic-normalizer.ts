import { doubleMetaphone } from 'double-metaphone'

/**
 * Known acoustic mishearings and phonetic corrections for speech recognition (ASR).
 * ASR engines frequently map non-English or Indian proper nouns, artist names,
 * and conversational words to phonetically similar English words
 * (e.g. "bure din by seedhe maut" -> "burethan by siremath" or "burethin by siddhi moth").
 */
const KNOWN_PHONETIC_REPLACEMENTS: [RegExp, string][] = [
  // Seedhe Maut & Bure Din specific acoustic patterns
  [/\bburethan\s+(?:by\s+)?siremath\b/gi, 'bure din by seedhe maut'],
  [/\bburethin\s+(?:by\s+)?siddhi\s+moth\b/gi, 'bure din by seedhe maut'],
  [/\bburethan\s+(?:by\s+)?siddhi\s+moth\b/gi, 'bure din by seedhe maut'],
  [/\bburethin\s+(?:by\s+)?siremath\b/gi, 'bure din by seedhe maut'],
  [/\b(?:burethan|burethin|buredin|pure\s+din)\b/gi, 'bure din'],
  [/\b(?:siremath|siddhi\s+moth|sidhi\s+maut|seedhe\s+mauth|sidhe\s+maut|seedhi\s+maut|siddhimoth)\b/gi, 'seedhe maut'],

  // Popular Indian artists & music queries frequently mangled by Western ASR
  [/\b(?:arjit|arijit)\s+singh\b/gi, 'Arijit Singh'],
  [/\b(?:diljeet|diljit)\s+(?:dosanj|dosanjh)?\b/gi, 'Diljit Dosanjh'],
  [/\b(?:kr\$na|krsna|krshna)\s+rap\b/gi, 'KR$NA rap'],
  [/\bpratik\s+kuhad\b/gi, 'Prateek Kuhad'],
  [/\bshreya\s+ghosal\b/gi, 'Shreya Ghoshal'],
  [/\ba\s+r\s+rahman\b/gi, 'A.R. Rahman'],
  [/\bsidhu\s+moosewala\b/gi, 'Sidhu Moose Wala'],
  [/\banuv\s+jen\b/gi, 'Anuv Jain'],

  // Common Hindi / Hinglish phrases misheard as English syllables
  [/\bachhe\s+din\b/gi, 'acche din'],
  [/\bshuru\s+karo\b/gi, 'shuru karo'],
  [/\bband\s+karo\b/gi, 'band karo']
]

/**
 * Double Metaphone signatures for targeted phonetic restoration.
 * Matches phonetic codes when ASR transcribes distinct words that produce identical sound keys.
 */
interface PhoneticSignature {
  keys: string[]
  canonical: string
}

const PHONETIC_SIGNATURES: PhoneticSignature[] = [
  // Seedhe Maut: doubleMetaphone('seedhe') = ['ST', 'ST'], doubleMetaphone('maut') = ['MT', 'MT']
  { keys: ['ST', 'MT'], canonical: 'seedhe maut' },
  // Bure Din: doubleMetaphone('bure') = ['PR', 'PR'], doubleMetaphone('din') = ['TN', 'TN']
  { keys: ['PR', 'TN'], canonical: 'bure din' }
]

function matchesSignature(word1: string, word2: string, sig: PhoneticSignature): boolean {
  if (!word1 || !word2) return false
  const [w1p1, w1p2] = doubleMetaphone(word1)
  const [w2p1, w2p2] = doubleMetaphone(word2)
  const [k1, k2] = sig.keys

  const firstMatches = w1p1 === k1 || w1p2 === k1
  const secondMatches = w2p1 === k2 || w2p2 === k2
  return firstMatches && secondMatches
}

/**
 * Normalizes speech recognition transcripts by stripping repeated command stutters
 * and repairing known acoustic errors so the user's intent is faithfully preserved.
 */
export function polishAcousticTranscript(text: string): string {
  if (!text || typeof text !== 'string') return ''

  let cleaned = text.trim()

  // 1. Clean repetitive speech recognition stutters (e.g. "search for search for", "open open")
  cleaned = cleaned
    .replace(/\b(?:search\s+for\s+)+search\s+for\b/gi, 'search for')
    .replace(/\b(?:search\s+)+search\b/gi, 'search')
    .replace(/\b(?:open\s+youtube\s+)+open\s+youtube\b/gi, 'open youtube')
    .replace(/\b(?:open\s+)+open\b/gi, 'open')
    .replace(/\b(?:play\s+)+play\b/gi, 'play')
    .replace(/\b(?:close\s+)+close\b/gi, 'close')

  // 2. Known phonetic pattern replacements
  for (const [regex, replacement] of KNOWN_PHONETIC_REPLACEMENTS) {
    cleaned = cleaned.replace(regex, replacement)
  }

  // 3. Double-Metaphone two-word phonetic signature scanning
  const words = cleaned.split(/\s+/)
  if (words.length >= 2) {
    for (let i = 0; i < words.length - 1; i++) {
      const w1 = words[i].toLowerCase()
      const w2 = words[i + 1].toLowerCase()

      for (const sig of PHONETIC_SIGNATURES) {
        if (matchesSignature(w1, w2, sig)) {
          words.splice(i, 2, sig.canonical)
          cleaned = words.join(' ')
          break
        }
      }
    }
  }

  return cleaned.replace(/\s+/g, ' ').trim()
}

/**
 * Cleans, unwraps, and acoustically corrects extracted search query strings.
 */
export function polishSearchQuery(rawQuery: string): string {
  if (!rawQuery || typeof rawQuery !== 'string') return ''

  let q = rawQuery.trim()

  // Remove surrounding quotes and punctuation
  q = q.replace(/^["'`]+|["'`]+$/g, '').replace(/[?.!]+$/, '').trim()

  // Strip accidental search prefix residue (e.g. "search for search for X" -> "X")
  q = q.replace(/^(?:(?:search|look\s+up|find)\s+(?:for\s+|about\s+)?)+/i, '').trim()

  // Strip trailing target markers if captured inside query (e.g. "react on youtube" -> "react")
  q = q.replace(/\s+(?:on|in)\s+(?:google|youtube|amazon|github|reddit|twitter|x|wikipedia|spotify|netflix|maps)\s*$/i, '').trim()

  // Apply acoustic corrections
  q = polishAcousticTranscript(q)

  return q.replace(/^["'`]+|["'`]+$/g, '').trim()
}
