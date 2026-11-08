// Unified, resilient helpers for Chrome Built-in AI APIs
// Compliant with W3C Writing Assistance APIs & Chrome Prompt API specs

export const getLanguageModelAPI = () =>
  (typeof window !== 'undefined' ? (window as any).LanguageModel || (window as any).ai?.languageModel || (window as any).ai?.assistant : null) ||
  (typeof self !== 'undefined' ? (self as any).LanguageModel || (self as any).ai?.languageModel || (self as any).ai?.assistant : null)

export const getRewriterAPI = () =>
  (typeof window !== 'undefined' ? (window as any).Rewriter || (window as any).ai?.rewriter : null) ||
  (typeof self !== 'undefined' ? (self as any).Rewriter || (self as any).ai?.rewriter : null)

export const getWriterAPI = () =>
  (typeof window !== 'undefined' ? (window as any).Writer || (window as any).ai?.writer : null) ||
  (typeof self !== 'undefined' ? (self as any).Writer || (self as any).ai?.writer : null)

export const getSummarizerAPI = () =>
  (typeof window !== 'undefined' ? (window as any).Summarizer || (window as any).ai?.summarizer : null) ||
  (typeof self !== 'undefined' ? (self as any).Summarizer || (self as any).ai?.summarizer : null)

export const getTranslatorAPI = () =>
  (typeof window !== 'undefined' ? (window as any).Translator || (window as any).ai?.translator || (window as any).translation : null) ||
  (typeof self !== 'undefined' ? (self as any).Translator || (self as any).ai?.translator || (self as any).translation : null)

export const getLanguageDetectorAPI = () =>
  (typeof window !== 'undefined' ? (window as any).LanguageDetector || (window as any).ai?.languageDetector || (window as any).translation?.canDetect : null) ||
  (typeof self !== 'undefined' ? (self as any).LanguageDetector || (self as any).ai?.languageDetector || (self as any).translation?.canDetect : null)

/**
 * Checks LanguageModel availability.
 * CRITICAL: In Chromium, availability() MUST be awaited before create() is called,
 * otherwise Chromium throws "The device is unable to create a session to run the model. Please check the result of availability() first."
 */
export async function checkLanguageModelAvailability(LM?: any): Promise<'available' | 'after-download' | 'no'> {
  const model = LM || getLanguageModelAPI()
  if (!model) return 'no'

  try {
    if (typeof model.availability === 'function') {
      try {
        const res = await model.availability({
          expectedOutputs: [{ type: 'text', languages: ['en'] }],
          outputLanguage: 'en'
        })
        if (res === 'readily' || res === 'available') return 'available'
        if (res === 'after-download' || res === 'downloadable') return 'after-download'
        if (res === 'no' || res === 'unavailable') return 'no'
      } catch {
        try {
          const res = await model.availability({ outputLanguage: 'en' })
          if (res === 'readily' || res === 'available') return 'available'
          if (res === 'after-download' || res === 'downloadable') return 'after-download'
          if (res === 'no' || res === 'unavailable') return 'no'
        } catch {
          const res = await model.availability({ outputLanguage: 'en' })
          if (res === 'readily' || res === 'available') return 'available'
          if (res === 'after-download' || res === 'downloadable') return 'after-download'
          if (res === 'no' || res === 'unavailable') return 'no'
        }
      }
    } else if (typeof model.capabilities === 'function') {
      const caps = await model.capabilities()
      const avail = caps?.available
      if (avail === 'readily' || avail === 'available') return 'available'
      if (avail === 'after-download' || avail === 'downloadable') return 'after-download'
      return 'no'
    }
  } catch (e) {
    console.warn('[chrome-ai-helpers] LanguageModel availability check failed:', e)
  }
  return 'no'
}

/**
 * Checks Rewriter availability compliant with W3C Writing Assistance API.
 * Ensures outputLanguage is always supplied to avoid Chrome warning/error:
 * "No output language was specified in a Rewriter API request."
 */
export async function checkRewriterAvailability(Rewriter?: any, options?: any): Promise<'available' | 'after-download' | 'no'> {
  const rewriter = Rewriter || getRewriterAPI()
  if (!rewriter || typeof rewriter.availability !== 'function') return 'no'

  const outputLanguage = options?.outputLanguage || 'en'
  const cleanOpts: any = {
    outputLanguage,
    expectedInputLanguages: options?.expectedInputLanguages || [outputLanguage],
    expectedContextLanguages: options?.expectedContextLanguages || [outputLanguage]
  }
  if (options?.tone) cleanOpts.tone = options.tone
  if (options?.format) cleanOpts.format = options.format
  if (options?.length) cleanOpts.length = options.length
  if (options?.sharedContext) cleanOpts.sharedContext = options.sharedContext

  try {
    let res: any
    try {
      res = await rewriter.availability(cleanOpts)
    } catch {
      try {
        res = await rewriter.availability({ outputLanguage })
      } catch {
        try {
          res = await rewriter.availability({
            expectedOutputs: [{ type: 'text', languages: [outputLanguage] }],
            outputLanguage
          })
        } catch {
          res = await rewriter.availability()
        }
      }
    }

    if (res === 'readily' || res === 'available') return 'available'
    if (res === 'after-download' || res === 'downloadable') return 'after-download'
    return 'no'
  } catch {
    return 'no'
  }
}

/**
 * Checks Writer availability compliant with W3C Writing Assistance API.
 * Ensures outputLanguage is always supplied to prevent:
 * "No output language was specified in a Writer API request. An output language should be specified to ensure optimal output quality and properly attest to output safety. Please specify a supported output language code: [de, en, es, fr, ja]"
 */
export async function checkWriterAvailability(Writer?: any, options?: any): Promise<'available' | 'after-download' | 'no'> {
  const writer = Writer || getWriterAPI()
  if (!writer || typeof writer.availability !== 'function') return 'no'

  const outputLanguage = options?.outputLanguage || 'en'
  const cleanOpts: any = {
    outputLanguage,
    expectedInputLanguages: options?.expectedInputLanguages || [outputLanguage],
    expectedContextLanguages: options?.expectedContextLanguages || [outputLanguage]
  }
  if (options?.tone) cleanOpts.tone = options.tone
  if (options?.format) cleanOpts.format = options.format
  if (options?.length) cleanOpts.length = options.length
  if (options?.sharedContext) cleanOpts.sharedContext = options.sharedContext

  try {
    let res: any
    try {
      res = await writer.availability(cleanOpts)
    } catch {
      try {
        res = await writer.availability({ outputLanguage })
      } catch {
        try {
          res = await writer.availability({
            expectedOutputs: [{ type: 'text', languages: [outputLanguage] }],
            outputLanguage
          })
        } catch {
          res = await writer.availability()
        }
      }
    }

    if (res === 'readily' || res === 'available') return 'available'
    if (res === 'after-download' || res === 'downloadable') return 'after-download'
    return 'no'
  } catch {
    return 'no'
  }
}

/**
 * Checks Summarizer availability compliant with Chrome Summarizer API.
 * Ensures outputLanguage is always supplied.
 */
export async function checkSummarizerAvailability(Summarizer?: any, options?: any): Promise<'available' | 'after-download' | 'no'> {
  const summarizer = Summarizer || getSummarizerAPI()
  if (!summarizer || typeof summarizer.availability !== 'function') return 'no'

  const outputLanguage = options?.outputLanguage || 'en'
  const cleanOpts: any = {
    outputLanguage,
    expectedInputLanguages: options?.expectedInputLanguages || [outputLanguage],
    expectedContextLanguages: options?.expectedContextLanguages || [outputLanguage]
  }
  if (options?.type) cleanOpts.type = options.type
  if (options?.format) cleanOpts.format = options.format
  if (options?.length) cleanOpts.length = options.length
  if (options?.sharedContext) cleanOpts.sharedContext = options.sharedContext

  try {
    let res: any
    try {
      res = await summarizer.availability(cleanOpts)
    } catch {
      try {
        res = await summarizer.availability({ outputLanguage })
      } catch {
        try {
          res = await summarizer.availability({
            expectedOutputs: [{ type: 'text', languages: [outputLanguage] }],
            outputLanguage
          })
        } catch {
          res = await summarizer.availability()
        }
      }
    }

    if (res === 'readily' || res === 'available') return 'available'
    if (res === 'after-download' || res === 'downloadable') return 'after-download'
    return 'no'
  } catch {
    return 'no'
  }
}

/**
 * Creates a LanguageModel session safely by awaiting availability() first
 * and progressively trying all Prompt API parameter variants.
 */
export async function createLMSession(
  LM: any,
  options: { systemPrompt: string; outputLanguage?: string; signal?: AbortSignal }
): Promise<any> {
  const model = LM || getLanguageModelAPI()
  if (!model) {
    throw new Error('Gemini Nano is not available. Please enable Optimization Guide On Device Model in chrome://flags.')
  }

  const avail = await checkLanguageModelAvailability(model)
  if (avail === 'no') {
    throw new Error('Gemini Nano is unavailable on this device. Please check chrome://flags and chrome://components.')
  }

  const monitorOpt = avail === 'after-download' ? {
    monitor(m: any) {
      m.addEventListener('downloadprogress', (e: any) => {
        console.log(`[LanguageModel] Model downloading: ${(e.loaded * 100).toFixed(0)}%`)
      })
    }
  } : {}

  const signalOpt = options.signal ? { signal: options.signal } : {}

  try {
    return await model.create({
      systemPrompt: options.systemPrompt,
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
      outputLanguage: options.outputLanguage || 'en',
      ...monitorOpt,
      ...signalOpt
    })
  } catch {
    try {
      return await model.create({
        initialPrompts: [{ role: 'system', content: options.systemPrompt }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
        outputLanguage: options.outputLanguage || 'en',
        ...monitorOpt,
        ...signalOpt
      })
    } catch {
      try {
        return await model.create({
          systemPrompt: options.systemPrompt,
          outputLanguage: options.outputLanguage || 'en',
          ...monitorOpt,
          ...signalOpt
        })
      } catch {
        return await model.create({
          systemPrompt: options.systemPrompt,
          outputLanguage: options.outputLanguage || 'en',
          ...monitorOpt,
          ...signalOpt
        })
      }
    }
  }
}

/**
 * Creates a Rewriter session safely with explicit outputLanguage.
 */
export async function createRewriterSession(
  Rewriter: any,
  options: { tone?: string; format?: string; length?: string; sharedContext?: string; signal?: AbortSignal; outputLanguage?: string; expectedInputLanguages?: string[]; expectedContextLanguages?: string[] }
): Promise<any> {
  const rewriter = Rewriter || getRewriterAPI()
  if (!rewriter || typeof rewriter.create !== 'function') {
    throw new Error('Rewriter API is not available')
  }

  const outputLanguage = options?.outputLanguage || 'en'
  const avail = await checkRewriterAvailability(rewriter, { ...options, outputLanguage })
  if (avail === 'no') {
    throw new Error('Rewriter is unavailable')
  }

  const monitorOpt = avail === 'after-download' ? {
    monitor(m: any) {
      m.addEventListener('downloadprogress', (e: any) => {
        console.log(`[Rewriter] Model downloading: ${(e.loaded * 100).toFixed(0)}%`)
      })
    }
  } : {}

  const cleanOpts: any = {
    outputLanguage,
    expectedInputLanguages: options?.expectedInputLanguages || [outputLanguage],
    expectedContextLanguages: options?.expectedContextLanguages || [outputLanguage],
    ...monitorOpt,
    ...(options?.signal ? { signal: options.signal } : {})
  }
  if (options?.tone) cleanOpts.tone = options.tone
  if (options?.format) cleanOpts.format = options.format
  if (options?.length) cleanOpts.length = options.length
  if (options?.sharedContext) cleanOpts.sharedContext = options.sharedContext

  try {
    return await rewriter.create(cleanOpts)
  } catch {
    try {
      return await rewriter.create({
        outputLanguage,
        format: options?.format || 'plain-text',
        sharedContext: options?.sharedContext,
        ...monitorOpt
      })
    } catch {
      try {
        return await rewriter.create({
          outputLanguage,
          ...monitorOpt
        })
      } catch {
        return await rewriter.create({ ...monitorOpt })
      }
    }
  }
}

/**
 * Creates a Writer session safely with explicit outputLanguage.
 * Ensures outputLanguage is passed to comply with Chrome requirement:
 * "No output language was specified in a Writer API request. Please specify a supported output language code: [de, en, es, fr, ja]"
 */
export async function createWriterSession(
  Writer: any,
  options: { tone?: string; format?: string; length?: string; sharedContext?: string; signal?: AbortSignal; outputLanguage?: string; expectedInputLanguages?: string[]; expectedContextLanguages?: string[] }
): Promise<any> {
  const writer = Writer || getWriterAPI()
  if (!writer || typeof writer.create !== 'function') {
    throw new Error('Writer API is not available')
  }

  const outputLanguage = options?.outputLanguage || 'en'
  const avail = await checkWriterAvailability(writer, { ...options, outputLanguage })
  if (avail === 'no') {
    throw new Error('Writer is unavailable')
  }

  const monitorOpt = avail === 'after-download' ? {
    monitor(m: any) {
      m.addEventListener('downloadprogress', (e: any) => {
        console.log(`[Writer] Model downloading: ${(e.loaded * 100).toFixed(0)}%`)
      })
    }
  } : {}

  const cleanOpts: any = {
    outputLanguage,
    expectedInputLanguages: options?.expectedInputLanguages || [outputLanguage],
    expectedContextLanguages: options?.expectedContextLanguages || [outputLanguage],
    ...monitorOpt,
    ...(options?.signal ? { signal: options.signal } : {})
  }
  if (options?.tone) cleanOpts.tone = options.tone
  if (options?.format) cleanOpts.format = options.format
  if (options?.length) cleanOpts.length = options.length
  if (options?.sharedContext) cleanOpts.sharedContext = options.sharedContext

  try {
    return await writer.create(cleanOpts)
  } catch {
    try {
      return await writer.create({
        outputLanguage,
        format: options?.format || 'plain-text',
        sharedContext: options?.sharedContext,
        ...monitorOpt
      })
    } catch {
      try {
        return await writer.create({
          outputLanguage,
          ...monitorOpt
        })
      } catch {
        return await writer.create({ ...monitorOpt })
      }
    }
  }
}

/**
 * Creates a Summarizer session safely with explicit outputLanguage.
 */
export async function createSummarizerSession(
  Summarizer: any,
  options: { type?: string; format?: string; length?: string; sharedContext?: string; signal?: AbortSignal; outputLanguage?: string; expectedInputLanguages?: string[]; expectedContextLanguages?: string[] }
): Promise<any> {
  const summarizer = Summarizer || getSummarizerAPI()
  if (!summarizer || typeof summarizer.create !== 'function') {
    throw new Error('Summarizer API is not available')
  }

  const outputLanguage = options?.outputLanguage || 'en'
  const avail = await checkSummarizerAvailability(summarizer, { ...options, outputLanguage })
  if (avail === 'no') {
    throw new Error('Summarizer is unavailable')
  }

  const monitorOpt = avail === 'after-download' ? {
    monitor(m: any) {
      m.addEventListener('downloadprogress', (e: any) => {
        console.log(`[Summarizer] Model downloading: ${(e.loaded * 100).toFixed(0)}%`)
      })
    }
  } : {}

  const cleanOpts: any = {
    outputLanguage,
    expectedInputLanguages: options?.expectedInputLanguages || [outputLanguage],
    expectedContextLanguages: options?.expectedContextLanguages || [outputLanguage],
    type: options?.type || 'key-points',
    format: options?.format || 'plain-text',
    length: options?.length || 'medium',
    ...monitorOpt,
    ...(options?.signal ? { signal: options.signal } : {})
  }
  if (options?.sharedContext) cleanOpts.sharedContext = options.sharedContext

  try {
    return await summarizer.create(cleanOpts)
  } catch {
    try {
      return await summarizer.create({
        outputLanguage,
        type: cleanOpts.type,
        format: cleanOpts.format,
        length: cleanOpts.length,
        sharedContext: cleanOpts.sharedContext,
        ...monitorOpt
      })
    } catch {
      return await summarizer.create({
        type: cleanOpts.type,
        format: cleanOpts.format,
        length: cleanOpts.length,
        ...monitorOpt
      })
    }
  }
}
