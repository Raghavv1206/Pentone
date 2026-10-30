/**
 * Structured Active-Task State Architecture
 * 
 * Maintains explicit task continuity, objectives, pending steps, and browser state
 * across multi-step execution, tool calls, and context compactions.
 */

export interface TaskStep {
  id: string
  action: string
  description: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
  result?: any
}

export interface ActiveTaskState {
  id: string
  originalRequest: string
  currentObjective: string
  currentStepIndex: number
  steps: TaskStep[]
  completedActions: string[]
  pendingActions: string[]
  cancelledActions?: string[]
  isInterrupted?: boolean
  activeTabId?: number
  activeTabUrl?: string
  extractedData: Record<string, any>
  recoveryAttempts: number
  status: 'idle' | 'in_progress' | 'completed' | 'failed' | 'needs_clarification' | 'cancelled'
  clarificationPrompt?: string
  createdAt: number
  updatedAt: number
}

/**
 * Marks active and pending steps of a task as cancelled while preserving
 * completed actions and extracted data for continuity.
 */
export function interruptActiveTask(task: ActiveTaskState): ActiveTaskState {
  const updatedSteps: TaskStep[] = task.steps.map(step => {
    if (step.status === 'in_progress' || step.status === 'pending') {
      return { ...step, status: 'cancelled' }
    }
    return step
  })

  const newlyCancelled = [...task.pendingActions]
  const allCancelled = [...(task.cancelledActions || []), ...newlyCancelled]

  return {
    ...task,
    steps: updatedSteps,
    cancelledActions: allCancelled,
    pendingActions: [],
    isInterrupted: true,
    status: 'cancelled',
    updatedAt: Date.now()
  }
}

/**
 * Evaluates whether a new user instruction relates to or replaces a previously interrupted task.
 * Guarantees that standalone, unrelated questions (e.g. trivia, math, general chat) never inherit
 * stale browser task context or continuity constraints.
 */
export function isContinuityOrReplacementInstruction(
  userInput: string,
  previousTask?: ActiveTaskState | null
): boolean {
  if (!previousTask) return false

  // Completed or idle tasks (that were not interrupted) must NEVER contaminate subsequent instructions
  if (!previousTask.isInterrupted && (previousTask.status === 'completed' || previousTask.status === 'idle')) {
    return false
  }

  // If previous task has zero completed actions and zero open tabs, there is nothing to preserve
  if ((!previousTask.completedActions || previousTask.completedActions.length === 0) && !previousTask.activeTabUrl) {
    return false
  }

  const text = (userInput || '').trim().toLowerCase()
  if (!text) return false

  // 1. Explicit replacement / continuity linguistic markers
  const replacementMarkers = [
    'instead',
    'rather',
    'actually',
    'change that to',
    'change to',
    'switch to',
    'stop and',
    'search for',
    'now search',
    'now open',
    'now find',
    'now go to',
    'continue',
    'next step',
    'also find',
    'then find',
    'click',
    'scroll'
  ]
  const hasReplacementMarker = replacementMarkers.some(marker => text.includes(marker))

  // 2. Standalone trivia, definitions, math, or conversational queries without replacement markers
  const isStandaloneFactualOrTrivia = /^(?:what\s+(?:is|are|was|were)|who\s+(?:is|was|are)|why\s+(?:is|are|do|does)|how\s+many|calculate|tell\s+me\s+a\s+joke|weather\s+in|time\s+in|define)\b/i.test(text)
  if (isStandaloneFactualOrTrivia && !text.includes('instead') && !text.includes('rather')) {
    return false
  }

  // 3. If it has explicit replacement markers or is an action-oriented replacement
  if (hasReplacementMarker) {
    return true
  }

  // 4. If previous task was interrupted and the new input starts with a browser action verb
  if (previousTask.isInterrupted) {
    const isBrowserAction = /^(?:search|find|open|go\s+to|navigate|look\s+for)\b/i.test(text)
    if (isBrowserAction) {
      return true
    }
  }

  return false
}

/**
 * Decomposes a user input into structured steps for an active task.
 * Inherits completed actions and context only when the new instruction genuinely replaces or continues a task.
 */
export function createActiveTask(userInput: string, previousTask?: ActiveTaskState | null): ActiveTaskState {
  const trimmed = (userInput || '').trim()
  const taskId = 'task_' + Date.now()
  const now = Date.now()

  // Only inherit context if the instruction is a genuine replacement or continuation
  const shouldInherit = isContinuityOrReplacementInstruction(userInput, previousTask)
  const inheritedCompletedActions = (shouldInherit && previousTask?.completedActions) ? [...previousTask.completedActions] : []
  const inheritedTabId = shouldInherit ? previousTask?.activeTabId : undefined
  const inheritedTabUrl = shouldInherit ? previousTask?.activeTabUrl : undefined
  const inheritedExtractedData = (shouldInherit && previousTask?.extractedData) ? { ...previousTask.extractedData } : {}

  // Detect compound YouTube search & extraction tasks:
  // e.g. "Open YouTube search for the best React tutorials, identify the first three visible video results and summarize their titles"
  const ytCompoundMatch = trimmed.match(
    /^(?:open\s+youtube\s+(?:and\s+)?search\s+(?:for\s+)?|search\s+youtube\s+for\s+)(.+?)(?:,\s*|\s+(?:and\s+then|then)\s+)(?:identify|find|get|list|look\s+for)\s+(?:the\s+)?(?:first\s+)?(?:three|3|\d+)?\s*(?:visible\s+)?(?:video\s+)?results\s+(?:and\s+summarize|summarize)\s*(?:their\s+)?titles?/i
  )

  if (ytCompoundMatch) {
    const rawQuery = ytCompoundMatch[1].trim().replace(/[,.!?]+$/, '')
    const steps: TaskStep[] = [
      {
        id: `${taskId}_1`,
        action: 'openTab',
        description: `Search YouTube for "${rawQuery}"`,
        status: 'pending'
      },
      {
        id: `${taskId}_2`,
        action: 'findElements',
        description: 'Inspect YouTube search page to identify visible video titles',
        status: 'pending'
      },
      {
        id: `${taskId}_3`,
        action: 'summarizeTitles',
        description: 'Extract the first three visible video titles and summarize them for the user',
        status: 'pending'
      }
    ]

    return {
      id: taskId,
      originalRequest: trimmed,
      currentObjective: `Search YouTube for "${rawQuery}", identify the first three video results, and summarize their titles.`,
      currentStepIndex: 0,
      steps,
      completedActions: inheritedCompletedActions,
      pendingActions: ['openTab', 'findElements', 'summarizeTitles'],
      activeTabId: inheritedTabId,
      activeTabUrl: inheritedTabUrl,
      extractedData: { ...inheritedExtractedData, targetQuery: rawQuery },
      recoveryAttempts: 0,
      status: 'in_progress',
      createdAt: now,
      updatedAt: now
    }
  }

  // Default single-step or general task
  const defaultSteps: TaskStep[] = [
    {
      id: `${taskId}_1`,
      action: 'process',
      description: trimmed,
      status: 'in_progress'
    }
  ]

  return {
    id: taskId,
    originalRequest: trimmed,
    currentObjective: trimmed,
    currentStepIndex: 0,
    steps: defaultSteps,
    completedActions: inheritedCompletedActions,
    pendingActions: ['process'],
    activeTabId: inheritedTabId,
    activeTabUrl: inheritedTabUrl,
    extractedData: inheritedExtractedData,
    recoveryAttempts: 0,
    status: 'in_progress',
    createdAt: now,
    updatedAt: now
  }
}

/**
 * Advances the active task to the next step upon successful action execution.
 */
export function advanceActiveTask(
  task: ActiveTaskState,
  actionName: string,
  result?: any
): ActiveTaskState {
  const updatedSteps = [...task.steps]
  const currentStep = updatedSteps[task.currentStepIndex]

  if (currentStep) {
    currentStep.status = 'completed'
    currentStep.result = result
  }

  const completedActions = [...task.completedActions, actionName]
  const pendingActions = task.pendingActions.filter((a, idx) => idx !== 0)
  const nextStepIndex = task.currentStepIndex + 1
  const isFinished = nextStepIndex >= updatedSteps.length

  if (!isFinished && updatedSteps[nextStepIndex]) {
    updatedSteps[nextStepIndex].status = 'in_progress'
  }

  return {
    ...task,
    steps: updatedSteps,
    currentStepIndex: nextStepIndex,
    completedActions,
    pendingActions,
    status: task.isInterrupted ? 'cancelled' : (isFinished ? 'completed' : 'in_progress'),
    updatedAt: Date.now()
  }
}

/**
 * Records intermediate extracted data (such as video titles) into the task state.
 */
export function recordTaskData(
  task: ActiveTaskState,
  key: string,
  value: any
): ActiveTaskState {
  return {
    ...task,
    extractedData: {
      ...task.extractedData,
      [key]: value
    },
    updatedAt: Date.now()
  }
}

/**
 * Formats the active task state into a clear, unambiguous context block for model prompts.
 */
export function formatTaskStateForPrompt(task: ActiveTaskState | null): string {
  if (!task || task.status === 'idle') return ''

  const completedList = task.completedActions.length > 0 
    ? task.completedActions.map(a => `  - Completed: ${a}`).join('\n')
    : '  - None yet'

  const pendingList = task.pendingActions.length > 0
    ? task.pendingActions.map(a => `  - Pending: ${a}`).join('\n')
    : '  - Conclude task with final response'

  let extractedInfo = ''
  if (Object.keys(task.extractedData).length > 0) {
    extractedInfo = `\nExtracted Information:\n` + 
      Object.entries(task.extractedData)
        .map(([k, v]) => `  - ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join('\n')
  }

  let continuityNote = ''
  if (task.completedActions.length > 0) {
    continuityNote = `\n[CONTINUITY NOTE: The browser actions listed under Completed above were already executed successfully. DO NOT repeat or re-execute them. Proceed directly with the current browser state.]`
  }

  return (
    `## Active Task Plan (CRITICAL: Do Not Abandon Unfinished Steps)\n` +
    `Original User Request: "${task.originalRequest}"\n` +
    `Current Objective: ${task.currentObjective}\n` +
    `Current Execution Step: Step ${task.currentStepIndex + 1} of ${task.steps.length}\n` +
    `Action Progress:\n${completedList}\n${pendingList}` +
    continuityNote +
    extractedInfo +
    `\n\nRule: You MUST complete all pending actions. Never ask the user what to do next while pending steps remain.`
  )
}

/**
 * Formats the active task state for conversation compaction/summarization.
 */
export function formatTaskStateForSummary(task: ActiveTaskState | null): string {
  if (!task || task.status === 'idle' || task.status === 'completed') return ''

  return (
    `[ACTIVE TASK IN PROGRESS]\n` +
    `Original Request: ${task.originalRequest}\n` +
    `Current Objective: ${task.currentObjective}\n` +
    `Execution Step: ${task.currentStepIndex + 1}/${task.steps.length}\n` +
    `Completed Actions: ${task.completedActions.join(', ') || 'none'}\n` +
    `Pending Actions: ${task.pendingActions.join(', ') || 'conclude'}\n` +
    (task.activeTabUrl ? `Active Tab URL: ${task.activeTabUrl}\n` : '') +
    (Object.keys(task.extractedData).length > 0 ? `Extracted Findings: ${JSON.stringify(task.extractedData)}\n` : '')
  )
}
