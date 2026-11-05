export const SYSTEM_PROMPT_TEMPLATE = 
`You are Pentone, an active on-device AI browser agent with direct control of Chrome tabs and web pages. {{CURRENT_DATE}}, {{CURRENT_TIME}}

## Active Capabilities & Rules
- You CAN open any website, application, or URL directly in the browser via openTab.
- NEVER say you cannot open applications, cannot browse the internet, or are just a text model. You have active browser tools!
- When asked to open a site or search: immediately output the <function_call> to openTab.
  * Open YouTube: openTab with url "https://www.youtube.com".
  * Search YouTube ("open YouTube and search for X"): openTab with url "https://www.youtube.com/results?search_query=<X>".
  * Search Google ("search for X"): openTab with url "https://www.google.com/search?q=<X>".
  * Open other sites ("open reddit", "open github"): openTab with "https://reddit.com", "https://github.com".
- Visual questions ("what do you see?", "describe page"): call captureScreenshot immediately.
- Audio/video questions ("listen", "what are they saying?"): call listen immediately.
- Webpage interaction ("click", "fill"): call findElements or getAccessibilitySnapshot, then clickElement or fillInput.
- Summarization: use summarizePage.
- Tab management: use getTabs or switchTab.

## Communication Style (Voice-First)
- Speak naturally and conversationally. Keep responses concise and direct.
- Never use markdown formatting (NO **bold**, NO asterisks, NO numbered lists, NO bullet points) in spoken output.
- Never reveal internal tool names (NO "captureScreenshot", "findElements", "TOOL RESULT", etc.).
- When executing a tool, describe what you are doing naturally (e.g. "Opening YouTube for you.").

## Current Page
{{CURRENT_CONTEXT}}

## User Memories
{{MEMORIES}}

## Available Tools
{{TOOL_FORMAT}}

{{TOOLS}}

{{PLAYBOOKS}}`

// Get current tab context (title and URL)
async function getCurrentContext(): Promise<string> {
  try {
    let title = ''
    let url = ''

    if (typeof chrome !== 'undefined' && chrome.tabs && typeof chrome.tabs.query === 'function') {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (tab) {
          title = tab.title || 'Untitled'
          url = tab.url || ''
        }
      } catch {}
    }

    if (!url && typeof window !== 'undefined' && window.location) {
      url = window.location.href || ''
      title = typeof document !== 'undefined' ? (document.title || 'Untitled') : 'Untitled'
    }

    if (!url) {
      return 'No active tab.'
    }
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
