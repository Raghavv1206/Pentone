/**
 * Tool: autofillForm
 * Inspects the current page, matches fields against the user's Profile Vault,
 * synthesizes contextual answers with Gemini Nano, and executes resilient form filling.
 */

import type { ToolSpec } from '../tool-registry'
import { loadAutofillProfile } from '../autofill/profile-vault'
import { inspectPageForms, type FormInspectionResult } from '../autofill/form-inspector'
import { createAutofillPlan } from '../autofill/form-matcher'
import { executeFillInstructions, type FillExecutionResult } from '../autofill/form-filler'

interface AutofillParams {
  section?: 'all' | 'personal' | 'experience' | 'education' | 'demographics'
  mode?: 'preview' | 'instant'
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

    // 2. Load user's master profile vault
    const profile = await loadAutofillProfile()

    // 3. Create intelligent autofill plan
    const plan = await createAutofillPlan(inspection.fields, profile, inspection.formType)

    if (plan.instructions.length === 0) {
      return {
        success: false,
        error: `Found ${inspection.totalFields} form fields, but none matched your profile vault. Please check your Profile Screen.`
      }
    }

    // 4. Execute the resilient field filling on the active page
    const fillResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: executeFillInstructions,
      args: [plan.instructions]
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

    const message = `Autofilled ${result.filledCount} of ${plan.totalDetected} fields on this ${plan.formType} form${aiNote}. Please review the highlighted fields before submitting!`

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
