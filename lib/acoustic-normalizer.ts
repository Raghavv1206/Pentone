import { doubleMetaphone } from 'double-metaphone'
import { transliterateDevanagariToHinglish } from './devanagari-transliteration'

/**
 * Known acoustic mishearings and phonetic corrections for speech recognition (ASR).
 * ASR engines frequently map non-English or Indian proper nouns, artist names,
 * and conversational words to phonetically similar English words
 * (e.g. "bure din by seedhe maut" -> "burethan by siremath" or "burethin by siddhi moth").
 */
const KNOWN_PHONETIC_REPLACEMENTS: [RegExp, string][] = [
  // Seedhe Maut & Bure Din compound acoustic patterns (ASR mishearings reported in live usage)
  [/\b(?:buradin|bored\s+(?:then|din|than)|bored|burethan|burethin|buredin|pure\s+din|poor\s+din|boarding)\s+(?:by\s+)?see\s+them\s+(?:hot|with\s+a\s+new|with\s+an\s+you|out|not|mouth|mod)\b/gi, 'bure din by seedhe maut'],
  [/\b(?:buradin|bored\s+(?:then|din|than)|bored)\s+(?:by\s+)?see\s+them\b/gi, 'bure din by seedhe maut'],
  [/\b(?:buradin|bored\s+(?:then|din|than)|bored|burethan|burethin|buredin)\s+(?:by\s+)?(?:seedhe\s+maut|siremath|siddhi\s+moth|sidhi\s+maut|straight\s+death)\b/gi, 'bure din by seedhe maut'],
  [/\b(?:bad\s+days\s+(?:and\s+|by\s+|wa\s+)?straight\s+death|bad\s+days\s+straight\s+death)\b/gi, 'bure din by seedhe maut'],
  [/\b(?:bure\s+din|buradin|bura\s+din|bad\s+days)\s+(?:va|wa|v|w)\s+(?:seedhe\s+maut|sidhe\s+maut|straight\s+death)\b/gi, 'bure din by seedhe maut'],
  [/\bburethan\s+(?:by\s+)?siremath\b/gi, 'bure din by seedhe maut'],
  [/\bburethin\s+(?:by\s+)?siddhi\s+moth\b/gi, 'bure din by seedhe maut'],
  [/\bburethan\s+(?:by\s+)?siddhi\s+moth\b/gi, 'bure din by seedhe maut'],
  [/\bburethin\s+(?:by\s+)?siremath\b/gi, 'bure din by seedhe maut'],
  [/\b(?:boarding\s+by\s+city\s+mouth|poor\s+din\s+by\s+cd\s+mod)\b/gi, 'bure din by seedhe maut'],

  // Individual artist / track mishearings
  [/\b(?:buradin|buredin|burethan|burethin|pure\s+din|poor\s+din|bura\s+din|bored\s+(?:then|din|than))\b/gi, 'bure din'],
  [/\bbad\s+days\b/gi, 'bure din'],
  [/\bstraight\s+death\b/gi, 'seedhe maut'],
  [/\bsee\s+them\s+(?:hot|with\s+a\s+new|with\s+an\s+you|out|not|mouth|mod)\b/gi, 'seedhe maut'],
  [/\b(?:siremath|siddhi\s+moth|sidhi\s+maut|seedhe\s+mauth|sidhe\s+maut|seedhi\s+maut|siddhimoth|city\s+mouth|cd\s+mod)\b/gi, 'seedhe maut'],
  [/\bsee\s+the\s+(?:mouth|mod|maut)\b/gi, 'seedhe maut'],

  // Popular Indian artists & music queries frequently mangled by Western ASR
  [/\b(?:arjit|arijit)\s+singh\b/gi, 'Arijit Singh'],
  [/\b(?:diljeet|diljit)\s+(?:dosanj|dosanjh)?\b/gi, 'Diljit Dosanjh'],
  [/\b(?:kr\$na|krsna|krshna)\s+rap\b/gi, 'KR$NA rap'],
  [/\bpratik\s+kuhad\b/gi, 'Prateek Kuhad'],
  [/\bshreya\s+ghosal\b/gi, 'Shreya Ghoshal'],
  [/\ba\s+r\s+rahman\b/gi, 'A.R. Rahman'],
  [/\bsidhu\s+moosewala\b/gi, 'Sidhu Moose Wala'],
  [/\banuv\s+jen\b/gi, 'Anuv Jain'],
  [/\b(?:mc\s+stand|emcee\s+stan)\b/gi, 'MC Stan'],
  [/\b(?:raftar|raftaar\s+rap)\b/gi, 'Raftaar'],
  [/\b(?:chaar\s+diwari|char\s+diwari)\b/gi, 'Chaar Diwaari'],
  [/\b(?:talwinder|talwiinder)\b/gi, 'Talwiinder'],
  [/\b(?:ap\s+dhilon|ap\s+dhillon)\b/gi, 'AP Dhillon'],

  // Popular tracks
  [/\b(?:namaste\s+today|namaste\s+to\s+day)\b/gi, 'namastute'],
  [/\b(?:non\s*chaku|nun\s*chucks?)\b/gi, 'nanchaku'],
  [/\b(?:khatta\s+mita|khatta\s+mitha)\b/gi, 'khatta meetha'],

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
  { keys: ['PR', 'TN'], canonical: 'bure din' },
  // "bored then" / "bored din"
  { keys: ['PRT', '0N'], canonical: 'bure din' },
  { keys: ['PRT', 'TN'], canonical: 'bure din' },
  // "see hot" / "seedhe hot"
  { keys: ['S', 'HT'], canonical: 'seedhe maut' },
  { keys: ['S', 'MT'], canonical: 'seedhe maut' }
]

const SINGLE_WORD_PHONETIC_SIGNATURES: { key: string, canonical: string }[] = [
  // buradin -> 'PRTN'
  { key: 'PRTN', canonical: 'bure din' }
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

  // 0. If transcript contains Devanagari script, phonetically transliterate to Roman script (Hinglish)
  // to preserve proper nouns, music titles, and artist queries faithfully.
  if (/[\u0900-\u097f]/u.test(cleaned)) {
    cleaned = transliterateDevanagariToHinglish(cleaned)
  }

  // 1. Clean repetitive speech recognition stutters (e.g. "search for search for", "open open")
  cleaned = cleaned
    .replace(/\b(?:search\s+for\s+)+search\s+for\b/gi, 'search for')
    .replace(/\b(?:search\s+)+search\b/gi, 'search')
    .replace(/\b(?:open\s+youtube\s+)+open\s+youtube\b/gi, 'open youtube')
    .replace(/\b(?:open\s+)+open\b/gi, 'open')
    .replace(/\b(?:play\s+)+play\b/gi, 'play')
    .replace(/\b(?:close\s+)+close\b/gi, 'close')
    // Common ASR mishearings for "open [site]" before music or navigation commands
    .replace(/\b(?:when|win|one|went)\s+(?:you\s*tube|youtube)\b/gi, 'open youtube')
    .replace(/\b(?:when|win|one|went)\s+google\b/gi, 'open google')
    // Common ASR acoustic mishearings for "open" / "go to" navigation
    .replace(/\b(?:border|boarder)\s+(main\s+|home\s+|homepage\s+)?/gi, 'open $1')
    .replace(/\b(?:border|boarder)\s+(?:to\s+)?(youtube|google|github|reddit|twitter|x|linkedin|wikipedia|amazon|netflix|facebook|instagram|gmail|chatgpt|spotify|chrome:\/\/[a-z0-9_/-]+)\b/gi, 'open $1')
    // Common ASR mishearings for "tab" in tab switching
    .replace(/\b(?:previous|last|next)\s+(?:tap|types|taps|apps)\b/gi, (m) => m.replace(/tap|types|taps|apps/i, 'tab'))

  // 2. Known phonetic pattern replacements
  for (const [regex, replacement] of KNOWN_PHONETIC_REPLACEMENTS) {
    cleaned = cleaned.replace(regex, replacement)
  }

  // 3. Double-Metaphone phonetic signature scanning
  const words = cleaned.split(/\s+/)

  // 3A. Single word phonetic signatures (e.g. "buradin" -> PRTN -> "bure din")
  for (let i = 0; i < words.length; i++) {
    const w = words[i].toLowerCase()
    const [p1, p2] = doubleMetaphone(w)
    for (const sig of SINGLE_WORD_PHONETIC_SIGNATURES) {
      if (p1 === sig.key || p2 === sig.key) {
        words[i] = sig.canonical
        cleaned = words.join(' ')
        break
      }
    }
  }

  // 3B. Two-word phonetic signatures
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

  if (/[\u0900-\u097f]/u.test(q)) {
    q = transliterateDevanagariToHinglish(q)
  }

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
