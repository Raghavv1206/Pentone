/**
 * Task Checkpoint and Session Continuity Architecture
 * 
 * Preserves active multi-step browser tasks across context compaction and Prompt API session replacement.
 * Guarantees that completed browser actions are never blindly repeated, pending steps are resumed,
 * and security grants/tokens are never restored or extended past their absolute deadlines.
 */

import type { ActiveTaskState, TaskStep } from './task-state'

export interface TaskCandidate {
  title: string
  channel?: string
  viewCountRaw?: string
  viewCountNumeric?: number
  url?: string
  index?: number
}

export interface TaskCheckpoint {
  taskId: string
  originalInstruction: string
  currentObjective: string
  activeTabUrl?: string
  activeTabTitle?: string
  searchQuery?: string
  searchCompleted: boolean
  resultsExtracted: boolean
  extractedCandidates?: TaskCandidate[]
  selectedCandidate?: TaskCandidate & { selectionCriteria?: string }
  navigationCompleted: boolean
  completedSteps: string[]
  currentStepIndex: number
  currentStepDescription: string
  pendingActions: string[]
  status: 'in_progress' | 'completed' | 'failed' | 'awaiting_user' | 'cancelled'
  lastToolResult?: any
  updatedAt: number
}

const CHECKPOINT_STORAGE_KEY = 'pentone_active_task_checkpoint'

// In-memory reference for instant synchronous access within the active thread
let memoryCheckpoint: TaskCheckpoint | null = null

/**
 * Creates or updates a structured checkpoint from the active task state.
 */
export function buildTaskCheckpoint(
  task: ActiveTaskState,
  lastToolResult?: any,
  tabInfo?: { url?: string; title?: string }
): TaskCheckpoint {
  const currentStep = task.steps[task.currentStepIndex]
  const extractedData = task.extractedData || {}

  // Check if search has completed
  const searchCompleted = task.completedActions.includes('openTab') || 
    task.completedActions.some(a => a.toLowerCase().includes('search'))

  // Check if video/page results have been extracted
  const resultsExtracted = Boolean(extractedData.candidates?.length || extractedData.resultsExtracted)

  // Check if video navigation has completed
  const navigationCompleted = Boolean(extractedData.videoNavigationCompleted || extractedData.navigationCompleted)

  const checkpoint: TaskCheckpoint = {
    taskId: task.id,
    originalInstruction: task.originalRequest,
    currentObjective: task.currentObjective,
    activeTabUrl: tabInfo?.url || task.activeTabUrl,
    activeTabTitle: tabInfo?.title,
    searchQuery: extractedData.targetQuery || extractedData.searchQuery,
    searchCompleted,
    resultsExtracted,
    extractedCandidates: extractedData.candidates || extractedData.videoCandidates,
    selectedCandidate: extractedData.selectedCandidate || extractedData.highestViewCandidate,
    navigationCompleted,
    completedSteps: [...task.completedActions],
    currentStepIndex: task.currentStepIndex,
    currentStepDescription: currentStep?.description || currentStep?.action || 'Execute next step',
    pendingActions: [...task.pendingActions],
    status: task.status === 'completed' ? 'completed' : task.status === 'failed' ? 'failed' : 'in_progress',
    lastToolResult,
    updatedAt: Date.now()
  }

  memoryCheckpoint = checkpoint
  return checkpoint
}

/**
 * Persists the task checkpoint to storage asynchronously.
 */
export async function persistTaskCheckpoint(checkpoint: TaskCheckpoint): Promise<void> {
  memoryCheckpoint = checkpoint
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [CHECKPOINT_STORAGE_KEY]: checkpoint })
    }
  } catch (err) {
    console.warn('[TaskCheckpoint] Failed to persist task checkpoint to storage:', err)
  }
}

/**
 * Retrieves the currently active task checkpoint.
 */
export async function getActiveTaskCheckpoint(): Promise<TaskCheckpoint | null> {
  if (memoryCheckpoint) return memoryCheckpoint

  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const result = await chrome.storage.local.get([CHECKPOINT_STORAGE_KEY])
      if (result?.[CHECKPOINT_STORAGE_KEY]) {
        memoryCheckpoint = result[CHECKPOINT_STORAGE_KEY]
        return memoryCheckpoint
      }
    }
  } catch (err) {
    console.warn('[TaskCheckpoint] Failed to read task checkpoint from storage:', err)
  }

  return null
}

/**
 * Clears the active task checkpoint upon task completion or cancellation.
 */
export async function clearTaskCheckpoint(): Promise<void> {
  memoryCheckpoint = null
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.remove([CHECKPOINT_STORAGE_KEY])
    }
  } catch (err) {
    console.warn('[TaskCheckpoint] Failed to remove task checkpoint:', err)
  }
}

/**
 * Formats the task checkpoint into a concise, token-efficient context block
 * for rebuilding the Prompt API session after context compaction.
 */
export function formatCheckpointForCompactedSession(checkpoint: TaskCheckpoint | null): string {
  if (!checkpoint || checkpoint.status === 'completed' || checkpoint.status === 'failed') {
    return ''
  }

  const completedList = checkpoint.completedSteps.length > 0 
    ? checkpoint.completedSteps.join(', ') 
    : 'None'

  let candidateSummary = ''
  if (checkpoint.extractedCandidates && checkpoint.extractedCandidates.length > 0) {
    candidateSummary = `\nExtracted Candidates: ${checkpoint.extractedCandidates.length} videos discovered`
  }

  let selectedSummary = ''
  if (checkpoint.selectedCandidate) {
    selectedSummary = `\nSelected Candidate: "${checkpoint.selectedCandidate.title}" (${checkpoint.selectedCandidate.viewCountRaw || checkpoint.selectedCandidate.viewCountNumeric || 'highest views'})`
  }

  return (
    `[ACTIVE TASK RESUMPTION CHECKPOINT]\n` +
    `Original Instruction: "${checkpoint.originalInstruction}"\n` +
    `Current Objective: ${checkpoint.currentObjective}\n` +
    (checkpoint.searchQuery ? `Search Query: "${checkpoint.searchQuery}" (Completed: ${checkpoint.searchCompleted})\n` : '') +
    (checkpoint.activeTabUrl ? `Active Tab URL: ${checkpoint.activeTabUrl}\n` : '') +
    `Completed Browser Actions: ${completedList}\n` +
    `Current Step: ${checkpoint.currentStepDescription}\n` +
    `Pending Actions: ${checkpoint.pendingActions.join(', ') || 'conclude'}` +
    candidateSummary +
    selectedSummary +
    `\nCRITICAL CONTINUITY RULE: Do NOT repeat completed actions (${completedList}). Proceed directly with pending actions.`
  )
}
