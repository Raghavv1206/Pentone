import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VoiceAuthorizationManager,
} from '../lib/audio/voice-authorization-manager';
import {
  classifyTool,
  evaluateHighImpact,
  TOOL_CLASSIFICATIONS,
} from '../lib/audio/tool-authorization-classifier';
import type {
  VoiceAuthorizationToken,
  VoiceCapabilityScope,
} from '../lib/audio/voice-authorization-types';
import type { SpeakerVerificationDecision } from '../lib/audio/speaker-types';

// =====================================================================
// Test Helpers & Setup
// =====================================================================

function createTestManager(opts?: { userId?: string; sessionId?: string; turnId?: number }) {
  const manager = new VoiceAuthorizationManager();
  manager.setActiveContext({
    userId: opts?.userId ?? 'alice_primary',
    sessionId: opts?.sessionId ?? 'session_tab_101',
    turnId: opts?.turnId ?? 1,
  });
  return manager;
}

// =====================================================================
// 1. Speaker Verification Decision Mapping & Capability Scope Tests
// =====================================================================

test('Auth Gate: REGISTERED_USER decision mints EXECUTE_MUTATING_ACTIONS scope', () => {
  const manager = createTestManager();
  const token = manager.mintToken({
    turnId: 1,
    userId: 'alice_primary',
    sessionId: 'session_tab_101',
    decision: 'REGISTERED_USER',
  });

  assert.equal(token.scope, 'EXECUTE_MUTATING_ACTIONS');
  assert.equal(token.turnId, 1);
  assert.equal(token.userId, 'alice_primary');
  assert.equal(token.sessionId, 'session_tab_101');
  assert.ok(token.expiresAt - token.issuedAt <= 10000);
});

test('Auth Gate: UNCERTAIN decision mints READ_ONLY_INFORMATIONAL scope', () => {
  const manager = createTestManager();
  const token = manager.mintToken({
    turnId: 1,
    userId: 'alice_primary',
    sessionId: 'session_tab_101',
    decision: 'UNCERTAIN',
  });

  assert.equal(token.scope, 'READ_ONLY_INFORMATIONAL');
});

test('Auth Gate: OTHER_SPEAKER, DISCARDED, and unknown decisions mint DENIED scope', () => {
  const manager = createTestManager();

  const tokenOther = manager.mintToken({
    turnId: 1,
    userId: 'alice_primary',
    sessionId: 'session_tab_101',
    decision: 'OTHER_SPEAKER',
  });
  assert.equal(tokenOther.scope, 'DENIED');

  const tokenDiscarded = manager.mintToken({
    turnId: 1,
    userId: 'alice_primary',
    sessionId: 'session_tab_101',
    decision: 'DISCARDED' as any,
  });
  assert.equal(tokenDiscarded.scope, 'DENIED');

  const tokenInvalid = manager.mintToken({
    turnId: 1,
    userId: 'alice_primary',
    sessionId: 'session_tab_101',
    decision: 'UNKNOWN_DECISION' as any,
  });
  assert.equal(tokenInvalid.scope, 'DENIED');
});

// =====================================================================
// 2. Capability Scope Enforcement & Action Authorization
// =====================================================================

test('Auth Gate: EXECUTE_MUTATING_ACTIONS authorizes mutating and read-only tools', () => {
  const manager = createTestManager();
  
  // Mutating tool (clickElement)
  const mutatingToken = manager.mintToken({
    turnId: 1,
    userId: 'alice_primary',
    sessionId: 'session_tab_101',
    decision: 'REGISTERED_USER',
  });
  const mutatingOutcome = manager.validateAndConsume(mutatingToken, {
    toolName: 'clickElement',
    parameters: { index: 2 },
  });
  assert.equal(mutatingOutcome.authorized, true);
  assert.equal(mutatingOutcome.reason, 'SUCCESS');

  // Read-only tool (getPageTitle)
  const readOnlyToken = manager.mintToken({
    turnId: 1,
    userId: 'alice_primary',
    sessionId: 'session_tab_101',
    decision: 'REGISTERED_USER',
  });
  const readOnlyOutcome = manager.validateAndConsume(readOnlyToken, {
    toolName: 'getPageTitle',
  });
  assert.equal(readOnlyOutcome.authorized, true);
  assert.equal(readOnlyOutcome.reason, 'SUCCESS');
});

test('Auth Gate: READ_ONLY_INFORMATIONAL authorizes read-only tools but rejects mutating tools', () => {
  const manager = createTestManager();

  // Read-only tool authorized
  const tokenForRead = manager.mintToken({
    turnId: 1,
    userId: 'alice_primary',
    sessionId: 'session_tab_101',
    decision: 'UNCERTAIN',
  });
  const readOutcome = manager.validateAndConsume(tokenForRead, {
    toolName: 'summarizePage',
    parameters: { length: 'short' },
  });
  assert.equal(readOutcome.authorized, true);
  assert.equal(readOutcome.reason, 'SUCCESS');

  // Mutating tool rejected with INSUFFICIENT_SCOPE
  const tokenForMutating = manager.mintToken({
    turnId: 1,
    userId: 'alice_primary',
    sessionId: 'session_tab_101',
    decision: 'UNCERTAIN',
  });
  const mutatingOutcome = manager.validateAndConsume(tokenForMutating, {
    toolName: 'clickElement',
    parameters: { index: 0 },
  });
  assert.equal(mutatingOutcome.authorized, false);
  assert.equal(mutatingOutcome.reason, 'INSUFFICIENT_SCOPE');
});

test('Auth Gate: DENIED scope rejects both read-only and mutating tools', () => {
  const manager = createTestManager();

  const token1 = manager.mintToken({
    turnId: 1,
    userId: 'alice_primary',
    sessionId: 'session_tab_101',
    decision: 'OTHER_SPEAKER',
  });
  const res1 = manager.validateAndConsume(token1, { toolName: 'getPageTitle' });
  assert.equal(res1.authorized, false);
  assert.equal(res1.reason, 'INSUFFICIENT_SCOPE');

  const token2 = manager.mintToken({
    turnId: 1,
    userId: 'alice_primary',
    sessionId: 'session_tab_101',
    decision: 'OTHER_SPEAKER',
  });
  const res2 = manager.validateAndConsume(token2, { toolName: 'clickElement', parameters: { index: 1 } });
  assert.equal(res2.authorized, false);
  assert.equal(res2.reason, 'INSUFFICIENT_SCOPE');
});

// =====================================================================
// 3. Token Invariants: Missing, Expired, Malformed, and Single-Use Replay
// =====================================================================

test('Auth Gate: Missing or null token fails closed (MISSING_TOKEN)', () => {
  const manager = createTestManager();

  const resNull = manager.validateAndConsume(null, { toolName: 'getPageTitle' });
  assert.equal(resNull.authorized, false);
  assert.equal(resNull.reason, 'MISSING_TOKEN');

  const resUndefined = manager.validateAndConsume(undefined, { toolName: 'openTab', parameters: { url: 'https://example.com' } });
  assert.equal(resUndefined.authorized, false);
  assert.equal(resUndefined.reason, 'MISSING_TOKEN');
});

test('Auth Gate: Expired token (>10s) fails closed (TOKEN_EXPIRED)', () => {
  const manager = createTestManager();
  const now = Date.now();

  const token = manager.mintToken({
    turnId: 1,
    userId: 'alice_primary',
    sessionId: 'session_tab_101',
    decision: 'REGISTERED_USER',
    currentTime: now,
  });

  // Advance clock by 10,001 ms (exceeds 10-second lifetime)
  const expiredOutcome = manager.validateAndConsume(token, {
    toolName: 'getPageTitle',
    currentTime: now + 10001,
  });

  assert.equal(expiredOutcome.authorized, false);
  assert.equal(expiredOutcome.reason, 'TOKEN_EXPIRED');
});

test('Auth Gate: Malformed token structure fails closed (INVALID_STRUCTURE)', () => {
  const manager = createTestManager();

  const malformed1 = { tokenId: 12345 };
  const res1 = manager.validateAndConsume(malformed1, { toolName: 'getPageTitle' });
  assert.equal(res1.authorized, false);
  assert.equal(res1.reason, 'INVALID_STRUCTURE');

  const malformed2 = {
    tokenId: 'some-uuid',
    turnId: 'not-a-number',
    userId: 'alice_primary',
    sessionId: 'session_tab_101',
    scope: 'EXECUTE_MUTATING_ACTIONS',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 5000,
  };
  const res2 = manager.validateAndConsume(malformed2, { toolName: 'getPageTitle' });
  assert.equal(res2.authorized, false);
  assert.equal(res2.reason, 'INVALID_STRUCTURE');
});

test('Auth Gate: Token lifetime exceeding 10 seconds is rejected as invalid structure', () => {
  const manager = createTestManager();
  const now = Date.now();

  const forgedToken: VoiceAuthorizationToken = {
    tokenId: 'forged-long-life',
    turnId: 1,
    userId: 'alice_primary',
    sessionId: 'session_tab_101',
    scope: 'EXECUTE_MUTATING_ACTIONS',
    issuedAt: now,
    expiresAt: now + 60000, // 60 seconds (violates 10-second invariant)
    requiresExplicitConfirmation: false,
  };

  const outcome = manager.validateAndConsume(forgedToken, {
    toolName: 'getPageTitle',
    currentTime: now + 1000,
  });

  assert.equal(outcome.authorized, false);
  assert.equal(outcome.reason, 'INVALID_STRUCTURE');
});

test('Auth Gate: Single-use replay protection strictly blocks reused tokens', () => {
  const manager = createTestManager();
  const token = manager.mintToken({
    turnId: 1,
    userId: 'alice_primary',
    sessionId: 'session_tab_101',
    decision: 'REGISTERED_USER',
  });

  // First consumption succeeds
  const firstUse = manager.validateAndConsume(token, {
    toolName: 'openTab',
    parameters: { url: 'https://example.com' },
  });
  assert.equal(firstUse.authorized, true);
  assert.equal(firstUse.reason, 'SUCCESS');

  // Second consumption attempt with identical token MUST fail closed
  const replayAttempt = manager.validateAndConsume(token, {
    toolName: 'openTab',
    parameters: { url: 'https://example.com' },
  });
  assert.equal(replayAttempt.authorized, false);
  assert.equal(replayAttempt.reason, 'TOKEN_ALREADY_CONSUMED');
});

// =====================================================================
// 4. Cross-Context Binding: Turn, Session, and Account Isolation
// =====================================================================

test('Auth Gate: Turn mismatch rejects token from earlier or different turn', () => {
  const manager = createTestManager({ turnId: 2 });

  const tokenTurn1 = manager.mintToken({
    turnId: 1,
    userId: 'alice_primary',
    sessionId: 'session_tab_101',
    decision: 'REGISTERED_USER',
  });

  // Current active turn is 2; token issued for turn 1
  const outcome = manager.validateAndConsume(tokenTurn1, {
    toolName: 'getPageTitle',
  });
  assert.equal(outcome.authorized, false);
  assert.equal(outcome.reason, 'TURN_MISMATCH');
});

test('Auth Gate: Session mismatch rejects token from another tab or window', () => {
  const manager = createTestManager({ sessionId: 'session_active_window' });

  const tokenOtherSession = manager.mintToken({
    turnId: 1,
    userId: 'alice_primary',
    sessionId: 'session_background_tab',
    decision: 'REGISTERED_USER',
  });

  const outcome = manager.validateAndConsume(tokenOtherSession, {
    toolName: 'getPageTitle',
  });
  assert.equal(outcome.authorized, false);
  assert.equal(outcome.reason, 'SESSION_MISMATCH');
});

test('Auth Gate: User account mismatch rejects token from different user', () => {
  const manager = createTestManager({ userId: 'alice_primary' });

  const tokenEve = manager.mintToken({
    turnId: 1,
    userId: 'eve_attacker',
    sessionId: 'session_tab_101',
    decision: 'REGISTERED_USER',
  });

  const outcome = manager.validateAndConsume(tokenEve, {
    toolName: 'getPageTitle',
  });
  assert.equal(outcome.authorized, false);
  assert.equal(outcome.reason, 'USER_MISMATCH');
});

// =====================================================================
// 5. Concurrency & Race-Condition Guard Tests
// =====================================================================

test('Auth Gate: Concurrent consumption attempts allow exactly one success', async () => {
  const manager = createTestManager();
  const token = manager.mintToken({
    turnId: 1,
    userId: 'alice_primary',
    sessionId: 'session_tab_101',
    decision: 'REGISTERED_USER',
  });

  // Fire 5 simultaneous consumption attempts with the same token
  const attempts = await Promise.all([
    Promise.resolve().then(() => manager.validateAndConsume(token, { toolName: 'getPageTitle' })),
    Promise.resolve().then(() => manager.validateAndConsume(token, { toolName: 'getPageTitle' })),
    Promise.resolve().then(() => manager.validateAndConsume(token, { toolName: 'getPageTitle' })),
    Promise.resolve().then(() => manager.validateAndConsume(token, { toolName: 'getPageTitle' })),
    Promise.resolve().then(() => manager.validateAndConsume(token, { toolName: 'getPageTitle' })),
  ]);

  const successes = attempts.filter((r) => r.authorized);
  const rejections = attempts.filter((r) => !r.authorized && r.reason === 'TOKEN_ALREADY_CONSUMED');

  assert.equal(successes.length, 1, 'Exactly one concurrent request must be authorized');
  assert.equal(rejections.length, 4, 'All concurrent duplicate requests must fail closed');
});

// =====================================================================
// 6. Account Switching & Session Termination Tests
// =====================================================================

test('Auth Gate: Account switching immediately revokes tokens issued for prior account', () => {
  const manager = createTestManager({ userId: 'alice_primary' });

  const tokenAlice = manager.mintToken({
    turnId: 1,
    userId: 'alice_primary',
    sessionId: 'session_tab_101',
    decision: 'REGISTERED_USER',
  });

  // Switch account to Bob
  manager.switchAccount('bob_secondary');

  const outcome = manager.validateAndConsume(tokenAlice, {
    toolName: 'getPageTitle',
  });
  assert.equal(outcome.authorized, false);
  assert.ok(outcome.reason === 'TOKEN_REVOKED' || outcome.reason === 'USER_MISMATCH');
});

test('Auth Gate: Session termination revokes tokens tied to terminated session', () => {
  const manager = createTestManager({ sessionId: 'session_tab_101' });

  const token = manager.mintToken({
    turnId: 1,
    userId: 'alice_primary',
    sessionId: 'session_tab_101',
    decision: 'REGISTERED_USER',
  });

  // Terminate tab session 101
  manager.terminateSession('session_tab_101');

  const outcome = manager.validateAndConsume(token, {
    toolName: 'getPageTitle',
    sessionId: 'session_tab_101',
  });
  assert.equal(outcome.authorized, false);
  assert.equal(outcome.reason, 'TOKEN_REVOKED');
});

// =====================================================================
// 7. Tool Classification & Unknown Tool Rejection
// =====================================================================

test('Auth Gate: Unknown or unclassified tools fail closed (UNCLASSIFIED_TOOL)', () => {
  const manager = createTestManager();
  const token = manager.mintToken({
    turnId: 1,
    userId: 'alice_primary',
    sessionId: 'session_tab_101',
    decision: 'REGISTERED_USER',
  });

  const resUnknown = manager.validateAndConsume(token, {
    toolName: 'unregistered_exploit_tool',
  });
  assert.equal(resUnknown.authorized, false);
  assert.equal(resUnknown.reason, 'UNCLASSIFIED_TOOL');

  const resInjected = manager.validateAndConsume(token, {
    toolName: '__proto__',
  });
  assert.equal(resInjected.authorized, false);
  assert.equal(resInjected.reason, 'UNCLASSIFIED_TOOL');
});

test('Auth Gate: All 25 registered tools are classified with required capability scope', () => {
  const registeredTools = [
    'think', 'getPageTitle', 'captureScreenshot', 'getAccessibilitySnapshot',
    'findElements', 'listen', 'writeContent', 'summarizePage', 'getMemories',
    'translateText', 'detectLanguage', 'captureCurrentPage', 'searchVault',
    'getVaultStats', 'getPlaybook', 'getTabs', 'openTab', 'clickElement',
    'fillInput', 'scrollUp', 'scrollDown', 'pressKey', 'highlightSelector',
    'highlightText', 'storeMemory', 'switchTab'
  ];

  for (const name of registeredTools) {
    const classification = classifyTool(name);
    assert.ok(classification !== null, `Tool '${name}' must be classified`);
    assert.ok(
      classification.actionType === 'READ_ONLY' || classification.actionType === 'MUTATING',
      `Tool '${name}' must have valid actionType`
    );
    assert.ok(
      classification.requiredScope === 'READ_ONLY_INFORMATIONAL' ||
      classification.requiredScope === 'EXECUTE_MUTATING_ACTIONS',
      `Tool '${name}' must specify valid requiredScope`
    );
  }
});

// =====================================================================
// 8. Sensitive-Action Confirmation Gate Tests
// =====================================================================

test('Auth Gate: Destructive or checkout clickElement requires explicit confirmation', () => {
  const manager = createTestManager();

  // 1. Checkout / Pay action without confirmation MUST FAIL CLOSED
  const token1 = manager.mintToken({
    turnId: 1,
    userId: 'alice_primary',
    sessionId: 'session_tab_101',
    decision: 'REGISTERED_USER',
  });
  const checkoutOutcome = manager.validateAndConsume(token1, {
    toolName: 'clickElement',
    parameters: { label: 'Confirm Payment and Place Order' },
    confirmationApproved: false,
  });
  assert.equal(checkoutOutcome.authorized, false);
  assert.equal(checkoutOutcome.reason, 'CONFIRMATION_REQUIRED');

  // 2. Checkout / Pay action WITH explicit confirmation SUCCEEDS
  const token2 = manager.mintToken({
    turnId: 1,
    userId: 'alice_primary',
    sessionId: 'session_tab_101',
    decision: 'REGISTERED_USER',
  });
  const approvedOutcome = manager.validateAndConsume(token2, {
    toolName: 'clickElement',
    parameters: { label: 'Confirm Payment and Place Order' },
    confirmationApproved: true,
  });
  assert.equal(approvedOutcome.authorized, true);
  assert.equal(approvedOutcome.reason, 'SUCCESS');
});

test('Auth Gate: fillInput with sensitive credentials or payment cards requires explicit confirmation', () => {
  const manager = createTestManager();

  // Sensitive credit card input without confirmation fails closed
  const token1 = manager.mintToken({
    turnId: 1,
    userId: 'alice_primary',
    sessionId: 'session_tab_101',
    decision: 'REGISTERED_USER',
  });
  const cardOutcome = manager.validateAndConsume(token1, {
    toolName: 'fillInput',
    parameters: { fieldName: 'creditcard_number', value: '4111 2222 3333 4444' },
    confirmationApproved: false,
  });
  assert.equal(cardOutcome.authorized, false);
  assert.equal(cardOutcome.reason, 'CONFIRMATION_REQUIRED');

  // Same action with explicit user confirmation succeeds
  const token2 = manager.mintToken({
    turnId: 1,
    userId: 'alice_primary',
    sessionId: 'session_tab_101',
    decision: 'REGISTERED_USER',
  });
  const approvedOutcome = manager.validateAndConsume(token2, {
    toolName: 'fillInput',
    parameters: { fieldName: 'creditcard_number', value: '4111 2222 3333 4444' },
    confirmationApproved: true,
  });
  assert.equal(approvedOutcome.authorized, true);
  assert.equal(approvedOutcome.reason, 'SUCCESS');
});

test('Auth Gate: openTab to banking or payment endpoint requires explicit confirmation', () => {
  const manager = createTestManager();

  const token1 = manager.mintToken({
    turnId: 1,
    userId: 'alice_primary',
    sessionId: 'session_tab_101',
    decision: 'REGISTERED_USER',
  });
  const bankingOutcome = manager.validateAndConsume(token1, {
    toolName: 'openTab',
    parameters: { url: 'https://paypal.com/checkout/pay' },
    confirmationApproved: false,
  });
  assert.equal(bankingOutcome.authorized, false);
  assert.equal(bankingOutcome.reason, 'CONFIRMATION_REQUIRED');

  // Normal navigation does not require separate confirmation
  const token2 = manager.mintToken({
    turnId: 1,
    userId: 'alice_primary',
    sessionId: 'session_tab_101',
    decision: 'REGISTERED_USER',
  });
  const normalOutcome = manager.validateAndConsume(token2, {
    toolName: 'openTab',
    parameters: { url: 'https://developer.mozilla.org/en-US/' },
  });
  assert.equal(normalOutcome.authorized, true);
  assert.equal(normalOutcome.reason, 'SUCCESS');
});

// =====================================================================
// 9. Liveness & Spoofing Disclaimer Contract
// =====================================================================

test('Auth Gate: Architecture adheres to liveness boundary disclaimer', () => {
  // Biometric similarity alone is never treated as liveness detection
  const manager = createTestManager();
  const token = manager.mintToken({
    turnId: 1,
    userId: 'alice_primary',
    sessionId: 'session_tab_101',
    decision: 'REGISTERED_USER',
  });

  // Token grants capability eligibility, but does NOT bypass high-impact confirmations
  const sensitiveOutcome = manager.validateAndConsume(token, {
    toolName: 'clickElement',
    parameters: { label: 'delete account permanently' },
    confirmationApproved: false,
  });
  assert.equal(sensitiveOutcome.authorized, false);
  assert.equal(sensitiveOutcome.reason, 'CONFIRMATION_REQUIRED');
});
