/**
 * High-Resilience Tool Call Parser and Schema Validator
 * 
 * Production-ready parsing pipeline for on-device LLMs (Chrome Built-in AI / Gemma 4).
 * Supports standard JSON, Gemma 4 loose comma syntax, Pythonic signatures,
 * tag variants (</function_call>, </function_end>), unclosed tags, and schema validation.
 */

import { isValidTool, getToolSpec } from './tool-registry'
import type { ToolSpec } from './tool-types'
import { validateAndSanitizeUrl, type UrlValidationResult } from './url-validator'

export { validateAndSanitizeUrl, type UrlValidationResult }

export interface ToolCall {
  function: string
  arguments: Record<string, any>
}

export interface ParseResult {
  success: boolean
  toolCall?: ToolCall
  error?: string
  rawExtracted?: string
}

/**
 * Validates a parsed tool call against the TOOL_REGISTRY allowlist and parameter schema.
 */
export function validateToolCallSchema(name: string, rawArgs: any): { valid: boolean; toolCall?: ToolCall; error?: string } {
  if (!name || typeof name !== 'string') {
    return { valid: false, error: 'Tool name must be a non-empty string' }
  }

  const trimmedName = name.trim()

  if (!isValidTool(trimmedName)) {
    return { valid: false, error: `Tool "${trimmedName}" is not registered in the tool allowlist` }
  }

  const spec: ToolSpec | undefined = getToolSpec(trimmedName)
  if (!spec) {
    return { valid: false, error: `Spec definition missing for tool "${trimmedName}"` }
  }

  const sanitizedArgs: Record<string, any> = {}
  const argsObj = (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) ? rawArgs : {}

  const allowedParamNames = new Set(spec.parameters.map(p => p.name))
  for (const key of Object.keys(argsObj)) {
    if (!allowedParamNames.has(key)) {
      return { 
        valid: false, 
        error: `Unexpected parameter "${key}" for tool "${trimmedName}". Allowed parameters: ${Array.from(allowedParamNames).join(', ') || 'none'}` 
      }
    }
  }

  for (const param of spec.parameters) {
    const val = argsObj[param.name]

    if (val === undefined || val === null || val === '') {
      if (param.required) {
        return { valid: false, error: `Missing required parameter "${param.name}" for tool "${trimmedName}"` }
      }
      continue
    }

    if (param.type === 'number') {
      const num = typeof val === 'number' ? val : Number(val)
      if (isNaN(num)) {
        return { valid: false, error: `Parameter "${param.name}" for tool "${trimmedName}" must be a number` }
      }
      sanitizedArgs[param.name] = num
    } else if (param.type === 'string') {
      sanitizedArgs[param.name] = String(val)
    } else if (param.type === 'boolean') {
      sanitizedArgs[param.name] = Boolean(val)
    } else {
      sanitizedArgs[param.name] = val
    }
  }

  // Security enforcement: openTab must pass URL validation
  if (trimmedName === 'openTab' && sanitizedArgs.url) {
    const urlValidation = validateAndSanitizeUrl(sanitizedArgs.url)
    if (!urlValidation.valid || !urlValidation.url) {
      return { valid: false, error: urlValidation.error || 'URL validation failed' }
    }
    sanitizedArgs.url = urlValidation.url
  }

  // Security enforcement: element indices must be non-negative integers
  if ((trimmedName === 'clickElement' || trimmedName === 'fillInput') && sanitizedArgs.index !== undefined) {
    const idx = Number(sanitizedArgs.index)
    if (!Number.isInteger(idx) || idx < 0) {
      return { valid: false, error: `Invalid element index: ${sanitizedArgs.index}. Must be a non-negative integer.` }
    }
    sanitizedArgs.index = idx
  }

  // Schema enforcement: captureScreenshot type normalization
  if (trimmedName === 'captureScreenshot') {
    if (sanitizedArgs.type !== undefined) {
      const rawType = String(sanitizedArgs.type).toLowerCase().trim()
      if (['viewport', 'fullpage', 'full_page', 'full-page'].includes(rawType)) {
        sanitizedArgs.type = rawType.includes('full') ? 'fullPage' : 'viewport'
      } else {
        return { valid: false, error: `Invalid type parameter "${sanitizedArgs.type}" for captureScreenshot. Allowed values: "viewport", "fullPage"` }
      }
    } else {
      sanitizedArgs.type = 'viewport'
    }
  }

  // Schema enforcement: summarizePage allowed enums & normalization
  if (trimmedName === 'summarizePage') {
    if (sanitizedArgs.length !== undefined) {
      const rawLen = String(sanitizedArgs.length).toLowerCase().trim()
      if (['short', 'medium', 'long'].includes(rawLen)) {
        sanitizedArgs.length = rawLen
      } else if (rawLen === 'short_medium') {
        sanitizedArgs.length = 'medium'
      } else {
        return { valid: false, error: `Invalid length parameter "${sanitizedArgs.length}" for summarizePage. Allowed values: "short", "medium", "long"` }
      }
    }
    if (sanitizedArgs.type !== undefined) {
      const rawType = String(sanitizedArgs.type).toLowerCase().trim()
      if (['key-points', 'tl;dr', 'teaser', 'headline'].includes(rawType)) {
        sanitizedArgs.type = rawType
      } else {
        return { valid: false, error: `Invalid type parameter "${sanitizedArgs.type}" for summarizePage. Allowed values: "key-points", "tl;dr", "teaser", "headline"` }
      }
    }
  }

  return {
    valid: true,
    toolCall: {
      function: trimmedName,
      arguments: sanitizedArgs
    }
  }
}

/**
 * Normalizes and parses JSON string, recovering from common on-device model syntax errors.
 */
function tryParseRepairedJSON(rawJson: string): any {
  let s = rawJson.trim()

  // Replace common empty-argument placeholders: {...} or { ... } -> {}
  s = s.replace(/"arguments"\s*:\s*\{\s*\.\.\.?\s*\}/g, '"arguments": {}')
  s = s.replace(/"arguments"\s*:\s*\{\.\.\.?\}/g, '"arguments": {}')

  // Normalize key names
  s = s.replace(/["']?tool["']?\s*:/g, '"function":')
  s = s.replace(/["']?func["']?\s*:/g, '"function":')
  s = s.replace(/["']?name["']?\s*:\s*(["'][a-zA-Z0-9_]+["'])/g, '"function": $1')
  s = s.replace(/["']?args["']?\s*:/g, '"arguments":')
  s = s.replace(/["']?parameters["']?\s*:/g, '"arguments":')

  // Fix unquoted keys: {function: "openTab"} -> {"function": "openTab"}
  s = s.replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":')

  // Replace single quotes around strings: 'value' -> "value"
  s = s.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"')

  // Remove trailing commas before closing braces/brackets
  s = s.replace(/,\s*([}\]])/g, '$1')

  // Fix missing closing braces if model was truncated
  const openBraces = (s.match(/\{/g) || []).length
  const closeBraces = (s.match(/\}/g) || []).length
  if (openBraces > closeBraces) {
    s += '}'.repeat(openBraces - closeBraces)
  }

  return JSON.parse(s)
}

/**
 * Parses loose, non-JSON formats produced by Gemma 4 / Gemini Nano.
 */
function parseLooseGemmaOutput(raw: string): ToolCall | null {
  const s = raw.trim()

  // Format 1: toolName,arguments: "open"https://www.youtube.com"
  // Format 2: toolName,arguments: "https://www.youtube.com"
  // Format 3: toolName,arguments: {"url": "https://..."}
  const commaPattern = /^([a-zA-Z0-9_]+)\s*,\s*arguments\s*[:=]\s*(.*)$/is
  const commaMatch = s.match(commaPattern)
  if (commaMatch) {
    const fn = commaMatch[1].trim()
    const argsPart = commaMatch[2].trim()

    // Try parsing argsPart as JSON
    try {
      const parsed = JSON.parse(argsPart)
      if (typeof parsed === 'object' && parsed !== null) {
        return { function: fn, arguments: parsed }
      }
    } catch {}

    // Tool-specific loose extraction
    if (fn === 'captureScreenshot') {
      const typeMatch = argsPart.match(/(?:type\s*[:=]\s*["']?)(viewport|fullPage|full_page|full-page)["']?/i)
      const type = typeMatch ? (typeMatch[1].toLowerCase().includes('full') ? 'fullPage' : 'viewport') : 'viewport'
      return { function: fn, arguments: { type } }
    }

    if (fn === 'openTab') {
      const urlMatch = argsPart.match(/https?:\/\/[^\s"'>]+/i)
      if (urlMatch) {
        return { function: fn, arguments: { url: urlMatch[0] } }
      }
    }

    if (fn === 'clickElement') {
      const indexMatch = argsPart.match(/(?:index\s*[:=]\s*|\b)(\d+)\b/i)
      if (indexMatch) {
        return { function: fn, arguments: { index: parseInt(indexMatch[1], 10) } }
      }
    }

    if (fn === 'fillInput') {
      const indexMatch = argsPart.match(/index\s*[:=]\s*(\d+)/i) || argsPart.match(/\b(\d+)\b/)
      const valMatch = argsPart.match(/value\s*[:=]\s*["']([^"']+)["']/i) || argsPart.match(/["']([^"']+)["']/)
      if (indexMatch && valMatch) {
        return {
          function: fn,
          arguments: {
            index: parseInt(indexMatch[1], 10),
            value: valMatch[1]
          }
        }
      }
    }

    if (fn === 'findElements' || fn === 'searchVault') {
      const queryMatch = argsPart.match(/query\s*[:=]\s*["']?([^"']+)["']?/i) || argsPart.match(/["']([^"']+)["']/)
      let q = queryMatch ? queryMatch[1].trim() : ''
      if (/\s+or\s+/i.test(q)) {
        q = q.split(/\s+or\s+/i)[0].replace(/^["']|["']$/g, '').trim()
      }
      return { function: fn, arguments: { query: q } }
    }

    if (fn === 'think') {
      const thought = argsPart.replace(/^["']|["']$/g, '').trim()
      return { function: fn, arguments: { thought } }
    }

    return { function: fn, arguments: {} }
  }

  // Format 4: Python-style function call: openTab(url="https://...") or captureScreenshot()
  const pyPattern = /^([a-zA-Z0-9_]+)\s*\((.*?)\)$/s
  const pyMatch = s.match(pyPattern)
  if (pyMatch) {
    const fn = pyMatch[1].trim()
    const inner = pyMatch[2].trim()

    if (!inner) {
      return { function: fn, arguments: {} }
    }

    if (fn === 'captureScreenshot') {
      const typeMatch = inner.match(/(?:type\s*[:=]\s*["']?)(viewport|fullPage|full_page|full-page)["']?/i)
      const type = typeMatch ? (typeMatch[1].toLowerCase().includes('full') ? 'fullPage' : 'viewport') : 'viewport'
      return { function: fn, arguments: { type } }
    }

    if (fn === 'openTab') {
      const urlMatch = inner.match(/https?:\/\/[^\s"'>)]+/i)
      if (urlMatch) {
        return { function: fn, arguments: { url: urlMatch[0] } }
      }
    }

    if (fn === 'clickElement') {
      const numMatch = inner.match(/\d+/)
      if (numMatch) {
        return { function: fn, arguments: { index: parseInt(numMatch[0], 10) } }
      }
    }

    if (fn === 'findElements' || fn === 'searchVault') {
      const qMatch = inner.match(/query\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|([^,)]+))/i) ||
                     inner.match(/["']([^"']+)["']/)
      if (qMatch) {
        let q = (qMatch[1] ?? qMatch[2] ?? qMatch[3] ?? '').trim()
        if (/\s+or\s+/i.test(q)) {
          q = q.split(/\s+or\s+/i)[0].replace(/^["']|["']$/g, '').trim()
        }
        return { function: fn, arguments: { query: q } }
      }
    }

    if (fn === 'fillInput') {
      const indexMatch = inner.match(/index\s*[:=]\s*(\d+)/i) || inner.match(/\b(\d+)\b/)
      const valMatch = inner.match(/value\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|([^,)]+))/i) || inner.match(/["']([^"']+)["']/)
      if (indexMatch && valMatch) {
        return {
          function: fn,
          arguments: {
            index: parseInt(indexMatch[1], 10),
            value: (valMatch[1] ?? valMatch[2] ?? valMatch[3] ?? '').trim()
          }
        }
      }
    }

    if (fn === 'think') {
      const thoughtMatch = inner.match(/(?:reasoning|thought)\s*[:=]\s*["']?([^"']+)["']?/i) || inner.match(/["']([^"']+)["']/)
      return { function: fn, arguments: { reasoning: thoughtMatch ? thoughtMatch[1].trim() : inner } }
    }

    // Attempt key=value or key:value parsing
    const kwargs: Record<string, any> = {}
    const pairs = inner.matchAll(/([a-zA-Z0-9_]+)\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|([^,)]+))/g)
    for (const p of pairs) {
      const key = p[1]
      let val = (p[2] ?? p[3] ?? p[4])?.trim()
      if (val && /\s+or\s+/i.test(val)) {
        val = val.split(/\s+or\s+/i)[0].replace(/^["']|["']$/g, '').trim()
      }
      kwargs[key] = val
    }
    if (Object.keys(kwargs).length > 0) {
      return { function: fn, arguments: kwargs }
    }
  }

  // Format 4b: Abutting-brace function call: toolName{key:val} or toolName{"key":"val"}
  const bracePattern = /^([a-zA-Z0-9_]+)\s*\{([^}]*)\}$/s
  const braceMatch = s.match(bracePattern)
  if (braceMatch && isValidTool(braceMatch[1])) {
    const fn = braceMatch[1].trim()
    const inner = braceMatch[2].trim()

    if (!inner) {
      return { function: fn, arguments: {} }
    }

    // Try parsing as repaired JSON object: "{" + inner + "}"
    try {
      const parsed = tryParseRepairedJSON('{' + inner + '}')
      if (typeof parsed === 'object' && parsed !== null) {
        return { function: fn, arguments: parsed }
      }
    } catch {}

    // Fallback key:value / key=value parsing
    const kwargs: Record<string, any> = {}
    const pairs = inner.matchAll(/([a-zA-Z0-9_]+)\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|([^,;}\s]+))/g)
    for (const p of pairs) {
      const key = p[1]
      const val = p[2] ?? p[3] ?? p[4]
      kwargs[key] = val?.trim()
    }
    if (Object.keys(kwargs).length > 0) {
      return { function: fn, arguments: kwargs }
    }
    return { function: fn, arguments: {} }
  }

  // Format 4c: Tool name with unexpected characters/delimiters followed by JSON object:
  // e.g. openTab有一些>{"url": "https://..."} or openTab: {"url": "..."}
  const prefixPattern = /^([a-zA-Z0-9_]+)[\s\S]*?(\{[\s\S]*\})$/s
  const prefixMatch = s.match(prefixPattern)
  if (prefixMatch && isValidTool(prefixMatch[1])) {
    const fn = prefixMatch[1].trim()
    const jsonPart = prefixMatch[2].trim()
    try {
      const parsed = JSON.parse(jsonPart)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return { function: fn, arguments: parsed }
      }
    } catch {
      try {
        const repaired = tryParseRepairedJSON(jsonPart)
        if (typeof repaired === 'object' && repaired !== null && !Array.isArray(repaired)) {
          return { function: fn, arguments: repaired }
        }
      } catch {}
    }
  }

  // Format 5: Standalone parameterless tool name inside candidate block (e.g. "captureScreenshot", "summarizePage")
  const PARAMETERLESS_TOOLS = new Set([
    'captureScreenshot',
    'getPageTitle',
    'summarizePage',
    'getTabs',
    'getVaultStats',
    'getAccessibilitySnapshot',
    'listen'
  ])
  if (PARAMETERLESS_TOOLS.has(s)) {
    return { function: s, arguments: {} }
  }

  return null
}

/**
 * Extracts candidate tool call segments from the LLM output.
 */
function extractToolCallCandidates(content: string): string[] {
  const candidates: string[] = []

  // 1. Tag formats: <function_call>...</function_call>, <function_call:...>, <tool_call>...
  const tagRegex = /<(?:[/]?(?:function_call|tool_call|call))(?::\s*|\s+|>)([\s\S]*?)(?:<[/](?:function_call|tool_call|call)>|<[/]function_end>|$)/gis
  let match: RegExpExecArray | null
  while ((match = tagRegex.exec(content)) !== null) {
    if (match[1] && match[1].trim()) {
      let cand = match[1].trim()
      cand = cand.replace(/\s*\/?\s*>$/, '').trim()
      if (cand) candidates.push(cand)
    }
  }

  // 2. Code block formats: ```tool_code ... ``` or ```json ... ```
  const codeBlockRegex = /```(?:tool_code|tool_call|function_call|json)\s*\n?([\s\S]*?)```/gis
  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match[1] && match[1].trim()) {
      candidates.push(match[1].trim())
    }
  }

  // 3. Balanced JSON blocks containing function, tool, or name
  let depth = 0
  let start = -1
  let inString = false
  let escape = false
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      if (depth > 0) {
        depth--
        if (depth === 0 && start !== -1) {
          const candidate = content.slice(start, i + 1)
          if (/["'](?:function|tool|name)["']\s*:/i.test(candidate)) {
            candidates.push(candidate.trim())
          }
          start = -1
        }
      }
    }
  }
  if (depth > 0 && start !== -1) {
    const candidate = content.slice(start)
    if (/["'](?:function|tool|name)["']\s*:/i.test(candidate)) {
      candidates.push(candidate.trim())
    }
  }

  // 4. Malformed backtick prefix: ```tool_call>... or ```function_call>...
  const malformedRegex = /```(?:tool_call|function_call)>(.*?)(?:<\/function_call>|<\/function_end>|```|$)/gis
  while ((match = malformedRegex.exec(content)) !== null) {
    if (match[1] && match[1].trim()) {
      candidates.push(match[1].trim())
    }
  }

  // 5. Naked allowed tool signatures: openTab(...), captureScreenshot{...}, etc.
  const knownTools = [
    'openTab', 'closeTab', 'switchTab', 'captureScreenshot', 'captureAudio', 
    'listen', 'clickElement', 'fillInput', 'scrollDown', 'scrollUp', 
    'getPageTitle', 'findElements', 'summarizePage', 'searchVault', 
    'storeMemory', 'getTabs', 'getVaultStats', 'getAccessibilitySnapshot', 'think'
  ]
  const nakedToolRegex = new RegExp(`\\b(${knownTools.join('|')})\\s*(?:\\{[^{}]*\\}|\\([^\\(\\)]*\\))`, 'g')
  while ((match = nakedToolRegex.exec(content)) !== null) {
    if (match[0] && match[0].trim()) {
      candidates.push(match[0].trim())
    }
  }

  return Array.from(new Set(candidates))
}

/**
 * Main entry point: Parses and validates the first valid tool call from model output.
 */
export function parseToolCallDetailed(content: string): ParseResult {
  if (!content || typeof content !== 'string') {
    return { success: false, error: 'Content is empty or not a string' }
  }

  const candidates = extractToolCallCandidates(content)

  if (candidates.length === 0) {
    return { success: false, error: 'No tool call patterns detected in content' }
  }

  let lastError: string | undefined
  for (const rawCandidate of candidates) {
    // 1. Try strict JSON parse first
    try {
      const parsed = JSON.parse(rawCandidate)
      if (typeof parsed === 'object' && parsed !== null) {
        const fnName = parsed.function || parsed.tool || parsed.name
        const fnArgs = parsed.arguments || parsed.args || parsed.parameters || {}
        if (fnName) {
          const validated = validateToolCallSchema(fnName, fnArgs)
          if (validated.valid && validated.toolCall) {
            return { success: true, toolCall: validated.toolCall, rawExtracted: rawCandidate }
          } else if (validated.error) {
            lastError = validated.error
          }
        }
      }
    } catch {}

    // 2. Try repaired JSON parse
    try {
      const repaired = tryParseRepairedJSON(rawCandidate)
      if (typeof repaired === 'object' && repaired !== null) {
        const fnName = repaired.function || repaired.tool || repaired.name
        const fnArgs = repaired.arguments || repaired.args || repaired.parameters || {}
        if (fnName) {
          const validated = validateToolCallSchema(fnName, fnArgs)
          if (validated.valid && validated.toolCall) {
            return { success: true, toolCall: validated.toolCall, rawExtracted: rawCandidate }
          }
        }
      }
    } catch {}

    // 3. Try loose Gemma 4 / Gemini Nano parse
    const loose = parseLooseGemmaOutput(rawCandidate)
    if (loose) {
      const validated = validateToolCallSchema(loose.function, loose.arguments)
      if (validated.valid && validated.toolCall) {
        return { success: true, toolCall: validated.toolCall, rawExtracted: rawCandidate }
      } else if (validated.error) {
        lastError = validated.error
      }
    }
  }

  return {
    success: false,
    error: lastError || `Failed to extract valid tool call from ${candidates.length} candidate(s)`,
    rawExtracted: candidates[0]
  }
}

/**
 * Backwards-compatible parser matching existing interface.
 */
export function parseToolCall(content: string): ToolCall | null {
  const result = parseToolCallDetailed(content)
  if (result.success && result.toolCall) {
    console.log('[ToolParser] Successfully parsed and validated tool call:', result.toolCall.function)
    return result.toolCall
  }

  if (content.includes('<function_call>') || content.includes('</function_end>')) {
    console.warn('[ToolParser] Tool call tags were present but validation rejected call:', result.error)
  }

  return null
}
