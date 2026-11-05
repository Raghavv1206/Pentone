// Core tools that are always available in the system prompt
// Automatically includes all registered tool capabilities for full agent command coverage

export const CORE_TOOLS = [
  'think',
  'captureScreenshot',
  'openTab',
  'findElements',
  'clickElement',
  'fillInput',
  'getTabs',
  'switchTab',
  'closeTab',
  'listen',
  'pressKey',
  'getAccessibilitySnapshot',
  'storeMemory',
  'getMemories',
  'translateText',
  'detectLanguage',
  'searchVault',
  'getVaultStats',
  'getPlaybook',
  'summarizePage',
  'highlightText',
  'highlightSelector',
  'scrollUp',
  'scrollDown',
  'getPageTitle',
  'writeContent',
  'captureCurrentPage'
]
