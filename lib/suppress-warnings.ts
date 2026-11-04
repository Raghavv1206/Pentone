/**
 * Runtime warning suppressor for Chrome MV3.
 * Chrome extensions treat calls to console.warn and console.error as issues in the extension dashboard.
 * Third-party libraries like Transformers.js (when downloading chunked files without Content-Length),
 * Web Speech API (on normal speech pauses or aborts), and Chrome Built-in AI language notices
 * log harmless notices that should not appear as unhandled issues.
 */

if (typeof window !== 'undefined') {
  const isSuppressedMessage = (args: any[]): boolean => {
    if (!args || args.length === 0) return false
    const msg = typeof args[0] === 'string' ? args[0] : (args[0]?.message || String(args[0] || ''))

    if (msg.includes('Unable to determine content-length from response headers')) return true
    if (msg.includes('No output language was specified in a LanguageModel API request')) return true
    if (msg.includes('No output language was specified in a Writer API request')) return true
    if (msg.includes('No output language was specified in a Rewriter API request')) return true
    if (msg.includes('No output language was specified in a Summarizer API request')) return true
    if (msg.includes('Speech recognition error: aborted')) return true
    if (msg.includes('Speech recognition error: no-speech')) return true

    return false
  }

  if (console.warn) {
    const originalWarn = console.warn.bind(console)
    console.warn = (...args: any[]) => {
      if (isSuppressedMessage(args)) return
      originalWarn(...args)
    }
  }

  if (console.error) {
    const originalError = console.error.bind(console)
    console.error = (...args: any[]) => {
      if (isSuppressedMessage(args)) return
      originalError(...args)
    }
  }
}

export {}
