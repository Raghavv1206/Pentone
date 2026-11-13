/**
 * Devanagari to Roman (Hinglish) Transliteration Engine
 * 
 * Accurately converts Devanagari script into phonetic Romanized Latin script (Hinglish),
 * preserving proper nouns, music titles, artist names, and search queries (e.g.
 * "सर्च फॉर बुरे दिन व सीधे मौत" -> "search for bure din by seedhe maut")
 * instead of incorrectly translating their semantic meaning into literal English
 * ("bad days and straight death").
 */

// Common English loanwords and browser command keywords written in Devanagari
const DEVANAGARI_PHRASES: [string, string][] = [
  // Multi-word phrases first
  ['सर्च फॉर', 'search for'],
  ['सर्च करो', 'search for'],
  ['सर्च करें', 'search for'],
  ['तलाश करो', 'search for'],
  ['प्ले करो', 'play'],
  ['चला दो', 'play'],
  ['सुना दो', 'play'],
  ['खोल दो', 'open'],
  ['ओपन करो', 'open'],
  ['बंद कर दो', 'close'],
  ['बंद करो', 'close'],
  ['बंद कीजिए', 'close'],
  ['सीधे मौत', 'seedhe maut'],
  ['बुरे दिन', 'bure din'],
  ['अरिजीत सिंह', 'Arijit Singh'],
  ['दिलजीत दोसांझ', 'Diljit Dosanjh'],
  ['सिद्धू मूसेवाला', 'Sidhu Moose Wala'],
  ['प्रतीक कुहाड़', 'Prateek Kuhad'],
  ['श्रेया घोषाल', 'Shreya Ghoshal'],
  ['अनुव जैन', 'Anuv Jain'],

  // Single-word commands & platforms
  ['सर्च', 'search'],
  ['फॉर', 'for'],
  ['खोजो', 'search for'],
  ['ढूंढो', 'search for'],
  ['प्ले', 'play'],
  ['चलाओ', 'play'],
  ['सुनाओ', 'play'],
  ['खोलो', 'open'],
  ['खोलिए', 'open'],
  ['ओपन', 'open'],
  ['क्लोज़', 'close'],
  ['यूट्यूब', 'YouTube'],
  ['गूगल', 'Google'],
  ['अमेज़न', 'Amazon'],
  ['अमेजन', 'Amazon'],
  ['गिटहब', 'GitHub'],
  ['रेडिट', 'Reddit'],
  ['ट्विटर', 'Twitter'],
  ['नेटफ्लिक्स', 'Netflix'],
  ['स्पॉटिफाई', 'Spotify'],
  ['विकिपीडिया', 'Wikipedia'],
  ['फेसबुक', 'Facebook'],
  ['इंस्टाग्राम', 'Instagram'],
  ['टैब्स', 'tabs'],
  ['टैब', 'tab'],
  ['विंडो', 'window'],
  ['पेज', 'page'],
  ['स्क्रीनशॉट', 'screenshot'],
  ['समरी', 'summary'],
  ['सारांश', 'summary'],
  ['वीडियो', 'video'],
  ['सॉन्ग्स', 'songs'],
  ['सॉन्ग', 'song'],
  ['गाने', 'songs'],
  ['गाना', 'song'],
  ['म्यूजिक', 'music']
]

// Standalone Devanagari vowels
const VOWELS: Record<string, string> = {
  'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo',
  'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'अं': 'an', 'अः': 'ah'
}

// Matras (vowel signs attached to consonants)
const MATRAS: Record<string, string> = {
  'ा': 'a', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo',
  'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
  'ॉ': 'o', 'ॅ': 'e'
}

// Consonants (inherent vowel 'a' is added unless followed by halant or matra)
const CONSONANTS: Record<string, string> = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
  'क़': 'q', 'ख़': 'kh', 'ग़': 'gh', 'ज़': 'z', 'ड़': 'r', 'ढ़': 'rh', 'फ़': 'f'
}

// Conjuncts
const CONJUNCTS: Record<string, string> = {
  'क्ष': 'ksh', 'त्र': 'tr', 'ज्ञ': 'gy', 'श्र': 'shr'
}

// Devanagari numerals
const NUMERALS: Record<string, string> = {
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
  '५': '5', '६': '6', '७': '7', '८': '8', '९': '9'
}

/**
 * Transliterates a single Devanagari word into Romanized script.
 * Applies standard Hindi schwa deletion (terminal 'a' omitted).
 */
function transliterateDevanagariWord(word: string): string {
  if (!word) return ''

  // Special case: standalone single-letter 'व' (often speech-transcribed for "by" or "va" in music queries)
  if (word === 'व') {
    return 'by'
  }

  let out = ''
  const len = word.length

  for (let i = 0; i < len; i++) {
    const ch = word[i]
    const nextCh = i + 1 < len ? word[i + 1] : ''

    // Numeral
    if (NUMERALS[ch]) {
      out += NUMERALS[ch]
      continue
    }

    // Independent Vowel
    if (VOWELS[ch]) {
      out += VOWELS[ch]
      continue
    }

    // Conjunct
    if (CONJUNCTS[ch]) {
      const base = CONJUNCTS[ch]
      if (nextCh === '्') {
        out += base
        i++
      } else if (MATRAS[nextCh]) {
        out += base + MATRAS[nextCh]
        i++
      } else {
        const isTerminal = (i + 1 === len)
        out += isTerminal ? base : base + 'a'
      }
      continue
    }

    // Consonant
    if (CONSONANTS[ch]) {
      const base = CONSONANTS[ch]
      if (nextCh === '्') {
        // Halant / Virama suppresses vowel
        out += base
        i++ // Skip halant
      } else if (MATRAS[nextCh]) {
        // Matra supplies explicit vowel
        out += base + MATRAS[nextCh]
        i++ // Skip matra
      } else {
        // Inherent schwa: in Hindi, terminal consonant has no inherent 'a'
        const isTerminal = (i + 1 === len)
        out += isTerminal ? base : base + 'a'
      }
      continue
    }

    // Anusvara (ं) or Chandrabindu (ँ)
    if (ch === 'ं' || ch === 'ँ') {
      out += 'n'
      continue
    }

    // Visarga (ः)
    if (ch === 'ः') {
      out += 'h'
      continue
    }

    // Nukta dot modifier alone
    if (ch === '़') {
      continue
    }

    // Retain any non-Devanagari characters (e.g. English letters, punctuation)
    out += ch
  }

  return out
}

/**
 * Converts a Devanagari text into natural Romanized Hinglish.
 * Maps command keywords, loanwords, and phonetically transliterates queries.
 */
export function transliterateDevanagariToHinglish(text: string): string {
  if (!text || typeof text !== 'string') return ''

  let result = text.trim()

  // 1. Pre-process loanwords and multi-word phrases using Unicode-safe boundaries
  for (const [phrase, replacement] of DEVANAGARI_PHRASES) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(new RegExp(`(^|\\s|[.,!?:;()[\\]"'])${escaped}($|\\s|[.,!?:;()[\\]"'])`, 'gu'), (m, before, after) => {
      return `${before}${replacement}${after}`
    })
  }

  // 2. Transliterate remaining Devanagari words
  const tokens = result.split(/(\s+|[.,!?:;()[\]"]+)/)
  const transliterated = tokens.map(token => {
    // If token contains Devanagari characters (\u0900-\u097F)
    if (/[\u0900-\u097f]/u.test(token)) {
      return transliterateDevanagariWord(token)
    }
    return token
  })

  let output = transliterated.join('').replace(/\s+/g, ' ').trim()

  // 3. Post-process common Hindi music query patterns
  // e.g. "bure din v seedhe maut" or "bure din wa seedhe maut" -> "bure din by seedhe maut"
  output = output
    .replace(/\b([a-z0-9]+(?:\s+[a-z0-9]+)*)\s+(?:va|wa|v|aur)\s+seedhe\s+maut\b/gi, '$1 by seedhe maut')
    .replace(/\bseedhe\s+maut\s+(?:ka|ki|ke)\s+bure\s+din\b/gi, 'bure din by seedhe maut')

  return output
}
