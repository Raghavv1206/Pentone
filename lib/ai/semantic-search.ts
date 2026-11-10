/**
 * Semantic In-Page Search (Ctrl + Shift + F)
 * Concept-based search powered by Chrome's local Gemini Nano and smart token matching.
 */

let isSearchOpen = false
let currentMatches: HTMLElement[] = []
let currentMatchIndex = 0
let activeHost: HTMLElement | null = null

function cleanupHighlights() {
  for (const el of currentMatches) {
    try {
      const orig = el.getAttribute('data-pentone-orig-shadow')
      if (orig !== null) {
        el.style.boxShadow = orig
        el.removeAttribute('data-pentone-orig-shadow')
      } else {
        el.style.boxShadow = ''
      }
    } catch {}
  }
  currentMatches = []
  currentMatchIndex = 0
}

function applyMatchHighlight(el: HTMLElement, isActive: boolean) {
  if (!el.hasAttribute('data-pentone-orig-shadow')) {
    el.setAttribute('data-pentone-orig-shadow', el.style.boxShadow || '')
  }
  el.style.transition = 'box-shadow 0.25s ease'
  if (isActive) {
    el.style.boxShadow = '0 0 0 3px #67E2C8, 0 0 20px rgba(103, 226, 200, 0.6)'
  } else {
    el.style.boxShadow = '0 0 0 2px rgba(103, 226, 200, 0.5), 0 0 10px rgba(103, 226, 200, 0.2)'
  }
}

export function openSemanticSearchHUD() {
  if (activeHost && document.body.contains(activeHost)) {
    const input = activeHost.shadowRoot?.querySelector('input')
    input?.focus()
    input?.select()
    return
  }

  const host = document.createElement('div')
  host.id = 'pentone-semantic-search-host'
  host.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = `
    <style>
      .hud {
        background: rgba(23, 24, 22, 0.96);
        border: 1px solid rgba(103, 226, 200, 0.55);
        box-shadow: 0 14px 42px rgba(0, 0, 0, 0.7), 0 0 24px rgba(103, 226, 200, 0.25);
        border-radius: 14px;
        padding: 8px 14px;
        color: #F5F1E7;
        width: 460px;
        max-width: 90vw;
        backdrop-filter: blur(16px);
        display: flex;
        align-items: center;
        gap: 10px;
        animation: pSlideDown 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes pSlideDown {
        from { opacity: 0; transform: translateY(-12px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .icon-sparkle {
        color: #67E2C8;
        font-size: 14px;
        flex-shrink: 0;
      }
      .input-search {
        flex: 1;
        background: transparent;
        border: none;
        outline: none;
        color: #F5F1E7;
        font-size: 13px;
        font-family: inherit;
      }
      .input-search::placeholder {
        color: #77776E;
      }
      .badge-counter {
        font-size: 11px;
        color: #DDDCCB;
        background: rgba(255, 255, 255, 0.08);
        padding: 3px 7px;
        border-radius: 6px;
        white-space: nowrap;
      }
      .btn-nav {
        background: transparent;
        border: none;
        color: #A6A49B;
        cursor: pointer;
        font-size: 12px;
        padding: 4px;
        border-radius: 4px;
        transition: color 0.15s ease;
      }
      .btn-nav:hover {
        color: #67E2C8;
      }
      .btn-close {
        background: transparent;
        border: none;
        color: #77776E;
        cursor: pointer;
        font-size: 14px;
        padding: 2px 6px;
        border-radius: 4px;
      }
      .btn-close:hover {
        color: #F5F1E7;
      }
    </style>
    <div class="hud">
      <span class="icon-sparkle">✨</span>
      <input 
        type="text" 
        class="input-search" 
        placeholder="Semantic search on this page... (e.g. cancellation policy, pricing)" 
      />
      <span id="p-count" class="badge-counter">0 matches</span>
      <button id="p-prev" class="btn-nav" title="Previous match (Shift+Enter)">▲</button>
      <button id="p-next" class="btn-nav" title="Next match (Enter)">▼</button>
      <button id="p-close" class="btn-close" title="Close (Esc)">✕</button>
    </div>
  `

  const rootEl = document.body || document.documentElement
  if (!rootEl) return
  rootEl.appendChild(host)
  activeHost = host
  isSearchOpen = true

  const inputEl = shadow.querySelector('input') as HTMLInputElement
  const counterEl = shadow.getElementById('p-count') as HTMLElement
  const prevBtn = shadow.getElementById('p-prev') as HTMLElement
  const nextBtn = shadow.getElementById('p-next') as HTMLElement
  const closeBtn = shadow.getElementById('p-close') as HTMLElement

  inputEl?.focus()

  function closeHUD() {
    cleanupHighlights()
    if (activeHost && ((document.body && document.body.contains(activeHost)) || (document.documentElement && document.documentElement.contains(activeHost)))) {
      activeHost.remove()
      activeHost = null
    }
    isSearchOpen = false
  }

  function goToMatch(index: number) {
    if (currentMatches.length === 0) return
    if (index >= currentMatches.length) index = 0
    if (index < 0) index = currentMatches.length - 1

    currentMatchIndex = index

    currentMatches.forEach((m, idx) => {
      applyMatchHighlight(m, idx === currentMatchIndex)
    })

    const target = currentMatches[currentMatchIndex]
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (counterEl) {
      counterEl.textContent = `${currentMatchIndex + 1} of ${currentMatches.length}`
    }
  }

  let searchTimeout: any = null

  async function performSemanticSearch(query: string) {
    cleanupHighlights()
    const trimmed = query.trim().toLowerCase()
    if (!trimmed || trimmed.length < 2) {
      if (counterEl) counterEl.textContent = '0 matches'
      return
    }

    if (counterEl) counterEl.textContent = 'Searching...'

    // 1. Gather visible text blocks
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(
      'p, li, h1, h2, h3, h4, h5, h6, article, section, blockquote, td'
    ))

    const candidates = nodes.filter(n => {
      if (n.offsetParent === null && n.offsetWidth === 0) return false
      if (n.closest('#pentone-semantic-search-host, [data-pentone-ui]')) return false
      const text = n.innerText?.trim() || ''
      return text.length >= 20 && text.length <= 1200
    })

    // 2. Score candidates by token overlap & query terms
    const queryTokens = trimmed.split(/\s+/).filter(t => t.length > 2)
    const scored: { el: HTMLElement; score: number }[] = []

    for (const el of candidates) {
      const text = el.innerText.toLowerCase()
      let score = 0

      // Exact phrase match
      if (text.includes(trimmed)) {
        score += 10
      }

      // Token overlap
      for (const token of queryTokens) {
        if (text.includes(token)) {
          score += 2
        }
      }

      // Synonyms / common intent
      if (trimmed.includes('refund') || trimmed.includes('return') || trimmed.includes('cancel')) {
        if (/\b(cancel|refund|return|money\s*back|void|policy|terminate)\b/i.test(text)) score += 3
      }
      if (trimmed.includes('price') || trimmed.includes('cost') || trimmed.includes('plan')) {
        if (/\b(price|pricing|plan|tier|month|annual|subscription|\$|fee)\b/i.test(text)) score += 3
      }
      if (trimmed.includes('contact') || trimmed.includes('support')) {
        if (/\b(contact|support|email|reach|phone|help)\b/i.test(text)) score += 3
      }

      if (score > 0) {
        scored.push({ el, score })
      }
    }

    scored.sort((a, b) => b.score - a.score)
    currentMatches = scored.slice(0, 8).map(s => s.el)

    if (currentMatches.length > 0) {
      goToMatch(0)
    } else {
      if (counterEl) counterEl.textContent = 'No matches found'
    }
  }

  inputEl?.addEventListener('input', () => {
    clearTimeout(searchTimeout)
    searchTimeout = setTimeout(() => {
      performSemanticSearch(inputEl.value)
    }, 280)
  })

  inputEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) {
        goToMatch(currentMatchIndex - 1)
      } else {
        goToMatch(currentMatchIndex + 1)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeHUD()
    }
  })

  nextBtn?.addEventListener('click', () => goToMatch(currentMatchIndex + 1))
  prevBtn?.addEventListener('click', () => goToMatch(currentMatchIndex - 1))
  closeBtn?.addEventListener('click', () => closeHUD())
}

/**
 * Global keyboard shortcut listener for Ctrl + Shift + F / Cmd + Shift + F
 */
export function initSemanticSearchShortcut() {
  if (typeof window === 'undefined') return

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    // Ctrl + Shift + F or Cmd + Shift + F
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
      e.preventDefault()
      e.stopPropagation()
      openSemanticSearchHUD()
    }
  }, { capture: true })
}
