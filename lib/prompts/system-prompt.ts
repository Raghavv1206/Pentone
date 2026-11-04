export const SYSTEM_PROMPT_TEMPLATE = 
`You are Pentone, an intelligent on-device AI browser companion. {{CURRENT_DATE}}, {{CURRENT_TIME}}

## Current Page
{{CURRENT_CONTEXT}}

## Communication Style (Voice-First)
- Speak naturally and conversationally. Keep responses concise and direct.
- Never use markdown formatting (NO **bold**, NO asterisks, NO numbered lists, NO bullet points) in spoken output.
- Never reveal internal tool names (NO "captureScreenshot", "findElements", "TOOL RESULT", etc.) or technical jargon. Describe what you see or do naturally.
- When asking the user for information, stop and wait. Never invent user replies.
- After a tool returns results, give the direct answer immediately without unnecessary follow-up calls.

## Core Rules & Actions
- Visual questions ("what do you see?", "describe page"): call captureScreenshot immediately.
- Audio/video questions ("listen", "what are they saying?"): call listen immediately.
- Webpage interaction ("click", "fill"): call findElements or getAccessibilitySnapshot to locate elements by index, then clickElement or fillInput.
- Search: if not on Google, open "https://www.google.com" with openTab first.
- Summarization: use summarizePage.
- Forms: use getPlaybook with id "fill-form" when completing forms.

## User Memories
{{MEMORIES}}

## Available Tools
{{TOOL_FORMAT}}

{{TOOLS}}

{{PLAYBOOKS}}`

// Get current tab context (title and URL)
async function getCurrentContext(): Promise<string> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab) {
      return 'No active tab.'
    }
    const title = tab.title || 'Untitled'
    const url = tab.url || ''
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) {
      return `Current Page: ${title} (Internal browser page)`
    }
    let domain = url
    try { domain = new URL(url).hostname } catch {}
    return `Current Page: "${title}"\nURL: ${url} (${domain})`
  } catch {
    return 'Unable to detect current page.'
  }
}

// Generate system prompt with current values
export async function getSystemPrompt(): Promise<string> {
  const now = new Date()
  const dateStr = now.toLocaleDateString('en-US', { 
    weekday: 'short', 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  })
  const timeStr = now.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit'
  })
  
  // Retrieve memories concisely
  const memories = await getAllMemories()
  
  // Get current tab context
  const currentContext = await getCurrentContext()
  
  return fillPromptPlaceholders(SYSTEM_PROMPT_TEMPLATE)
    .replace('{{CURRENT_DATE}}', dateStr)
    .replace('{{CURRENT_TIME}}', timeStr)
    .replace('{{MEMORIES}}', memories)
    .replace('{{CURRENT_CONTEXT}}', currentContext)
}

// Retrieve and format all stored memories concisely (top 5 max to prevent token bloat)
async function getAllMemories(): Promise<string> {
  try {
    const storage = await chrome.storage.local.get(['agent_memories'])
    const memories = storage.agent_memories || []
    
    if (memories.length === 0) {
      return 'No memories stored yet. Use storeMemory to save personal user details.'
    }
    
    const recent = memories.slice(-5)
    return recent.map((m: any, idx: number) => `${idx + 1}. ${m.content}`).join('\n')
  } catch {
    return 'No memories available.'
  }
}

function fillPromptPlaceholders(template: string): string {
  const { generateToolDocumentation } = require('../tool-registry')
  const { TOOL_FORMAT } = require('../tool-docs')
  const { generatePlaybooksDocumentation } = require('../playbooks')
  const { CORE_TOOLS } = require('../core-tools')
  
  const toolDocs = generateToolDocumentation(CORE_TOOLS)
  const playbooksDocs = generatePlaybooksDocumentation()
  
  return template
    .replace('{{TOOLS}}', toolDocs)
    .replace('{{TOOL_FORMAT}}', TOOL_FORMAT)
    .replace('{{PLAYBOOKS}}', playbooksDocs)
}

// Get memory reminder for loopback injection
export async function getMemoryReminder(): Promise<string> {
  try {
    const storage = await chrome.storage.local.get(['agent_memories'])
    const memories = storage.agent_memories || []
    
    if (memories.length === 0) {
      return 'Reminder: Speak naturally without markdown or bullet points.\n\n'
    }
    
    const memoryList = memories.slice(-3).map((m: any) => m.content).join('; ')
    return `Reminder: User info: ${memoryList}. Speak naturally without markdown or bullet points.\n\n`
  } catch {
    return 'Reminder: Speak naturally without markdown or bullet points.\n\n'
  }
}
