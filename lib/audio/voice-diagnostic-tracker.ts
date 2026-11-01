/**
 * Pentone Voice Diagnostic Tracker
 * 
 * Lightweight, non-intrusive diagnostic and telemetry tracker for Chrome runtime voice verification.
 * 
 * Exposes:
 * - VAD speech-start and speech-end events
 * - Whisper transcription result and latency
 * - CAM++ verification status, similarity score, centroid type, and latency
 * - Authorization decision, capability scope, and gate latency
 * - Tool execution or rejection results
 * - Instant barge-in timing
 * - Errors and stale-turn cancellations
 * 
 * Security Invariant:
 * Strictly avoids logging or storing raw audio, encryption keys, or sensitive profile ciphertext.
 */

export interface TurnDiagnosticRecord {
  turnId: number;
  userId: string;
  sessionId: string;
  audioSegmentId?: string;
  speechStartTime?: number;
  speechEndTime?: number;
  audioDurationSeconds?: number;
  audioRms?: number;
  bargeInTriggered?: boolean;
  bargeInLatencyMs?: number;
  whisperText?: string;
  whisperLatencyMs?: number;
  whisperError?: string;
  camDecision?: string;
  camScore?: number;
  camCentroidScore?: number;
  camExemplarScore?: number;
  camRoutingPath?: string;
  camConversationalScore?: number;
  camShortCommandScore?: number;
  scoringPolicy?: string;
  rawBufferDurationSeconds?: number;
  actualVoicedDurationSeconds?: number;
  voicedFrameCount?: number;
  preSpeechPadMs?: number;
  postSpeechPadMs?: number;
  camLatencyMs?: number;
  camError?: string;
  camStatus?: 'VERIFIED' | 'PROFILE_NOT_FOUND' | 'MODEL_LOAD_FAILED' | 'INFERENCE_FAILED' | 'INVALID_AUDIO' | 'BYPASSED';
  detectedSpeaker?: 'VERIFIED_USER' | 'OTHER_SPEAKER' | 'UNCERTAIN_SPEAKER' | 'OVERLAPPING_SPEECH' | 'PROFILE_NOT_FOUND';
  profileLookupStatus?: 'FOUND' | 'PROFILE_NOT_FOUND' | 'ERROR';
  transcriptSpeakerAssociation?: 'VERIFIED_USER' | 'OTHER_SPEAKER' | 'OVERLAPPING' | 'UNATTRIBUTED';
  nemotronIntentDecision?: string;
  detectedSegmentsCount?: number;
  terminalState?: 'COMPLETED' | 'CANCELLED' | 'PROFILE_NOT_FOUND' | 'DENIED' | 'FAILED' | 'ASR_FAILED' | 'TOOL_PARSE_FAILED' | 'OTHER_SPEAKER' | 'UNCERTAIN_SPEAKER' | 'OVERLAPPING_SPEECH';
  authDecision?: string;
  authScope?: string;
  authLatencyMs?: number;
  toolName?: string;
  toolAuthorized?: boolean;
  toolOutcomeReason?: string;
  toolExecutionLatencyMs?: number;
  cancelled?: boolean;
  cancelReason?: string;
  totalTurnLatencyMs?: number;
  whisperLifecycleEvent?: string;
  whisperInitDurationMs?: number;
  whisperReuseCount?: number;
  turnGrantId?: string;
  turnGrantDeadlineMs?: number;
  executionTokenId?: string;
  executionTokenTtlRemainingMs?: number;
  compactionCount?: number;
  compactionTokensBefore?: number;
  compactionTokensAfter?: number;
  timestamp: number;
}

export type DiagnosticListener = (record: TurnDiagnosticRecord) => void;

export class VoiceDiagnosticTracker {
  private static instance: VoiceDiagnosticTracker | null = null;
  private turns = new Map<number, TurnDiagnosticRecord>();
  private readonly MAX_TURNS = 50;
  private listeners: Set<DiagnosticListener> = new Set();

  public static getInstance(): VoiceDiagnosticTracker {
    if (!this.instance) {
      this.instance = new VoiceDiagnosticTracker();
      if (typeof window !== 'undefined') {
        (window as any).__pentoneVoiceDiagnostic = this.instance;
      }
    }
    return this.instance;
  }

  public subscribe(listener: DiagnosticListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(record: TurnDiagnosticRecord): void {
    for (const listener of this.listeners) {
      try {
        listener(record);
      } catch (err) {
        console.warn('[VoiceDiagnosticTracker] Listener error:', err);
      }
    }
  }

  private getOrCreateTurn(turnId: number): TurnDiagnosticRecord {
    let rec = this.turns.get(turnId);
    if (!rec) {
      rec = {
        turnId,
        userId: 'default_user',
        sessionId: 'unknown',
        timestamp: Date.now(),
      };
      if (this.turns.size >= this.MAX_TURNS) {
        const oldestKey = this.turns.keys().next().value;
        if (oldestKey !== undefined) this.turns.delete(oldestKey);
      }
      this.turns.set(turnId, rec);
    }
    return rec;
  }

  public startTurn(turnId: number, userId: string, sessionId: string): void {
    const rec = this.getOrCreateTurn(turnId);
    rec.userId = userId;
    rec.sessionId = sessionId;
    rec.speechStartTime = Date.now();
    this.notify(rec);
  }

  public recordBargeIn(turnId: number, latencyMs: number): void {
    const rec = this.getOrCreateTurn(turnId);
    rec.bargeInTriggered = true;
    rec.bargeInLatencyMs = latencyMs;
    this.notify(rec);
  }

  public recordSpeechEnd(turnId: number, durationSeconds: number, rms: number): void {
    const rec = this.getOrCreateTurn(turnId);
    rec.speechEndTime = Date.now();
    rec.audioDurationSeconds = durationSeconds;
    rec.audioRms = rms;
    this.notify(rec);
  }

  public recordWhisper(turnId: number, text?: string, latencyMs?: number, error?: string): void {
    const rec = this.getOrCreateTurn(turnId);
    rec.whisperText = text;
    rec.whisperLatencyMs = latencyMs;
    rec.whisperError = error;
    this.notify(rec);
  }

  public recordCAM(
    turnId: number,
    decision?: string,
    score?: number,
    centroidScore?: number,
    exemplarScore?: number,
    routingPath?: string,
    latencyMs?: number,
    error?: string,
    status?: 'VERIFIED' | 'PROFILE_NOT_FOUND' | 'MODEL_LOAD_FAILED' | 'INFERENCE_FAILED' | 'INVALID_AUDIO' | 'BYPASSED',
    extra?: {
      audioSegmentId?: string;
      detectedSpeaker?: 'VERIFIED_USER' | 'OTHER_SPEAKER' | 'UNCERTAIN_SPEAKER' | 'OVERLAPPING_SPEECH' | 'PROFILE_NOT_FOUND';
      profileLookupStatus?: 'FOUND' | 'PROFILE_NOT_FOUND' | 'ERROR';
      transcriptSpeakerAssociation?: 'VERIFIED_USER' | 'OTHER_SPEAKER' | 'OVERLAPPING' | 'UNATTRIBUTED';
      detectedSegmentsCount?: number;
      camConversationalScore?: number;
      camShortCommandScore?: number;
      scoringPolicy?: string;
      rawBufferDurationSeconds?: number;
      actualVoicedDurationSeconds?: number;
      voicedFrameCount?: number;
      preSpeechPadMs?: number;
      postSpeechPadMs?: number;
    }
  ): void {
    const rec = this.getOrCreateTurn(turnId);
    rec.camDecision = decision;
    rec.camScore = score;
    rec.camCentroidScore = centroidScore;
    rec.camExemplarScore = exemplarScore;
    rec.camRoutingPath = routingPath;
    rec.camLatencyMs = latencyMs;
    rec.camError = error;
    if (extra?.audioSegmentId) rec.audioSegmentId = extra.audioSegmentId;
    if (extra?.detectedSpeaker) rec.detectedSpeaker = extra.detectedSpeaker;
    if (extra?.profileLookupStatus) rec.profileLookupStatus = extra.profileLookupStatus;
    if (extra?.transcriptSpeakerAssociation) rec.transcriptSpeakerAssociation = extra.transcriptSpeakerAssociation;
    if (extra?.detectedSegmentsCount !== undefined) rec.detectedSegmentsCount = extra.detectedSegmentsCount;
    if (extra?.camConversationalScore !== undefined) rec.camConversationalScore = extra.camConversationalScore;
    if (extra?.camShortCommandScore !== undefined) rec.camShortCommandScore = extra.camShortCommandScore;
    if (extra?.scoringPolicy !== undefined) rec.scoringPolicy = extra.scoringPolicy;
    if (extra?.rawBufferDurationSeconds !== undefined) rec.rawBufferDurationSeconds = extra.rawBufferDurationSeconds;
    if (extra?.actualVoicedDurationSeconds !== undefined) rec.actualVoicedDurationSeconds = extra.actualVoicedDurationSeconds;
    if (extra?.voicedFrameCount !== undefined) rec.voicedFrameCount = extra.voicedFrameCount;
    if (extra?.preSpeechPadMs !== undefined) rec.preSpeechPadMs = extra.preSpeechPadMs;
    if (extra?.postSpeechPadMs !== undefined) rec.postSpeechPadMs = extra.postSpeechPadMs;

    if (status) {
      rec.camStatus = status;
    } else if (error && (error.includes('ProfileNotFound') || error.includes('missing or unrecoverable'))) {
      rec.camStatus = 'PROFILE_NOT_FOUND';
      rec.profileLookupStatus = 'PROFILE_NOT_FOUND';
    } else if (decision) {
      rec.camStatus = 'VERIFIED';
      rec.profileLookupStatus = 'FOUND';
    }
    this.notify(rec);
  }

  public recordNemotronIntent(turnId: number, intent: string): void {
    const rec = this.getOrCreateTurn(turnId);
    rec.nemotronIntentDecision = intent;
    this.notify(rec);
  }

  public recordTerminalState(
    turnId: number,
    state: 'COMPLETED' | 'CANCELLED' | 'PROFILE_NOT_FOUND' | 'DENIED' | 'FAILED' | 'ASR_FAILED' | 'TOOL_PARSE_FAILED' | 'OTHER_SPEAKER' | 'UNCERTAIN_SPEAKER' | 'OVERLAPPING_SPEECH',
    reason?: string
  ): void {
    const rec = this.getOrCreateTurn(turnId);
    rec.terminalState = state;
    if (state === 'CANCELLED') {
      rec.cancelled = true;
    }
    if (reason) {
      rec.cancelReason = reason;
    }
    this.notify(rec);
  }

  public recordAuth(turnId: number, decision: string, scope: string, latencyMs?: number): void {
    const rec = this.getOrCreateTurn(turnId);
    rec.authDecision = decision;
    rec.authScope = scope;
    rec.authLatencyMs = latencyMs;
    if (rec.speechEndTime) {
      rec.totalTurnLatencyMs = Date.now() - rec.speechEndTime;
    }
    this.notify(rec);
  }

  public recordToolExecution(
    turnId: number,
    toolName: string,
    authorized: boolean,
    outcomeReason?: string,
    latencyMs?: number
  ): void {
    const rec = this.getOrCreateTurn(turnId);
    rec.toolName = toolName;
    rec.toolAuthorized = authorized;
    rec.toolOutcomeReason = outcomeReason;
    rec.toolExecutionLatencyMs = latencyMs;
    this.notify(rec);
  }

  public recordCancellation(turnId: number, reason: string): void {
    const rec = this.getOrCreateTurn(turnId);
    rec.cancelled = true;
    rec.cancelReason = reason;
    this.notify(rec);
  }

  public recordWhisperLifecycle(
    turnId: number,
    event: 'WHISPER_MODEL_INITIALIZATION_STARTED' | 'WHISPER_MODEL_INITIALIZATION_COMPLETED' | 'WHISPER_MODEL_REUSED' | 'WHISPER_MODEL_INITIALIZATION_FAILED',
    initDurationMs?: number,
    reuseCount?: number
  ): void {
    const rec = this.getOrCreateTurn(turnId);
    rec.whisperLifecycleEvent = event;
    if (initDurationMs !== undefined) rec.whisperInitDurationMs = initDurationMs;
    if (reuseCount !== undefined) rec.whisperReuseCount = reuseCount;
    this.notify(rec);
  }

  public recordTurnGrant(turnId: number, grantId: string, deadlineMs: number): void {
    const rec = this.getOrCreateTurn(turnId);
    rec.turnGrantId = grantId;
    rec.turnGrantDeadlineMs = deadlineMs;
    this.notify(rec);
  }

  public recordExecutionToken(turnId: number, tokenId: string, remainingTtlMs: number, toolName?: string): void {
    const rec = this.getOrCreateTurn(turnId);
    rec.executionTokenId = tokenId;
    rec.executionTokenTtlRemainingMs = remainingTtlMs;
    if (toolName) rec.toolName = toolName;
    this.notify(rec);
  }

  public recordCompaction(turnId: number, tokensBefore: number, tokensAfter: number): void {
    const rec = this.getOrCreateTurn(turnId);
    rec.compactionCount = (rec.compactionCount || 0) + 1;
    rec.compactionTokensBefore = tokensBefore;
    rec.compactionTokensAfter = tokensAfter;
    this.notify(rec);
  }

  public getTurn(turnId: number): TurnDiagnosticRecord | undefined {
    return this.turns.get(turnId);
  }

  public getRecentTurns(): TurnDiagnosticRecord[] {
    return Array.from(this.turns.values()).sort((a, b) => b.timestamp - a.timestamp);
  }

  public clear(): void {
    this.turns.clear();
  }
}

export const voiceDiagnosticTracker = VoiceDiagnosticTracker.getInstance();
