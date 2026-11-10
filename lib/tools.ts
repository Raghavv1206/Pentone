// Tool execution module
export interface ToolCall {
  function: string
  arguments: Record<string, any>
}

export function detectInvalidToolFormat(content: string): string | null {
  // Only check for print() syntax - we'll handle code blocks in parseToolCall
  if (/print\s*\(/.test(content) && /get|click|fill|open/i.test(content)) {
    return 'Invalid format detected: print() syntax - must use <function_call> format'
  }
  return null
}

export function parseToolCall(content: string): ToolCall | null {
  const parse = (source: string): ToolCall | null => {
    let parsed: any
    try {
      // Parse valid JSON before attempting repair: argument text may contain braces.
      try { parsed = JSON.parse(source) } catch {
        const repaired = source.trim().replace(/"arguments"\s*:\s*\{\s*\.\.\.?\s*\}/g, '"arguments": {}')
        const stack: string[] = []
        let quoted = false, escaped = false
        for (const ch of repaired) {
          if (quoted) {
            if (escaped) escaped = false
            else if (ch === '\\') escaped = true
            else if (ch === '"') quoted = false
          } else if (ch === '"') quoted = true
          else if (ch === '{') stack.push('}')
          else if (ch === '[') stack.push(']')
          else if ((ch === '}' || ch === ']') && stack.pop() !== ch) return null
        }
        if (quoted) return null
        parsed = JSON.parse(repaired + stack.reverse().join(''))
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
      const name = parsed.function ?? parsed.tool
      const args = parsed.arguments === undefined ? {} : parsed.arguments
      if (typeof name !== 'string' || !name.trim() || !args || typeof args !== 'object' || Array.isArray(args)) return null
      return { function: name, arguments: args }
    } catch { return null }
  }
  const tagged = content.match(/<function_call>(.*?)<\/function_call>/s)
    || content.match(/```(?:tool_call|function_call)>(.*?)<\/function_call>/s)
  if (tagged) return parse(tagged[1])
  const block = content.match(/```(?:tool_code|tool_call|function_call|json)\s*\n?(.*?)```/s)
  const source = (block?.[1] ?? content).trim()
  return source.startsWith('{') ? parse(source) : null
}

export async function executeTool(toolCall: ToolCall, execution?: { runId: string; request: string; signal?: AbortSignal }): Promise<any> {
  // Detect if we're in popup or sidepanel context
  const isPopup = window.location.pathname.includes('popup.html')
  const context = isPopup ? 'popup' : 'sidepanel'
  
  if (execution?.signal?.aborted) return { success: false, error: 'Task was stopped' }
  const send = (confirmationId?: string): Promise<any> => new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: 'run_tool',
      payload: {
        toolName: toolCall.function,
        parameters: toolCall.arguments,
        context: context,
        runId: execution?.runId,
        request: execution?.request,
        confirmationId
      }
    }, (response) => {
      if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message })
      else resolve(response || { success: false, error: 'Tool returned no response' })
    })
  })
  let result = await send()
  if (result?.requiresConfirmation && !execution?.signal?.aborted) {
    if (window.confirm(result.preview)) result = await send(result.confirmationId)
    else result = { success: false, error: 'User declined the action' }
  }
  return result
}
