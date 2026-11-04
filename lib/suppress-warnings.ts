/**
 * Runtime warning suppressor for Chrome MV3.
 * Chrome extensions treat calls to console.warn as issues/warnings in the extension dashboard.
 * Third-party libraries like Transformers.js (when downloading chunked files without Content-Length)
 * or Web Speech API (on normal speech pauses or aborts) log harmless warnings.
 * This filter intercepts only those specific known benign messages.
 */

if (typeof window !== 'undefined' && console.warn) {
  const originalWarn = console.warn.bind(console)

  console.warn = (...args: any[]) => {
    if (args.length > 0) {
      const firstArg = typeof args[0] === 'string' ? args[0] : ''

      // Suppress Transformers.js chunked buffer expansion warning
      if (firstArg.includes('Unable to determine content-length from response headers')) {
        return
      }

      // Suppress normal speech recognition abort/pause notices
      if (firstArg.includes('Speech recognition error: aborted') || firstArg.includes('Speech recognition error: no-speech')) {
        return
      }
    }

    originalWarn(...args)
  }
}

export {}
