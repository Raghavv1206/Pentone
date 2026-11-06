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
  const parts = keyPath.split('.')
  let current: any = profile
  for (const part of parts) {
    if (current === undefined || current === null) return undefined
    current = current[part]
  }
  return current
}

/**
 * Match a detected field against stored Custom Q&A patterns
 */
function matchCustomQA(fieldLabel: string, profile: AutofillProfile): string | null {
  if (!profile.customAnswers || profile.customAnswers.length === 0) return null

  for (const item of profile.customAnswers) {
    try {
      const regex = new RegExp(item.questionPattern, 'i')
      if (regex.test(fieldLabel)) {
        return item.answer
      }
    } catch {}
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
    if (customMatch) {
      resolvedValue = customMatch
      confidence = 0.95
    }

    // 2. Check direct suggested key mapping
    if (!resolvedValue && field.suggestedProfileKey) {
      if (field.suggestedProfileKey === 'ai_essay') {
        // Synthesize via Gemini Nano
        resolvedValue = await synthesizeEssayAnswer(field.label, profile, pageContext)
        isAI = true
        confidence = 0.85
      } else if (field.suggestedProfileKey.startsWith('demographics.')) {
        // Boolean or demographic values
        const rawVal = getProfileValue(profile, field.suggestedProfileKey)
        if (typeof rawVal === 'boolean') {
          resolvedValue = rawVal ? 'Yes' : 'No'
        } else if (typeof rawVal === 'string') {
          resolvedValue = rawVal
        }
      } else {
        const val = getProfileValue(profile, field.suggestedProfileKey)
        if (typeof val === 'string' && val.trim()) {
          resolvedValue = val.trim()
        }
      }
    }

    // 3. Dropdown matching: if field has options, pick closest option
    if (resolvedValue && field.options && field.options.length > 0) {
      const lower = resolvedValue.toLowerCase()
      const matchedOpt = field.options.find(opt => {
        const optLower = opt.toLowerCase()
        return optLower === lower || optLower.includes(lower) || lower.includes(optLower)
      })
      if (matchedOpt) {
        resolvedValue = matchedOpt
      }
    }

    // 4. Save to instructions if resolved
    if (resolvedValue) {
      instructions.push({
        fieldIndex: field.index,
        selector: field.selector,
        label: field.label || field.placeholder || field.name,
        valueToFill: resolvedValue,
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
