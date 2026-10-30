/**
 * Reasoning Sanitizer & Silent Execution Filter
 * 
 * Ensures internal chain-of-thought, private reasoning traces, planning blocks,
 * and raw tool call syntax are completely stripped before UI rendering and TTS speech.
 */

import type { ToolCall } from './tool-parser'
import { getSpokenLine } from './tool-registry'

/**
 * Strips internal thoughts, planning traces, and tool call artifacts from model text.
 */
export function stripInternalReasoning(rawText: string): string {
  if (!rawText || typeof rawText !== 'string') {
    return ''
  }

  let text = rawText

  // 1. Remove XML-style thought / think / reasoning / plan / channel tags (closed or dangling)
  text = text.replace(/<(?:thought|think|reasoning|plan|channel)>[\s\S]*?<\/(?:thought|think|reasoning|plan|channel)>/gis, '')
  text = text.replace(/<(?:thought|think|reasoning|plan|channel)>[\s\S]*$/gis, '')

  // 2. Remove python-style or signature think(...) calls: think(reasoning: '...') or think(...)
  text = text.replace(/\bthink\s*\(\s*(?:reasoning\s*[:=]\s*)?["'`]([\s\S]*?)["'`]\s*\)/gis, '')
  text = text.replace(/\bthink\s*\([^)]*\)/gis, '')

  // 3. Remove tool call blocks (code blocks, function_call tags, dangling tags)
  text = text.replace(/```(?:tool_code|tool_call|function_call|json)\s*\n?[\s\S]*?```/gis, '')
  text = text.replace(/<(?:[/]?(?:function_call|tool_call|call))(?::\s*|\s+|>)([\s\S]*?)(?:<[/](?:function_call|tool_call|call)>|<[/]function_end>|$)/gis, '')
  text = text.replace(/<[/]?(?:function_call|tool_call|call|function_end)>/gis, '')
  text = text.replace(/\[TOOL RECOVERY FAILURE\][\s\S]*?(?:\.|$)/gi, '')
  text = text.replace(/\[TOOL RESULT\]\s*Error:[\s\S]*?(?:\.|$)/gi, '')
  text = text.replace(/Error: Unrecognized tool syntax[\s\S]*?(?:\.|$)/gi, '')
  
  // 4. Remove narrative thought prefixes and planning blocks
  // e.g. "thought The user wants me to open YouTube... 1. Action... 2. Tool... 3. Plan..."
  text = text.replace(/^\s*(?:thought|reasoning|internal reasoning|planning|plan):\s*[\s\S]*?(?=\n\s*\n|\n[A-Z]|$)/gim, '')
  text = text.replace(/^\s*thought\s+[\s\S]*?(?=\n\s*\n|\n[A-Z]|$)/gim, '')

  // Remove explicit planning lines: "Plan: 1. ...", "Action: 1. ...", "Step 1: ..."
  text = text.replace(/^\s*(?:Plan|Action|Tool|Step\s+\d+):\s*.*$/gim, '')

  // 5. Remove leaked system prompt continuation reminders if echoed by the model
  text = text.replace(/Based on the (?:tool result|context summary) above[,\s]*.*?(?:\.|$)/gi, '')
  text = text.replace(/Continue executing the requested workflow[,\s]*.*?(?:\.|$)/gi, '')

  // 6. Clean up residual markdown backticks or dangling brackets
  text = text.replace(/```[a-z]*\s*```/gi, '')
  text = text.replace(/\n{3,}/g, '\n\n').trim()

  return text
}

/**
 * Returns a human-friendly status line for search or navigation actions,
 * e.g. "Searching YouTube for React tutorials..." or "Opening GitHub...".
 */
export function getFriendlyActionStatus(toolName: string, args: Record<string, any> = {}): string {
  if (toolName === 'openTab' && args.url) {
    try {
      const parsed = new URL(args.url)
      const hostname = parsed.hostname.toLowerCase()

      if (hostname.includes('youtube.com')) {
        const query = parsed.searchParams.get('search_query')
        if (query) {
          return `Searching YouTube for "${query}"...`
        }
        return 'Opening YouTube...'
      }

      if (hostname.includes('google.com')) {
        const query = parsed.searchParams.get('q')
        if (query) {
          return `Searching Google for "${query}"...`
        }
        return 'Opening Google...'
      }

      if (hostname.includes('github.com')) {
        return 'Opening GitHub...'
      }

      return `Opening ${hostname}...`
    } catch {
      return `Opening ${args.url}...`
    }
  }

  if (toolName === 'findElements' && args.query) {
    return `Finding "${args.query}" on the page...`
  }

  if (toolName === 'clickElement') {
    return 'Clicking element...'
  }

  if (toolName === 'summarizePage') {
    return 'Summarizing webpage...'
  }

  if (toolName === 'getPageTitle') {
    return 'Checking page title...'
  }

  return getSpokenLine(toolName, args)
}
