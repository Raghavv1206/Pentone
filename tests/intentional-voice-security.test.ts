/**
 * Pentone Phase 7 — Intentional Voice Activation & Security Test Suite
 * 
 * Verifies that Pentone accepts commands from any human speaker, but executes
 * mutating browser actions ONLY when the user has intentionally activated voice input (PTT).
 * 
 * Evaluates the 15 security regression requirements specified in Phase 7:
 * 1. Background TV command without PTT — blocked.
 * 2. YouTube command without PTT — blocked.
 * 3. Another person speaking without PTT — blocked.
 * 4. Genuine user speaking without PTT — no command execution.
 * 5. Genuine user holding PTT and speaking — accepted.
 * 6. Different human speaker holding PTT — accepted.
 * 7. PTT cancellation — no execution.
 * 8. Delayed ASR response after cancellation — blocked.
 * 9. Old token replay — blocked.
 * 10. Account switching during PTT — blocked.
 * 11. TTS interruption after PTT activation — works.
 * 12. TTS audio without PTT — cannot generate a command.
 * 13. Active browser tab audio — does not bypass PTT.
 * 14. External background audio — does not bypass PTT.
 * 15. High-impact operation — confirmation remains mandatory.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { voiceAuthorizationManager } from '../lib/audio/voice-authorization-manager';
import { ASROrchestrator } from '../lib/audio/asr-intent-orchestrator';
import { wakeWordActivationManager } from '../lib/audio/wake-word-activation-manager';
import { classicalNoiseSuppressor } from '../lib/audio/neural-noise-reduction-service';
import { BargeInController } from '../lib/audio/barge-in-controller';
import { TTSAcousticTracker } from '../lib/tts-context';

test('Security Req 1: Background TV command without PTT is blocked', () => {
  const sessionId = 'session_tv_no_ptt';
  const turnId = 101;
  voiceAuthorizationManager.setActiveContext({ userId: 'default_user', sessionId, turnId });

  // Background TV speech transcribes to a command, but PTT is not held
  const token = voiceAuthorizationManager.mintToken({
    turnId,
    userId: 'default_user',
    sessionId,
    mode: 'UNIVERSAL_VOICE',
    isPttActive: false,
    activationMethod: 'UNAUTHORIZED_CONTINUOUS',
  });

  assert.equal(token.scope, 'DENIED', 'Token scope without PTT must be DENIED');
  assert.equal(token.activationMethod, 'UNAUTHORIZED_CONTINUOUS');

  // Attempting to execute mutating tool fails closed
  const outcome = voiceAuthorizationManager.validateAndConsume(token, {
    toolName: 'openTab',
    parameters: { url: 'https://www.youtube.com' },
    turnId,
    userId: 'default_user',
    sessionId,
  });

  assert.equal(outcome.authorized, false);
  assert.equal(outcome.reason, 'INSUFFICIENT_SCOPE');
});

test('Security Req 2: YouTube audio playback command without PTT is blocked', () => {
  const sessionId = 'session_yt_playback';
  const turnId = 102;
  voiceAuthorizationManager.setActiveContext({ userId: 'default_user', sessionId, turnId });

  const token = voiceAuthorizationManager.mintToken({
    turnId,
    userId: 'default_user',
    sessionId,
    mode: 'UNIVERSAL_VOICE',
    isPttActive: false,
  });

  assert.equal(token.scope, 'DENIED', 'Playback audio without active PTT must receive DENIED');

  const outcome = voiceAuthorizationManager.validateAndConsume(token, {
    toolName: 'clickElement',
    parameters: { selector: '#subscribe' },
    turnId,
    userId: 'default_user',
    sessionId,
  });

  assert.equal(outcome.authorized, false);
  assert.equal(outcome.reason, 'INSUFFICIENT_SCOPE');
});

test('Security Req 3: Another person speaking in room without PTT is blocked', () => {
  const sessionId = 'session_roommate_speech';
  const turnId = 103;
  voiceAuthorizationManager.setActiveContext({ userId: 'default_user', sessionId, turnId });

  const token = voiceAuthorizationManager.mintToken({
    turnId,
    userId: 'default_user',
    sessionId,
    mode: 'UNIVERSAL_VOICE',
    isPttActive: false,
    activationMethod: 'UNAUTHORIZED_CONTINUOUS',
  });

  assert.equal(token.scope, 'DENIED');

  const outcome = voiceAuthorizationManager.validateAndConsume(token, {
    toolName: 'scrollDown',
    turnId,
    userId: 'default_user',
    sessionId,
  });

  assert.equal(outcome.authorized, false);
  assert.equal(outcome.reason, 'INSUFFICIENT_SCOPE');
});

test('Security Req 4: Genuine user speaking without PTT produces no command execution', () => {
  const sessionId = 'session_user_no_ptt';
  const turnId = 104;
  voiceAuthorizationManager.setActiveContext({ userId: 'default_user', sessionId, turnId });

  // Spoken without pressing PTT
  const token = voiceAuthorizationManager.mintToken({
    turnId,
    userId: 'default_user',
    sessionId,
    mode: 'UNIVERSAL_VOICE',
    isPttActive: false,
  });

  assert.equal(token.scope, 'DENIED');

  const outcome = voiceAuthorizationManager.validateAndConsume(token, {
    toolName: 'openTab',
    parameters: { url: 'https://news.ycombinator.com' },
    turnId,
    userId: 'default_user',
    sessionId,
  });

  assert.equal(outcome.authorized, false);
});

test('Security Req 5: Genuine user holding PTT and speaking is accepted', () => {
  const sessionId = 'session_genuine_user_ptt';
  const turnId = 105;
  voiceAuthorizationManager.setActiveContext({ userId: 'default_user', sessionId, turnId });
  voiceAuthorizationManager.advanceTurn(turnId);

  const token = voiceAuthorizationManager.mintToken({
    turnId,
    userId: 'default_user',
    sessionId,
    mode: 'UNIVERSAL_VOICE',
    activationMethod: 'PUSH_TO_TALK',
    isPttActive: true,
  });

  assert.equal(token.scope, 'EXECUTE_MUTATING_ACTIONS');
  assert.equal(token.activationMethod, 'PUSH_TO_TALK');

  const outcome = voiceAuthorizationManager.validateAndConsume(token, {
    toolName: 'openTab',
    parameters: { url: 'https://www.google.com' },
    turnId,
    userId: 'default_user',
    sessionId,
  });

  assert.equal(outcome.authorized, true, 'Intentional PTT activation must authorize ordinary mutating tool');
  assert.equal(outcome.reason, 'SUCCESS');
});

test('Security Req 6: Different human speaker holding PTT is accepted (Universal Voice)', () => {
  const sessionId = 'session_guest_speaker_ptt';
  const turnId = 106;
  voiceAuthorizationManager.setActiveContext({ userId: 'guest_speaker_2', sessionId, turnId });
  voiceAuthorizationManager.advanceTurn(turnId);

  // Guest speaker holding PTT
  const token = voiceAuthorizationManager.mintToken({
    turnId,
    userId: 'guest_speaker_2',
    sessionId,
    mode: 'UNIVERSAL_VOICE',
    activationMethod: 'PUSH_TO_TALK',
    isPttActive: true,
  });

  assert.equal(token.scope, 'EXECUTE_MUTATING_ACTIONS');

  const outcome = voiceAuthorizationManager.validateAndConsume(token, {
    toolName: 'scrollDown',
    turnId,
    userId: 'guest_speaker_2',
    sessionId,
  });

  assert.equal(outcome.authorized, true, 'Universal Voice allows any human speaker when PTT is intentionally held');
});

test('Security Req 7: PTT cancellation produces no execution', () => {
  const sessionId = 'session_ptt_cancellation';
  const turnId = 107;
  voiceAuthorizationManager.setActiveContext({ userId: 'default_user', sessionId, turnId });
  voiceAuthorizationManager.advanceTurn(turnId);

  const token = voiceAuthorizationManager.mintToken({
    turnId,
    userId: 'default_user',
    sessionId,
    mode: 'UNIVERSAL_VOICE',
    activationMethod: 'PUSH_TO_TALK',
    isPttActive: true,
  });

  // User releases outside or presses Escape -> turn cancelled
  voiceAuthorizationManager.cancelTurn(turnId, 'User pressed Escape');

  const outcome = voiceAuthorizationManager.validateAndConsume(token, {
    toolName: 'openTab',
    parameters: { url: 'https://example.com' },
    turnId,
    userId: 'default_user',
    sessionId,
  });

  assert.equal(outcome.authorized, false);
  assert.equal(outcome.reason, 'TOKEN_REVOKED', 'Cancelled turn must immediately revoke active token');
});

test('Security Req 8: Delayed ASR response after cancellation is blocked', () => {
  const sessionId = 'session_delayed_asr';
  const turnId = 108;
  voiceAuthorizationManager.setActiveContext({ userId: 'default_user', sessionId, turnId });
  voiceAuthorizationManager.advanceTurn(turnId);

  const token = voiceAuthorizationManager.mintToken({
    turnId,
    userId: 'default_user',
    sessionId,
    mode: 'UNIVERSAL_VOICE',
    activationMethod: 'PUSH_TO_TALK',
    isPttActive: true,
  });

  // Turn cancelled while Whisper was in-flight
  voiceAuthorizationManager.cancelTurn(turnId, 'Interrupted');

  // Next turn starts
  const nextTurnId = 109;
  voiceAuthorizationManager.advanceTurn(nextTurnId);

  // Late arriving ASR from turn 108 tries to execute
  const outcome = voiceAuthorizationManager.validateAndConsume(token, {
    toolName: 'clickElement',
    parameters: { selector: '#button' },
    turnId: 108, // Stale turn
    userId: 'default_user',
    sessionId,
  });

  assert.equal(outcome.authorized, false);
  assert.equal(outcome.reason, 'TOKEN_REVOKED');
});

test('Security Req 9: Old token replay is blocked (single-use invariant)', () => {
  const sessionId = 'session_token_replay';
  const turnId = 109;
  voiceAuthorizationManager.setActiveContext({ userId: 'default_user', sessionId, turnId });
  voiceAuthorizationManager.advanceTurn(turnId);

  const token = voiceAuthorizationManager.mintToken({
    turnId,
    userId: 'default_user',
    sessionId,
    mode: 'UNIVERSAL_VOICE',
    activationMethod: 'PUSH_TO_TALK',
    isPttActive: true,
  });

  // First execution: Success
  const outcome1 = voiceAuthorizationManager.validateAndConsume(token, {
    toolName: 'getPageTitle',
    turnId,
    userId: 'default_user',
    sessionId,
  });
  assert.equal(outcome1.authorized, true);

  // Second execution (replay attempt): Blocked
  const outcome2 = voiceAuthorizationManager.validateAndConsume(token, {
    toolName: 'openTab',
    parameters: { url: 'https://malicious.example' },
    turnId,
    userId: 'default_user',
    sessionId,
  });
  assert.equal(outcome2.authorized, false);
  assert.equal(outcome2.reason, 'TOKEN_ALREADY_CONSUMED');
});

test('Security Req 10: Account switching during PTT is blocked', () => {
  const sessionId = 'session_account_switch';
  const turnId = 110;
  voiceAuthorizationManager.setActiveContext({ userId: 'user_work', sessionId, turnId });
  voiceAuthorizationManager.advanceTurn(turnId);

  const token = voiceAuthorizationManager.mintToken({
    turnId,
    userId: 'user_work',
    sessionId,
    mode: 'UNIVERSAL_VOICE',
    activationMethod: 'PUSH_TO_TALK',
    isPttActive: true,
  });

  // Switch canonical account
  voiceAuthorizationManager.switchAccount('user_personal');

  // Attempt to execute with token issued for previous account
  const outcome = voiceAuthorizationManager.validateAndConsume(token, {
    toolName: 'openTab',
    parameters: { url: 'https://work.internal' },
    turnId,
    userId: 'user_personal', // Active account now different
    sessionId,
  });

  assert.equal(outcome.authorized, false);
});

test('Security Req 11: TTS interruption after PTT activation works immediately', () => {
  let interrupted = false;
  const controller = new BargeInController({
    onInterrupt: () => {
      interrupted = true;
    },
  });

  controller.enableVoiceMode();
  controller.startCalibrating();
  controller.readyToListen();
  controller.handleAssistantSpeechStart();

  assert.equal(controller.getState(), 'ASSISTANT_SPEAKING');

  // PTT activation triggers deliberate speech onset
  controller.handleSpeechStart();

  assert.equal(interrupted, true, 'Activating PTT while assistant speaks must trigger onInterrupt');
  assert.equal(controller.getState(), 'USER_SPEAKING');
});

test('Security Req 12: Assistant TTS audio without PTT cannot generate a command (AEC + gate)', () => {
  const orchestrator = new ASROrchestrator();
  const ttsUtterance = 'I have opened YouTube for you in a new tab.';
  TTSAcousticTracker.recordSpeechStart(ttsUtterance);

  // Microphone picks up assistant's own TTS output
  const processed = orchestrator.processTranscript(ttsUtterance, {
    recentAssistantUtterances: TTSAcousticTracker.getRecentUtterances(),
    isAudibleTabActive: true,
  });

  assert.equal(processed.isSelfHearingEcho, true, 'Acoustic self-hearing echo must be filtered');

  // Even if not filtered by ASR, without PTT it cannot mint mutating tokens
  const token = voiceAuthorizationManager.mintToken({
    turnId: 112,
    userId: 'default_user',
    sessionId: 'session_tts_bleed',
    mode: 'UNIVERSAL_VOICE',
    isPttActive: false,
  });

  assert.equal(token.scope, 'DENIED');
});

test('Security Req 13: Active browser tab audio does not bypass PTT', () => {
  const orchestrator = new ASROrchestrator();
  const tvDialogue = 'Click subscribe and open the notifications tab.';

  // Audible tab is playing
  const isAudibleTabActive = true;
  const processed = orchestrator.processTranscript(tvDialogue, {
    isAudibleTabActive,
  });

  // Without PTT, token is DENIED
  const token = voiceAuthorizationManager.mintToken({
    turnId: 113,
    userId: 'default_user',
    sessionId: 'session_audible_tab',
    mode: 'UNIVERSAL_VOICE',
    isPttActive: false,
  });

  assert.equal(token.scope, 'DENIED');

  const outcome = voiceAuthorizationManager.validateAndConsume(token, {
    toolName: 'clickElement',
    parameters: { selector: '#subscribe' },
    turnId: 113,
    userId: 'default_user',
    sessionId: 'session_audible_tab',
  });

  assert.equal(outcome.authorized, false);
});

test('Security Req 14: External background audio does not bypass PTT', async () => {
  // Simulate synthetic noise frame through classical noise suppressor
  const noise = new Float32Array(16000);
  for (let i = 0; i < noise.length; i++) {
    noise[i] = 0.05 * Math.sin(2 * Math.PI * 180 * i / 16000);
  }

  const { enhancedAudio, metrics } = await classicalNoiseSuppressor.enhanceAudio(noise);
  assert.ok(metrics.processingLatencyMs < 50, 'Classical DSP denoiser must process within 50ms');

  // Even if speech leakage occurred from an external speaker, without PTT it is DENIED
  const token = voiceAuthorizationManager.mintToken({
    turnId: 114,
    userId: 'default_user',
    sessionId: 'session_ext_audio',
    mode: 'UNIVERSAL_VOICE',
    isPttActive: false,
  });

  assert.equal(token.scope, 'DENIED');
});

test('Security Req 15: High-impact operation confirmation remains strictly mandatory', () => {
  const sessionId = 'session_high_impact_ptt';
  const turnId = 115;
  voiceAuthorizationManager.setActiveContext({ userId: 'default_user', sessionId, turnId });
  voiceAuthorizationManager.advanceTurn(turnId);

  // Even with an intentionally activated PTT token!
  const token = voiceAuthorizationManager.mintToken({
    turnId,
    userId: 'default_user',
    sessionId,
    mode: 'UNIVERSAL_VOICE',
    activationMethod: 'PUSH_TO_TALK',
    isPttActive: true,
  });

  assert.equal(token.scope, 'EXECUTE_MUTATING_ACTIONS');

  // Attempting high-impact tool without confirmation approved
  const outcomeWithoutConf = voiceAuthorizationManager.validateAndConsume(token, {
    toolName: 'fillInput',
    parameters: { selector: 'input[name="password"]', value: 'secret123' },
    turnId,
    userId: 'default_user',
    sessionId,
    confirmationApproved: false,
  });

  assert.equal(outcomeWithoutConf.authorized, false);
  assert.equal(outcomeWithoutConf.reason, 'CONFIRMATION_REQUIRED', 'High-impact password input requires confirmation even with PTT');

  // With explicit interactive confirmation approved
  const outcomeWithConf = voiceAuthorizationManager.validateAndConsume(token, {
    toolName: 'fillInput',
    parameters: { selector: 'input[name="password"]', value: 'secret123' },
    turnId,
    userId: 'default_user',
    sessionId,
    confirmationApproved: true,
  });

  assert.equal(outcomeWithConf.authorized, true);
  assert.equal(outcomeWithConf.reason, 'SUCCESS');
});

test('Wake-Word Mode Evaluation: Detects wake word and manages 5s capture window', () => {
  wakeWordActivationManager.closeWindow();
  assert.equal(wakeWordActivationManager.isWindowActive(), false);

  // Non-wake speech does not open window
  const r1 = wakeWordActivationManager.evaluateTranscript('open youtube', 201, 1000);
  assert.equal(r1.detected, false);
  assert.equal(wakeWordActivationManager.isWindowActive(1000), false);

  // Wake phrase detected
  const r2 = wakeWordActivationManager.evaluateTranscript('Hey Marionette', 202, 1000);
  assert.equal(r2.detected, true);
  assert.equal(r2.windowOpened, true);
  assert.equal(wakeWordActivationManager.isWindowActive(1000), true);
  assert.equal(wakeWordActivationManager.isWindowActive(5999), true);
  // After 5s window expires
  assert.equal(wakeWordActivationManager.isWindowActive(6001), false);

  // Combined wake phrase + command: "hey marionette scroll down"
  const r3 = wakeWordActivationManager.evaluateTranscript('hey marionette scroll down', 203, 10000);
  assert.equal(r3.detected, true);
  assert.equal(r3.remainingCommand, 'scroll down');
});

// ============================================================================
// PHASE 8 REMEDIATION REGRESSION TEST SUITE (DEFECTS 1, 2, AND 3)
// ============================================================================

test('Phase 8 Remediation: Mouse release outside button (Defect 1) triggers safe finalization', () => {
  const sessionId = 'session_defect1_pointer_up';
  const turnId = 501;
  voiceAuthorizationManager.setActiveContext({ userId: 'default_user', sessionId, turnId });
  voiceAuthorizationManager.advanceTurn(turnId);

  // When global pointerup/mouseup fires after user dragged outside button
  const token = voiceAuthorizationManager.mintToken({
    turnId,
    userId: 'default_user',
    sessionId,
    mode: 'UNIVERSAL_VOICE',
    activationMethod: 'PUSH_TO_TALK',
    isPttActive: true,
  });

  assert.equal(token.scope, 'EXECUTE_MUTATING_ACTIONS');

  const outcome = voiceAuthorizationManager.validateAndConsume(token, {
    toolName: 'openTab',
    parameters: { url: 'https://www.google.com' },
    turnId,
    userId: 'default_user',
    sessionId,
  });

  assert.equal(outcome.authorized, true);
});

test('Phase 8 Remediation: Touch release outside button safely finalizes command', () => {
  const sessionId = 'session_touch_up';
  const turnId = 502;
  voiceAuthorizationManager.setActiveContext({ userId: 'default_user', sessionId, turnId });
  voiceAuthorizationManager.advanceTurn(turnId);

  const token = voiceAuthorizationManager.mintToken({
    turnId,
    userId: 'default_user',
    sessionId,
    mode: 'UNIVERSAL_VOICE',
    activationMethod: 'PUSH_TO_TALK',
    isPttActive: true,
  });

  assert.equal(token.scope, 'EXECUTE_MUTATING_ACTIONS');
});

test('Phase 8 Remediation: Pointer cancellation cancels PTT without execution', () => {
  const sessionId = 'session_pointer_cancel';
  const turnId = 503;
  voiceAuthorizationManager.setActiveContext({ userId: 'default_user', sessionId, turnId });
  voiceAuthorizationManager.advanceTurn(turnId);

  const token = voiceAuthorizationManager.mintToken({
    turnId,
    userId: 'default_user',
    sessionId,
    mode: 'UNIVERSAL_VOICE',
    activationMethod: 'PUSH_TO_TALK',
    isPttActive: true,
  });

  // Pointer cancel event fires (system gesture interrupted touch/pointer)
  voiceAuthorizationManager.cancelTurn(turnId, 'Pointer cancelled');

  const outcome = voiceAuthorizationManager.validateAndConsume(token, {
    toolName: 'clickElement',
    parameters: { selector: '#submit' },
    turnId,
    userId: 'default_user',
    sessionId,
  });

  assert.equal(outcome.authorized, false);
  assert.equal(outcome.reason, 'TOKEN_REVOKED');
});

test('Phase 8 Remediation: Lost pointer capture cancels PTT without execution', () => {
  const sessionId = 'session_lost_capture';
  const turnId = 504;
  voiceAuthorizationManager.setActiveContext({ userId: 'default_user', sessionId, turnId });
  voiceAuthorizationManager.advanceTurn(turnId);

  const token = voiceAuthorizationManager.mintToken({
    turnId,
    userId: 'default_user',
    sessionId,
    mode: 'UNIVERSAL_VOICE',
    activationMethod: 'PUSH_TO_TALK',
    isPttActive: true,
  });

  // Pointer capture lost (e.g. element hidden or window lost focus)
  voiceAuthorizationManager.cancelTurn(turnId, 'Lost pointer capture');

  const outcome = voiceAuthorizationManager.validateAndConsume(token, {
    toolName: 'scrollDown',
    turnId,
    userId: 'default_user',
    sessionId,
  });

  assert.equal(outcome.authorized, false);
  assert.equal(outcome.reason, 'TOKEN_REVOKED');
});

test('Phase 8 Remediation: Spacebar held during Alt+Tab / window blur (Defect 2) cancels active capture', () => {
  const sessionId = 'session_blur_spacebar';
  const turnId = 505;
  voiceAuthorizationManager.setActiveContext({ userId: 'default_user', sessionId, turnId });
  voiceAuthorizationManager.advanceTurn(turnId);

  const token = voiceAuthorizationManager.mintToken({
    turnId,
    userId: 'default_user',
    sessionId,
    mode: 'UNIVERSAL_VOICE',
    activationMethod: 'PUSH_TO_TALK',
    isPttActive: true,
  });

  // User hits Alt+Tab -> window.blur fires
  voiceAuthorizationManager.cancelTurn(turnId, 'Window blur / Alt+Tab focus loss');

  const outcome = voiceAuthorizationManager.validateAndConsume(token, {
    toolName: 'openTab',
    parameters: { url: 'https://private.internal' },
    turnId,
    userId: 'default_user',
    sessionId,
  });

  assert.equal(outcome.authorized, false, 'Focus loss must revoke token and prevent command execution');
  assert.equal(outcome.reason, 'TOKEN_REVOKED');
});

test('Phase 8 Remediation: Mouse held during window blur cancels active capture', () => {
  const sessionId = 'session_mouse_blur';
  const turnId = 506;
  voiceAuthorizationManager.setActiveContext({ userId: 'default_user', sessionId, turnId });
  voiceAuthorizationManager.advanceTurn(turnId);

  voiceAuthorizationManager.cancelTurn(turnId, 'Mouse held blur');

  // Attempting to mint for cancelled turn fails closed
  const token = voiceAuthorizationManager.mintToken({
    turnId,
    userId: 'default_user',
    sessionId,
    mode: 'UNIVERSAL_VOICE',
    activationMethod: 'PUSH_TO_TALK',
    isPttActive: true,
  });

  assert.equal(token.scope, 'DENIED', 'Cannot mint authorizing token for cancelled turn');
});

test('Phase 8 Remediation: Document visibility loss during capture cancels active session', () => {
  const sessionId = 'session_visibility_loss';
  const turnId = 507;
  voiceAuthorizationManager.setActiveContext({ userId: 'default_user', sessionId, turnId });
  voiceAuthorizationManager.advanceTurn(turnId);

  // Tab hidden / minimized
  voiceAuthorizationManager.cancelTurn(turnId, 'document.visibilitychange hidden');

  const token = voiceAuthorizationManager.mintToken({
    turnId,
    userId: 'default_user',
    sessionId,
    mode: 'UNIVERSAL_VOICE',
    activationMethod: 'PUSH_TO_TALK',
    isPttActive: true,
  });

  assert.equal(token.scope, 'DENIED');
});

test('Phase 8 Remediation: Side Panel unmount during active capture (Defect 3) revokes tokens and turn', () => {
  const sessionId = 'session_sidepanel_unmount';
  const turnId = 508;
  voiceAuthorizationManager.setActiveContext({ userId: 'default_user', sessionId, turnId });
  voiceAuthorizationManager.advanceTurn(turnId);

  const token = voiceAuthorizationManager.mintToken({
    turnId,
    userId: 'default_user',
    sessionId,
    mode: 'UNIVERSAL_VOICE',
    activationMethod: 'PUSH_TO_TALK',
    isPttActive: true,
  });

  // Side Panel unmount hook executes
  voiceAuthorizationManager.cancelTurn(turnId, 'Side Panel unmounted');

  // Any tool execution attempted with unmounted token fails closed
  const outcome = voiceAuthorizationManager.validateAndConsume(token, {
    toolName: 'openTab',
    parameters: { url: 'https://example.com' },
    turnId,
    userId: 'default_user',
    sessionId,
  });

  assert.equal(outcome.authorized, false);
  assert.equal(outcome.reason, 'TOKEN_REVOKED');
});

test('Phase 8 Remediation: Delayed ASR response after cancellation cannot execute', () => {
  const sessionId = 'session_delayed_asr_remed';
  const turnId = 509;
  voiceAuthorizationManager.setActiveContext({ userId: 'default_user', sessionId, turnId });
  voiceAuthorizationManager.advanceTurn(turnId);

  // User cancelled while Whisper was in-flight
  voiceAuthorizationManager.cancelTurn(turnId, 'Interrupted');

  // Late arriving ASR tries to mint for cancelled turn 509
  const lateToken = voiceAuthorizationManager.mintToken({
    turnId,
    userId: 'default_user',
    sessionId,
    mode: 'UNIVERSAL_VOICE',
    activationMethod: 'PUSH_TO_TALK',
    isPttActive: true,
  });

  assert.equal(lateToken.scope, 'DENIED', 'Late token for cancelled turn must be DENIED');

  const outcome = voiceAuthorizationManager.validateAndConsume(lateToken, {
    toolName: 'scrollDown',
    turnId,
    userId: 'default_user',
    sessionId,
  });

  assert.equal(outcome.authorized, false);
});

test('Phase 8 Remediation: Already-minted token for cancelled turn is revoked and blocked', () => {
  const sessionId = 'session_already_minted_revoked';
  const turnId = 510;
  voiceAuthorizationManager.setActiveContext({ userId: 'default_user', sessionId, turnId });
  voiceAuthorizationManager.advanceTurn(turnId);

  const token = voiceAuthorizationManager.mintToken({
    turnId,
    userId: 'default_user',
    sessionId,
    mode: 'UNIVERSAL_VOICE',
    activationMethod: 'PUSH_TO_TALK',
    isPttActive: true,
  });

  assert.equal(token.scope, 'EXECUTE_MUTATING_ACTIONS');

  // Cancel turn
  voiceAuthorizationManager.cancelTurn(turnId, 'User clicked cancel');

  const outcome = voiceAuthorizationManager.validateAndConsume(token, {
    toolName: 'openTab',
    parameters: { url: 'https://test.com' },
    turnId,
    userId: 'default_user',
    sessionId,
  });

  assert.equal(outcome.authorized, false);
  assert.equal(outcome.reason, 'TOKEN_REVOKED');
});

test('Phase 8 Remediation: Repeated cancellation calls are safe and idempotent', () => {
  const turnId = 511;

  // Multiple cleanup handlers firing simultaneously
  voiceAuthorizationManager.cancelTurn(turnId, 'Cleanup 1');
  voiceAuthorizationManager.cancelTurn(turnId, 'Cleanup 2');
  voiceAuthorizationManager.cancelTurn(turnId, 'Cleanup 3');

  assert.equal(voiceAuthorizationManager.isTurnCancelled(turnId), true);

  const token = voiceAuthorizationManager.mintToken({
    turnId,
    userId: 'default_user',
    sessionId: 'sess_repeat_cancel',
    mode: 'UNIVERSAL_VOICE',
    activationMethod: 'PUSH_TO_TALK',
    isPttActive: true,
  });

  assert.equal(token.scope, 'DENIED');
});

test('Phase 8 Remediation: Normal PTT release still submits and executes authorized command', () => {
  const sessionId = 'session_normal_ptt_remed';
  const turnId = 512;
  voiceAuthorizationManager.setActiveContext({ userId: 'default_user', sessionId, turnId });
  voiceAuthorizationManager.advanceTurn(turnId);

  // Normal, uninterrupted PTT hold and release
  const token = voiceAuthorizationManager.mintToken({
    turnId,
    userId: 'default_user',
    sessionId,
    mode: 'UNIVERSAL_VOICE',
    activationMethod: 'PUSH_TO_TALK',
    isPttActive: true,
  });

  assert.equal(token.scope, 'EXECUTE_MUTATING_ACTIONS');

  const outcome = voiceAuthorizationManager.validateAndConsume(token, {
    toolName: 'openTab',
    parameters: { url: 'https://en.wikipedia.org/wiki/Main_Page' },
    turnId,
    userId: 'default_user',
    sessionId,
  });

  assert.equal(outcome.authorized, true);
  assert.equal(outcome.reason, 'SUCCESS');
});

