/**
 * Form Filler - Executes framework-resilient field filling across modern web apps
 * Handles React, Angular, Vue, Workday, native selects, and custom comboboxes.
 */

import type { FieldFillInstruction } from './form-matcher'

export interface FillExecutionResult {
  success: boolean
  filledCount: number
  failedCount: number
  details: { label: string; value: string; success: boolean; error?: string }[]
}

export interface StoredResumeFileInput {
  name: string
  type: string
  size: number
  base64: string
}

/**
 * Executes field filling on the current document
 * Self-contained for safe chrome.scripting.executeScript injection
 */
export function executeFillInstructions(
  instructions: FieldFillInstruction[],
  storedResume?: StoredResumeFileInput | null
): FillExecutionResult {
  function escapeHTML(value: string): string {
    const span = document.createElement('span'); span.textContent = value; return span.innerHTML
  }
  function deepQuery(selector: string, root: Document | ShadowRoot = document): HTMLElement | null {
    const found = root.querySelector<HTMLElement>(selector)
    if (found) return found
    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (el.shadowRoot) { const nested = deepQuery(selector, el.shadowRoot); if (nested) return nested }
    }
    return null
  }
  function applyHighlight(el: HTMLElement) {
    const originalOutline = el.style.outline
    const originalBoxShadow = el.style.boxShadow
    const originalTransition = el.style.transition
    const originalBorder = el.style.borderColor

    el.style.transition = 'box-shadow 0.3s ease, border-color 0.3s ease'
    el.style.boxShadow = '0 0 0 2px #67E2C8, 0 0 10px rgba(103, 226, 200, 0.4)'
    el.style.borderColor = '#67E2C8'

    setTimeout(() => {
      el.style.boxShadow = originalBoxShadow
      el.style.outline = originalOutline
      el.style.transition = originalTransition
      el.style.borderColor = originalBorder
    }, 4000)
  }

  function showToast(filled: number, total: number, resumeName?: string) {
    const existing = document.getElementById('pentone-autofill-host')
    if (existing) existing.remove()

    const host = document.createElement('div')
    host.id = 'pentone-autofill-host'
    host.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = `
      <style>
        .toast {
          background: rgba(23, 24, 22, 0.95);
          border: 1px solid rgba(103, 226, 200, 0.5);
          box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6), 0 0 20px rgba(103, 226, 200, 0.3);
          border-radius: 12px;
          padding: 12px 18px;
          display: flex;
          align-items: center;
          gap: 12px;
          color: #F5F1E7;
          font-size: 13px;
          backdrop-filter: blur(12px);
          animation: pSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes pSlideUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: #67E2C8;
          box-shadow: 0 0 10px #67E2C8;
          flex-shrink: 0;
        }
        .title {
          font-weight: 700;
          color: #67E2C8;
          font-size: 13px;
        }
        .body {
          font-size: 11.5px;
          color: #DDDCCB;
          margin-top: 2px;
        }
      </style>
      <div class="toast">
        <div class="dot"></div>
        <div>
          <div class="title">Pentone Autofill Complete</div>
          <div class="body">Populated ${filled} field${filled === 1 ? '' : 's'}${resumeName ? ` + uploaded "${escapeHTML(resumeName)}"` : ''}. Unfilled fields left untouched.</div>
        </div>
      </div>
    `

    document.body.appendChild(host)

    setTimeout(() => {
      host.style.opacity = '0'
      host.style.transition = 'opacity 0.4s ease'
      setTimeout(() => host.remove(), 400)
    }, 4500)
  }

  function setupWizardNavigation(count: number) {
    const existing = document.getElementById('pentone-wizard-host')
    if (existing) existing.remove()

    const allButtons = Array.from(document.querySelectorAll<HTMLElement>(
      'button, input[type="button"], input[type="submit"], [role="button"], a.btn, a[class*="button"]'
    ))

    let nextBtn: HTMLElement | null = null
    let submitBtn: HTMLElement | null = null

    for (const btn of allButtons) {
      if (btn.offsetParent === null && btn.offsetWidth === 0) continue
      const text = (btn.innerText || (btn as HTMLInputElement).value || btn.getAttribute('aria-label') || '').trim()
      if (!text || text.length > 50) continue

      if (
        /^(next|continue|proceed|save\s*&\s*continue|next\s*step|go\s*to\s*next)$/i.test(text) ||
        btn.getAttribute('data-automation-id')?.includes('next') ||
        btn.getAttribute('data-automation-id')?.includes('continue')
      ) {
        nextBtn = btn
        break
      }

      if (
        /^(submit|submit\s*application|complete\s*application|apply\s*now|finish)$/i.test(text) ||
        btn.getAttribute('data-automation-id')?.includes('submit')
      ) {
        submitBtn = btn
      }
    }

    if (nextBtn) {
      const btnText = (nextBtn.innerText || (nextBtn as HTMLInputElement).value || 'Next Step').trim()
      const host = document.createElement('div')
      host.id = 'pentone-wizard-host'
      host.style.cssText = `
        position: fixed;
        bottom: 86px;
        right: 24px;
        z-index: 2147483646;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      `
      const shadow = host.attachShadow({ mode: 'open' })
      shadow.innerHTML = `
        <style>
          .hud {
            background: rgba(23, 24, 22, 0.96);
            border: 1px solid rgba(103, 226, 200, 0.55);
            box-shadow: 0 14px 40px rgba(0, 0, 0, 0.65), 0 0 24px rgba(103, 226, 200, 0.25);
            border-radius: 14px;
            padding: 14px 18px;
            color: #F5F1E7;
            width: 310px;
            backdrop-filter: blur(14px);
            animation: pSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          }
          @keyframes pSlideUp {
            from { opacity: 0; transform: translateY(14px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .title {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
            font-weight: 700;
            color: #67E2C8;
          }
          .dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #67E2C8;
            box-shadow: 0 0 8px #67E2C8;
          }
          .desc {
            font-size: 11.5px;
            color: #DDDCCB;
            margin-top: 6px;
            line-height: 1.45;
          }
          .actions {
            display: flex;
            gap: 8px;
            margin-top: 10px;
          }
          .btn-next {
            flex: 1;
            background: #005447;
            border: 1px solid #67E2C8;
            color: #67E2C8;
            padding: 7px 12px;
            border-radius: 8px;
            font-size: 11.5px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
          }
          .btn-next:hover {
            background: #00705E;
            color: #FFFFFF;
            box-shadow: 0 0 12px rgba(103, 226, 200, 0.4);
          }
          .btn-dismiss {
            background: transparent;
            border: 1px solid rgba(221, 220, 203, 0.2);
            color: #A6A49B;
            padding: 7px 10px;
            border-radius: 8px;
            font-size: 11.5px;
            cursor: pointer;
            transition: all 0.2s ease;
          }
          .btn-dismiss:hover {
            color: #F5F1E7;
            border-color: rgba(221, 220, 203, 0.4);
          }
        </style>
        <div class="hud">
          <div class="title">
            <div class="dot"></div>
            <span>Multi-Step Application Wizard</span>
          </div>
          <div class="desc">
            Filled <strong>${count} fields</strong> on this step. Next section: <em>"${escapeHTML(btnText)}"</em>.
          </div>
          <div class="actions">
            <button id="p-btn-next" class="btn-next">Proceed to ${escapeHTML(btnText)} ➔</button>
            <button id="p-btn-dismiss" class="btn-dismiss">Stay Here</button>
          </div>
        </div>
      `
      document.body.appendChild(host)

      shadow.getElementById('p-btn-dismiss')?.addEventListener('click', () => {
        host.remove()
      })

      shadow.getElementById('p-btn-next')?.addEventListener('click', () => {
        host.remove()
        if (nextBtn) {
          nextBtn.scrollIntoView({ behavior: 'smooth', block: 'center' })
          nextBtn.click()
        }
      })
    } else if (submitBtn) {
      applyHighlight(submitBtn)
      const host = document.createElement('div')
      host.id = 'pentone-wizard-host'
      host.style.cssText = `
        position: fixed;
        bottom: 86px;
        right: 24px;
        z-index: 2147483646;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      `
      const shadow = host.attachShadow({ mode: 'open' })
      shadow.innerHTML = `
        <style>
          .hud {
            background: rgba(23, 24, 22, 0.96);
            border: 1px solid rgba(103, 226, 200, 0.55);
            box-shadow: 0 14px 40px rgba(0, 0, 0, 0.65);
            border-radius: 14px;
            padding: 12px 18px;
            color: #F5F1E7;
            width: 290px;
            backdrop-filter: blur(14px);
          }
          .title {
            color: #67E2C8;
            font-weight: 700;
            font-size: 13px;
          }
          .desc {
            font-size: 11.5px;
            color: #DDDCCB;
            margin-top: 4px;
            line-height: 1.4;
          }
        </style>
        <div class="hud">
          <div class="title">✓ Application Complete!</div>
          <div class="desc">All fields populated. The final Submit button is highlighted for your manual review.</div>
        </div>
      `
      document.body.appendChild(host)
      setTimeout(() => host.remove(), 6000)
    }
  }

  function setupAdaptiveLearningListener() {
    if ((window as any).__pentoneAdaptiveAttached) return
    ;(window as any).__pentoneAdaptiveAttached = true

    document.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement | HTMLTextAreaElement
      if (!target || !target.hasAttribute || !target.hasAttribute('data-pentone-injected')) return

      const injectedVal = target.getAttribute('data-pentone-injected') || ''
      const label = target.getAttribute('data-pentone-label') || target.name || 'Field'
      const currentVal = target.value ? target.value.trim() : ''

      if (currentVal && currentVal !== injectedVal) {
        const existingHost = document.getElementById('pentone-adaptive-host')
        if (existingHost) existingHost.remove()

        const host = document.createElement('div')
        host.id = 'pentone-adaptive-host'
        host.style.cssText = `
          position: fixed;
          bottom: 24px;
          left: 24px;
          z-index: 2147483647;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `
        const shadow = host.attachShadow({ mode: 'open' })
        shadow.innerHTML = `
          <style>
            .toast {
              background: rgba(23, 24, 22, 0.96);
              border: 1px solid rgba(103, 226, 200, 0.55);
              box-shadow: 0 10px 32px rgba(0, 0, 0, 0.6);
              border-radius: 12px;
              padding: 10px 14px;
              color: #F5F1E7;
              display: flex;
              align-items: center;
              gap: 10px;
              font-size: 12px;
              backdrop-filter: blur(12px);
              animation: pSlideIn 0.3s ease;
            }
            @keyframes pSlideIn {
              from { opacity: 0; transform: translateY(8px); }
              to { opacity: 1; transform: translateY(0); }
            }
            .btn-update {
              background: #005447;
              color: #67E2C8;
              border: 1px solid #67E2C8;
              border-radius: 6px;
              padding: 4px 8px;
              font-size: 11px;
              font-weight: 600;
              cursor: pointer;
            }
            .btn-close {
              background: transparent;
              border: none;
              color: #A6A49B;
              cursor: pointer;
              font-size: 13px;
            }
          </style>
          <div class="toast">
            <span>Update <strong>${escapeHTML(label)}</strong> in Profile Vault?</span>
            <button id="p-btn-upd" class="btn-update">Update</button>
            <button id="p-btn-cls" class="btn-close">✕</button>
          </div>
        `
        document.body.appendChild(host)

        shadow.getElementById('p-btn-cls')?.addEventListener('click', () => host.remove())
        shadow.getElementById('p-btn-upd')?.addEventListener('click', () => {
          try {
            chrome.runtime.sendMessage({
              type: 'pentone_update_profile_field',
              payload: { label, value: currentVal }
            })
          } catch {}

          const toastEl = shadow.querySelector('.toast')
          if (toastEl) {
            toastEl.innerHTML = `<span style="color: #67E2C8; font-weight: 600;">✓ Profile Vault updated!</span>`
            setTimeout(() => host.remove(), 2500)
          }
        })

        setTimeout(() => {
          if (document.body.contains(host)) host.remove()
        }, 9000)
      }
    })
  }

  let filledCount = 0
  let failedCount = 0
  const details: FillExecutionResult['details'] = []

  for (const inst of instructions) {
    // STRICT INVARIANT: Only fill fields that have non-empty values in the profile.
    // If the value is empty or whitespace, do not touch the element and leave it as is.
    if (!inst.valueToFill || typeof inst.valueToFill !== 'string' || !inst.valueToFill.trim()) {
      continue
    }

    try {
      let el: HTMLElement | null = null

      if (inst.selector) {
        try {
          el = deepQuery(inst.selector)
        } catch {}
      }

      if (!el) {
        // Fallback: look for data-pentone-field index
        el = deepQuery(`[data-pentone-field="${inst.fieldIndex}"]`)
      }

      if (!el || el.matches(':disabled, [aria-disabled="true"], [readonly], input[type="file"], input[type="hidden"]')) {
        failedCount++
        details.push({ label: inst.label, value: inst.valueToFill, success: false, error: 'Element not found' })
        continue
      }

      // Selecting custom options requires the site's widget lifecycle. Typing/clicking
      // the control alone does not establish a selection.
      if (el.getAttribute('role') === 'combobox' || el.classList.contains('react-select__input') || el.classList.contains('select2')) {
        throw new Error('Custom dropdown requires manual selection')
      }

      // 1. Text Inputs and Textareas
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const inputType = el.getAttribute('type')?.toLowerCase() || 'text'

        if (el instanceof HTMLInputElement && (inputType === 'radio' || inputType === 'checkbox')) {
          const desired = inst.valueToFill.toLowerCase().trim()
          const yes = ['yes', 'true', '1'].includes(desired)
          const no = ['no', 'false', '0'].includes(desired)
          if (inputType === 'radio') {
            const radioVal = el.value.toLowerCase().trim()
            const labelText = (el.labels?.[0]?.textContent || '').toLowerCase().trim()
            const matches = radioVal === desired || labelText === desired
              || (yes && ['yes', 'true', '1'].includes(radioVal))
              || (no && ['no', 'false', '0'].includes(radioVal))
            if (!matches) throw new Error('Radio option does not match the requested value')
            if (!el.checked) el.click()
            if (!el.checked) throw new Error('Radio option was not selected')
          } else {
            if (!yes && !no) throw new Error('Checkbox requires a yes/no value')
            if (el.checked !== yes) el.click()
            if (el.checked !== yes) throw new Error('Checkbox state did not change')
          }
        } else {
          // Standard text / email / tel / number / url / textarea
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
          el.focus()

          // Bypass React 16+ virtual DOM property tracker
          const prototype = el instanceof HTMLInputElement 
            ? window.HTMLInputElement.prototype 
            : window.HTMLTextAreaElement.prototype
          const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set

          if (nativeSetter) {
            nativeSetter.call(el, inst.valueToFill)
          } else {
            el.value = inst.valueToFill
          }

          el.setAttribute('data-pentone-injected', inst.valueToFill)
          el.setAttribute('data-pentone-label', inst.label || '')

          // Full event lifecycle sequence
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
          el.dispatchEvent(new Event('blur', { bubbles: true }))
          if (el.value !== inst.valueToFill) throw new Error('Field did not retain the requested value')
        }

        // Apply visual mint highlight
        applyHighlight(el)
        filledCount++
        details.push({ label: inst.label, value: inst.valueToFill, success: true })
        continue
      }

      // 2. Native <select> elements
      if (el instanceof HTMLSelectElement) {
        const options = Array.from(el.options)
        const available = (o: HTMLOptionElement) => !o.matches(':disabled')
        const targetVal = inst.valueToFill.toLowerCase().trim()
        const cleanTarget = targetVal.replace(/\./g, '')

        let matchIdx = options.findIndex(o => {
          if (!available(o)) return false
          const oText = o.text.toLowerCase().trim()
          const oVal = o.value.toLowerCase().trim()
          const cleanOText = oText.replace(/\./g, '')
          const cleanOVal = oVal.replace(/\./g, '')
          return (
            oText === targetVal || 
            oVal === targetVal || 
            cleanOText === cleanTarget || 
            cleanOVal === cleanTarget
          )
        })

        if (matchIdx === -1) {
          // Substring match
          matchIdx = options.findIndex(o => {
          if (!available(o)) return false
            const oText = o.text.toLowerCase().trim()
            return oText.includes(targetVal) || (oText.length > 0 && targetVal.includes(oText))
          })
        }

        // Title/Salutation match: Mr / Mr. / Mister
        if (matchIdx === -1 && (cleanTarget === 'mr' || cleanTarget === 'mister')) {
          matchIdx = options.findIndex(o => available(o) && (/^(mr\.?|mister)$/i.test(o.text.trim()) || /^(mr\.?|mister)$/i.test(o.value.trim())))
        }
        if (matchIdx === -1 && (cleanTarget === 'ms' || cleanTarget === 'mrs' || cleanTarget === 'miss')) {
          matchIdx = options.findIndex(o => available(o) && (/^(ms\.?|mrs\.?|miss)$/i.test(o.text.trim()) || /^(ms\.?|mrs\.?|miss)$/i.test(o.value.trim())))
        }

        // Gender initial match (e.g. "Male" -> "M", "Female" -> "F")
        if (matchIdx === -1 && (targetVal === 'male' || targetVal === 'female')) {
          const initial = targetVal.slice(0, 1)
          matchIdx = options.findIndex(o => available(o) && (o.text.trim().toLowerCase() === initial || o.value.trim().toLowerCase() === initial))
        }

        if (matchIdx !== -1) {
          el.selectedIndex = matchIdx
          el.value = options[matchIdx].value
          el.setAttribute('data-pentone-injected', options[matchIdx].value)
          el.setAttribute('data-pentone-label', inst.label || '')
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
          el.dispatchEvent(new Event('blur', { bubbles: true }))
          applyHighlight(el)
          filledCount++
          details.push({ label: inst.label, value: inst.valueToFill, success: true })
          continue
        }
      }

      failedCount++
      details.push({ label: inst.label, value: inst.valueToFill, success: false, error: 'Unsupported element type' })
    } catch (e: any) {
      failedCount++
      details.push({ label: inst.label, value: inst.valueToFill, success: false, error: e?.message || 'Error filling field' })
    }
  }

  // 4. Automated Resume File Drop Injection
  let resumeNameInjected: string | undefined
  if (storedResume && storedResume.base64) {
    try {
      const fileInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'))
      for (const fileInput of fileInputs) {
        if (fileInput.disabled || (fileInput.files && fileInput.files.length > 0)) continue

        const labelText = (
          (fileInput.getAttribute('aria-label') || '') + ' ' +
          (fileInput.getAttribute('name') || '') + ' ' +
          (fileInput.id || '') + ' ' +
          (fileInput.closest('label')?.innerText || '') + ' ' +
          (fileInput.parentElement?.innerText || '')
        ).toLowerCase()

        const isResumeInput = /\b(resume|cv|curriculum\s*vitae)\b/i.test(labelText)
        if (isResumeInput) {
          const pureBase64 = storedResume.base64.includes(',')
            ? storedResume.base64.split(',')[1]
            : storedResume.base64
          const byteChars = atob(pureBase64)
          const byteNumbers = new Uint8Array(byteChars.length)
          for (let i = 0; i < byteChars.length; i++) {
            byteNumbers[i] = byteChars.charCodeAt(i)
          }
          const file = new File([byteNumbers], storedResume.name, {
            type: storedResume.type || 'application/pdf',
            lastModified: Date.now()
          })
          const dt = new DataTransfer()
          dt.items.add(file)
          fileInput.files = dt.files
          fileInput.dispatchEvent(new Event('input', { bubbles: true }))
          fileInput.dispatchEvent(new Event('change', { bubbles: true }))
          applyHighlight(fileInput)
          filledCount++
          resumeNameInjected = storedResume.name
          details.push({
            label: `Resume Auto-Drop (${storedResume.name})`,
            value: storedResume.name,
            success: true
          })
          break
        }
      }
    } catch (fErr) {
      console.warn('[FormFiller] Resume auto-drop notice:', fErr)
    }
  }

  // 5. Setup Adaptive Learning Listener
  setupAdaptiveLearningListener()

  // 6. Setup Multi-Page Wizard Flow HUD
  setupWizardNavigation(filledCount)

  // 7. Display summary floating toast
  showToast(filledCount, instructions.length, resumeNameInjected)

  return {
    success: filledCount > 0,
    filledCount,
    failedCount,
    details
  }
}

/**
 * Standalone highlight helper exported for external consumers
 */
export function applyFieldHighlight(el: HTMLElement) {
  const originalOutline = el.style.outline
  const originalBoxShadow = el.style.boxShadow
  const originalTransition = el.style.transition

  el.style.transition = 'box-shadow 0.3s ease, border-color 0.3s ease'
  el.style.boxShadow = '0 0 0 2px #67E2C8, 0 0 10px rgba(103, 226, 200, 0.4)'
  el.style.borderColor = '#67E2C8'

  setTimeout(() => {
    el.style.boxShadow = originalBoxShadow
    el.style.outline = originalOutline
    el.style.transition = originalTransition
  }, 4000)
}
