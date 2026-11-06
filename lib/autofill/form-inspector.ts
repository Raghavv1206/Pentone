/**
 * Form Inspector Engine - Discovers and categorizes all form controls on any page
 * Supports Workday, Greenhouse, Lever, Ashby, React-Select, and custom web components.
 */

export interface DetectedField {
  index: number
  tagName: string
  type: string
  name: string
  id: string
  label: string
  placeholder: string
  autocomplete: string
  selector: string
  isRequired: boolean
  isReadOnly: boolean
  currentValue: string
  fieldCategory: FieldCategory
  suggestedProfileKey?: string
  confidence: number // 0.0 to 1.0
  options?: string[] // For select/combobox
}

export type FieldCategory = 
  | 'name'
  | 'email'
  | 'phone'
  | 'address'
  | 'social'
  | 'work_auth'
  | 'eeo'
  | 'education'
  | 'experience'
  | 'skills'
  | 'custom_qa'
  | 'essay'
  | 'unknown'

export interface FormInspectionResult {
  url: string
  domain: string
  formType: 'Workday' | 'Greenhouse' | 'Lever' | 'Ashby' | 'JobApplication' | 'GeneralForm' | 'Taleo' | 'iCIMS' | 'BambooHR' | 'SmartRecruiters'
  fields: DetectedField[]
  totalFields: number
  mappableFields: number
}

/**
 * Detects the specific ATS or framework profile of the current page
 */
export function detectPageFormType(): FormInspectionResult['formType'] {
  const html = document.documentElement.innerHTML.toLowerCase()
  const url = window.location.href.toLowerCase()

  if (url.includes('myworkdayjobs.com') || html.includes('data-automation-id') || html.includes('workday')) {
    return 'Workday'
  }
  if (url.includes('greenhouse.io') || html.includes('gh-src') || html.includes('grnhse')) {
    return 'Greenhouse'
  }
  if (url.includes('lever.co') || html.includes('lever-form') || html.includes('lever.co')) {
    return 'Lever'
  }
  if (url.includes('ashbyhq.com') || html.includes('ashby')) {
    return 'Ashby'
  }
  if (url.includes('taleo.net') || html.includes('taleo') || url.includes('oraclecloud.com')) {
    return 'Taleo'
  }
  if (url.includes('icims.com') || html.includes('icims')) {
    return 'iCIMS'
  }
  if (url.includes('bamboohr.com') || html.includes('bamboohr')) {
    return 'BambooHR'
  }
  if (url.includes('smartrecruiters.com') || html.includes('smartrecruiters')) {
    return 'SmartRecruiters'
  }
  if (
    html.includes('apply') ||
    html.includes('resume') ||
    html.includes('curriculum vitae') ||
    html.includes('job title') ||
    html.includes('work authorization') ||
    html.includes('cover letter')
  ) {
    return 'JobApplication'
  }

  return 'GeneralForm'
}

/**
 * Extract clean, visible label text associated with an element
 */
export function extractFieldLabel(el: HTMLElement): string {
  // 1. Check aria-label
  const ariaLabel = el.getAttribute('aria-label')
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim()

  // 2. Check aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby')
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy)
    if (labelEl && labelEl.innerText.trim()) return labelEl.innerText.trim()
  }

  // 3. Check <label for="id">
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`) as HTMLElement | null
    if (label && label.innerText.trim()) return label.innerText.trim()
  }

  // 4. Check enclosing <fieldset> with <legend> (critical for radio groups & EEO questions)
  const fieldset = el.closest('fieldset')
  if (fieldset) {
    const legend = fieldset.querySelector('legend')
    if (legend && legend.innerText.trim()) {
      const legendText = legend.innerText.trim()
      const elLabel = el.closest('label')?.innerText.trim()
      return elLabel ? `${legendText} - ${elLabel}` : legendText
    }
  }

  // 5. Check enclosing <label>
  const parentLabel = el.closest('label')
  if (parentLabel && parentLabel.innerText.trim()) {
    return parentLabel.innerText.replace(el.innerText || '', '').trim()
  }

  // 6. Workday specific data-automation-id label check
  const wdContainer = el.closest('[data-automation-id]')
  if (wdContainer) {
    const label = wdContainer.querySelector('label, [data-automation-id*="label"]') as HTMLElement | null
    if (label && label.innerText.trim()) return label.innerText.trim()
  }

  // 7. Check table layout: preceding td or th (Taleo, Oracle, legacy ATS)
  const cell = el.closest('td')
  if (cell) {
    const prevCell = cell.previousElementSibling as HTMLElement | null
    if (prevCell && prevCell.innerText.trim()) {
      return prevCell.innerText.trim()
    }
  }

  // 8. Check preceding sibling or container heading
  const container = el.closest('.form-group, .field, [class*="form-item"], [class*="input-wrap"], [class*="Field_"]')
  if (container) {
    const labelCandidate = container.querySelector('label, [class*="label"], span') as HTMLElement | null
    if (labelCandidate && labelCandidate.innerText.trim()) return labelCandidate.innerText.trim()
  }

  // 9. Fallback to placeholder or name attribute
  const placeholder = el.getAttribute('placeholder')
  if (placeholder && placeholder.trim()) return placeholder.trim()

  const name = el.getAttribute('name')
  if (name && name.trim()) return name.trim().replace(/[_-]/g, ' ')

  return ''
}

/**
 * Categorizes a field and assigns suggested profile mapping keys with confidence
 */
export function categorizeField(
  label: string, 
  name: string, 
  id: string, 
  autocomplete: string, 
  type: string, 
  tagName: string
): { category: FieldCategory; suggestedKey: string; confidence: number } {
  const text = `${label} ${name} ${id} ${autocomplete}`.toLowerCase()

  // First Name
  if (
    autocomplete === 'given-name' || 
    /\b(first\s*name|given\s*name|fname|forename)\b/i.test(text)
  ) {
    return { category: 'name', suggestedKey: 'personal.firstName', confidence: 0.98 }
  }

  // Last Name
  if (
    autocomplete === 'family-name' || 
    /\b(last\s*name|family\s*name|surname|lname)\b/i.test(text)
  ) {
    return { category: 'name', suggestedKey: 'personal.lastName', confidence: 0.98 }
  }

  // Full Name
  if (
    autocomplete === 'name' || 
    /\b(full\s*name|your\s*name|candidate\s*name)\b/i.test(text) ||
    (/^name$/i.test(name) && !text.includes('user') && !text.includes('file'))
  ) {
    return { category: 'name', suggestedKey: 'personal.fullName', confidence: 0.95 }
  }

  // Email
  if (
    type === 'email' || 
    autocomplete === 'email' || 
    /\b(email|e-mail|email\s*address)\b/i.test(text)
  ) {
    return { category: 'email', suggestedKey: 'personal.email', confidence: 0.99 }
  }

  // Phone
  if (
    type === 'tel' || 
    autocomplete === 'tel' || 
    /\b(phone|mobile|cell|telephone|contact\s*number)\b/i.test(text)
  ) {
    return { category: 'phone', suggestedKey: 'personal.phone', confidence: 0.95 }
  }

  // City
  if (
    autocomplete === 'address-level2' || 
    /\b(city|town)\b/i.test(text)
  ) {
    return { category: 'address', suggestedKey: 'personal.city', confidence: 0.93 }
  }

  // State / Province
  if (
    autocomplete === 'address-level1' || 
    /\b(state|province|region)\b/i.test(text)
  ) {
    return { category: 'address', suggestedKey: 'personal.state', confidence: 0.92 }
  }

  // Postal / Zip Code
  if (
    autocomplete === 'postal-code' || 
    /\b(zip(\s*code)?|postal(\s*code)?|pincode)\b/i.test(text)
  ) {
    return { category: 'address', suggestedKey: 'personal.postalCode', confidence: 0.95 }
  }

  // Country
  if (
    autocomplete === 'country-name' || 
    /\b(country)\b/i.test(text)
  ) {
    return { category: 'address', suggestedKey: 'personal.country', confidence: 0.92 }
  }

  // Address Line 1 / Street Address
  if (
    autocomplete === 'address-line1' || 
    (autocomplete !== 'address-level1' && autocomplete !== 'address-level2' && /\b(address(\s*line\s*1)?|street\s*address|residential\s*address)\b/i.test(text))
  ) {
    return { category: 'address', suggestedKey: 'personal.addressLine1', confidence: 0.94 }
  }

  // Country
  if (
    autocomplete === 'country-name' || 
    /\b(country|nation)\b/i.test(text)
  ) {
    return { category: 'address', suggestedKey: 'personal.country', confidence: 0.91 }
  }

  // LinkedIn
  if (/\b(linkedin|linked\s*in)\b/i.test(text)) {
    return { category: 'social', suggestedKey: 'online.linkedinUrl', confidence: 0.98 }
  }

  // GitHub
  if (/\b(github|git\s*hub)\b/i.test(text)) {
    return { category: 'social', suggestedKey: 'online.githubUrl', confidence: 0.98 }
  }

  // Portfolio / Website
  if (/\b(portfolio|website|personal\s*site|personal\s*url|link)\b/i.test(text)) {
    return { category: 'social', suggestedKey: 'online.portfolioUrl', confidence: 0.94 }
  }

  // Work Authorization / Visa
  if (/\b(authorized\s*to\s*work|legal\s*work|work\s*authorization|eligible\s*to\s*work)\b/i.test(text)) {
    return { category: 'work_auth', suggestedKey: 'demographics.authorizedToWorkInCountry', confidence: 0.90 }
  }

  if (/\b(sponsorship|require\s*visa|h-1b|visa\s*sponsorship)\b/i.test(text)) {
    return { category: 'work_auth', suggestedKey: 'demographics.requiresSponsorship', confidence: 0.90 }
  }

  // EEO Demographics
  if (/\b(gender|sex)\b/i.test(text) && !text.includes('female-only')) {
    return { category: 'eeo', suggestedKey: 'demographics.gender', confidence: 0.88 }
  }
  if (/\b(pronoun|pronouns)\b/i.test(text)) {
    return { category: 'eeo', suggestedKey: 'demographics.pronouns', confidence: 0.90 }
  }
  if (/\b(veteran|military)\b/i.test(text)) {
    return { category: 'eeo', suggestedKey: 'demographics.veteranStatus', confidence: 0.88 }
  }
  if (/\b(disability|handicap)\b/i.test(text)) {
    return { category: 'eeo', suggestedKey: 'demographics.disabilityStatus', confidence: 0.88 }
  }
  if (/\b(race|ethnicity|hispanic|latino)\b/i.test(text)) {
    return { category: 'eeo', suggestedKey: 'demographics.raceEthnicity', confidence: 0.88 }
  }

  // Open-ended Essays / Long Answer Textareas
  if (tagName === 'textarea' || text.includes('why do you want') || text.includes('cover letter') || text.includes('describe') || text.includes('tell us')) {
    return { category: 'essay', suggestedKey: 'ai_essay', confidence: 0.80 }
  }

  return { category: 'unknown', suggestedKey: '', confidence: 0.1 }
}

/**
 * Scan document and return all fillable fields
 * Self-contained for safe chrome.scripting.executeScript injection
 */
export function inspectPageForms(): FormInspectionResult {
  function getPageFormType(): FormInspectionResult['formType'] {
    const html = document.documentElement.innerHTML.toLowerCase()
    const url = window.location.href.toLowerCase()

    if (url.includes('myworkdayjobs.com') || html.includes('data-automation-id') || html.includes('workday')) {
      return 'Workday'
    }
    if (url.includes('greenhouse.io') || html.includes('gh-src') || html.includes('grnhse')) {
      return 'Greenhouse'
    }
    if (url.includes('lever.co') || html.includes('lever-form') || html.includes('lever.co')) {
      return 'Lever'
    }
    if (url.includes('ashbyhq.com') || html.includes('ashby')) {
      return 'Ashby'
    }
    if (url.includes('taleo.net') || html.includes('taleo') || url.includes('oraclecloud.com')) {
      return 'Taleo'
    }
    if (url.includes('icims.com') || html.includes('icims')) {
      return 'iCIMS'
    }
    if (url.includes('bamboohr.com') || html.includes('bamboohr')) {
      return 'BambooHR'
    }
    if (url.includes('smartrecruiters.com') || html.includes('smartrecruiters')) {
      return 'SmartRecruiters'
    }
    if (
      html.includes('apply') ||
      html.includes('resume') ||
      html.includes('curriculum vitae') ||
      html.includes('job title') ||
      html.includes('work authorization') ||
      html.includes('cover letter')
    ) {
      return 'JobApplication'
    }

    return 'GeneralForm'
  }

  function getFieldLabel(el: HTMLElement): string {
    const ariaLabel = el.getAttribute('aria-label')
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim()

    const labelledBy = el.getAttribute('aria-labelledby')
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy)
      if (labelEl && labelEl.innerText.trim()) return labelEl.innerText.trim()
    }

    if (el.id) {
      try {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`) as HTMLElement | null
        if (label && label.innerText.trim()) return label.innerText.trim()
      } catch {}
    }

    // Check enclosing <fieldset> with <legend>
    const fieldset = el.closest('fieldset')
    if (fieldset) {
      const legend = fieldset.querySelector('legend')
      if (legend && legend.innerText.trim()) {
        const legendText = legend.innerText.trim()
        const elLabel = el.closest('label')?.innerText.trim()
        return elLabel ? `${legendText} - ${elLabel}` : legendText
      }
    }

    const parentLabel = el.closest('label')
    if (parentLabel && parentLabel.innerText.trim()) {
      return parentLabel.innerText.replace(el.innerText || '', '').trim()
    }

    const wdContainer = el.closest('[data-automation-id]')
    if (wdContainer) {
      const label = wdContainer.querySelector('label, [data-automation-id*="label"]') as HTMLElement | null
      if (label && label.innerText.trim()) return label.innerText.trim()
    }

    // Check table cell layout (preceding td or th)
    const cell = el.closest('td')
    if (cell) {
      const prevCell = cell.previousElementSibling as HTMLElement | null
      if (prevCell && prevCell.innerText.trim()) {
        return prevCell.innerText.trim()
      }
    }

    const container = el.closest('.form-group, .field, [class*="form-item"], [class*="input-wrap"], [class*="Field_"]')
    if (container) {
      const labelCandidate = container.querySelector('label, [class*="label"], span') as HTMLElement | null
      if (labelCandidate && labelCandidate.innerText.trim()) return labelCandidate.innerText.trim()
    }

    const placeholder = el.getAttribute('placeholder')
    if (placeholder && placeholder.trim()) return placeholder.trim()

    const name = el.getAttribute('name')
    if (name && name.trim()) return name.trim().replace(/[_-]/g, ' ')

    return ''
  }

  function getFieldCategory(
    label: string, 
    name: string, 
    id: string, 
    autocomplete: string, 
    type: string, 
    tagName: string
  ): { category: FieldCategory; suggestedKey: string; confidence: number } {
    const text = `${label} ${name} ${id} ${autocomplete}`.toLowerCase()

    if (autocomplete === 'given-name' || /\b(first\s*name|given\s*name|fname|forename)\b/i.test(text)) {
      return { category: 'name', suggestedKey: 'personal.firstName', confidence: 0.98 }
    }
    if (autocomplete === 'family-name' || /\b(last\s*name|family\s*name|surname|lname)\b/i.test(text)) {
      return { category: 'name', suggestedKey: 'personal.lastName', confidence: 0.98 }
    }
    if (autocomplete === 'name' || /\b(full\s*name|your\s*name|candidate\s*name)\b/i.test(text) || (/^name$/i.test(name) && !text.includes('user') && !text.includes('file'))) {
      return { category: 'name', suggestedKey: 'personal.fullName', confidence: 0.95 }
    }
    if (type === 'email' || autocomplete === 'email' || /\b(email|e-mail|email\s*address)\b/i.test(text)) {
      return { category: 'email', suggestedKey: 'personal.email', confidence: 0.99 }
    }
    if (type === 'tel' || autocomplete === 'tel' || /\b(phone|mobile|cell|telephone|contact\s*number)\b/i.test(text)) {
      return { category: 'phone', suggestedKey: 'personal.phone', confidence: 0.95 }
    }
    if (autocomplete === 'address-level2' || /\b(city|town)\b/i.test(text)) {
      return { category: 'address', suggestedKey: 'personal.city', confidence: 0.93 }
    }
    if (autocomplete === 'address-level1' || /\b(state|province|region)\b/i.test(text)) {
      return { category: 'address', suggestedKey: 'personal.state', confidence: 0.92 }
    }
    if (autocomplete === 'postal-code' || /\b(zip|postal\s*code|pincode)\b/i.test(text)) {
      return { category: 'address', suggestedKey: 'personal.postalCode', confidence: 0.94 }
    }
    if (autocomplete === 'country-name' || /\b(country)\b/i.test(text)) {
      return { category: 'address', suggestedKey: 'personal.country', confidence: 0.92 }
    }
    if (
      autocomplete === 'address-line1' || 
      (autocomplete !== 'address-level1' && autocomplete !== 'address-level2' && /\b(address(\s*line\s*1)?|street\s*address|residential\s*address)\b/i.test(text))
    ) {
      return { category: 'address', suggestedKey: 'personal.addressLine1', confidence: 0.94 }
    }
    if (/\b(linkedin|linked\s*in)\b/i.test(text)) {
      return { category: 'social', suggestedKey: 'online.linkedinUrl', confidence: 0.96 }
    }
    if (/\b(github|git\s*hub)\b/i.test(text)) {
      return { category: 'social', suggestedKey: 'online.githubUrl', confidence: 0.96 }
    }
    if (/\b(portfolio|website|personal\s*site|webpage)\b/i.test(text)) {
      return { category: 'social', suggestedKey: 'online.portfolioUrl', confidence: 0.94 }
    }
    if (/\b(twitter|x\.com)\b/i.test(text)) {
      return { category: 'social', suggestedKey: 'online.twitterUrl', confidence: 0.92 }
    }
    if (/\b(authorized|legally\s*authorized|work\s*authorization|eligible\s*to\s*work)\b/i.test(text)) {
      return { category: 'work_auth', suggestedKey: 'demographics.authorizedToWorkInCountry', confidence: 0.90 }
    }
    if (/\b(sponsorship|require\s*sponsorship|visa\s*sponsorship)\b/i.test(text)) {
      return { category: 'work_auth', suggestedKey: 'demographics.requiresSponsorship', confidence: 0.90 }
    }
    if (/\b(gender|sex)\b/i.test(text)) {
      return { category: 'eeo', suggestedKey: 'demographics.gender', confidence: 0.88 }
    }
    if (/\b(veteran|military\s*status)\b/i.test(text)) {
      return { category: 'eeo', suggestedKey: 'demographics.veteranStatus', confidence: 0.88 }
    }
    if (/\b(disability|handicap)\b/i.test(text)) {
      return { category: 'eeo', suggestedKey: 'demographics.disabilityStatus', confidence: 0.88 }
    }
    if (/\b(race|ethnicity|hispanic|latino)\b/i.test(text)) {
      return { category: 'eeo', suggestedKey: 'demographics.raceEthnicity', confidence: 0.88 }
    }
    if (tagName === 'textarea' || text.includes('why do you want') || text.includes('cover letter') || text.includes('describe') || text.includes('tell us')) {
      return { category: 'essay', suggestedKey: 'ai_essay', confidence: 0.80 }
    }

    return { category: 'unknown', suggestedKey: '', confidence: 0.1 }
  }

  const formType = getPageFormType()
  const detected: DetectedField[] = []

  function getEligibleElements(): HTMLElement[] {
    const selector = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), ' +
      'textarea, ' +
      'select, ' +
      '[role="combobox"], ' +
      '[data-automation-id*="input"], ' +
      '[data-automation-id*="select"]'

    const elements: HTMLElement[] = []

    function traverse(root: Document | ShadowRoot | Element) {
      try {
        const matched = Array.from(root.querySelectorAll<HTMLElement>(selector))
        elements.push(...matched)

        const all = Array.from(root.querySelectorAll<HTMLElement>('*'))
        for (const el of all) {
          if (el.shadowRoot) {
            traverse(el.shadowRoot)
          }
        }
      } catch {}
    }

    traverse(document)
    return elements
  }

  const elements = getEligibleElements()

  elements.forEach((el, index) => {
    if (el.offsetParent === null && el.offsetWidth === 0 && el.offsetHeight === 0) {
      return
    }

    const tagName = el.tagName.toLowerCase()
    const type = (el.getAttribute('type') || (tagName === 'textarea' ? 'textarea' : tagName === 'select' ? 'select' : 'text')).toLowerCase()
    const name = el.getAttribute('name') || ''
    const id = el.id || ''
    const placeholder = el.getAttribute('placeholder') || ''
    const autocomplete = el.getAttribute('autocomplete') || ''
    const isRequired = el.hasAttribute('required') || el.getAttribute('aria-required') === 'true'
    const isReadOnly = (el as HTMLInputElement).readOnly || el.hasAttribute('disabled')
    const currentValue = (el as HTMLInputElement).value || el.innerText || ''

    if (isReadOnly) return

    const label = getFieldLabel(el)
    const { category, suggestedKey, confidence } = getFieldCategory(label, name, id, autocomplete, type, tagName)

    let options: string[] | undefined
    if (el instanceof HTMLSelectElement) {
      options = Array.from(el.options).map(o => o.text.trim())
    }

    let selector = ''
    if (id) {
      try {
        selector = `#${CSS.escape(id)}`
      } catch {
        selector = `#${id}`
      }
    } else if (name) {
      try {
        selector = `${tagName}[name="${CSS.escape(name)}"]`
      } catch {
        selector = `${tagName}[name="${name}"]`
      }
    } else {
      el.setAttribute('data-pentone-field', String(index))
      selector = `[data-pentone-field="${index}"]`
    }

    detected.push({
      index,
      tagName,
      type,
      name,
      id,
      label,
      placeholder,
      autocomplete,
      selector,
      isRequired,
      isReadOnly,
      currentValue,
      fieldCategory: category,
      suggestedProfileKey: suggestedKey,
      confidence,
      options
    })
  })

  return {
    url: window.location.href,
    domain: window.location.hostname,
    formType,
    fields: detected,
    totalFields: detected.length,
    mappableFields: detected.filter(f => f.confidence > 0.5).length
  }
}
