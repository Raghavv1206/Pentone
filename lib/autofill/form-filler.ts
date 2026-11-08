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

/**
 * Executes field filling on the current document
 * Self-contained for safe chrome.scripting.executeScript injection
 */
export function executeFillInstructions(instructions: FieldFillInstruction[]): FillExecutionResult {
  function applyHighlight(el: HTMLElement) {
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

  function showToast(filled: number, total: number) {
    const existing = document.getElementById('pentone-autofill-toast')
    if (existing) existing.remove()

    const toast = document.createElement('div')
    toast.id = 'pentone-autofill-toast'
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      background: rgba(23, 24, 22, 0.95);
      border: 1px solid rgba(103, 226, 200, 0.5);
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6), 0 0 20px rgba(103, 226, 200, 0.3);
      border-radius: 12px;
      padding: 12px 18px;
      display: flex;
      align-items: center;
      gap: 10px;
      color: #F5F1E7;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      backdrop-filter: blur(12px);
    `

    toast.innerHTML = `
      <div style="width: 8px; height: 8px; border-radius: 50%; background: #67E2C8;"></div>
      <div>
        <div style="font-weight: 600; color: #67E2C8;">Pentone Autofill Complete</div>
        <div style="font-size: 11.5px; color: #DDDCCB;">Populated ${filled} field${filled === 1 ? '' : 's'} from your profile. Unfilled fields were left untouched.</div>
      </div>
    `

    document.body.appendChild(toast)

    setTimeout(() => {
      toast.style.opacity = '0'
      toast.style.transition = 'opacity 0.4s ease'
      setTimeout(() => toast.remove(), 400)
    }, 4500)
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
          el = document.querySelector<HTMLElement>(inst.selector)
        } catch {}
      }

      if (!el) {
        // Fallback: look for data-pentone-field index
        el = document.querySelector<HTMLElement>(`[data-pentone-field="${inst.fieldIndex}"]`)
      }

      if (!el) {
        failedCount++
        details.push({ label: inst.label, value: inst.valueToFill, success: false, error: 'Element not found' })
        continue
      }

      const tagName = el.tagName.toLowerCase()

      // 1. Text Inputs and Textareas
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const inputType = el.getAttribute('type')?.toLowerCase() || 'text'

        if (el instanceof HTMLInputElement && (inputType === 'radio' || inputType === 'checkbox')) {
          const isTargetChecked = inst.valueToFill.toLowerCase() === 'yes' || inst.valueToFill.toLowerCase() === 'true'
          if (inputType === 'radio') {
            const radioVal = (el.value || el.id || '').toLowerCase()
            const labelText = (el.labels?.[0]?.textContent || el.parentElement?.textContent || '').toLowerCase().trim()
            const isYesOption = radioVal.includes('yes') || radioVal === '1' || radioVal === 'true' || labelText.startsWith('yes')
            const isNoOption = radioVal.includes('no') || radioVal === '0' || radioVal === 'false' || labelText.startsWith('no')

            if ((isTargetChecked && isYesOption) || (!isTargetChecked && isNoOption)) {
              if (!el.checked) {
                el.click()
                el.dispatchEvent(new Event('change', { bubbles: true }))
              }
            }
          } else {
            // Checkbox
            if (el.checked !== isTargetChecked) {
              el.click()
              el.dispatchEvent(new Event('change', { bubbles: true }))
            }
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

          // Full event lifecycle sequence
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
          el.dispatchEvent(new Event('blur', { bubbles: true }))
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
        const targetVal = inst.valueToFill.toLowerCase().trim()
        const cleanTarget = targetVal.replace(/\./g, '')

        let matchIdx = options.findIndex(o => {
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
            const oText = o.text.toLowerCase().trim()
            return oText.includes(targetVal) || targetVal.includes(oText)
          })
        }

        // Title/Salutation match: Mr / Mr. / Mister
        if (matchIdx === -1 && (cleanTarget === 'mr' || cleanTarget === 'mister')) {
          matchIdx = options.findIndex(o => /^(mr\.?|mister)$/i.test(o.text.trim()) || /^(mr\.?|mister)$/i.test(o.value.trim()))
        }
        if (matchIdx === -1 && (cleanTarget === 'ms' || cleanTarget === 'mrs' || cleanTarget === 'miss')) {
          matchIdx = options.findIndex(o => /^(ms\.?|mrs\.?|miss)$/i.test(o.text.trim()) || /^(ms\.?|mrs\.?|miss)$/i.test(o.value.trim()))
        }

        // Gender initial match (e.g. "Male" -> "M", "Female" -> "F")
        if (matchIdx === -1 && (targetVal === 'male' || targetVal === 'female')) {
          const initial = targetVal.slice(0, 1)
          matchIdx = options.findIndex(o => o.text.trim().toLowerCase() === initial || o.value.trim().toLowerCase() === initial)
        }

        if (matchIdx !== -1) {
          el.selectedIndex = matchIdx
          el.value = options[matchIdx].value
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
          el.dispatchEvent(new Event('blur', { bubbles: true }))
          applyHighlight(el)
          filledCount++
          details.push({ label: inst.label, value: inst.valueToFill, success: true })
          continue
        }
      }

      // 3. React-Select or custom combobox
      if (el.getAttribute('role') === 'combobox' || el.classList.contains('react-select__input') || el.classList.contains('select2')) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        el.focus()
        el.click()

        if (el instanceof HTMLInputElement) {
          el.value = inst.valueToFill
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        }

        applyHighlight(el)
        filledCount++
        details.push({ label: inst.label, value: inst.valueToFill, success: true })
        continue
      }

      failedCount++
      details.push({ label: inst.label, value: inst.valueToFill, success: false, error: 'Unsupported element type' })
    } catch (e: any) {
      failedCount++
      details.push({ label: inst.label, value: inst.valueToFill, success: false, error: e?.message || 'Error filling field' })
    }
  }

  // Display summary floating toast
  showToast(filledCount, instructions.length)

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
