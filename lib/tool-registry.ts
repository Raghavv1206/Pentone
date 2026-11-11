// Tool Registry - Aggregates tool specs from individual tool modules
import { browserToolSpecs } from './browser'
import { spec as captureScreenshotSpec } from './tools/captureScreenshot'
import { spec as getPageTitleSpec } from './tools/getPageTitle'
import { spec as openTabSpec } from './tools/openTab'
import { spec as getAccessibilitySnapshotSpec } from './tools/getAccessibilitySnapshot'
import { spec as clickElementSpec } from './tools/clickElement'
import { spec as fillInputSpec } from './tools/fillInput'
import { spec as findElementsSpec } from './tools/findElements'
import { spec as listenSpec } from './tools/listen'
import { spec as writeContentSpec } from './tools/writeContent'
import { spec as storeMemorySpec } from './tools/storeMemory'
import { spec as getMemoriesSpec } from './tools/getMemories'
import { spec as translateTextSpec } from './tools/translateText'
import { spec as detectLanguageSpec } from './tools/detectLanguage'
import { spec as scrollUpSpec } from './tools/scrollUp'
import { spec as scrollDownSpec } from './tools/scrollDown'
import { spec as pressKeySpec } from './tools/pressKey'
import { spec as highlightSelectorSpec } from './tools/highlightSelector'
import { spec as highlightTextSpec } from './tools/highlightText'
import { spec as captureCurrentPageSpec } from './tools/captureCurrentPage'
import { spec as searchVaultSpec } from './tools/searchVault'
import { spec as getVaultStatsSpec } from './tools/getVaultStats'
import { spec as getPlaybookSpec } from './tools/getPlaybook'
import { spec as thinkSpec } from './tools/think'
import { spec as summarizePageSpec } from './tools/summarizePage'
import { spec as getTabsSpec } from './tools/getTabs'
import { spec as switchTabSpec } from './tools/switchTab'
import { spec as closeTabSpec } from './tools/closeTab'
import { spec as navigatePageSpec } from './tools/navigatePage'
import { spec as controlMediaSpec } from './tools/controlMedia'
import { spec as zoomPageSpec } from './tools/zoomPage'
import { spec as dismissModalSpec } from './tools/dismissModal'
import { spec as copyToClipboardSpec } from './tools/copyToClipboard'
import { spec as selectOptionSpec } from './tools/selectOption'
import { spec as autofillFormSpec } from './tools/autofillForm'
import { spec as scanPrivacyRiskSpec } from './tools/scanPrivacyRisk'
import { spec as clipToVaultSpec } from './tools/clipToVault'
import { spec as voiceSurferSpec } from './tools/voiceSurfer'
import { spec as checkPhishingRiskSpec } from './tools/checkPhishingRisk'

export interface ToolParameter {
  name: string
  type: string
  description: string
  required: boolean
}

export interface ToolSpec {
  name: string
  description: string
  parameters: ToolParameter[]
  examples: string[]
  spokenLine: string  // What AI says when executing this tool
  requiresUserGesture?: boolean  // If true, must be called from UI context
}

// Automatically aggregated from tool modules
export const TOOL_REGISTRY: ToolSpec[] = [
  ...browserToolSpecs,
  thinkSpec,
  captureScreenshotSpec,
  getPageTitleSpec,
  openTabSpec,
  getAccessibilitySnapshotSpec,
  findElementsSpec,
  clickElementSpec,
  fillInputSpec,
  listenSpec,
  writeContentSpec,
  summarizePageSpec,
  storeMemorySpec,
  getMemoriesSpec,
  translateTextSpec,
  detectLanguageSpec,
  scrollUpSpec,
  scrollDownSpec,
  pressKeySpec,
  highlightSelectorSpec,
  highlightTextSpec,
  captureCurrentPageSpec,
  searchVaultSpec,
  getVaultStatsSpec,
  getPlaybookSpec,
  getTabsSpec,
  switchTabSpec,
  closeTabSpec,
  navigatePageSpec,
  controlMediaSpec,
  zoomPageSpec,
  dismissModalSpec,
  copyToClipboardSpec,
  selectOptionSpec,
  autofillFormSpec,
  scanPrivacyRiskSpec,
  clipToVaultSpec,
  voiceSurferSpec,
  checkPhishingRiskSpec
]

// Generate formatted tool documentation for specific tools
export function generateToolDocumentation(toolNames?: string[]): string {
  const { generateToolDocumentation: genDocs } = require('./tool-docs')
  return genDocs(TOOL_REGISTRY, toolNames)
}

// Get list of tool names for quick reference
export function getToolNames(): string[] {
  return TOOL_REGISTRY.map(tool => tool.name)
}

// Validate if a tool exists
export function isValidTool(toolName: string): boolean {
  return TOOL_REGISTRY.some(tool => tool.name === toolName)
}

// Get tool spec by name
export function getToolSpec(toolName: string): ToolSpec | undefined {
  return TOOL_REGISTRY.find(tool => tool.name === toolName)
}

// Check if tool requires user gesture
export function requiresUserGesture(toolName: string): boolean {
  const spec = getToolSpec(toolName)
  return spec?.requiresUserGesture || false
}

// Get all tools that require user gesture
export function getUITools(): ToolSpec[] {
  return TOOL_REGISTRY.filter(tool => tool.requiresUserGesture)
}

// Get spoken line for a tool with parameter substitution
export function getSpokenLine(toolName: string, params?: Record<string, any>): string {
  if (toolName === 'closeTab') {
    if (params?.all) return 'Closing all tabs'
    if (params?.other) return 'Closing other tabs'
    if (params?.query) return 'Closing ' + params.query + ' tab'
    return 'Closing tab'
  }
  if (toolName === 'switchTab') {
    if (params?.query) return 'Switching to ' + params.query + ' tab'
    if (params?.index !== undefined) return 'Switching to tab ' + params.index
    return 'Switching tab'
  }
  if (toolName === 'navigatePage') {
    if (params?.action === 'back' || params?.action === 'previous') return 'Going back to the previous page'
    if (params?.action === 'forward' || params?.action === 'next') return 'Going forward to the next page'
    if (params?.action === 'reload' || params?.action === 'refresh') return 'Reloading the page'
    if (params?.action === 'home' || params?.action === 'main' || params?.action === 'homepage') return 'Going to the home page'
    if (params?.url) {
      try {
        const u = new URL(params.url.startsWith('http') ? params.url : `https://${params.url}`)
        const host = u.hostname.replace(/^www\./, '')
        const site = host.split('.')[0]
        return `Navigating to ${site.charAt(0).toUpperCase() + site.slice(1)}`
      } catch {
        return `Navigating to ${params.url}`
      }
    }
    return 'Navigating page'
  }
  if (toolName === 'clickElement') {
    if (params?.query) {
      if (params.query.includes('skip') || params.query.includes('ad')) return 'Skipping the ad'
      return 'Opening ' + params.query
    }
    if (params?.index !== undefined) return 'Clicking element ' + params.index
    return 'Clicking element'
  }
  if (toolName === 'clickSkipButton' || toolName === 'waitAndSkipAd') {
    return 'Skipping the ad'
  }
  if (toolName === 'controlMedia') {
    if (params?.action === 'skip' || params?.action === 'skipAd' || params?.action === 'skip_ad') return 'Skipping the ad'
    if (params?.action === 'pause') return 'Pausing media playback'
    if (params?.action === 'play') return 'Playing media'
    if (params?.action === 'mute') return 'Muting audio'
    if (params?.action === 'unmute') return 'Unmuting audio'
    if (params?.action === 'speed' && params?.rate) return `Setting playback speed to ${params.rate}x`
    if (params?.action === 'seek' && params?.seconds) {
      return params.seconds > 0 ? `Fast forwarding ${params.seconds} seconds` : `Rewinding ${Math.abs(params.seconds)} seconds`
    }
    if (params?.action === 'restart') return 'Restarting video'
    if (params?.action === 'fullscreen') return 'Toggling fullscreen'
    return 'Controlling media'
  }
  if (toolName === 'zoomPage') {
    if (params?.action === 'in') return 'Zooming in'
    if (params?.action === 'out') return 'Zooming out'
    if (params?.action === 'reset') return 'Resetting zoom'
    if (params?.action === 'set' && params?.factor) return `Setting zoom to ${params.factor}%`
    return 'Adjusting zoom'
  }
  if (toolName === 'dismissModal') {
    return 'Dismissing popup'
  }
  if (toolName === 'copyToClipboard') {
    if (params?.type === 'url') return 'Copying page link'
    return 'Copying to clipboard'
  }
  if (toolName === 'selectOption') {
    if (params?.query) return `Selecting ${params.query}`
    return 'Selecting option'
  }
  if (toolName === 'autofillForm') {
    return 'Autofilling form fields with your profile'
  }
  const spec = getToolSpec(toolName)
  if (!spec) {
    return toolName // fallback to tool name if spec not found
  }
  
  let spokenLine = spec.spokenLine
  
  // Replace parameters in the spoken line (e.g., {url}, {query}, {value})
  if (params) {
    Object.keys(params).forEach(key => {
      const placeholder = `{${key}}`
      if (spokenLine.includes(placeholder)) {
        // For URLs, extract just the domain
        if (key === 'url') {
          try {
            const url = new URL(params[key])
            spokenLine = spokenLine.replace(placeholder, url.hostname)
          } catch {
            spokenLine = spokenLine.replace(placeholder, params[key])
          }
        } else {
          // For other params, just replace with value
          spokenLine = spokenLine.replace(placeholder, params[key])
        }
      }
    })
  }
  
  return spokenLine
}

// Calculate Levenshtein distance between two strings
function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = []
  
  // Initialize first column and row
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j
  }
  
  // Fill in the rest of the matrix
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        )
      }
    }
  }
  
  return matrix[str2.length][str1.length]
}

// Find similar tool names using fuzzy matching
export function findSimilarTools(invalidToolName: string, maxSuggestions: number = 3): string[] {
  const toolNames = getToolNames()
  const lowerInvalid = invalidToolName.toLowerCase()
  
  // Calculate similarity scores for all tools
  const scores = toolNames.map(toolName => {
    const lowerTool = toolName.toLowerCase()
    
    // Check if invalid name is substring (high priority)
    const substringMatch = lowerTool.includes(lowerInvalid) || lowerInvalid.includes(lowerTool)
    
    // Calculate Levenshtein distance
    const distance = levenshteinDistance(lowerInvalid, lowerTool)
    
    // Calculate similarity score (lower is better)
    // Substring matches get bonus
    const score = substringMatch ? distance - 100 : distance
    
    return { toolName, score }
  })
  
  // Sort by score (ascending) and return top matches
  return scores
    .sort((a, b) => a.score - b.score)
    .slice(0, maxSuggestions)
    .filter(item => item.score < lowerInvalid.length * 1.5) // Only suggest if reasonably similar
    .map(item => item.toolName)
}

export function validateToolArguments(name: string, args: unknown): string | null {
  const spec = getToolSpec(name)
  if (!spec) return 'Unknown tool'
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'Tool arguments must be an object'
  for (const param of spec.parameters) {
    const value = (args as Record<string, unknown>)[param.name]
    if (value === undefined) { if (param.required) return `Missing parameter: ${param.name}`; continue }
    const kinds = param.type.split('|').map(type => type.trim())
    const valid = kinds.some(kind => kind === 'string[]' ? Array.isArray(value) && value.every(v => typeof v === 'string')
      : kind === 'number' ? typeof value === 'number' && Number.isFinite(value)
      : kind === 'object' ? !!value && typeof value === 'object' && !Array.isArray(value)
      : typeof value === kind)
    if (!valid) return `Invalid parameter type: ${param.name}`
  }
  return null
}
