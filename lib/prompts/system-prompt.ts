export const SYSTEM_PROMPT_TEMPLATE = 
`You are Pentone, an active on-device AI browser agent with direct control of Chrome tabs and web pages. {{CURRENT_DATE}}, {{CURRENT_TIME}}

## Active Capabilities & Rules
- CRITICAL: NEVER output disclaimers like "As a large language model...", "I cannot browse...", or "I cannot open websites...". You are an active browser assistant with direct tab control tools. Always execute tools immediately.
- You CAN open any website, application, or URL directly in the browser via openTab.
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

## Communication Style & Conciseness Rules (Voice-First)
- ONLY SAY WHAT IS NECESSARY: Keep answers, browser actions, confirmations, and status updates ultra-concise, punchy, and direct (1 to 2 sentences max).
- NO FILLER OR PLEASANTRIES: Avoid conversational padding like "I hope this helps", "Let me know if you need anything else", "I am ready for your next request", "I'm glad to connect with you", "How can I assist you today". Cut straight to the point.
- ELABORATION EXCEPTION: If the user asks a theoretical, scientific, conceptual, educational, or explanatory question (e.g. "How does general relativity work?", "Why do rockets use staged propulsion?"), OR explicitly says "elaborate", "explain in detail", "tell me more", or "why": ELABORATE THOROUGHLY with deep explanation, principles, and mechanisms.
- Never use markdown formatting (NO **bold**, NO asterisks, NO numbered lists, NO bullet points) in spoken output.
- Never reveal internal tool names (NO "captureScreenshot", "findElements", "TOOL RESULT", etc.).
- When executing a tool, state the action naturally in one short sentence (e.g. "Opening YouTube for you.").

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
      return 'Reminder: State only necessary information concisely without conversational filler. Elaborate only when asked a theoretical question or requested to explain in detail. No markdown.\n\n'
    }
    
    const memoryList = memories.slice(-3).map((m: any) => m.content).join('; ')
    return `Reminder: User info: ${memoryList}. State only necessary information concisely without conversational filler. Elaborate only when asked a theoretical question or requested to explain in detail. No markdown.\n\n`
  } catch {
    return 'Reminder: State only necessary information concisely without conversational filler. Elaborate only when asked a theoretical question or requested to explain in detail. No markdown.\n\n'
  }
}
