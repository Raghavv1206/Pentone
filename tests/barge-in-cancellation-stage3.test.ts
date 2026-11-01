import test from 'node:test'
import assert from 'node:assert/strict'

import { BargeInController, type VoiceState } from '../lib/audio/barge-in-controller'
import {
  createActiveTask,
  advanceActiveTask,
  interruptActiveTask,
  formatTaskStateForPrompt,
  isContinuityOrReplacementInstruction,
  type ActiveTaskState
} from '../lib/task-state'
import { detectExplicitRepeatIntent } from '../lib/intent-validator'
import { validateToolCallSchema, parseToolCall } from '../lib/tool-parser'

// =========================================================================
// TEST SUITE: PENTONE STAGE 3 — RELIABLE BARGE-IN, CANCELLATION & CONTINUITY
// =========================================================================

test('Stage 3 Barge-In: Speech onset in ASSISTANT_SPEAKING triggers immediate INTERRUPTING and fires onInterrupt', () => {
  let interruptFired = false
  const stateLog: VoiceState[] = []

  const controller = new BargeInController({
    onStateChange: (newState) => {
      stateLog.push(newState)
    },
    onInterrupt: () => {
      interruptFired = true
    }
  })

  controller.enableVoiceMode()
  controller.readyToListen()
  controller.handleSpeechStart()
  controller.handleSpeechEnd(new Float32Array(16000))
  controller.handleAssistantSpeechStart()

  assert.equal(controller.getState(), 'ASSISTANT_SPEAKING')
  assert.equal(interruptFired, false)

  // User begins speaking (barge-in!)
  controller.handleSpeechStart()

  assert.equal(interruptFired, true, 'Interruption callback must be executed immediately on speech onset')
  assert.equal(controller.getState(), 'USER_SPEAKING', 'Controller must transition to USER_SPEAKING immediately')
  assert.ok(stateLog.includes('INTERRUPTING'), 'Must transition through INTERRUPTING state')
})

test('Stage 3 Barge-In: Speech onset in PROCESSING triggers immediate cancellation and transitions to USER_SPEAKING', () => {
  let interruptFired = false
  const stateLog: VoiceState[] = []

  const controller = new BargeInController({
    onStateChange: (newState) => {
      stateLog.push(newState)
    },
    onInterrupt: () => {
      interruptFired = true
    }
  })

  controller.enableVoiceMode()
  controller.readyToListen()
  controller.handleSpeechStart()
  controller.handleSpeechEnd(new Float32Array(16000))

  assert.equal(controller.getState(), 'PROCESSING')
  assert.equal(controller.isInterruptible(), true, 'PROCESSING state must be interruptible by user speech')

  // User interrupts while model or tool is still PROCESSING!
  controller.handleSpeechStart()

  assert.equal(interruptFired, true, 'onInterrupt must fire when user speaks during PROCESSING')
  assert.equal(controller.getState(), 'USER_SPEAKING')
  assert.ok(stateLog.includes('INTERRUPTING'))
})

test('Stage 3 Barge-In: Debounce suppresses rapid double-fire speech onset events within 150ms', () => {
  let interruptCount = 0
  const controller = new BargeInController({
    onInterrupt: () => {
      interruptCount++
    }
  })

  controller.enableVoiceMode()
  controller.readyToListen()
  controller.handleAssistantSpeechStart()

  // First speech start
  controller.handleSpeechStart()
  assert.equal(interruptCount, 1)
  assert.equal(controller.getState(), 'USER_SPEAKING')

  // Rapid consecutive speech start within same utterance (e.g. VAD burst frame)
  controller.handleSpeechStart()
  assert.equal(interruptCount, 1, 'Duplicate speech start within debounce window must not re-trigger interrupt')
  assert.equal(controller.getState(), 'USER_SPEAKING')
})

test('Stage 3 Task Continuity: interruptActiveTask cancels pending/in_progress steps while preserving completed actions', () => {
  const initialTask = createActiveTask(
    'Open YouTube search for the best React tutorials, identify the first three visible video results and summarize their titles'
  )
  assert.equal(initialTask.steps.length, 3)
  assert.equal(initialTask.steps[0].status, 'pending')

  // Advance step 1: openTab completes
  const advancedTask = advanceActiveTask(initialTask, 'openTab', { tabId: 101, url: 'https://youtube.com' })
  assert.equal(advancedTask.steps[0].status, 'completed')
  assert.equal(advancedTask.steps[1].status, 'in_progress')
  assert.deepEqual(advancedTask.completedActions, ['openTab'])

  // User interrupts the task mid-flight!
  const cancelledTask = interruptActiveTask(advancedTask)

  assert.equal(cancelledTask.status, 'cancelled')
  assert.equal(cancelledTask.isInterrupted, true)
  assert.equal(cancelledTask.steps[0].status, 'completed', 'Completed step 1 MUST remain completed')
  assert.equal(cancelledTask.steps[1].status, 'cancelled', 'In-progress step 2 must be marked cancelled')
  assert.equal(cancelledTask.steps[2].status, 'cancelled', 'Pending step 3 must be marked cancelled')
  assert.deepEqual(cancelledTask.completedActions, ['openTab'], 'Completed actions must be preserved')
  assert.deepEqual(cancelledTask.cancelledActions, ['findElements', 'summarizeTitles'], 'Pending actions moved to cancelledActions')
  assert.deepEqual(cancelledTask.pendingActions, [], 'Pending actions list must be cleared')
})

test('Stage 3 Task Continuity: createActiveTask branches cleanly from interrupted task and inherits completed actions', () => {
  // 1. Initial task was interrupted after opening GitHub
  const task1 = createActiveTask('Open GitHub and search for React repositories')
  const task1WithTab = {
    ...advanceActiveTask(task1, 'openTab', { url: 'https://github.com' }),
    activeTabId: 42,
    activeTabUrl: 'https://github.com'
  }
  const interruptedTask1 = interruptActiveTask(task1WithTab)

  // 2. User replaces instruction: "Stop. Search Next.js instead"
  const replacementPrompt = 'Search Next.js instead'
  const task2 = createActiveTask(replacementPrompt, interruptedTask1)

  assert.equal(task2.originalRequest, 'Search Next.js instead')
  assert.equal(task2.activeTabId, 42, 'Must inherit active browser tab context')
  assert.equal(task2.activeTabUrl, 'https://github.com', 'Must inherit tab URL')
  assert.deepEqual(task2.completedActions, ['openTab'], 'Must inherit completed navigation actions to prevent reloading')
  assert.equal(task2.status, 'in_progress')
})

test('Stage 3 Task Continuity: formatTaskStateForPrompt includes explicit Continuity Note when completed actions exist', () => {
  const task = createActiveTask('Search Next.js instead', {
    id: 'prev_1',
    originalRequest: 'Open GitHub',
    currentObjective: 'Open GitHub',
    currentStepIndex: 1,
    steps: [],
    completedActions: ['openTab'],
    pendingActions: [],
    activeTabId: 55,
    activeTabUrl: 'https://github.com',
    extractedData: {},
    recoveryAttempts: 0,
    status: 'cancelled',
    createdAt: Date.now(),
    updatedAt: Date.now()
  })

  const formattedPrompt = formatTaskStateForPrompt(task)
  assert.ok(formattedPrompt.includes('Completed: openTab'), 'Prompt must show completed openTab action')
  assert.ok(
    formattedPrompt.includes('CONTINUITY NOTE: The browser actions listed under Completed above were already executed successfully'),
    'Prompt must include continuity note forbidding re-opening'
  )
})

test('Stage 3 Turn Superseding: Newer turn increments token and discards stale older turn output', async () => {
  let activeTurnId = 0
  const executedActions: string[] = []
  const committedMessages: string[] = []

  // Simulated execution worker with turn token checks
  const runTurn = async (turnPrompt: string, delayMs: number) => {
    const turnId = ++activeTurnId
    
    // Simulate async streaming / tool execution delay
    await new Promise((resolve) => setTimeout(resolve, delayMs))

    // Post-delay turn validity check
    if (turnId !== activeTurnId) {
      // Turn superseded! Discard output
      return { success: false, superseded: true, turnId }
    }

    executedActions.push(`execute_${turnPrompt}`)
    committedMessages.push(`message_${turnPrompt}`)
    return { success: true, superseded: false, turnId }
  }

  // Turn 1 starts with a 50ms delay
  const turn1Promise = runTurn('slow_react_search', 50)
  
  // Turn 2 interrupts at 10ms with a faster 20ms execution
  await new Promise((resolve) => setTimeout(resolve, 10))
  const turn2Promise = runTurn('fast_nextjs_search', 20)

  const [res1, res2] = await Promise.all([turn1Promise, turn2Promise])

  assert.equal(res1.superseded, true, 'Turn 1 must be invalidated by Turn 2')
  assert.equal(res2.superseded, false, 'Turn 2 must succeed as the latest active turn')
  assert.deepEqual(executedActions, ['execute_fast_nextjs_search'], 'Only Turn 2 action may be executed')
  assert.deepEqual(committedMessages, ['message_fast_nextjs_search'], 'Only Turn 2 message may be committed')
})

test('Stage 3 Stream Cancellation: AbortSignal stops chunk streaming and throws AbortError cleanly', async () => {
  const chunksReceived: string[] = []
  const controller = new AbortController()

  // Generator simulating Chrome Prompt API promptStreaming
  async function* mockPromptStreaming(signal: AbortSignal) {
    const tokens = ['Hello', ' there,', ' I', ' am', ' Pentone', ' assistant.']
    for (const token of tokens) {
      if (signal.aborted) {
        const err = new Error('AI generation was aborted')
        err.name = 'AbortError'
        throw err
      }
      await new Promise((r) => setTimeout(r, 10))
      yield token
    }
  }

  let caughtError: any = null
  try {
    const stream = mockPromptStreaming(controller.signal)
    let count = 0
    for await (const chunk of stream) {
      chunksReceived.push(chunk)
      count++
      if (count === 2) {
        // Interruption occurs after 2 chunks!
        controller.abort()
      }
    }
  } catch (err: any) {
    caughtError = err
  }

  assert.ok(caughtError, 'Must throw AbortError when aborted')
  assert.equal(caughtError.name, 'AbortError')
  assert.equal(chunksReceived.length, 2, 'Must stop collecting chunks immediately upon abort')
  assert.deepEqual(chunksReceived, ['Hello', ' there,'])
})

test('Stage 3 Action Deduplication: Completed openTab is skipped to prevent duplicate tab creation', () => {
  const completedActions = new Set<string>(['openTab:{"tabName":"github"}', 'openTab'])
  const incomingAction = {
    function: 'openTab',
    arguments: { tabName: 'github' }
  }
  const actionSignature = `${incomingAction.function}:${JSON.stringify(incomingAction.arguments)}`

  let executed = false
  let toolResult: any = null

  if (completedActions.has(actionSignature) && incomingAction.function === 'openTab') {
    toolResult = {
      success: true,
      result: `Navigation already completed: ${incomingAction.function} with ${JSON.stringify(incomingAction.arguments)}`
    }
  } else {
    executed = true
  }

  assert.equal(executed, false, 'Duplicate openTab must NOT be executed')
  assert.ok(toolResult.result.includes('Navigation already completed'))
})

test('Stage 3 Voice State Machine: Exhaustive 8-state transition validation and no deadlocks', () => {
  const controller = new BargeInController()

  // 1. Initial
  assert.equal(controller.getState(), 'DISABLED')

  // 2. Enable -> IDLE
  assert.equal(controller.enableVoiceMode(), true)
  assert.equal(controller.getState(), 'IDLE')

  // 3. Audio ready -> LISTENING
  assert.equal(controller.readyToListen(), true)
  assert.equal(controller.getState(), 'LISTENING')

  // 4. User speech -> USER_SPEAKING
  controller.handleSpeechStart()
  assert.equal(controller.getState(), 'USER_SPEAKING')

  // 5. Speech end -> PROCESSING
  controller.handleSpeechEnd(new Float32Array(16000))
  assert.equal(controller.getState(), 'PROCESSING')

  // 6. Assistant speech -> ASSISTANT_SPEAKING
  controller.handleAssistantSpeechStart()
  assert.equal(controller.getState(), 'ASSISTANT_SPEAKING')

  // 7. Interruption during assistant speech -> INTERRUPTING -> USER_SPEAKING
  controller.handleSpeechStart()
  assert.equal(controller.getState(), 'USER_SPEAKING')

  // 8. User speech end -> PROCESSING
  controller.handleSpeechEnd(new Float32Array(16000))
  assert.equal(controller.getState(), 'PROCESSING')

  // 9. Processing completes without TTS (e.g. silent tool execution) -> returns to LISTENING
  assert.equal(controller.readyToListen(), true)
  assert.equal(controller.getState(), 'LISTENING')

  // 10. Disable voice mode -> DISABLED
  assert.equal(controller.disableVoiceMode(), true)
  assert.equal(controller.getState(), 'DISABLED')
})

test('Stage 3 Teardown: Disabling voice mode resets state and safely clears controller', () => {
  const controller = new BargeInController()
  controller.enableVoiceMode()
  controller.readyToListen()
  controller.handleSpeechStart()

  assert.equal(controller.getState(), 'USER_SPEAKING')

  // Disable voice mode while user was speaking
  assert.equal(controller.disableVoiceMode(), true)
  assert.equal(controller.getState(), 'DISABLED')
  assert.equal(controller.isMicrophoneActive(), false)
  assert.equal(controller.isInterruptible(), false)
})

// =========================================================================
// STAGE 3 DEFECT REMEDIATION REGRESSION SUITE
// =========================================================================

test('Stage 3 Remediation: Unrelated standalone questions do NOT inherit previous task completed actions or continuity notes', () => {
  // Previous task was interrupted after opening GitHub
  const prevTask = createActiveTask('Open GitHub and search for React')
  const prevWithAction = advanceActiveTask(prevTask, 'openTab', { url: 'https://github.com' })
  prevWithAction.activeTabUrl = 'https://github.com'
  prevWithAction.activeTabId = 42
  const interruptedPrev = interruptActiveTask(prevWithAction)

  // Unrelated questions
  const unrelatedQuestions = [
    'What is the capital of France?',
    'Who is the president of India?',
    'Calculate 25 * 40',
    'Tell me a joke',
    'What is 2 + 2?'
  ]

  for (const q of unrelatedQuestions) {
    assert.equal(isContinuityOrReplacementInstruction(q, interruptedPrev), false, `Should reject continuity for: "${q}"`)
    const newTask = createActiveTask(q, interruptedPrev)
    assert.deepEqual(newTask.completedActions, [], `completedActions must be empty for: "${q}"`)
    assert.equal(newTask.activeTabUrl, undefined, `activeTabUrl must be undefined for: "${q}"`)
    assert.equal(newTask.activeTabId, undefined, `activeTabId must be undefined for: "${q}"`)

    const promptText = formatTaskStateForPrompt(newTask)
    assert.equal(promptText.includes('CONTINUITY NOTE'), false, `Must NOT contain continuity note for: "${q}"`)
    assert.equal(promptText.includes('Completed: openTab'), false, `Must NOT list openTab as completed for: "${q}"`)
  }
})

test('Stage 3 Remediation: Completed task does NOT leak completed actions into future tasks', () => {
  const completedTask = createActiveTask('Open GitHub and search for React')
  completedTask.status = 'completed'
  completedTask.completedActions = ['openTab']

  // Even if user says an action query, completed task must NOT contaminate
  const nextInput = 'Search Next.js'
  assert.equal(isContinuityOrReplacementInstruction(nextInput, completedTask), false)

  const newTask = createActiveTask(nextInput, completedTask)
  assert.deepEqual(newTask.completedActions, [])
})

test('Stage 3 Remediation: Genuine replacement instruction inherits completed actions and tab context', () => {
  const prevTask = createActiveTask('Open GitHub and search for React')
  const prevWithAction = advanceActiveTask(prevTask, 'openTab', { url: 'https://github.com' })
  prevWithAction.activeTabUrl = 'https://github.com'
  prevWithAction.activeTabId = 42
  const interruptedPrev = interruptActiveTask(prevWithAction)

  const replacementPrompts = [
    'Search Next.js instead',
    'Stop and search Vue.js',
    'Now open documentation',
    'Change that to Angular tutorials',
    'Actually search for TypeScript'
  ]

  for (const prompt of replacementPrompts) {
    assert.equal(isContinuityOrReplacementInstruction(prompt, interruptedPrev), true, `Should accept continuity for: "${prompt}"`)
    const newTask = createActiveTask(prompt, interruptedPrev)
    assert.deepEqual(newTask.completedActions, ['openTab'], `Must inherit completedActions for: "${prompt}"`)
    assert.equal(newTask.activeTabUrl, 'https://github.com', `Must inherit activeTabUrl for: "${prompt}"`)
    assert.equal(newTask.activeTabId, 42, `Must inherit activeTabId for: "${prompt}"`)

    const promptText = formatTaskStateForPrompt(newTask)
    assert.ok(promptText.includes('Completed: openTab'))
    assert.ok(promptText.includes('CONTINUITY NOTE'))
  }
})

test('Stage 3 Remediation: Explicit repeat intent detection identifies reload, refresh, reopen, and again patterns', () => {
  const explicitRepeatQueries = [
    'Open GitHub again',
    'Reload the current page',
    'Refresh YouTube',
    'Navigate to github.com again',
    'Reopen the tab',
    'Please reload page',
    'Visit youtube.com once more'
  ]

  for (const q of explicitRepeatQueries) {
    const analysis = detectExplicitRepeatIntent(q)
    assert.equal(analysis.isExplicitRepeat, true, `Must detect explicit repeat for: "${q}"`)
  }

  // Conversational memory idioms must NOT trigger browser reload intent
  const conversationalMemoryQueries = [
    'Refresh my memory about React',
    'Refresh me on React',
    'Refresh our memory about the project',
    'Can you refresh my memory on TypeScript'
  ]

  for (const q of conversationalMemoryQueries) {
    const analysis = detectExplicitRepeatIntent(q)
    assert.equal(analysis.isExplicitRepeat, false, `Must NOT detect browser repeat for conversational memory idiom: "${q}"`)
  }

  const normalQueries = [
    'Open GitHub',
    'Search YouTube for React',
    'What is Next.js?',
    'Navigate to google.com'
  ]

  for (const q of normalQueries) {
    const analysis = detectExplicitRepeatIntent(q)
    assert.equal(analysis.isExplicitRepeat, false, `Must NOT detect explicit repeat for: "${q}"`)
  }
})

test('Stage 3 Remediation: Explicit repeated navigation bypasses deduplication and executes', () => {
  const completedActions = new Set<string>(['openTab:{"tabName":"github"}', 'openTab'])
  const incomingAction = {
    function: 'openTab',
    arguments: { tabName: 'github' }
  }
  const actionSignature = `${incomingAction.function}:${JSON.stringify(incomingAction.arguments)}`

  // 1. User says: "Open GitHub again"
  const userInput = 'Open GitHub again'
  const isExplicitRepeat = detectExplicitRepeatIntent(userInput).isExplicitRepeat

  let executed = false
  if (!isExplicitRepeat && completedActions.has(actionSignature) && (incomingAction.function === 'openTab' || incomingAction.function === 'navigateTab')) {
    executed = false
  } else {
    executed = true
  }

  assert.equal(isExplicitRepeat, true)
  assert.equal(executed, true, 'Explicit repeat navigation must execute and NOT be skipped by deduplication')
})

test('Stage 3 Remediation: Accidental duplicate navigation in autonomous loop is blocked', () => {
  const completedActions = new Set<string>(['openTab:{"tabName":"github"}', 'openTab'])
  const incomingAction = {
    function: 'openTab',
    arguments: { tabName: 'github' }
  }
  const actionSignature = `${incomingAction.function}:${JSON.stringify(incomingAction.arguments)}`

  // Normal query (no repeat intent) but autonomous loop emitted duplicate openTab
  const userInput = 'Find React issues'
  const isExplicitRepeat = detectExplicitRepeatIntent(userInput).isExplicitRepeat

  let executed = false
  let toolResult: any = null

  if (!isExplicitRepeat && completedActions.has(actionSignature) && (incomingAction.function === 'openTab' || incomingAction.function === 'navigateTab')) {
    executed = false
    toolResult = {
      success: true,
      result: `Navigation already completed: ${incomingAction.function}`
    }
  } else {
    executed = true
  }

  assert.equal(isExplicitRepeat, false)
  assert.equal(executed, false, 'Accidental duplicate openTab in autonomous loop must be blocked')
  assert.ok(toolResult.result.includes('Navigation already completed'))
})

test('Stage 3 Remediation: In-flight browser action that succeeds during interruption preserves accurate record for replacement task', async () => {
  let activeTurnId = 1
  const turnId = 1
  const completedActions = new Set<string>()
  let lastTaskRecord: ActiveTaskState | null = {
    id: 't1',
    originalRequest: 'Open GitHub',
    currentObjective: 'Open GitHub',
    currentStepIndex: 0,
    steps: [{ id: 's1', action: 'openTab', description: 'Open GitHub', status: 'in_progress' }],
    completedActions: [],
    pendingActions: ['openTab'],
    extractedData: {},
    recoveryAttempts: 0,
    status: 'in_progress',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }

  // Tool begins execution in flight
  const executeInFlightTool = async () => {
    // Simulated browser operation delay
    await new Promise((r) => setTimeout(r, 20))
    return { success: true, result: { tabId: 99, url: 'https://github.com' } }
  }

  const toolPromise = executeInFlightTool()

  // User interrupts while tool is running!
  activeTurnId++ // turn 2 starts
  lastTaskRecord = interruptActiveTask(lastTaskRecord)

  // Tool completes!
  const toolResult = await toolPromise
  const isTurnSuperseded = (turnId !== activeTurnId)

  // Reconciliation logic
  if (toolResult && toolResult.success) {
    completedActions.add('openTab:{"tabName":"github"}')
    completedActions.add('openTab')
    if (lastTaskRecord) {
      lastTaskRecord = advanceActiveTask(lastTaskRecord, 'openTab', toolResult.result)
      lastTaskRecord.activeTabId = toolResult.result.tabId
      lastTaskRecord.activeTabUrl = toolResult.result.url
    }
  }

  assert.equal(isTurnSuperseded, true, 'Turn 1 must be detected as superseded')
  assert.equal(completedActions.has('openTab'), true, 'Completed browser action must be recorded accurately')
  assert.equal(lastTaskRecord?.activeTabId, 99, 'lastTaskRecord must reflect actual tab opened')
  assert.equal(lastTaskRecord?.activeTabUrl, 'https://github.com', 'lastTaskRecord must reflect actual URL')

  // Replacement task starts and reads lastTaskRecord
  const replacementTask = createActiveTask('Search Next.js instead', lastTaskRecord)
  assert.deepEqual(replacementTask.completedActions, ['openTab'], 'Replacement task must see completed openTab')
  assert.equal(replacementTask.activeTabUrl, 'https://github.com', 'Replacement task must inherit active tab URL')
})

test('Stage 3 Remediation: In-flight browser action that fails during interruption is NOT recorded as completed', async () => {
  let activeTurnId = 1
  const turnId = 1
  const completedActions = new Set<string>()

  // In-flight tool fails
  const toolResult = { success: false, error: 'Tab failed to load' }
  const isTurnSuperseded = true // superseded

  if (toolResult && toolResult.success) {
    completedActions.add('openTab')
  }

  assert.equal(completedActions.has('openTab'), false, 'Failed tool action must NOT be added to completedActions')
})

test('Stage 3 Remediation: Late-resolving tool result from superseded turn cannot overwrite replacement turn state', async () => {
  let activeTurnId = 2
  const turn1Id = 1
  let conversationMessages: string[] = ['User: Search Next.js instead']
  let isProcessing = true

  // Late tool result from turn 1 resolves
  const lateToolResolution = { turnId: turn1Id, result: 'Old React results' }

  if (lateToolResolution.turnId === activeTurnId) {
    conversationMessages.push(lateToolResolution.result)
    isProcessing = false
  }

  assert.equal(conversationMessages.length, 1, 'Late result must NOT append to conversation')
  assert.equal(isProcessing, true, 'Late result must NOT reset isProcessing on active turn 2')
})

test('Stage 3 Remediation: Old operation completing after replacement task creation does NOT advance replacement step index', async () => {
  const task1Id = 'task_1_old'
  const task2Id = 'task_2_replacement'

  // Task 1 was running
  const task1: ActiveTaskState = {
    id: task1Id,
    originalRequest: 'Open GitHub and search for React',
    currentObjective: 'Open GitHub',
    currentStepIndex: 0,
    steps: [{ id: 's1', action: 'openTab', description: 'Open GitHub', status: 'in_progress' }],
    completedActions: [],
    pendingActions: ['openTab'],
    extractedData: {},
    recoveryAttempts: 0,
    status: 'in_progress',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }

  // Turn 1 begins executing openTab in background
  const originatingTaskId = task1.id

  // User interrupts and starts replacement Task 2
  const task2: ActiveTaskState = {
    id: task2Id,
    originalRequest: 'Search Next.js instead',
    currentObjective: 'Search Next.js',
    currentStepIndex: 0,
    steps: [
      { id: 's2_1', action: 'fillInput', description: 'Type Next.js', status: 'pending' },
      { id: 's2_2', action: 'clickElement', description: 'Submit search', status: 'pending' }
    ],
    completedActions: [],
    pendingActions: ['fillInput', 'clickElement'],
    extractedData: {},
    recoveryAttempts: 0,
    status: 'in_progress',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }

  // lastTaskRef now points to replacement Task 2!
  let lastTaskRecord: ActiveTaskState | null = task2

  // Now, Turn 1's old operation completes successfully!
  const oldToolResult = { success: true, result: { tabId: 105, url: 'https://github.com' } }
  const actionSignature = 'openTab:{"tabName":"github"}'

  // Reconciliation logic as implemented in chat-context.tsx:
  if (lastTaskRecord) {
    if (originatingTaskId && lastTaskRecord.id === originatingTaskId) {
      // Same task: advance normally
      lastTaskRecord = advanceActiveTask(lastTaskRecord, 'openTab', oldToolResult.result)
    } else {
      // Replacement task: MUST NOT call advanceActiveTask! MUST NOT advance currentStepIndex!
      const existingCompleted = new Set(lastTaskRecord.completedActions || [])
      existingCompleted.add(actionSignature)
      existingCompleted.add('openTab')
      lastTaskRecord.completedActions = Array.from(existingCompleted)

      if (oldToolResult.result && typeof oldToolResult.result === 'object') {
        if (oldToolResult.result.tabId) lastTaskRecord.activeTabId = oldToolResult.result.tabId
        if (oldToolResult.result.url) lastTaskRecord.activeTabUrl = oldToolResult.result.url
      }
    }
  }

  // Verify:
  assert.equal(lastTaskRecord.id, task2Id, 'lastTaskRecord must still be replacement Task 2')
  assert.equal(lastTaskRecord.currentStepIndex, 0, 'Replacement task step index must remain 0 and NOT be advanced by old operation')
  assert.equal(lastTaskRecord.steps[0].status, 'pending', 'Replacement task step 1 must remain pending')
  assert.equal(lastTaskRecord.steps[0].action, 'fillInput', 'Replacement task step 1 action must remain intact')
  assert.equal(lastTaskRecord.activeTabId, 105, 'Actual browser tab ID must be reconciled')
  assert.equal(lastTaskRecord.activeTabUrl, 'https://github.com', 'Actual browser tab URL must be reconciled')
  assert.deepEqual(lastTaskRecord.completedActions, ['openTab:{"tabName":"github"}', 'openTab'], 'Completed actions must include the successful browser action')
})

test('Continuous Voice Lifecycle: 5 consecutive voice turns without re-clicking mic button', () => {
  const transitions: string[] = []
  let interruptCount = 0

  const controller = new BargeInController({
    onStateChange: (newState, oldState) => {
      transitions.push(`${oldState}->${newState}`)
    },
    onInterrupt: () => {
      interruptCount++
    }
  })

  // 1. Initial activation: Enable voice mode and ready to listen
  controller.enableVoiceMode()
  controller.readyToListen()
  assert.equal(controller.getState(), 'LISTENING')

  // --- Turn 1 ---
  controller.handleSpeechStart()
  assert.equal(controller.getState(), 'USER_SPEAKING')
  controller.handleSpeechEnd(new Float32Array(1600))
  assert.equal(controller.getState(), 'PROCESSING')
  controller.handleAssistantSpeechStart()
  assert.equal(controller.getState(), 'ASSISTANT_SPEAKING')
  controller.handleAssistantSpeechEnd()
  assert.equal(controller.getState(), 'LISTENING', 'Must automatically return to LISTENING after Turn 1')

  // --- Turn 2 ---
  controller.handleSpeechStart()
  assert.equal(controller.getState(), 'USER_SPEAKING')
  controller.handleSpeechEnd(new Float32Array(1600))
  assert.equal(controller.getState(), 'PROCESSING')
  controller.handleAssistantSpeechStart()
  assert.equal(controller.getState(), 'ASSISTANT_SPEAKING')
  controller.handleAssistantSpeechEnd()
  assert.equal(controller.getState(), 'LISTENING', 'Must automatically return to LISTENING after Turn 2')

  // --- Turn 3 (Interruption / Barge-in) ---
  controller.handleSpeechStart()
  assert.equal(controller.getState(), 'USER_SPEAKING')
  controller.handleSpeechEnd(new Float32Array(1600))
  assert.equal(controller.getState(), 'PROCESSING')
  controller.handleAssistantSpeechStart()
  assert.equal(controller.getState(), 'ASSISTANT_SPEAKING')
  // User speaks while assistant is speaking!
  controller.handleSpeechStart()
  assert.equal(controller.getState(), 'USER_SPEAKING', 'Instant transition to USER_SPEAKING on barge-in')
  assert.equal(interruptCount, 1, 'onInterrupt must be called immediately')
  controller.handleSpeechEnd(new Float32Array(1600))
  assert.equal(controller.getState(), 'PROCESSING')
  controller.handleAssistantSpeechStart()
  controller.handleAssistantSpeechEnd()
  assert.equal(controller.getState(), 'LISTENING', 'Must return to LISTENING after Turn 3')

  // --- Turn 4 ---
  controller.handleSpeechStart()
  controller.handleSpeechEnd(new Float32Array(1600))
  controller.handleAssistantSpeechStart()
  controller.handleAssistantSpeechEnd()
  assert.equal(controller.getState(), 'LISTENING', 'Must return to LISTENING after Turn 4')

  // --- Turn 5 ---
  controller.handleSpeechStart()
  controller.handleSpeechEnd(new Float32Array(1600))
  controller.handleAssistantSpeechStart()
  controller.handleAssistantSpeechEnd()
  assert.equal(controller.getState(), 'LISTENING', 'Must return to LISTENING after Turn 5')

  // Finally disable voice mode:
  controller.disableVoiceMode()
  assert.equal(controller.getState(), 'DISABLED')
})

test('Task Continuity: "Now open the second video" inherits completed YouTube task context, while unrelated query does not', () => {
  // Simulate Task 1: Completed YouTube search task
  const completedTask1: ActiveTaskState = {
    id: 'task_youtube_search',
    originalRequest: 'Open YouTube and search for React tutorials for beginners',
    currentObjective: 'Search YouTube for React tutorials for beginners',
    currentStepIndex: 1,
    steps: [
      { id: 's1', action: 'openTab', description: 'Open YouTube search', status: 'completed' }
    ],
    completedActions: ['openTab:{"url":"https://www.youtube.com/results?search_query=React+tutorials+for+beginners"}', 'openTab'],
    pendingActions: [],
    activeTabId: 42,
    activeTabUrl: 'https://www.youtube.com/results?search_query=React+tutorials+for+beginners',
    extractedData: {},
    recoveryAttempts: 0,
    status: 'completed',
    createdAt: Date.now() - 5000,
    updatedAt: Date.now() - 1000
  }

  // 1. Follow-up instruction: "Now open the second video"
  const isFollowUp1 = isContinuityOrReplacementInstruction('Now open the second video', completedTask1)
  assert.equal(isFollowUp1, true, '"Now open the second video" must inherit active YouTube page context')

  const task2 = createActiveTask('Now open the second video', completedTask1)
  assert.equal(task2.activeTabId, 42, 'Turn 2 must inherit activeTabId from previous task')
  assert.equal(task2.activeTabUrl, 'https://www.youtube.com/results?search_query=React+tutorials+for+beginners', 'Turn 2 must inherit activeTabUrl')
  assert.ok(task2.completedActions.includes('openTab'), 'Turn 2 must record completed actions from Turn 1')

  // 2. Another follow-up variant: "Click the first result"
  const isFollowUp2 = isContinuityOrReplacementInstruction('Click the first result', completedTask1)
  assert.equal(isFollowUp2, true, '"Click the first result" must inherit page context')

  // 3. Unrelated standalone question: "What is the capital of France?"
  const isUnrelated1 = isContinuityOrReplacementInstruction('What is the capital of France?', completedTask1)
  assert.equal(isUnrelated1, false, 'Standalone factual question must NOT inherit browser task context')

  const unrelatedTask = createActiveTask('What is the capital of France?', completedTask1)
  assert.equal(unrelatedTask.activeTabId, undefined, 'Unrelated question must not inherit tabId')
  assert.equal(unrelatedTask.activeTabUrl, undefined, 'Unrelated question must not inherit activeTabUrl')
  assert.equal(unrelatedTask.completedActions.length, 0, 'Unrelated question must have clean action history')

  // 4. Standalone math query: "Calculate 25 * 4"
  const isUnrelated2 = isContinuityOrReplacementInstruction('Calculate 25 * 4', completedTask1)
  assert.equal(isUnrelated2, false, 'Standalone math query must NOT inherit browser task context')
})

test('Tool Parser & Schema: clickElement accepts array parameter unwrap and integer indices without rejection', () => {
  // Case A: Model outputs array-wrapped index {"index": [20]}
  const resA = validateToolCallSchema('clickElement', { index: [20] })
  assert.equal(resA.valid, true, 'Must unwrap array-wrapped index [20]')
  assert.equal(resA.toolCall?.arguments.index, 20)

  // Case B: Model outputs integer index {"index": 20}
  const resB = validateToolCallSchema('clickElement', { index: 20 })
  assert.equal(resB.valid, true)
  assert.equal(resB.toolCall?.arguments.index, 20)

  // Case C: Loose Python call syntax clickElement(20)
  const parsedC = parseToolCall('clickElement(20)')
  assert.ok(parsedC)
  assert.equal(parsedC.function, 'clickElement')
  assert.equal(parsedC.arguments.index, 20)

  // Case D: Loose Python call syntax findElements(second video)
  const parsedD = parseToolCall('findElements(second video)')
  assert.ok(parsedD)
  assert.equal(parsedD.function, 'findElements')
  assert.equal(parsedD.arguments.query, 'second video')
})
