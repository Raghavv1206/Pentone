/**
 * Inline Ghost Pill - 1-Click field filler for individual inputs
 * Renders an isolated Shadow DOM pill on focused empty fields.
 */

import { loadAutofillProfile, type AutofillProfile } from './profile-vault'
import { normalizeFormIdentifier } from './form-inspector'
import { generateSubAddressAlias } from '../security/alias-generator'

let cachedProfile: AutofillProfile | null = null
let isInitialized = false

function resolveFieldValue(el: HTMLInputElement | HTMLTextAreaElement, profile: AutofillProfile): string {
  const type = (el.getAttribute('type') || 'text').toLowerCase()
  if (type === 'password' || type === 'hidden' || type === 'submit' || type === 'button' || type === 'checkbox' || type === 'radio') {
    return ''
  }

  const name = normalizeFormIdentifier(el.name || '')
  const id = normalizeFormIdentifier(el.id || '')
  const placeholder = normalizeFormIdentifier(el.placeholder || '')
  const autocomplete = (el.autocomplete || '').toLowerCase()
  const label = normalizeFormIdentifier(el.closest('label')?.innerText || el.getAttribute('aria-label') || '')

  const text = `${label} ${name} ${id} ${placeholder} ${autocomplete}`.toLowerCase()

  // First name
  if (/\b(first\s*name|fname|given\s*name)\b/.test(text) || autocomplete === 'given-name') {
    return profile.personal?.firstName || ''
  }
  // Last name
  if (/\b(last\s*name|lname|surname|family\s*name)\b/.test(text) || autocomplete === 'family-name') {
    return profile.personal?.lastName || ''
  }
  // Full name
  if (/\b(full\s*name|candidate\s*name|your\s*name)\b/.test(text) || autocomplete === 'name') {
    return profile.personal?.fullName || `${profile.personal?.firstName || ''} ${profile.personal?.lastName || ''}`.trim()
  }
  // Email
  if (type === 'email' || /\b(email|e-mail)\b/.test(text) || autocomplete === 'email') {
    return profile.personal?.email || ''
  }
  // Phone
  if (type === 'tel' || /\b(phone|mobile|cell|telephone)\b/.test(text) || autocomplete === 'tel') {
    return profile.personal?.phone || ''
  }
  // City
  if (/\b(city|town)\b/.test(text) || autocomplete === 'address-level2') {
    return profile.personal?.city || ''
  }
  // State
  if (/\b(state|province|region)\b/.test(text) || autocomplete === 'address-level1') {
    return profile.personal?.state || ''
  }
  // Zip
  if (/\b(zip|postal(\s*code)?|pincode)\b/.test(text) || autocomplete === 'postal-code') {
    return profile.personal?.postalCode || ''
  }
  // Country
  if (/\b(country|nation)\b/.test(text) || autocomplete === 'country-name') {
    return profile.personal?.country || ''
  }
  // Address 1
  if (/\b(address(\s*line\s*1)?|street)\b/.test(text) && !/\b(line\s*2|suite|apt)\b/.test(text)) {
    return profile.personal?.addressLine1 || ''
  }
  // Address 2
  if (/\b(address\s*line\s*2|suite|apt|apartment)\b/.test(text)) {
    return profile.personal?.addressLine2 || ''
  }
  // Company
  if (/\b(company|employer|organization)\b/.test(text)) {
    return profile.workExperience?.[0]?.company || ''
  }
  // Position
  if (/\b(position|job\s*title|current\s*role)\b/.test(text)) {
    return profile.workExperience?.[0]?.title || ''
  }
  // LinkedIn
  if (/\b(linkedin)\b/.test(text)) {
    return profile.online?.linkedinUrl || ''
  }
  // GitHub
  if (/\b(github)\b/.test(text)) {
    return profile.online?.githubUrl || ''
  }
  // Website
  if (/\b(website|portfolio|web\s*site)\b/.test(text)) {
    return profile.online?.portfolioUrl || ''
  }

  return ''
}

export function initInlineFieldPill() {
  if (isInitialized || typeof window === 'undefined') return
  isInitialized = true

  // Pre-load profile
  loadAutofillProfile().then(p => { cachedProfile = p })

  // Listen to profile updates
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.pentone_autofill_profile?.newValue) {
        cachedProfile = changes.pentone_autofill_profile.newValue
      }
    })
  }

  let activeHost: HTMLElement | null = null

  function removePill() {
    if (activeHost && document.body.contains(activeHost)) {
      activeHost.remove()
      activeHost = null
    }
  }

  document.addEventListener('focusin', async (e) => {
    const target = e.target as HTMLElement | null
    if (!target || !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      return
    }

    if (target.value && target.value.trim().length > 0) {
      removePill()
      return
    }

    if (!cachedProfile) {
      cachedProfile = await loadAutofillProfile()
    }
    if (!cachedProfile) return

    const matchVal = resolveFieldValue(target, cachedProfile)
    if (!matchVal || !matchVal.trim()) {
      removePill()
      return
    }

    removePill()

    const rect = target.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0 || rect.top < 0) return

    const host = document.createElement('div')
    host.id = 'pentone-inline-pill-host'
    host.style.cssText = `
      position: absolute;
      top: ${rect.top + window.scrollY - 26}px;
      left: ${Math.max(rect.left + window.scrollX, 8)}px;
      z-index: 2147483645;
      pointer-events: auto;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `

    const isEmail = matchVal === cachedProfile.personal?.email
    const aliasVal = isEmail ? generateSubAddressAlias(matchVal, window.location.hostname).alias : null

    const shadow = host.attachShadow({ mode: 'open' })
    const escapeHTML = (value: string) => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!))
    const displayVal = matchVal.length > 20 ? matchVal.slice(0, 18) + '…' : matchVal
    const displayAlias = aliasVal ? (aliasVal.length > 20 ? aliasVal.slice(0, 18) + '…' : aliasVal) : ''

    shadow.innerHTML = `
      <style>
        .pill-wrap {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .pill {
          background: rgba(23, 24, 22, 0.95);
          border: 1px solid rgba(103, 226, 200, 0.6);
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), 0 0 10px rgba(103, 226, 200, 0.25);
          color: #67E2C8;
          padding: 3px 8px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          backdrop-filter: blur(8px);
          user-select: none;
          transition: all 0.15s ease;
          animation: pPop 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .pill:hover {
          background: #005447;
          color: #FFFFFF;
          border-color: #67E2C8;
          transform: translateY(-1px);
        }
        .pill-alias {
          border-color: rgba(147, 197, 253, 0.6);
          color: #93C5FD;
        }
        .pill-alias:hover {
          background: #1E3A8A;
          color: #FFFFFF;
          border-color: #93C5FD;
        }
        @keyframes pPop {
          from { opacity: 0; transform: scale(0.92); }
          to { opacity: 1; transform: scale(1); }
        }
        .icon {
          font-size: 10px;
        }
      </style>
      <div class="pill-wrap">
        <div id="p-fill-main" class="pill" title="Fill with: ${escapeHTML(matchVal)}">
          <span class="icon">✨</span>
          <span>Fill "${escapeHTML(displayVal)}"</span>
        </div>
        ${isEmail && aliasVal ? `
          <div id="p-fill-alias" class="pill pill-alias" title="Fill disposable alias: ${escapeHTML(aliasVal)}">
            <span class="icon">🛡️</span>
            <span>Alias "${escapeHTML(displayAlias)}"</span>
          </div>
        ` : ''}
      </div>
    `

    document.body.appendChild(host)
    activeHost = host

    const applyValue = (valToApply: string) => {
      // Native setter bypass for React/Vue
      const prototype = target instanceof HTMLInputElement 
        ? window.HTMLInputElement.prototype 
        : window.HTMLTextAreaElement.prototype
      const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set

      if (nativeSetter) {
        nativeSetter.call(target, valToApply)
      } else {
        target.value = valToApply
      }

      target.setAttribute('data-pentone-injected', valToApply)
      target.dispatchEvent(new Event('input', { bubbles: true }))
      target.dispatchEvent(new Event('change', { bubbles: true }))

      // Mint flash highlight
      const origBoxShadow = target.style.boxShadow
      target.style.transition = 'box-shadow 0.3s ease'
      target.style.boxShadow = '0 0 0 2px #67E2C8, 0 0 8px rgba(103, 226, 200, 0.4)'
      setTimeout(() => { target.style.boxShadow = origBoxShadow }, 2500)

      removePill()
    }

    shadow.querySelector('#p-fill-main')?.addEventListener('mousedown', (clickEv) => {
      clickEv.preventDefault()
      clickEv.stopPropagation()
      applyValue(matchVal)
    })

    shadow.querySelector('#p-fill-alias')?.addEventListener('mousedown', (clickEv) => {
      clickEv.preventDefault()
      clickEv.stopPropagation()
      if (aliasVal) applyValue(aliasVal)
    })
  }, true)

  document.addEventListener('focusout', () => {
    // Slight delay to allow clicking on the pill before removal
    setTimeout(() => {
      removePill()
    }, 200)
  }, true)

  window.addEventListener('scroll', () => {
    removePill()
  }, { passive: true })
}
