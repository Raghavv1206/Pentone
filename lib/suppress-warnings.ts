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
    const fullText = args.map(arg => {
      if (!arg) return ''
      if (typeof arg === 'string') return arg
      if (typeof arg?.message === 'string') return `${arg.name ? arg.name + ': ' : ''}${arg.message}`
      if (typeof arg?.stack === 'string') return arg.stack
      return String(arg)
    }).join(' ')

    if (fullText.includes('Unable to determine content-length from response headers')) return true
    if (fullText.includes('No output language was specified in a LanguageModel API request')) return true
    if (fullText.includes('No output language was specified in a Writer API request')) return true
    if (fullText.includes('No output language was specified in a Rewriter API request')) return true
    if (fullText.includes('No output language was specified in a Summarizer API request')) return true
    if (fullText.includes('No output language was specified')) return true
    if (fullText.includes('Speech recognition error: aborted')) return true
    if (fullText.includes('Speech recognition error: no-speech')) return true
    if (/model capability.*not available|not available.*model capability|model adaptation.*not available/i.test(fullText)) return true
    if (/extension context invalidated|context invalidated/i.test(fullText)) return true
    if (/the message port closed before a response was received/i.test(fullText)) return true
    if (/could not establish connection/i.test(fullText)) return true
    if (/resizeobserver loop/i.test(fullText)) return true
    if (/unchecked runtime\.lasterror/i.test(fullText)) return true

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

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const msg = typeof reason === 'string' ? reason : (reason?.message || String(reason || ''))
    if (
      isSuppressedMessage([reason]) || 
      /model capability.*not available|not available.*model capability|model adaptation.*not available|extension context invalidated|context invalidated|resizeobserver loop/i.test(msg)
    ) {
      event.preventDefault()
      event.stopImmediatePropagation?.()
    }
  })

  window.addEventListener('error', (event) => {
    const err = event.error || event.message
    const msg = typeof err === 'string' ? err : (err?.message || String(err || ''))
    if (
      isSuppressedMessage([err, event.message]) || 
      /model capability.*not available|not available.*model capability|model adaptation.*not available|extension context invalidated|context invalidated|resizeobserver loop/i.test(msg)
    ) {
      event.preventDefault()
      event.stopImmediatePropagation?.()
    }
  })
}

export {}
