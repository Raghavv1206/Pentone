/**
 * Lightweight, zero-latency heuristic text improver & grammar corrector.
 * Serves as an instant, resilient fallback when Gemini Nano is initializing or unavailable.
 */
export function improveTextHeuristically(
  text: string,
  instruction: string = 'improve',
  tone: 'more-formal' | 'as-is' | 'more-casual' = 'as-is',
  length: 'shorter' | 'as-is' | 'longer' = 'as-is'
): string {
  if (!text || !text.trim()) return text

  let result = text.trim()

  // 1. Common pronoun & subject-verb agreement corrections
  const verbCorrections: [RegExp, string][] = [
    [/\bi\s+are\b/gi, 'I am'],
    [/\bi\s+is\b/gi, 'I am'],
    [/\bi\s+has\b/gi, 'I have'],
    [/\bi\s+were\b/gi, 'I was'],
    [/\byou\s+is\b/gi, 'you are'],
    [/\byou\s+was\b/gi, 'you were'],
    [/\bwe\s+is\b/gi, 'we are'],
    [/\bwe\s+was\b/gi, 'we were'],
    [/\bthey\s+is\b/gi, 'they are'],
    [/\bthey\s+was\b/gi, 'they were'],
    [/\bhe\s+are\b/gi, 'he is'],
    [/\bhe\s+have\b/gi, 'he has'],
    [/\bhe\s+don't\b/gi, "he doesn't"],
    [/\bshe\s+are\b/gi, 'she is'],
    [/\bshe\s+have\b/gi, 'she has'],
    [/\bshe\s+don't\b/gi, "she doesn't"],
    [/\bit\s+are\b/gi, 'it is'],
    [/\bit\s+have\b/gi, 'it has'],
    [/\bit\s+don't\b/gi, "it doesn't"],
    [/\bthere\s+is\s+(\d+|many|several|two|three|four|five|few)\b/gi, 'there are $1']
  ]

  for (const [regex, replacement] of verbCorrections) {
    result = result.replace(regex, replacement)
  }

  // 2. Common contractions & typo corrections
  const commonTypos: [RegExp, string][] = [
    [/\bteh\b/gi, 'the'],
    [/\brecieve\b/gi, 'receive'],
    [/\bseperate\b/gi, 'separate'],
    [/\boccured\b/gi, 'occurred'],
    [/\buntill\b/gi, 'until'],
    [/\bdefinately\b/gi, 'definitely'],
    [/\baccomodate\b/gi, 'accommodate'],
    [/\bim\b/gi, "I'm"],
    [/\bi\b/g, 'I'],
    [/\bdont\b/gi, "don't"],
    [/\bcant\b/gi, "can't"],
    [/\bwont\b/gi, "won't"],
    [/\bdidnt\b/gi, "didn't"],
    [/\bdoesnt\b/gi, "doesn't"],
    [/\bwasnt\b/gi, "wasn't"],
    [/\bwerent\b/gi, "weren't"],
    [/\bisnt\b/gi, "isn't"],
    [/\barent\b/gi, "aren't"],
    [/\bhavent\b/gi, "haven't"],
    [/\bhasnt\b/gi, "hasn't"],
    [/\bcouldnt\b/gi, "couldn't"],
    [/\bshouldnt\b/gi, "shouldn't"],
    [/\bwouldnt\b/gi, "wouldn't"],
    [/\bthats\b/gi, "that's"],
    [/\bwhats\b/gi, "what's"],
    [/\blets\b/gi, "let's"]
  ]

  for (const [regex, replacement] of commonTypos) {
    result = result.replace(regex, replacement)
  }

  // 3. Tone adjustments
  if (tone === 'more-formal') {
    const formalReplacements: [RegExp, string][] = [
      [/\bgonna\b/gi, 'going to'],
      [/\bwanna\b/gi, 'want to'],
      [/\bgotta\b/gi, 'must'],
      [/\bkinda\b/gi, 'somewhat'],
      [/\bsorta\b/gi, 'somewhat'],
      [/\byeah\b/gi, 'yes'],
      [/\byep\b/gi, 'yes'],
      [/\bnope\b/gi, 'no'],
      [/\bcan't\b/gi, 'cannot'],
      [/\bdon't\b/gi, 'do not'],
      [/\bwon't\b/gi, 'will not'],
      [/\bdoesn't\b/gi, 'does not'],
      [/\bdidn't\b/gi, 'did not'],
      [/\bI'm\b/gi, 'I am'],
      [/\bwe're\b/gi, 'we are'],
      [/\bthey're\b/gi, 'they are'],
      [/\byou're\b/gi, 'you are']
    ]
    for (const [regex, replacement] of formalReplacements) {
      result = result.replace(regex, replacement)
    }
  } else if (tone === 'more-casual') {
    const casualReplacements: [RegExp, string][] = [
      [/\bcannot\b/gi, "can't"],
      [/\bdo not\b/gi, "don't"],
      [/\bwill not\b/gi, "won't"],
      [/\bdoes not\b/gi, "doesn't"],
      [/\bdid not\b/gi, "didn't"],
      [/\bI am\b/gi, "I'm"],
      [/\bwe are\b/gi, "we're"],
      [/\bthey are\b/gi, "they're"],
      [/\byou are\b/gi, "you're"]
    ]
    for (const [regex, replacement] of casualReplacements) {
      result = result.replace(regex, replacement)
    }
  }

  // 4. Length adjustments (conciseness)
  if (length === 'shorter') {
    const fillerWords = [
      /\bbasically,\s*/gi,
      /\bactually,\s*/gi,
      /\bliterally,\s*/gi,
      /\bin order to\b/gi,
      /\bat this point in time\b/gi,
      /\bdue to the fact that\b/gi,
      /\bin my personal opinion,?\s*/gi
    ]
    for (const regex of fillerWords) {
      result = result.replace(regex, (match) => {
        if (match.toLowerCase().includes('in order to')) return 'to'
        if (match.toLowerCase().includes('at this point in time')) return 'now'
        if (match.toLowerCase().includes('due to the fact that')) return 'because'
        return ''
      })
    }
  }

  // 5. Clean spacing and punctuation
  result = result.replace(/\s+/g, ' ').trim()

  // Insert period before independent clauses in run-on sentences (e.g. "Raghav I am" -> "Raghav. I am")
  result = result.replace(/([a-zA-Z0-9])\s+(I am|I was|I have|I will|I would|I can)\b/g, '$1. $2')

  // 6. Sentence capitalization
  result = result.replace(/(^\s*|[.!?]\s+)([a-z])/g, (_, p1, p2) => p1 + p2.toUpperCase())

  // Ensure "I" is capitalized
  result = result.replace(/\bi\b/g, 'I')

  // Capitalize common names / words after greeting (e.g. "my name is anthony raghav" -> Anthony Raghav)
  result = result.replace(/\bmy name is\s+([a-z]+)(\s+[a-z]+)?/gi, (match, first, second) => {
    const capFirst = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
    const capSecond = second ? ' ' + second.trim().charAt(0).toUpperCase() + second.trim().slice(1).toLowerCase() : ''
    return `My name is ${capFirst}${capSecond}`
  })

  // Ensure ends with punctuation if original looked like a sentence
  if (result.length > 5 && !/[.!?]$/.test(result) && !/[,;:]$/.test(result)) {
    result += '.'
  }

  return result
}

/**
 * Lightweight, zero-latency heuristic text generator.
 * Serves as an instant offline fallback when Writer API / Gemini Nano is unavailable.
 */
export function writeTextHeuristically(prompt: string, context: string = ''): string {
  if (!prompt || !prompt.trim()) return ''
  const p = prompt.toLowerCase().trim()

  // 1. Apologies / Late notifications
  if (p.includes('apolog') || p.includes('sorry') || p.includes('late') || p.includes('delay')) {
    return `I sincerely apologize for the delay. Thank you for your patience and understanding. I have addressed this matter and will keep you updated on further progress.`
  }

  // 2. Thank you / Appreciation
  if (p.includes('thank') || p.includes('appreciat') || p.includes('grateful')) {
    return `Thank you very much for your time, support, and guidance. It is greatly appreciated, and I look forward to continuing our collaboration.`
  }

  // 3. Follow-up / Status update
  if (p.includes('follow up') || p.includes('follow-up') || p.includes('status') || p.includes('check in')) {
    return `I am following up regarding our previous conversation. Could you please provide a brief update on the current status at your earliest convenience? Thank you.`
  }

  // 4. Meeting request / Scheduling
  if (p.includes('meet') || p.includes('schedule') || p.includes('call') || p.includes('catch up')) {
    return `I would like to schedule a brief meeting to discuss this further. Please let me know what times work best for your calendar this week.`
  }

  // 5. Professional confirmation / acknowledgment
  if (p.includes('confirm') || p.includes('acknowledge') || p.includes('got it') || p.includes('received')) {
    return `Thank you for the update. I confirm receipt of the details and will proceed accordingly. Please let me know if anything else is needed.`
  }

  // 6. Generic prompt formatting: clean up the prompt itself into a polished assertion or statement
  let cleaned = prompt.trim()
  cleaned = cleaned.replace(/^(please\s+)?(write|draft|compose|generate|create)\s+(an?\s+)?/i, '')
  cleaned = cleaned.replace(/^(about|regarding)\s+/i, '')
  cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
  if (!/[.!?]$/.test(cleaned)) cleaned += '.'
  return cleaned
}

