/**
 * Voice Action Authorization Contracts & Capability Types
 * 
 * Defines the capability boundary that restricts browser-action execution
 * independently of LLM reasoning, system prompt compliance, or tool parser variations.
 * 
 * Security Principles:
 * 1. An authorization token is strictly an ephemeral capability grant, NEVER a permanent credential.
 * 2. Short-lived (maximum lifetime: 10 seconds), single-use semantics for mutating browser actions.
 * 3. Bound to the originating voice turn ID, account/user identity, and active browser session.
 * 4. UNCERTAIN and OTHER_SPEAKER outcomes MUST NEVER be granted action-authorizing capabilities.
 * 5. Zero biometric embeddings, raw audio, or symmetric keys are included inside authorization tokens.
 * 6. Explicit handling for expired, replayed, revoked, and mismatched tokens.
 * 
 * NOTE: This module defines type contracts and structural validation invariants.
 * Cryptographic issuance, stateful consumption tracking, and enforcement hooks
 * in background.ts and lib/tools.ts will be implemented in Milestone 2C.
 */

import type { SpeakerVerificationDecision } from './speaker-types';

/**
 * Capability scopes that can be granted to a voice interaction turn.
 */
export type VoiceCapabilityScope =
  | 'EXECUTE_MUTATING_ACTIONS' // Authorized to invoke mutating DOM/tab tools (clickElement, fillInput, openTab, etc.)
  | 'READ_ONLY_INFORMATIONAL'  // Authorized to inspect page text, summarize, or query (think, summarizePage, getTitle)
  | 'DENIED';                  // Strictly prohibited from invoking any tools; turn dropped immediately

/**
 * Authorization mode and source governing token issuance.
 */
export type AuthorizationSource = 'UNIVERSAL_VOICE' | 'SPEAKER_VERIFIED';

/**
 * Intentional activation method required to grant mutating capability in Universal Voice mode.
 */
export type VoiceActivationMethod =
  | 'PUSH_TO_TALK'
  | 'WAKE_WORD'
  | 'BIOMETRIC_ENFORCED'
  | 'UNAUTHORIZED_CONTINUOUS';

/**
 * Rejection / invalidation reasons for token validation failures.
 */
export type TokenRejectionReason =
  | 'SUCCESS'
  | 'MISSING_TOKEN'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_ALREADY_CONSUMED'
  | 'TOKEN_REVOKED'
  | 'SESSION_MISMATCH'
  | 'USER_MISMATCH'
  | 'TURN_MISMATCH'
  | 'INSUFFICIENT_SCOPE'
  | 'INVALID_STRUCTURE'
  | 'UNCLASSIFIED_TOOL'
  | 'CONFIRMATION_REQUIRED'
  | 'DEADLINE_EXCEEDED'
  | 'TOOL_MISMATCH'
  | 'SCOPE_ESCALATION'
  | 'UNREGISTERED_TOKEN';

/**
 * Level A: Authoritative Voice Turn Grant.
 * Minted upon successful completion of intentional voice input (PTT or active wake-word).
 * Grants capability for the duration of the conversational turn, up to 30 seconds absolute deadline.
 * Cannot be passed directly to tools as an execution credential.
 */
export interface VoiceTurnGrant {
  readonly grantId: string;
  readonly turnId: number;
  readonly userId: string;
  readonly sessionId: string;
  readonly maxScope: VoiceCapabilityScope;
  readonly issuedAt: number;
  readonly absoluteDeadlineMs: number; // Maximum 30,000 ms from issuedAt
  readonly activationMethod: VoiceActivationMethod;
  readonly source: AuthorizationSource;
  readonly requiresExplicitConfirmation?: boolean;
  revoked?: boolean;
  revocationReason?: string;
}

/**
 * Level B: Ephemeral Single-Use Tool Execution Token.
 * Minted immediately before protected tool invocation.
 * Short-lived (10,000 ms TTL), single-use, tool-bound.
 */
export interface VoiceAuthorizationToken {
  readonly tokenId: string; // Unique cryptographic identifier (UUIDv4)
  readonly grantId?: string; // Reference to Level A Voice Turn Grant
  readonly turnId: number; // Monotonic voice turn correlation identifier
  readonly userId: string; // Account identity of the authorized speaker
  readonly sessionId: string; // Browser window/tab session identifier
  readonly scope: VoiceCapabilityScope; // Granted capability scope
  readonly targetToolName?: string; // Specific tool this token authorizes
  readonly issuedAt: number; // Unix timestamp ms when token was minted
  readonly expiresAt: number; // Unix timestamp ms after which token is invalid (max lifetime: 10,000 ms)
  readonly requiresExplicitConfirmation: boolean; // True if action requires manual user modal confirmation
  readonly source?: AuthorizationSource; // Universal voice vs speaker verified grant
  readonly activationMethod?: VoiceActivationMethod; // Intentional activation method (PTT, wake-word, biometric)
}

/**
 * Verification evaluation used to determine capability grant.
 */
export interface VoiceAuthorizationContext {
  readonly turnId: number;
  readonly userId: string;
  readonly sessionId: string;
  readonly verificationDecision: SpeakerVerificationDecision;
  readonly similarityScore: number;
  readonly turnTimestamp: number;
}

/**
 * Token validation result emitted by the authorization guard.
 */
export interface TokenValidationOutcome {
  readonly authorized: boolean;
  readonly reason: TokenRejectionReason;
  readonly validatedTokenId?: string;
  readonly details?: string;
}

/**
 * Derives the strict capability scope from a biometric verification decision.
 * 
 * Security Rule:
 * - REGISTERED_USER -> EXECUTE_MUTATING_ACTIONS
 * - UNCERTAIN       -> READ_ONLY_INFORMATIONAL (never mutates browser state)
 * - OTHER_SPEAKER   -> DENIED (zero tool execution)
 */
export function deriveCapabilityScope(
  decision: SpeakerVerificationDecision
): VoiceCapabilityScope {
  switch (decision) {
    case 'REGISTERED_USER':
      return 'EXECUTE_MUTATING_ACTIONS';
    case 'UNCERTAIN':
      return 'READ_ONLY_INFORMATIONAL';
    case 'OTHER_SPEAKER':
    default:
      return 'DENIED';
  }
}

/**
 * Validates that an authorization token satisfies structural invariants,
 * lifetime bounds, and identity bindings.
 */
export function validateTokenInvariants(
  token: unknown,
  expectedContext: {
    expectedTurnId: number;
    expectedUserId: string;
    expectedSessionId: string;
    requiredScope: VoiceCapabilityScope;
    currentTime?: number;
    consumedTokenIds?: ReadonlySet<string>;
    revokedTokenIds?: ReadonlySet<string>;
  }
): TokenValidationOutcome {
  if (!token || typeof token !== 'object') {
    return { authorized: false, reason: 'MISSING_TOKEN', details: 'Token object is null or undefined' };
  }

  const candidate = token as Partial<VoiceAuthorizationToken>;

  if (
    typeof candidate.tokenId !== 'string' ||
    typeof candidate.turnId !== 'number' ||
    typeof candidate.userId !== 'string' ||
    typeof candidate.sessionId !== 'string' ||
    typeof candidate.scope !== 'string' ||
    typeof candidate.issuedAt !== 'number' ||
    typeof candidate.expiresAt !== 'number'
  ) {
    return { authorized: false, reason: 'INVALID_STRUCTURE', details: 'Token has missing or invalid property types' };
  }

  const now = expectedContext.currentTime ?? Date.now();

  // 1. Check expiration
  if (now > candidate.expiresAt) {
    return {
      authorized: false,
      reason: 'TOKEN_EXPIRED',
      validatedTokenId: candidate.tokenId,
      details: `Token expired at ${candidate.expiresAt} (current time: ${now})`,
    };
  }

  // 2. Check maximum allowed lifetime (10 seconds from issue)
  if (candidate.expiresAt - candidate.issuedAt > 10000 || candidate.expiresAt <= candidate.issuedAt) {
    return {
      authorized: false,
      reason: 'INVALID_STRUCTURE',
      validatedTokenId: candidate.tokenId,
      details: 'Token lifetime exceeds maximum allowed window (10,000 ms) or is non-positive',
    };
  }

  // 3. Check revocation list
  if (expectedContext.revokedTokenIds?.has(candidate.tokenId)) {
    return {
      authorized: false,
      reason: 'TOKEN_REVOKED',
      validatedTokenId: candidate.tokenId,
      details: 'Token has been explicitly revoked',
    };
  }

  // 4. Check single-use / replay prevention
  if (expectedContext.consumedTokenIds?.has(candidate.tokenId)) {
    return {
      authorized: false,
      reason: 'TOKEN_ALREADY_CONSUMED',
      validatedTokenId: candidate.tokenId,
      details: 'Token was previously consumed; replay attempt rejected',
    };
  }

  // 5. Check voice turn binding
  if (candidate.turnId !== expectedContext.expectedTurnId) {
    return {
      authorized: false,
      reason: 'TURN_MISMATCH',
      validatedTokenId: candidate.tokenId,
      details: `Token turnId (${candidate.turnId}) does not match active speech turn (${expectedContext.expectedTurnId})`,
    };
  }

  // 6. Check user/account binding
  if (candidate.userId !== expectedContext.expectedUserId) {
    return {
      authorized: false,
      reason: 'USER_MISMATCH',
      validatedTokenId: candidate.tokenId,
      details: `Token userId ('${candidate.userId}') does not match expected account ('${expectedContext.expectedUserId}')`,
    };
  }

  // 7. Check browser session binding
  if (candidate.sessionId !== expectedContext.expectedSessionId) {
    return {
      authorized: false,
      reason: 'SESSION_MISMATCH',
      validatedTokenId: candidate.tokenId,
      details: `Token sessionId ('${candidate.sessionId}') does not match active session ('${expectedContext.expectedSessionId}')`,
    };
  }

  // 8. Check capability scope sufficiency
  if (expectedContext.requiredScope === 'EXECUTE_MUTATING_ACTIONS') {
    if (candidate.scope !== 'EXECUTE_MUTATING_ACTIONS') {
      return {
        authorized: false,
        reason: 'INSUFFICIENT_SCOPE',
        validatedTokenId: candidate.tokenId,
        details: `Requested action requires 'EXECUTE_MUTATING_ACTIONS', but token has scope '${candidate.scope}'`,
      };
    }
  } else if (expectedContext.requiredScope === 'READ_ONLY_INFORMATIONAL') {
    if (candidate.scope !== 'EXECUTE_MUTATING_ACTIONS' && candidate.scope !== 'READ_ONLY_INFORMATIONAL') {
      return {
        authorized: false,
        reason: 'INSUFFICIENT_SCOPE',
        validatedTokenId: candidate.tokenId,
        details: `Requested action requires informational scope, but token has scope '${candidate.scope}'`,
      };
    }
  }

  return {
    authorized: true,
    reason: 'SUCCESS',
    validatedTokenId: candidate.tokenId,
  };
}
