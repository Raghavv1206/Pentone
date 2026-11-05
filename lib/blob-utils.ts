/**
 * Blob and Data URL utilities that operate purely in memory.
 * Bypasses window.fetch() to prevent CSP (connect-src) violations on strict origins (e.g. mail.google.com).
 */

export function dataUrlToBlob(dataUrl: string): Blob {
  try {
    const commaIdx = dataUrl.indexOf(',')
    if (commaIdx === -1) {
      return new Blob([], { type: 'application/octet-stream' })
    }
    const header = dataUrl.slice(0, commaIdx)
    const base64Data = dataUrl.slice(commaIdx + 1)
    const mimeMatch = header.match(/:(.*?);/)
    const mime = mimeMatch ? mimeMatch[1] : 'image/png'
    const binaryStr = atob(base64Data)
    const len = binaryStr.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i)
    }
    return new Blob([bytes], { type: mime })
  } catch (err) {
    console.warn('[dataUrlToBlob] Manual base64 decode failed:', err)
    return new Blob([], { type: 'application/octet-stream' })
  }
}
