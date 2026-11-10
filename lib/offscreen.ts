let pending: Promise<boolean> | null = null

// Share startup between callers and verify the listener is ready before sending AI work.
export function ensureOffscreenDocument(): Promise<boolean> {
  if (pending) return pending
  pending = prepare().finally(() => { pending = null })
  return pending
}

async function prepare(): Promise<boolean> {
  const api = (chrome as any).offscreen
  if (!api) return false
  try {
    const contexts = await (chrome.runtime as any).getContexts?.({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
    const exists = contexts?.length > 0 || await api.hasDocument?.()
    if (!exists) {
      try {
        await api.createDocument({ url: 'tabs/offscreen.html', reasons: ['DOM_SCRAPING'],
          justification: 'Execute on-device AI for in-page assistance' })
      } catch (error: any) {
        if (!error?.message?.includes('Only a single offscreen document')) throw error
      }
    }
    for (let attempt = 0; attempt < 30; attempt++) {
      const alive = await new Promise<boolean>(resolve => {
        const timeout = setTimeout(() => resolve(false), 100)
        chrome.runtime.sendMessage({ type: 'ping_offscreen' }).then(response => {
          clearTimeout(timeout); resolve(response?.alive === true)
        }, () => { clearTimeout(timeout); resolve(false) })
      })
      if (alive) return true
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  } catch (error) { console.warn('[Offscreen] Startup failed:', error) }
  return false
}
