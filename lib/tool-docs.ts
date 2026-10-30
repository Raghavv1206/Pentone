// Tool documentation utilities (separated to avoid circular dependencies)

// Tool call format syntax (shared across system prompt and playbooks)
export const TOOL_FORMAT = `## Tool Call Format
Use: <function_call>{"function": "toolName", "arguments": {...}}</function_call>
Examples:
<function_call>{"function": "openTab", "arguments": {"url": "https://www.youtube.com"}}</function_call>
<function_call>{"function": "getPageTitle", "arguments": {}}</function_call>
<function_call>{"function": "captureScreenshot", "arguments": {}}</function_call>
<function_call>{"function": "summarizePage", "arguments": {"length": "medium"}}</function_call>`

// Generate compact tool documentation for system prompt (< 700 tokens)
export function generateToolDocumentation(toolRegistry: any[], toolNames?: string[]): string {
  const tools = toolNames 
    ? toolRegistry.filter(tool => toolNames.includes(tool.name))
    : toolRegistry
  
  return tools.map(tool => {
    const params = tool.parameters && tool.parameters.length > 0
      ? tool.parameters.map((p: any) => {
          let typeStr = p.type
          if (p.name === 'length' && tool.name === 'summarizePage') {
            typeStr = '"short" | "medium" | "long"'
          } else if (p.name === 'type' && tool.name === 'summarizePage') {
            typeStr = '"key-points" | "tl;dr" | "teaser" | "headline"'
          }
          return `${p.name}${p.required ? '' : '?'}: ${typeStr}`
        }).join(', ')
      : ''
    // Use the primary summary sentence of each tool to minimize token usage
    const summary = tool.description ? tool.description.split('.')[0] : ''
    return `- ${tool.name}(${params}): ${summary}`
  }).join('\n')
}
