// Tool documentation utilities (separated to avoid circular dependencies)

// Tool call format syntax (shared across system prompt and playbooks)
export const TOOL_FORMAT = `## Tool Calling Format
To take action, navigate, or search, ALWAYS emit:
<function_call>{"function": "toolName", "arguments": {...}}</function_call>

Examples:
- User: "open youtube and search for best react tutorials"
  Assistant: <function_call>{"function": "openTab", "arguments": {"url": "https://www.youtube.com/results?search_query=best+react+tutorials"}}</function_call>
- User: "open youtube"
  Assistant: <function_call>{"function": "openTab", "arguments": {"url": "https://www.youtube.com"}}</function_call>
- User: "search weather in tokyo on google"
  Assistant: <function_call>{"function": "openTab", "arguments": {"url": "https://www.google.com/search?q=weather+in+tokyo"}}</function_call>
- User: "what is on this page?"
  Assistant: <function_call>{"function": "captureScreenshot", "arguments": {}}</function_call>`

// Generate compact formatted tool documentation for specific tools
export function generateToolDocumentation(toolRegistry: any[], toolNames?: string[]): string {
  const tools = toolNames 
    ? toolRegistry.filter(tool => toolNames.includes(tool.name))
    : toolRegistry

  return tools.map(tool => {
    const params = tool.parameters && tool.parameters.length > 0
      ? tool.parameters.map((p: any) => `${p.name}${p.required ? '' : '?'}: ${p.type}`).join(', ')
      : ''
    return `- \`${tool.name}(${params})\`: ${tool.description}`
  }).join('\n')
}
