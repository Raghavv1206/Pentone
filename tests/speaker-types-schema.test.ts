import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAM_SPEAKER_EMBEDDING_DIMENSION,
  validateEmbeddingVector,
  validateDecisionConsistency,
  DEFAULT_VERIFICATION_THRESHOLDS,
  type SpeakerVerificationDecision,
} from '../lib/audio/speaker-types';
import {
  deriveCapabilityScope,
  validateTokenInvariants,
  type VoiceAuthorizationToken,
  type VoiceCapabilityScope,
} from '../lib/audio/voice-authorization-types';

// =================================================================
// 1. Acoustic Vector & Dimension Invariant Tests
// =================================================================

test('Speaker Types: Valid 512-dimensional Float32Array embedding passes validation', () => {
  const validVector = new Float32Array(CAM_SPEAKER_EMBEDDING_DIMENSION);
  for (let i = 0; i < validVector.length; i++) {
    validVector[i] = Math.sin(i);
  }
  const result = validateEmbeddingVector(validVector);
  assert.equal(result.valid, true);
  assert.equal(result.error, undefined);
});

test('Speaker Types: Rejects vector if not a Float32Array', () => {
  const arrayVector = new Array(512).fill(0.1);
  const result = validateEmbeddingVector(arrayVector);
  assert.equal(result.valid, false);
  assert.match(result.error || '', /instance of Float32Array/);
});

test('Speaker Types: Rejects non-512 dimensions (128, 511, 513)', () => {
  const shortVec128 = new Float32Array(128);
  const shortVec511 = new Float32Array(511);
  const longVec513 = new Float32Array(513);

  const res128 = validateEmbeddingVector(shortVec128);
  assert.equal(res128.valid, false);
  assert.match(res128.error || '', /expected 512, got 128/);

  const res511 = validateEmbeddingVector(shortVec511);
  assert.equal(res511.valid, false);
  assert.match(res511.error || '', /expected 512, got 511/);

  const res513 = validateEmbeddingVector(longVec513);
  assert.equal(res513.valid, false);
  assert.match(res513.error || '', /expected 512, got 513/);
});

test('Speaker Types: Rejects embeddings containing NaN or Infinity', () => {
  const nanVector = new Float32Array(512);
  nanVector[250] = NaN;
  const resNan = validateEmbeddingVector(nanVector);
  assert.equal(resNan.valid, false);
  assert.match(resNan.error || '', /non-finite value at index 250/);

  const infVector = new Float32Array(512);
  infVector[10] = Infinity;
  const resInf = validateEmbeddingVector(infVector);
  assert.equal(resInf.valid, false);
  assert.match(resInf.error || '', /non-finite value at index 10/);
});

// =================================================================
// 2. Decision and Threshold Consistency Tests
// =================================================================

test('Speaker Types: Validates all three legitimate verification decisions', () => {
  // 1. REGISTERED_USER (score >= 0.62)
  const resRegistered = validateDecisionConsistency(0.72, 'REGISTERED_USER');
  assert.equal(resRegistered.consistent, true);

  // 2. OTHER_SPEAKER (score < 0.52)
  const resOther = validateDecisionConsistency(0.44, 'OTHER_SPEAKER');
  assert.equal(resOther.consistent, true);

  // 3. UNCERTAIN (0.52 <= score < 0.62)
  const resUncertain = validateDecisionConsistency(0.56, 'UNCERTAIN');
  assert.equal(resUncertain.consistent, true);
});

test('Speaker Types: Rejects contradictory score-decision combinations', () => {
  // Score 0.75 but marked OTHER_SPEAKER
  const badOther = validateDecisionConsistency(0.75, 'OTHER_SPEAKER');
  assert.equal(badOther.consistent, false);
  assert.match(badOther.error || '', /meets accept threshold/);

  // Score 0.40 but marked REGISTERED_USER
  const badRegistered = validateDecisionConsistency(0.40, 'REGISTERED_USER');
  assert.equal(badRegistered.consistent, false);
  assert.match(badRegistered.error || '', /below reject threshold/);

  // Score 0.55 (uncertain zone) but marked REGISTERED_USER
  const badUncertain = validateDecisionConsistency(0.55, 'REGISTERED_USER');
  assert.equal(badUncertain.consistent, false);
  assert.match(badUncertain.error || '', /in uncertain zone/);
});

test('Speaker Types: Rejects non-finite and out-of-bound scores', () => {
  const resNaN = validateDecisionConsistency(NaN, 'OTHER_SPEAKER');
  assert.equal(resNaN.consistent, false);
  assert.match(resNaN.error || '', /must be a finite number/);

  const resOver = validateDecisionConsistency(1.5, 'REGISTERED_USER');
  assert.equal(resOver.consistent, false);
  assert.match(resOver.error || '', /out of bounds/);

  const resUnder = validateDecisionConsistency(-1.2, 'OTHER_SPEAKER');
  assert.equal(resUnder.consistent, false);
  assert.match(resUnder.error || '', /out of bounds/);
});

test('Speaker Types: Rejects corrupted threshold configuration (reject >= accept)', () => {
  const invertedThresholds = {
    acceptThreshold: 0.50,
    rejectThreshold: 0.60,
    minAudioDurationSeconds: 0.40,
    shortCommandCutoffSeconds: 1.20,
  };
  const res = validateDecisionConsistency(0.55, 'UNCERTAIN', invertedThresholds);
  assert.equal(res.consistent, false);
  assert.match(res.error || '', /must be strictly less than/);
});

// =================================================================
// 3. Voice Capability Scope Derivation Tests
// =================================================================

test('Voice Authorization: Strictly limits capability by verification decision', () => {
  // REGISTERED_USER receives mutating action execution authority
  assert.equal(deriveCapabilityScope('REGISTERED_USER'), 'EXECUTE_MUTATING_ACTIONS');

  // UNCERTAIN receives only read-only informational capability (PROHIBITED from mutating actions)
  assert.equal(deriveCapabilityScope('UNCERTAIN'), 'READ_ONLY_INFORMATIONAL');

  // OTHER_SPEAKER receives DENIED (Zero execution authority)
  assert.equal(deriveCapabilityScope('OTHER_SPEAKER'), 'DENIED');
});

// =================================================================
// 4. Token Invariants, Binding & Replay Prevention Tests
// =================================================================

const BASE_TIME = 1730380000000;

function createValidToken(overrides: Partial<VoiceAuthorizationToken> = {}): VoiceAuthorizationToken {
  return {
    tokenId: 'tok-uuid-12345',
    turnId: 42,
    userId: 'user_primary',
    sessionId: 'session_tab_99',
    scope: 'EXECUTE_MUTATING_ACTIONS',
    issuedAt: BASE_TIME,
    expiresAt: BASE_TIME + 5000, // 5 second lifetime
    requiresExplicitConfirmation: false,
    ...overrides,
  };
}

test('Voice Authorization: Valid token matching all invariants is authorized', () => {
  const token = createValidToken();
  const result = validateTokenInvariants(token, {
    expectedTurnId: 42,
    expectedUserId: 'user_primary',
    expectedSessionId: 'session_tab_99',
    requiredScope: 'EXECUTE_MUTATING_ACTIONS',
    currentTime: BASE_TIME + 1000,
  });

  assert.equal(result.authorized, true);
  assert.equal(result.reason, 'SUCCESS');
  assert.equal(result.validatedTokenId, 'tok-uuid-12345');
});

test('Voice Authorization: Rejects expired tokens', () => {
  const token = createValidToken();
  const result = validateTokenInvariants(token, {
    expectedTurnId: 42,
    expectedUserId: 'user_primary',
    expectedSessionId: 'session_tab_99',
    requiredScope: 'EXECUTE_MUTATING_ACTIONS',
    currentTime: BASE_TIME + 6000, // Past expiresAt (BASE_TIME + 5000)
  });

  assert.equal(result.authorized, false);
  assert.equal(result.reason, 'TOKEN_EXPIRED');
});

test('Voice Authorization: Rejects token with lifetime exceeding 10 seconds (max lifetime invariant)', () => {
  const longLivedToken = createValidToken({
    issuedAt: BASE_TIME,
    expiresAt: BASE_TIME + 15000, // 15 seconds (exceeds 10s ceiling)
  });
  const result = validateTokenInvariants(longLivedToken, {
    expectedTurnId: 42,
    expectedUserId: 'user_primary',
    expectedSessionId: 'session_tab_99',
    requiredScope: 'EXECUTE_MUTATING_ACTIONS',
    currentTime: BASE_TIME + 1000,
  });

  assert.equal(result.authorized, false);
  assert.equal(result.reason, 'INVALID_STRUCTURE');
  assert.match(result.details || '', /exceeds maximum allowed window/);
});

test('Voice Authorization: Single-use semantics reject replayed token', () => {
  const token = createValidToken();
  const consumedSet = new Set<string>(['tok-uuid-12345']); // Already consumed

  const result = validateTokenInvariants(token, {
    expectedTurnId: 42,
    expectedUserId: 'user_primary',
    expectedSessionId: 'session_tab_99',
    requiredScope: 'EXECUTE_MUTATING_ACTIONS',
    currentTime: BASE_TIME + 1000,
    consumedTokenIds: consumedSet,
  });

  assert.equal(result.authorized, false);
  assert.equal(result.reason, 'TOKEN_ALREADY_CONSUMED');
  assert.match(result.details || '', /replay attempt rejected/);
});

test('Voice Authorization: Rejects explicitly revoked token', () => {
  const token = createValidToken();
  const revokedSet = new Set<string>(['tok-uuid-12345']);

  const result = validateTokenInvariants(token, {
    expectedTurnId: 42,
    expectedUserId: 'user_primary',
    expectedSessionId: 'session_tab_99',
    requiredScope: 'EXECUTE_MUTATING_ACTIONS',
    currentTime: BASE_TIME + 1000,
    revokedTokenIds: revokedSet,
  });

  assert.equal(result.authorized, false);
  assert.equal(result.reason, 'TOKEN_REVOKED');
});

test('Voice Authorization: Rejects turn ID mismatch (preventing cross-turn execution)', () => {
  const token = createValidToken({ turnId: 41 }); // Token from previous turn

  const result = validateTokenInvariants(token, {
    expectedTurnId: 42, // Current turn is 42
    expectedUserId: 'user_primary',
    expectedSessionId: 'session_tab_99',
    requiredScope: 'EXECUTE_MUTATING_ACTIONS',
    currentTime: BASE_TIME + 1000,
  });

  assert.equal(result.authorized, false);
  assert.equal(result.reason, 'TURN_MISMATCH');
});

test('Voice Authorization: Rejects account/user identity mismatch', () => {
  const token = createValidToken({ userId: 'attacker_account' });

  const result = validateTokenInvariants(token, {
    expectedTurnId: 42,
    expectedUserId: 'user_primary',
    expectedSessionId: 'session_tab_99',
    requiredScope: 'EXECUTE_MUTATING_ACTIONS',
    currentTime: BASE_TIME + 1000,
  });

  assert.equal(result.authorized, false);
  assert.equal(result.reason, 'USER_MISMATCH');
});

test('Voice Authorization: Rejects browser session mismatch', () => {
  const token = createValidToken({ sessionId: 'other_tab_window' });

  const result = validateTokenInvariants(token, {
    expectedTurnId: 42,
    expectedUserId: 'user_primary',
    expectedSessionId: 'session_tab_99',
    requiredScope: 'EXECUTE_MUTATING_ACTIONS',
    currentTime: BASE_TIME + 1000,
  });

  assert.equal(result.authorized, false);
  assert.equal(result.reason, 'SESSION_MISMATCH');
});

test('Voice Authorization: Insufficient scope rejects mutating actions for read-only tokens', () => {
  const readOnlyToken = createValidToken({ scope: 'READ_ONLY_INFORMATIONAL' });

  // Attempt to invoke mutating browser tool with read-only token
  const result = validateTokenInvariants(readOnlyToken, {
    expectedTurnId: 42,
    expectedUserId: 'user_primary',
    expectedSessionId: 'session_tab_99',
    requiredScope: 'EXECUTE_MUTATING_ACTIONS',
    currentTime: BASE_TIME + 1000,
  });

  assert.equal(result.authorized, false);
  assert.equal(result.reason, 'INSUFFICIENT_SCOPE');
  assert.match(result.details || '', /requires 'EXECUTE_MUTATING_ACTIONS'/);
});

test('Voice Authorization: DENIED scope token is rejected for all operations', () => {
  const deniedToken = createValidToken({ scope: 'DENIED' });

  const resMutating = validateTokenInvariants(deniedToken, {
    expectedTurnId: 42,
    expectedUserId: 'user_primary',
    expectedSessionId: 'session_tab_99',
    requiredScope: 'EXECUTE_MUTATING_ACTIONS',
    currentTime: BASE_TIME + 1000,
  });
  assert.equal(resMutating.authorized, false);
  assert.equal(resMutating.reason, 'INSUFFICIENT_SCOPE');

  const resReadOnly = validateTokenInvariants(deniedToken, {
    expectedTurnId: 42,
    expectedUserId: 'user_primary',
    expectedSessionId: 'session_tab_99',
    requiredScope: 'READ_ONLY_INFORMATIONAL',
    currentTime: BASE_TIME + 1000,
  });
  assert.equal(resReadOnly.authorized, false);
  assert.equal(resReadOnly.reason, 'INSUFFICIENT_SCOPE');
});

test('Voice Authorization: Rejects null, undefined, or structurally invalid tokens', () => {
  const resNull = validateTokenInvariants(null, {
    expectedTurnId: 42,
    expectedUserId: 'user_primary',
    expectedSessionId: 'session_tab_99',
    requiredScope: 'EXECUTE_MUTATING_ACTIONS',
  });
  assert.equal(resNull.authorized, false);
  assert.equal(resNull.reason, 'MISSING_TOKEN');

  const resMalformed = validateTokenInvariants({ tokenId: 123 }, {
    expectedTurnId: 42,
    expectedUserId: 'user_primary',
    expectedSessionId: 'session_tab_99',
    requiredScope: 'EXECUTE_MUTATING_ACTIONS',
  });
  assert.equal(resMalformed.authorized, false);
  assert.equal(resMalformed.reason, 'INVALID_STRUCTURE');
});
