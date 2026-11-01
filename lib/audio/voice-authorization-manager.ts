/**
 * Pentone Voice Authorization Manager & Capability Gate
 * 
 * CRITICAL SECURITY NOTICE:
 * Biometric speaker verification establishes speaker eligibility only.
 * Speaker similarity DOES NOT constitute liveness detection and DOES NOT
 * provide cryptographic defense against replayed, pre-recorded, synthesized,
 * or cloned audio.
 * 
 * Capability & Enforcement Rules:
 * 1. Single-use capability tokens with a strict 10-second maximum lifetime.
 * 2. Strict binding to authenticated userId, speech turnId, and browser sessionId.
 * 3. Fail-closed behavior for missing, expired, replayed, mismatched, or invalid tokens.
 * 4. REGISTERED_USER grants capability to proceed; it does NOT automatically authorize every action.
 * 5. UNCERTAIN, OTHER_SPEAKER, DISCARDED, and errors NEVER authorize mutating actions.
 * 6. High-impact actions require explicit confirmation beyond speaker verification.
 * 7. Unclassified or unknown tools fail closed immediately.
 */

import { randomUUID } from 'crypto';
import type { SpeakerVerificationDecision } from './speaker-types';
import {
  type VoiceCapabilityScope,
  type VoiceAuthorizationToken,
  type VoiceTurnGrant,
  type TokenValidationOutcome,
  type TokenRejectionReason,
  type VoiceActivationMethod,
  deriveCapabilityScope,
  validateTokenInvariants,
} from './voice-authorization-types';
import {
  classifyTool,
  evaluateHighImpact,
} from './tool-authorization-classifier';

export interface ToolExecutionRequest {
  readonly toolName: string;
  readonly parameters?: any;
  readonly turnId?: number;
  readonly userId?: string;
  readonly sessionId?: string;
  readonly confirmationApproved?: boolean;
  readonly currentTime?: number;
}

export interface MintTokenParams {
  readonly turnId: number;
  readonly userId: string;
  readonly sessionId: string;
  readonly decision?: SpeakerVerificationDecision;
  readonly verificationResult?: { decision?: SpeakerVerificationDecision; [key: string]: any };
  readonly mode?: 'UNIVERSAL_VOICE' | 'BIOMETRIC_ENFORCED';
  readonly activationMethod?: VoiceActivationMethod;
  readonly isPttActive?: boolean;
  readonly isWakeWordActive?: boolean;
  readonly requiresExplicitConfirmation?: boolean;
  readonly currentTime?: number;
}

export interface MintTurnGrantParams {
  readonly turnId: number;
  readonly userId: string;
  readonly sessionId: string;
  readonly decision?: SpeakerVerificationDecision;
  readonly verificationResult?: { decision?: SpeakerVerificationDecision; [key: string]: any };
  readonly mode?: 'UNIVERSAL_VOICE' | 'BIOMETRIC_ENFORCED';
  readonly activationMethod?: VoiceActivationMethod;
  readonly isPttActive?: boolean;
  readonly isWakeWordActive?: boolean;
  readonly requiresExplicitConfirmation?: boolean;
  readonly currentTime?: number;
}

export interface ActiveContext {
  userId: string | null;
  sessionId: string | null;
  turnId: number;
}

export class VoiceAuthorizationManager {
  private activeContext: ActiveContext = {
    userId: 'default_user',
    sessionId: null,
    turnId: 0,
  };

  private readonly activeTokens = new Map<string, VoiceAuthorizationToken>();
  private readonly consumedTokens = new Set<string>();
  private readonly revokedTokens = new Set<string>();
  private readonly inFlightConsumptions = new Set<string>();
  private readonly cancelledTurns = new Set<number>();

  // Level A Voice Turn Grants (30-second absolute deadline per turn)
  private readonly turnGrants = new Map<number, VoiceTurnGrant>();
  private readonly activeGrants = new Map<string, VoiceTurnGrant>();
  private readonly revokedGrants = new Set<string>();

  /**
   * Sets or updates the active authorization context.
   */
  public setActiveContext(context: Partial<ActiveContext>): void {
    if (context.userId !== undefined) this.activeContext.userId = (context.userId || '').trim() || 'default_user';
    if (context.sessionId !== undefined) this.activeContext.sessionId = context.sessionId;
    if (context.turnId !== undefined) this.activeContext.turnId = context.turnId;
  }

  /**
   * Returns current active context.
   */
  public getActiveContext(): Readonly<ActiveContext> {
    return { ...this.activeContext };
  }

  /**
   * Advances the speech turn. Tokens minted for older turns become invalid.
   */
  public advanceTurn(newTurnId: number): void {
    this.activeContext.turnId = newTurnId;
  }

  /**
   * Handles user/account switching: revokes all active tokens minted for the previous account.
   */
  public switchAccount(newUserId: string): void {
    const normalized = (newUserId || '').trim() || 'default_user';
    const previousUserId = this.activeContext.userId;
    if (previousUserId && previousUserId !== normalized) {
      for (const [tokenId, token] of this.activeTokens.entries()) {
        if (token.userId === previousUserId) {
          this.revokedTokens.add(tokenId);
          this.activeTokens.delete(tokenId);
        }
      }
      for (const [turnId, grant] of this.turnGrants.entries()) {
        if (grant.userId === previousUserId) {
          grant.revoked = true;
          grant.revocationReason = 'Account switched';
          this.revokedGrants.add(grant.grantId);
        }
      }
    }
    this.activeContext.userId = normalized;
  }

  /**
   * Handles session termination: revokes all active tokens and grants tied to that session.
   */
  public terminateSession(sessionId: string): void {
    for (const [tokenId, token] of this.activeTokens.entries()) {
      if (token.sessionId === sessionId) {
        this.revokedTokens.add(tokenId);
        this.activeTokens.delete(tokenId);
      }
    }
    for (const [turnId, grant] of this.turnGrants.entries()) {
      if (grant.sessionId === sessionId) {
        grant.revoked = true;
        grant.revocationReason = 'Session terminated';
        this.revokedGrants.add(grant.grantId);
      }
    }
    if (this.activeContext.sessionId === sessionId) {
      this.activeContext.sessionId = null;
    }
  }

  /**
   * Explicitly revokes a specific token.
   */
  public revokeToken(tokenId: string): void {
    this.revokedTokens.add(tokenId);
    this.activeTokens.delete(tokenId);
  }

  /**
   * Cancels a specific speech turn. Immediately revokes any active tokens
   * and turn grants issued for this turn, preventing delayed or late ASR transcripts from executing.
   * This cancellation is idempotent.
   */
  public cancelTurn(turnId: number, reason?: string): void {
    if (turnId <= 0) return;
    this.cancelledTurns.add(turnId);
    for (const [tokenId, token] of this.activeTokens.entries()) {
      if (token.turnId === turnId) {
        this.revokedTokens.add(tokenId);
        this.activeTokens.delete(tokenId);
      }
    }
    const grant = this.turnGrants.get(turnId);
    if (grant) {
      grant.revoked = true;
      grant.revocationReason = reason || 'Turn cancelled';
      this.revokedGrants.add(grant.grantId);
    }
    // Invalidate activeContext turn if matching
    if (this.activeContext.turnId <= turnId) {
      this.activeContext.turnId = turnId + 1;
    }
  }

  /**
   * Checks whether a specific speech turn has been marked as cancelled.
   */
  public isTurnCancelled(turnId: number): boolean {
    return this.cancelledTurns.has(turnId);
  }

  /**
   * Checks whether a specific token has been revoked.
   */
  public isTokenRevoked(tokenId: string): boolean {
    return this.revokedTokens.has(tokenId);
  }

  /**
   * Checks whether a specific token has already been consumed (replay check).
   */
  public isTokenConsumed(tokenId: string): boolean {
    return this.consumedTokens.has(tokenId);
  }

  /**
   * Checks whether a specific token is currently registered and active.
   */
  public isTokenActive(tokenId: string): boolean {
    return this.activeTokens.has(tokenId);
  }

  /**
   * Checks whether a specific turn grant has been revoked.
   */
  public isGrantRevoked(grantId: string): boolean {
    return this.revokedGrants.has(grantId);
  }

  /**
   * Checks whether a specific turn grant is registered and active.
   */
  public isGrantActive(grantId: string): boolean {
    return this.activeGrants.has(grantId) && !this.revokedGrants.has(grantId);
  }

  /**
   * Retrieves an active turn grant by speech turn ID.
   */
  public getGrant(turnId: number): VoiceTurnGrant | undefined {
    return this.turnGrants.get(turnId);
  }

  /**
   * Mints an authoritative Level A Voice Turn Grant upon completion of intentional voice input.
   * Bound to turnId, sessionId, and userId with an absolute 30-second deadline.
   * The grant itself cannot be used directly as a tool execution credential.
   */
  public mintTurnGrant(params: MintTurnGrantParams): VoiceTurnGrant {
    const now = params.currentTime ?? Date.now();
    let maxScope: VoiceCapabilityScope;
    let activationMethod: VoiceActivationMethod;

    const effectiveDecision = params.decision ?? params.verificationResult?.decision;

    if (this.cancelledTurns.has(params.turnId) || params.turnId < this.activeContext.turnId) {
      maxScope = 'DENIED';
      activationMethod = 'UNAUTHORIZED_CONTINUOUS';
    } else if (params.mode === 'BIOMETRIC_ENFORCED' && effectiveDecision) {
      maxScope = deriveCapabilityScope(effectiveDecision);
      activationMethod = 'BIOMETRIC_ENFORCED';
    } else if (effectiveDecision !== undefined && params.mode !== 'UNIVERSAL_VOICE') {
      maxScope = deriveCapabilityScope(effectiveDecision);
      activationMethod = 'BIOMETRIC_ENFORCED';
    } else {
      if (params.activationMethod === 'UNAUTHORIZED_CONTINUOUS' || params.isPttActive === false) {
        maxScope = 'DENIED';
        activationMethod = 'UNAUTHORIZED_CONTINUOUS';
      } else if (params.activationMethod === 'WAKE_WORD' || params.isWakeWordActive === true) {
        maxScope = 'EXECUTE_MUTATING_ACTIONS';
        activationMethod = 'WAKE_WORD';
      } else {
        maxScope = 'EXECUTE_MUTATING_ACTIONS';
        activationMethod = params.activationMethod ?? 'PUSH_TO_TALK';
      }
    }

    const grantId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : randomUUID();

    const grant: VoiceTurnGrant = {
      grantId,
      turnId: params.turnId,
      userId: params.userId,
      sessionId: params.sessionId,
      maxScope,
      issuedAt: now,
      absoluteDeadlineMs: now + 30_000, // Absolute 30s deadline, non-extendable
      activationMethod,
      source: (params.mode === 'BIOMETRIC_ENFORCED' || (params.decision && params.mode !== 'UNIVERSAL_VOICE'))
        ? 'SPEAKER_VERIFIED'
        : 'UNIVERSAL_VOICE',
      requiresExplicitConfirmation: params.requiresExplicitConfirmation ?? false,
      revoked: maxScope === 'DENIED',
    };

    this.turnGrants.set(params.turnId, grant);
    this.activeGrants.set(grantId, grant);
    return grant;
  }

  /**
   * Retrieves active Level A Voice Turn Grant by turnId.
   */
  public getTurnGrant(turnId: number): VoiceTurnGrant | undefined {
    return this.turnGrants.get(turnId);
  }

  /**
   * Mints an ephemeral, single-use Level B execution token immediately before protected tool invocation.
   * Enforces tool binding, scope non-escalation, 10s TTL, and absolute 30s turn deadline.
   */
  public mintExecutionToken(
    grant: VoiceTurnGrant,
    targetToolName: string,
    currentTime?: number
  ): VoiceAuthorizationToken {
    const now = currentTime ?? Date.now();

    // 1. Invalidation/Cancellation check
    const isCancelled = this.cancelledTurns.has(grant.turnId) ||
      grant.revoked ||
      this.revokedGrants.has(grant.grantId);

    // 2. Absolute deadline check (strictly non-extendable)
    const isDeadlineExceeded = now > grant.absoluteDeadlineMs;

    // 3. User / Account mismatch check
    const isAccountMismatch = this.activeContext.userId !== null &&
      this.activeContext.userId !== grant.userId;

    // 4. Session mismatch check
    const isSessionMismatch = this.activeContext.sessionId !== null &&
      grant.sessionId !== this.activeContext.sessionId;

    // 5. Tool classification & scope non-escalation check
    const classification = classifyTool(targetToolName);
    const requiredScope = classification ? classification.requiredScope : 'DENIED';
    const isScopeEscalation = requiredScope === 'EXECUTE_MUTATING_ACTIONS' &&
      grant.maxScope !== 'EXECUTE_MUTATING_ACTIONS';

    const failClosed = isCancelled || isDeadlineExceeded || isAccountMismatch || isSessionMismatch || isScopeEscalation || !classification;

    const effectiveScope: VoiceCapabilityScope = failClosed ? 'DENIED' : requiredScope;

    const remainingGrantMs = grant.absoluteDeadlineMs - now;
    const expiresAt = now + Math.min(10_000, Math.max(0, remainingGrantMs));

    const tokenId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : randomUUID();

    const token: VoiceAuthorizationToken = {
      tokenId,
      grantId: grant.grantId,
      turnId: grant.turnId,
      userId: grant.userId,
      sessionId: grant.sessionId,
      scope: effectiveScope,
      targetToolName,
      issuedAt: now,
      expiresAt: failClosed ? now - 1 : expiresAt,
      requiresExplicitConfirmation: grant.requiresExplicitConfirmation ?? false,
      source: grant.source,
      activationMethod: grant.activationMethod,
    };

    if (!failClosed) {
      this.activeTokens.set(tokenId, token);
    } else {
      this.revokedTokens.add(tokenId);
    }

    return token;
  }

  /**
   * Mints an ephemeral VoiceAuthorizationToken for an active speech turn.
   * 
   * In Universal Voice mode (default):
   * An intentional voice activation (Push-to-Talk or active Wake-Word window) grants
   * EXECUTE_MUTATING_ACTIONS capability for ordinary tools.
   * Audio captured outside an authorized intentional activation session (UNAUTHORIZED_CONTINUOUS)
   * receives DENIED capability to prevent background TV, ambient conversation, or YouTube audio
   * from executing actions.
   * High-impact tools (checkout, banking, passwords) still strictly require interactive confirmation.
   * 
   * In Biometric-Enforced mode:
   * REGISTERED_USER -> EXECUTE_MUTATING_ACTIONS
   * UNCERTAIN       -> READ_ONLY_INFORMATIONAL
   * OTHER_SPEAKER   -> DENIED
   */
  public mintToken(params: MintTokenParams): VoiceAuthorizationToken {
    const now = params.currentTime ?? Date.now();
    let scope: VoiceCapabilityScope;
    let activationMethod: VoiceActivationMethod;

    const effectiveDecision = params.decision ?? params.verificationResult?.decision;

    // MANDATORY SECURITY INVARIANT (Phase 8 Remediation):
    // A cancelled turn or a turn older than active context can NEVER mint an authorizing capability token.
    if (this.cancelledTurns.has(params.turnId) || params.turnId < this.activeContext.turnId) {
      scope = 'DENIED';
      activationMethod = 'UNAUTHORIZED_CONTINUOUS';
    } else if (params.mode === 'BIOMETRIC_ENFORCED' && effectiveDecision) {
      scope = deriveCapabilityScope(effectiveDecision);
      activationMethod = 'BIOMETRIC_ENFORCED';
    } else if (effectiveDecision !== undefined && params.mode !== 'UNIVERSAL_VOICE') {
      scope = deriveCapabilityScope(effectiveDecision);
      activationMethod = 'BIOMETRIC_ENFORCED';
    } else {
      // Universal Voice Mode:
      // SECURITY INVARIANT (Phase 7 Intentional Voice Activation):
      // Only intentional activations (PUSH_TO_TALK or active WAKE_WORD window) grant EXECUTE_MUTATING_ACTIONS.
      // Continuous audio without intentional activation is strictly DENIED.
      if (params.activationMethod === 'UNAUTHORIZED_CONTINUOUS' || params.isPttActive === false) {
        scope = 'DENIED';
        activationMethod = 'UNAUTHORIZED_CONTINUOUS';
      } else if (params.activationMethod === 'WAKE_WORD' || params.isWakeWordActive === true) {
        scope = 'EXECUTE_MUTATING_ACTIONS';
        activationMethod = 'WAKE_WORD';
      } else {
        scope = 'EXECUTE_MUTATING_ACTIONS';
        activationMethod = params.activationMethod ?? 'PUSH_TO_TALK';
      }
    }

    const tokenId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : randomUUID();

    const token: VoiceAuthorizationToken = {
      tokenId,
      turnId: params.turnId,
      userId: params.userId,
      sessionId: params.sessionId,
      scope,
      issuedAt: now,
      expiresAt: now + 10_000,
      requiresExplicitConfirmation: params.requiresExplicitConfirmation ?? false,
      source: (params.mode === 'BIOMETRIC_ENFORCED' || (params.decision && params.mode !== 'UNIVERSAL_VOICE'))
        ? 'SPEAKER_VERIFIED'
        : 'UNIVERSAL_VOICE',
      activationMethod,
    };

    // Store in active registry
    this.activeTokens.set(tokenId, token);
    return token;
  }

  /**
   * Registers an externally minted token (e.g. from background service worker) into the local manager.
   */
  public registerToken(token: VoiceAuthorizationToken): void {
    if (token && token.tokenId) {
      this.activeTokens.set(token.tokenId, token);
    }
  }

  /**
   * Validates and atomically consumes a capability token at an execution boundary.
   * 
   * Guarantees:
   * 1. Unclassified tools fail closed immediately.
   * 2. High-impact tools require explicit confirmation approval.
   * 3. Single-use semantics: token is consumed atomically. Concurrent re-use fails.
   * 4. Session, turn, and account bindings are strictly enforced.
   */
  public validateAndConsume(
    token: unknown,
    request: ToolExecutionRequest
  ): TokenValidationOutcome {
    // 1. Tool Classification Gate (Fail closed on unclassified / unknown tools)
    const classification = classifyTool(request.toolName);
    if (!classification) {
      return {
        authorized: false,
        reason: 'UNCLASSIFIED_TOOL',
        details: `Tool '${request.toolName}' is unclassified or unknown`,
      };
    }

    // 2. High-Impact Action Gate (Confirmation required beyond verification)
    const impact = evaluateHighImpact(request.toolName, request.parameters);
    if (impact.isHighImpact && request.confirmationApproved !== true) {
      return {
        authorized: false,
        reason: 'CONFIRMATION_REQUIRED',
        details: impact.reason || `Tool '${request.toolName}' requires explicit confirmation`,
      };
    }

    // 3. Check Token Presence
    if (!token || typeof token !== 'object') {
      return {
        authorized: false,
        reason: 'MISSING_TOKEN',
        details: 'Execution request lacks voice authorization token',
      };
    }

    const candidateToken = token as Partial<VoiceAuthorizationToken>;
    const tokenId = candidateToken.tokenId;

    if (!tokenId || typeof tokenId !== 'string') {
      return {
        authorized: false,
        reason: 'INVALID_STRUCTURE',
        details: 'Token lacks valid tokenId string',
      };
    }

    // 3b. Tool Binding Check (Level B execution token must match target tool)
    if (candidateToken.targetToolName && candidateToken.targetToolName !== request.toolName) {
      return {
        authorized: false,
        reason: 'TOOL_MISMATCH',
        validatedTokenId: tokenId,
        details: `Execution token bound to tool '${candidateToken.targetToolName}' cannot execute tool '${request.toolName}'`,
      };
    }

    // 3c. Turn Grant Revocation Check
    if (candidateToken.grantId && this.revokedGrants.has(candidateToken.grantId)) {
      return {
        authorized: false,
        reason: 'TOKEN_REVOKED',
        validatedTokenId: tokenId,
        details: `Underlying turn grant '${candidateToken.grantId}' has been revoked`,
      };
    }

    // 3d. Turn Grant Deadline Check
    if (candidateToken.grantId) {
      const grant = this.activeGrants.get(candidateToken.grantId) || (candidateToken.turnId !== undefined ? this.turnGrants.get(candidateToken.turnId) : undefined);
      const currentTime = request.currentTime ?? Date.now();
      if (grant && currentTime > grant.absoluteDeadlineMs) {
        return {
          authorized: false,
          reason: 'DEADLINE_EXCEEDED',
          validatedTokenId: tokenId,
          details: `Underlying turn grant '${candidateToken.grantId}' absolute deadline exceeded`,
        };
      }
    }

    // 4. Atomic Check-and-Lock (Single-Use & Concurrency Guard)
    if (candidateToken.turnId !== undefined && this.cancelledTurns.has(candidateToken.turnId)) {
      return {
        authorized: false,
        reason: 'TOKEN_REVOKED',
        validatedTokenId: tokenId,
        details: `Turn ${candidateToken.turnId} was cancelled before execution`,
      };
    }

    if (this.consumedTokens.has(tokenId)) {
      return {
        authorized: false,
        reason: 'TOKEN_ALREADY_CONSUMED',
        validatedTokenId: tokenId,
        details: 'Token was previously consumed; replay attempt rejected',
      };
    }

    if (this.inFlightConsumptions.has(tokenId)) {
      return {
        authorized: false,
        reason: 'TOKEN_ALREADY_CONSUMED',
        validatedTokenId: tokenId,
        details: 'Concurrent token consumption detected; request rejected',
      };
    }

    // Lock token in-flight synchronously
    this.inFlightConsumptions.add(tokenId);

    try {
      // 5. Context Resolution
      const expectedTurnId = request.turnId ?? this.activeContext.turnId;
      const expectedUserId = request.userId ?? this.activeContext.userId;
      const expectedSessionId = request.sessionId ?? this.activeContext.sessionId;

      if (expectedUserId === null || expectedSessionId === null) {
        return {
          authorized: false,
          reason: 'USER_MISMATCH',
          validatedTokenId: tokenId,
          details: 'Active authorization context not established (missing user or session)',
        };
      }

      // 6. Validate Token Invariants
      const invariantOutcome = validateTokenInvariants(token, {
        expectedTurnId,
        expectedUserId,
        expectedSessionId,
        requiredScope: classification.requiredScope,
        currentTime: request.currentTime,
        consumedTokenIds: this.consumedTokens,
        revokedTokenIds: this.revokedTokens,
      });

      if (!invariantOutcome.authorized) {
        return invariantOutcome;
      }

      // 7. Atomic Consumption Commit
      this.consumedTokens.add(tokenId);
      this.activeTokens.delete(tokenId);

      return {
        authorized: true,
        reason: 'SUCCESS',
        validatedTokenId: tokenId,
      };
    } finally {
      // Release in-flight lock
      this.inFlightConsumptions.delete(tokenId);
    }
  }

  /**
   * Resets all internal manager state (for testing and isolation).
   */
  public clear(): void {
    this.activeContext = { userId: null, sessionId: null, turnId: 0 };
    this.activeTokens.clear();
    this.consumedTokens.clear();
    this.revokedTokens.clear();
    this.cancelledTurns.clear();
    this.inFlightConsumptions.clear();
    this.turnGrants.clear();
    this.activeGrants.clear();
    this.revokedGrants.clear();
  }

  /**
   * Returns current token ledger stats.
   */
  public getStats(): { activeCount: number; consumedCount: number; revokedCount: number } {
    return {
      activeCount: this.activeTokens.size,
      consumedCount: this.consumedTokens.size,
      revokedCount: this.revokedTokens.size,
    };
  }
}

// Export singleton instance for production extension runtime
export const voiceAuthorizationManager = new VoiceAuthorizationManager();
