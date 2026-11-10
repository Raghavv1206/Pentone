/**
 * Voice Surfer - Hands-Free Voice Element Navigation
 * Overlays numbered badges on visible interactive elements and executes voice clicks.
 */

interface VoiceSurferState {
  host: HTMLElement | null
  elements: HTMLElement[]
}

function getState(): VoiceSurferState {
  const w = window as any
  if (!w.__pentone_voice_surfer_state) {
    w.__pentone_voice_surfer_state = { host: null, elements: [] }
  }
  return w.__pentone_voice_surfer_state
}

export function hideVoiceBadges(): void {
  const state = getState()
  if (state.host && document.body.contains(state.host)) {
    state.host.remove()
  }
  const existing = document.getElementById('pentone-voice-badges-host')
  if (existing) {
    existing.remove()
  }
  state.host = null
  state.elements = []
}

export function showVoiceBadges(): { count: number; message: string } {
  hideVoiceBadges()
  const state = getState()

  // 1. Query candidate interactive elements
  const selector = 'a, button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [onclick], summary'
  const allCandidates = Array.from(document.querySelectorAll<HTMLElement>(selector))

  // 2. Filter to currently visible elements in the viewport
  const viewportHeight = window.innerHeight
  const viewportWidth = window.innerWidth

  const visible = allCandidates.filter(el => {
    // Hidden by offset
    if (el.offsetParent === null && el.offsetWidth === 0 && el.offsetHeight === 0) return false
    // Inside Pentone overlays
    if (el.closest('#pentone-voice-badges-host, #pentone-autofill-host, [data-pentone-ui], #pentone-custom-selection-root')) return false

    const rect = el.getBoundingClientRect()
    if (rect.width < 10 || rect.height < 10) return false
    if (rect.bottom < 0 || rect.top > viewportHeight) return false
    if (rect.right < 0 || rect.left > viewportWidth) return false

    // Check computed visibility
    const style = window.getComputedStyle(el)
    if (style.visibility === 'hidden' || style.display === 'none' || parseFloat(style.opacity) < 0.1) return false

    return true
  })

  // 3. Sort elements top-to-bottom, left-to-right
  visible.sort((a, b) => {
    const rA = a.getBoundingClientRect()
    const rB = b.getBoundingClientRect()
    if (Math.abs(rA.top - rB.top) > 15) {
      return rA.top - rB.top
    }
    return rA.left - rB.left
  })

  // Cap at 45 elements for visual clarity and vocal ease
  const targetElements = visible.slice(0, 45)
  if (targetElements.length === 0) {
    return { count: 0, message: 'No visible interactive elements found in the current viewport.' }
  }

  state.elements = targetElements

  // 4. Create isolated Shadow DOM overlay host
  const host = document.createElement('div')
  host.id = 'pentone-voice-badges-host'
  host.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 2147483644;
    pointer-events: none;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `
  const shadow = host.attachShadow({ mode: 'open' })

  let badgeHTML = `
    <style>
      .badge {
        position: absolute;
        background: #005447;
        color: #67E2C8;
        border: 1px solid #67E2C8;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.6), 0 0 6px rgba(103, 226, 200, 0.4);
        border-radius: 4px;
        padding: 1px 5px;
        font-size: 11px;
        font-weight: 700;
        line-height: 14px;
        user-select: none;
        pointer-events: none;
        transform: translate(-30%, -30%);
        animation: pBadgePop 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes pBadgePop {
        from { transform: translate(-30%, -30%) scale(0.7); opacity: 0; }
        to { transform: translate(-30%, -30%) scale(1); opacity: 1; }
      }
      .instructions {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(23, 24, 22, 0.96);
        border: 1px solid rgba(103, 226, 200, 0.55);
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.7);
        border-radius: 12px;
        padding: 8px 16px;
        color: #F5F1E7;
        font-size: 12px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
        backdrop-filter: blur(12px);
        pointer-events: auto;
      }
      .dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #67E2C8;
        box-shadow: 0 0 8px #67E2C8;
      }
      .btn-cancel {
        background: transparent;
        border: none;
        color: #A6A49B;
        cursor: pointer;
        font-size: 14px;
        margin-left: 8px;
      }
      .btn-cancel:hover { color: #F5F1E7; }
    </style>
  `

  targetElements.forEach((el, idx) => {
    const rect = el.getBoundingClientRect()
    const pageY = rect.top + window.scrollY
    const pageX = rect.left + window.scrollX
    const num = idx + 1
    badgeHTML += `<div class="badge" style="top: ${pageY}px; left: ${pageX}px;">${num}</div>`
  })

  badgeHTML += `
    <div class="instructions">
      <div class="dot"></div>
      <span>Say "Click [number]" or "Hide numbers"</span>
      <button id="p-hide-badges" class="btn-cancel">✕</button>
    </div>
  `

  shadow.innerHTML = badgeHTML
  document.body.appendChild(host)
  state.host = host

  shadow.getElementById('p-hide-badges')?.addEventListener('click', () => {
    hideVoiceBadges()
  })

  // Auto-clear on escape
  const handleKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      hideVoiceBadges()
      window.removeEventListener('keydown', handleKey)
    }
  }
  window.addEventListener('keydown', handleKey)

  return {
    count: targetElements.length,
    message: `Displayed ${targetElements.length} numbered voice badges on screen. Speak "Click [number]" to activate.`
  }
}

export function clickVoiceBadge(targetIndex: number): { success: boolean; message: string } {
  const state = getState()
  if (!state.elements || state.elements.length === 0) {
    return { success: false, message: 'Voice badges are not currently visible. Say "Show numbers" first.' }
  }

  if (!Number.isInteger(targetIndex)) return { success: false, message: 'Choose a whole badge number.' }
  const idx = targetIndex - 1
  if (idx < 0 || idx >= state.elements.length) {
    return {
      success: false,
      message: `Invalid number: ${targetIndex}. Please choose between 1 and ${state.elements.length}.`
    }
  }

  const el = state.elements[idx]
  if (!el.isConnected || el.matches(':disabled, [aria-disabled="true"]')) return { success: false, message: 'This target is no longer available. Show numbers again.' }

  // Highlight effect
  const origBoxShadow = el.style.boxShadow
  el.style.transition = 'box-shadow 0.25s ease'
  el.style.boxShadow = '0 0 0 3px #67E2C8, 0 0 16px rgba(103, 226, 200, 0.6)'

  el.scrollIntoView({ behavior: 'smooth', block: 'center' })

  // If input or textarea, focus it
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    el.focus()
  } else {
    // Dispatch native click
    el.click()
  }

  setTimeout(() => {
    el.style.boxShadow = origBoxShadow
    hideVoiceBadges()
  }, 400)

  const label = (el.innerText || (el as HTMLInputElement).value || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 30)

  return {
    success: true,
    message: `Activated #${targetIndex} ("${label}").`
  }
}
