/**
 * Tool: autofillForm
 * Inspects the current page, matches fields against the user's Profile Vault,
 * synthesizes contextual answers with Gemini Nano, and executes resilient form filling.
 */

import type { ToolSpec } from '../tool-registry'
import { loadAutofillProfile, loadStoredResumeFile } from '../autofill/profile-vault'
import { inspectPageForms, type FormInspectionResult } from '../autofill/form-inspector'
import { createAutofillPlan } from '../autofill/form-matcher'
import { executeFillInstructions, type FillExecutionResult } from '../autofill/form-filler'
import { inspectSecurityRisk, showPhishingWarningModal } from '../security/phishing-guard'
import { generateSubAddressAlias } from '../security/alias-generator'

interface AutofillParams {
  section?: 'all' | 'personal' | 'experience' | 'education' | 'demographics'
  mode?: 'preview' | 'instant'
  useAlias?: boolean
}

async function autofillForm(params: AutofillParams) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      return { success: false, error: 'No active tab found' }
    }

    // 1. Inspect forms on the active tab
    const inspectionResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: inspectPageForms
    })

    const inspection = inspectionResults?.[0]?.result as FormInspectionResult | undefined

    if (!inspection || inspection.fields.length === 0) {
      return {
        success: false,
        error: 'No fillable form fields or application inputs were found on this page.'
      }
    }

    // 1.5 Pre-autofill Security Audit (Phishing & Domain Deception Guard)
    const formActions = inspection.formActions || []
    const securityReport = inspectSecurityRisk(tab.url || '', formActions)

    if (!securityReport.isSafe && securityReport.threatLevel === 'dangerous') {
      try {
        void chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: showPhishingWarningModal,
          args: [securityReport]
        }).catch(() => {})
      } catch {}

      return {
        success: false,
        securityBlocked: true,
        threatLevel: securityReport.threatLevel,
        error: `Autofill paused by Pentone Security Shield: Potential spoofed or deceptive domain (${securityReport.spoofedTarget || securityReport.currentHost}). Reasons: ${securityReport.reasons.join('; ')}`
      }
    }

    // 2. Load user's master profile vault
    const profile = await loadAutofillProfile()

    // 3. Create intelligent autofill plan
    const categories: Record<string, string[]> = {
      personal: ['name', 'email', 'phone', 'address', 'social'],
      experience: ['experience', 'skills'], education: ['education'], demographics: ['eeo', 'work_auth']
    }
    if (params?.section && params.section !== 'all' && !categories[params.section]) {
      return { success: false, error: 'Unknown autofill section' }
    }
    if (params?.mode && !['preview', 'instant'].includes(params.mode)) {
      return { success: false, error: 'Unknown autofill mode' }
    }
    const fields = params?.section && params.section !== 'all'
      ? inspection.fields.filter(f => categories[params.section!].includes(f.fieldCategory))
      : inspection.fields
    const plan = await createAutofillPlan(fields, profile, inspection.formType)

    // If disposable alias requested, rewrite email values to site-specific sub-address
    if (params?.useAlias && tab.url && profile.personal?.email) {
      const hostname = new URL(tab.url).hostname
      const aliasInfo = generateSubAddressAlias(profile.personal.email, hostname)
      plan.instructions.forEach(inst => {
        const field = inspection.fields.find(f => f.index === inst.fieldIndex)
        if (field?.fieldCategory === 'email') {
          inst.valueToFill = aliasInfo.alias
        }
      })
    }

    if (plan.instructions.length === 0) {
      return {
        success: false,
        error: `Found ${inspection.totalFields} form fields, but none matched your profile vault. Please check your Profile Screen.`
      }
    }

    // If preview mode requested, return planned matches without modifying the page
    if (params?.mode === 'preview') {
      const aiCount = plan.instructions.filter(i => i.isAISynthesized).length
      return {
        success: true,
        mode: 'preview',
        result: `Found ${plan.mappedCount} matching fields on this ${plan.formType} form${aiCount > 0 ? ` with ${aiCount} AI-tailored answers` : ''}.`,
        mappedCount: plan.mappedCount,
        totalCount: plan.totalDetected,
        formType: plan.formType,
        instructions: plan.instructions.map(i => ({
          label: i.label,
          valueToFill: i.valueToFill,
          isAISynthesized: i.isAISynthesized,
          confidence: i.confidence
        })),
        requiresAttention: plan.requiresAttention
      }
    }

    const resumeFile = !params?.section || params.section === 'all' ? await loadStoredResumeFile() : null

    // 4. Execute the resilient field filling on the active page
    const fillResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: executeFillInstructions,
      args: [plan.instructions, resumeFile]
    })

    const result = fillResults?.[0]?.result as FillExecutionResult | undefined

    if (!result || !result.success) {
      return {
        success: false,
        error: 'Failed to inject autofill values into form elements.'
      }
    }

    const aiCount = plan.instructions.filter(i => i.isAISynthesized).length
    const aiNote = aiCount > 0 ? ` (including ${aiCount} AI-tailored answers)` : ''

    const message = `Autofilled ${result.filledCount} matching field${result.filledCount === 1 ? '' : 's'} on this ${plan.formType} form from your profile${aiNote}. Unfilled fields were left untouched.`

    return {
      success: true,
      result: message,
      filledCount: result.filledCount,
      totalCount: plan.totalDetected,
      formType: plan.formType,
      requiresAttention: plan.requiresAttention
    }
  } catch (err: any) {
    console.error('[Tool: autofillForm] Execution error:', err)
    return {
      success: false,
      error: `Form autofill encountered an error: ${err?.message || 'Unknown error'}`
    }
  }
}

export const spec: ToolSpec = {
  name: 'autofillForm',
  description: 'Automatically detects and fills form fields, job applications, or registration forms using the user\'s offline profile vault and Gemini Nano.',
  parameters: [
    {
      name: 'section',
      type: 'string',
      description: 'Specific section to fill ("all", "personal", "experience", "education", "demographics")',
      required: false
    },
    {
      name: 'mode',
      type: 'string',
      description: 'Execution mode ("preview" summary or "instant" injection)',
      required: false
    }
  ],
  spokenLine: 'Autofilling form fields with your profile',
  examples: [
    'User: "fill this form" → autofillForm with section: "all"',
    'User: "autofill my resume details" → autofillForm',
    'User: "fill in my contact information" → autofillForm with section: "personal"'
  ]
}

export default autofillForm
