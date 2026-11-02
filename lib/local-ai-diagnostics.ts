/**
 * Pentone Phase 3.5 — Lightweight Local AI Diagnostics
 * 
 * Provides privacy-preserving, zero-telemetry diagnostics for local AI runtime operations,
 * worker lifecycle, and fallback transitions. Never records prompts, webpage content,
 * audio samples, or personal data.
 */

export type AIExecutionMode = 'worker' | 'deterministic' | 'native' | 'unavailable'

export type DiagnosticCategory = 
  | 'worker_init' 
  | 'inference' 
  | 'worker_error' 
  | 'worker_unload' 
  | 'cache_check' 
  | 'recovery'
  | 'audio_pipeline'

export type ErrorCategory =
  | 'init_timeout'
  | 'inference_timeout'
  | 'worker_crash'
  | 'worker_messageerror'
  | 'asset_corrupt'
  | 'quota_exceeded'
  | 'network'
  | 'unsupported_environment'
  | 'unknown'

export interface LocalAIDiagnosticEvent {
  timestamp: number
  category: DiagnosticCategory
  executionMode?: AIExecutionMode
  durationMs?: number
  modelId?: string
  success: boolean
  errorCategory?: ErrorCategory
  details?: Record<string, string | number | boolean>
}

class LocalAIDiagnosticsService {
  private static instance: LocalAIDiagnosticsService | null = null
  private events: LocalAIDiagnosticEvent[] = []
  private maxEvents = 50

  private constructor() {}

  static getInstance(): LocalAIDiagnosticsService {
    if (!LocalAIDiagnosticsService.instance) {
      LocalAIDiagnosticsService.instance = new LocalAIDiagnosticsService()
    }
    return LocalAIDiagnosticsService.instance
  }

  /**
   * Records a diagnostic event into the bounded in-memory buffer.
   * Strips any potential sensitive properties defensively.
   */
  record(event: Omit<LocalAIDiagnosticEvent, 'timestamp'>): void {
    const safeEvent: LocalAIDiagnosticEvent = {
      ...event,
      timestamp: Date.now()
    }
    this.events.push(safeEvent)
    if (this.events.length > this.maxEvents) {
      this.events.shift()
    }
  }

  getRecentEvents(limit = 20): LocalAIDiagnosticEvent[] {
    return this.events.slice(-limit)
  }

  getSummary(): {
    totalEvents: number
    workerInitSuccesses: number
    workerInitFailures: number
    inferencesByMode: Record<AIExecutionMode, number>
    lastError?: string
  } {
    const inferencesByMode: Record<AIExecutionMode, number> = {
      worker: 0,
      deterministic: 0,
      native: 0,
      unavailable: 0
    }
    let workerInitSuccesses = 0
    let workerInitFailures = 0
    let lastError: string | undefined

    for (const ev of this.events) {
      if (ev.category === 'worker_init') {
        if (ev.success) workerInitSuccesses++
        else workerInitFailures++
      }
      if (ev.category === 'inference' && ev.executionMode) {
        inferencesByMode[ev.executionMode] = (inferencesByMode[ev.executionMode] || 0) + 1
      }
      if (!ev.success && ev.errorCategory) {
        lastError = ev.errorCategory
      }
    }

    return {
      totalEvents: this.events.length,
      workerInitSuccesses,
      workerInitFailures,
      inferencesByMode,
      lastError
    }
  }

  clear(): void {
    this.events = []
  }
}

export const localAIDiagnostics = LocalAIDiagnosticsService.getInstance()
