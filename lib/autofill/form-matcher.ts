/**
 * Form Matcher & AI Resolver - Maps detected form fields to Profile Vault attributes
 * and synthesizes contextual answers using Gemini Nano for open-ended questions.
 */

import type { AutofillProfile } from './profile-vault'
import type { DetectedField } from './form-inspector'
import { ensureSession } from '../ai'
import { getPageContext } from '../use-page-context'

export interface FieldFillInstruction {
  fieldIndex: number
  selector: string
  label: string
  valueToFill: string
  isAISynthesized: boolean
  confidence: number
}

export interface AutofillPlan {
  formType: string
  totalDetected: number
  mappedCount: number
  instructions: FieldFillInstruction[]
  requiresAttention: { label: string; selector: string; reason: string }[]
}

/**
 * Access a nested property safely from the AutofillProfile using a dot path
 */
function getProfileValue(profile: AutofillProfile, keyPath: string): any {
  // Alias mapping for work authorization
  if (
    (keyPath === 'demographics.authorizedInCountry' || keyPath === 'demographics.authorizedToWorkInCountry') &&
    profile.demographics?.authorizedToWorkInCountry !== undefined
  ) {
    return profile.demographics.authorizedToWorkInCountry
  }

  const parts = keyPath.split('.')
  let current: any = profile
  for (const part of parts) {
    if (current === undefined || current === null) return undefined
    current = current[part]
  }
  return current
}

/**
 * Match a detected field against stored Custom Q&A patterns (with ReDoS protection)
 */
function matchCustomQA(fieldLabel: string, profile: AutofillProfile): string | null {
  if (!profile.customAnswers || profile.customAnswers.length === 0 || !fieldLabel) return null

  for (const item of profile.customAnswers) {
    if (!item.questionPattern || !item.answer) continue
    const cleanPattern = item.questionPattern.trim()
    if (!cleanPattern) continue

    try {
      // Limit pattern length to prevent catastrophic backtracking (ReDoS)
      const safePattern = cleanPattern.slice(0, 150)
      const regex = new RegExp(safePattern, 'i')
      if (regex.test(fieldLabel)) {
        return item.answer
      }
    } catch {
      // Resilient fallback: case-insensitive substring search
      if (fieldLabel.toLowerCase().includes(cleanPattern.toLowerCase())) {
        return item.answer
      }
    }
  }
  return null
}

/**
 * Generate an open-ended essay response using local Gemini Nano Prompt API
 */
export async function synthesizeEssayAnswer(
  fieldLabel: string,
  profile: AutofillProfile,
  pageContextText: string = ''
): Promise<string> {
  try {
    const session = await ensureSession()
    const recentRole = profile.workExperience?.[0]
    const skillsList = profile.skills.slice(0, 8).join(', ')
    const recentSummary = recentRole 
      ? `${recentRole.title} at ${recentRole.company}: ${recentRole.description}`
      : 'Experienced professional'

    const prompt = `You are an expert job application assistant. Draft a concise, polished response to the following application question.
Use the candidate's actual background and the company context. Keep the answer professional, authentic, and under 120 words.
Output ONLY the pure answer text without quotes, preamble, or conversational filler.

Question: "${fieldLabel}"
Company / Page Context: ${pageContextText.slice(0, 1500)}
Candidate Background:
- Key Skills: ${skillsList}
- Recent Experience: ${recentSummary}`

    const response = await session.prompt(prompt)
    return (response || '').trim().replace(/^["'`]|["'`]$/g, '').trim()
  } catch (err) {
    console.warn('[FormMatcher] Gemini Nano essay synthesis failed, returning fallback template:', err)
    return `I am excited about this opportunity because my experience with ${profile.skills.slice(0, 3).join(', ')} aligns strongly with your team's mission.`
  }
}

/**
 * Generate a complete Autofill Plan for the given fields against user profile
 */
export async function createAutofillPlan(
  fields: DetectedField[],
  profile: AutofillProfile,
  formType: string = 'JobApplication'
): Promise<AutofillPlan> {
  const instructions: FieldFillInstruction[] = []
  const requiresAttention: { label: string; selector: string; reason: string }[] = []
  const pageContext = await getPageContext().catch(() => '')

  for (const field of fields) {
    let resolvedValue = ''
    let isAI = false
    let confidence = field.confidence

    // 1. Check Custom Q&A pattern first
    const customMatch = matchCustomQA(field.label, profile)
    if (customMatch && customMatch.trim().length > 0) {
      resolvedValue = customMatch.trim()
      confidence = 0.95
    }

    // 2. Check direct suggested key mapping
    if (!resolvedValue && field.suggestedProfileKey) {
      if (field.suggestedProfileKey === 'ai_essay') {
        // Only synthesize if profile has candidate background details entered
        const hasBackground = (profile.skills && profile.skills.length > 0) || (profile.workExperience && profile.workExperience.length > 0)
        if (hasBackground) {
          resolvedValue = await synthesizeEssayAnswer(field.label, profile, pageContext)
          isAI = true
          confidence = 0.85
        }
      } else if (field.suggestedProfileKey === 'personal.fullName') {
        const full = (profile.personal?.fullName || `${profile.personal?.firstName || ''} ${profile.personal?.lastName || ''}`).trim()
        if (full) resolvedValue = full
      } else if (field.suggestedProfileKey === 'personal.firstName') {
        const first = (profile.personal?.firstName || (profile.personal?.fullName ? profile.personal.fullName.split(' ')[0] : '')).trim()
        if (first) resolvedValue = first
      } else if (field.suggestedProfileKey === 'personal.lastName') {
        const last = (profile.personal?.lastName || (profile.personal?.fullName ? profile.personal.fullName.split(' ').slice(1).join(' ') : '')).trim()
        if (last) resolvedValue = last
      } else if (field.suggestedProfileKey === 'personal.middleInitial') {
        const preferred = (profile.personal?.preferredName || '').trim()
        if (preferred.length === 1) {
          resolvedValue = preferred.toUpperCase()
        } else if (profile.personal?.fullName) {
          const parts = profile.personal.fullName.trim().split(/\s+/)
          if (parts.length >= 3) {
            resolvedValue = parts[1][0].toUpperCase()
          }
        }
      } else if (field.suggestedProfileKey === 'personal.title') {
        const customTitle = matchCustomQA('title', profile) || matchCustomQA('salutation', profile)
        if (customTitle) {
          resolvedValue = customTitle
        } else if (profile.demographics?.gender?.toLowerCase() === 'male') {
          resolvedValue = 'Mr.'
        } else if (profile.demographics?.gender?.toLowerCase() === 'female') {
          resolvedValue = 'Ms.'
        }
      } else if (field.suggestedProfileKey === 'experience.company') {
        const comp = profile.workExperience?.[0]?.company
        if (comp && comp.trim()) resolvedValue = comp.trim()
      } else if (field.suggestedProfileKey === 'experience.title') {
        const pos = profile.workExperience?.[0]?.title
        if (pos && pos.trim()) resolvedValue = pos.trim()
      } else if (field.suggestedProfileKey === 'personal.username') {
        const usr = profile.personal?.preferredName || (profile.personal?.email ? profile.personal.email.split('@')[0] : '') || profile.personal?.firstName?.toLowerCase() || ''
        if (usr) resolvedValue = usr
      } else if (field.suggestedProfileKey === 'online.portfolioUrl') {
        const site = profile.online?.portfolioUrl || profile.online?.githubUrl || profile.online?.linkedinUrl || ''
        if (site) resolvedValue = site
      } else if (field.suggestedProfileKey.startsWith('demographics.')) {
        // Boolean or demographic values
        const rawVal = getProfileValue(profile, field.suggestedProfileKey)
        if (typeof rawVal === 'boolean') {
          if (
            field.suggestedProfileKey === 'demographics.authorizedToWorkInCountry' ||
            field.suggestedProfileKey === 'demographics.requiresSponsorship' ||
            field.suggestedProfileKey === 'demographics.authorizedInCountry'
          ) {
            resolvedValue = rawVal ? 'Yes' : 'No'
          }
        } else if (typeof rawVal === 'string' && rawVal.trim().length > 0) {
          resolvedValue = rawVal.trim()
        }
      } else {
        const val = getProfileValue(profile, field.suggestedProfileKey)
        if (typeof val === 'string' && val.trim().length > 0) {
          resolvedValue = val.trim()
        }
      }
    }

    // 2.5 Smart Fallback Contextual Matcher:
    // If not yet resolved, check the normalized field label, name, and placeholder against profile attributes
    if (!resolvedValue) {
      const search = `${field.label} ${field.name} ${field.placeholder}`.toLowerCase()
      if (/\b(first\s*name|given\s*name|fname|frstname)\b/i.test(search)) {
        const first = (profile.personal?.firstName || (profile.personal?.fullName ? profile.personal.fullName.split(' ')[0] : '')).trim()
        if (first) resolvedValue = first
      } else if (/\b(last\s*name|surname|family\s*name|lname|lastname)\b/i.test(search)) {
        const last = (profile.personal?.lastName || (profile.personal?.fullName ? profile.personal.fullName.split(' ').slice(1).join(' ') : '')).trim()
        if (last) resolvedValue = last
      } else if (/\b(full\s*name|candidate\s*name|fullname)\b/i.test(search)) {
        const full = (profile.personal?.fullName || `${profile.personal?.firstName || ''} ${profile.personal?.lastName || ''}`).trim()
        if (full) resolvedValue = full
      } else if (/\b(company|employer|organization)\b/i.test(search)) {
        const comp = profile.workExperience?.[0]?.company
        if (comp) resolvedValue = comp.trim()
      } else if (/\b(position|job\s*title|current\s*role|occupation)\b/i.test(search)) {
        const pos = profile.workExperience?.[0]?.title
        if (pos) resolvedValue = pos.trim()
      } else if (/\b(city|town)\b/i.test(search)) {
        if (profile.personal?.city) resolvedValue = profile.personal.city.trim()
      } else if (/\b(state|province|region)\b/i.test(search)) {
        if (profile.personal?.state) resolvedValue = profile.personal.state.trim()
      } else if (/\b(country|nation)\b/i.test(search)) {
        if (profile.personal?.country) resolvedValue = profile.personal.country.trim()
      } else if (/\b(zip|postal(\s*code)?|pincode)\b/i.test(search)) {
        if (profile.personal?.postalCode) resolvedValue = profile.personal.postalCode.trim()
      } else if (/\b(address(\s*1|\s*line\s*1)?|street)\b/i.test(search) && !/\b(line\s*2|suite|apt)\b/i.test(search)) {
        if (profile.personal?.addressLine1) resolvedValue = profile.personal.addressLine1.trim()
      } else if (/\b(address\s*(line\s*)?2|suite|apt|apartment)\b/i.test(search)) {
        if (profile.personal?.addressLine2) resolvedValue = profile.personal.addressLine2.trim()
      } else if (/\b(phone|mobile|cell|telephone|tel)\b/i.test(search)) {
        if (profile.personal?.phone) resolvedValue = profile.personal.phone.trim()
      } else if (/\b(email|e-mail)\b/i.test(search)) {
        if (profile.personal?.email) resolvedValue = profile.personal.email.trim()
      } else if (/\b(web\s*site|website|portfolio|homepage)\b/i.test(search)) {
        const site = profile.online?.portfolioUrl || profile.online?.githubUrl || profile.online?.linkedinUrl
        if (site) resolvedValue = site.trim()
      } else if (/\b(user\s*id|username|login)\b/i.test(search)) {
        const usr = profile.personal?.preferredName || (profile.personal?.email ? profile.personal.email.split('@')[0] : '') || profile.personal?.firstName?.toLowerCase() || ''
        if (usr) resolvedValue = usr
      } else if (/\b(sex|gender)\b/i.test(search)) {
        if (profile.demographics?.gender) resolvedValue = profile.demographics.gender.trim()
      }
    }

    // 3. Dropdown matching: if field has options and resolvedValue is non-empty, pick closest option
    if (resolvedValue && field.options && field.options.length > 0) {
      const lower = resolvedValue.toLowerCase().trim()
      const cleanLower = lower.replace(/\./g, '')

      let matchedOpt = field.options.find(opt => {
        const optLower = opt.toLowerCase().trim()
        const cleanOpt = optLower.replace(/\./g, '')
        return optLower === lower || cleanOpt === cleanLower
      })

      if (!matchedOpt) {
        matchedOpt = field.options.find(opt => {
          const optLower = opt.toLowerCase().trim()
          return optLower.includes(lower) || lower.includes(optLower)
        })
      }

      // Title/Salutation match: Mr. / Mr / Mister
      if (!matchedOpt && (cleanLower === 'mr' || cleanLower === 'mister')) {
        matchedOpt = field.options.find(opt => /^(mr\.?|mister)$/i.test(opt.trim()))
      }
      if (!matchedOpt && (cleanLower === 'ms' || cleanLower === 'mrs' || cleanLower === 'miss')) {
        matchedOpt = field.options.find(opt => /^(ms\.?|miss|mrs\.?)$/i.test(opt.trim()))
      }

      // Gender initial match: Male -> M, Female -> F
      if (!matchedOpt && (lower === 'male' || lower === 'female')) {
        const initial = lower.slice(0, 1)
        matchedOpt = field.options.find(opt => opt.trim().toLowerCase() === initial)
      }

      if (matchedOpt) {
        resolvedValue = matchedOpt
      }
    }

    // 4. Save to instructions ONLY IF resolvedValue is non-empty!
    // Leave all fields without profile data completely untouched.
    if (resolvedValue && resolvedValue.trim().length > 0) {
      instructions.push({
        fieldIndex: field.index,
        selector: field.selector,
        label: field.label || field.placeholder || field.name,
        valueToFill: resolvedValue.trim(),
        isAISynthesized: isAI,
        confidence
      })
    } else if (field.isRequired) {
      requiresAttention.push({
        label: field.label || field.placeholder || field.name || 'Required field',
        selector: field.selector,
        reason: 'Required field with no matching profile data'
      })
    }
  }

  return {
    formType,
    totalDetected: fields.length,
    mappedCount: instructions.length,
    instructions,
    requiresAttention
  }
}
