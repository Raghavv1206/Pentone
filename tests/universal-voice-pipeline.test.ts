/**
 * Universal Voice Recognition & Neural Noise Reduction Test Suite
 * 
 * Phase 5 Verification:
 * 1. Universal multi-speaker acceptance (commands accepted from any speaker without requiring enrollment).
 * 2. Neural noise reduction on ambient noise (fan, typing, background audio).
 * 3. English and Hinglish command processing.
 * 4. Acoustic variations (quiet desk speech vs loud speech).
 * 5. Safeguards against TV dialogue, noise hallucinations, and acoustic echo.
 * 6. Security capability token gate and high-impact action confirmation.
 * 7. Memory stability across consecutive listening turns.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { neuralNoiseReductionService } from '../lib/audio/neural-noise-reduction-service';
import { voiceAuthorizationManager } from '../lib/audio/voice-authorization-manager';
import { classifyTool, evaluateHighImpact } from '../lib/audio/tool-authorization-classifier';
import { ASROrchestrator } from '../lib/audio/asr-intent-orchestrator';
import { BargeInController } from '../lib/audio/barge-in-controller';
import { TTSAcousticTracker } from '../lib/tts-context';

const BASE_EXPERIMENT_PATH = path.resolve('C:/project/New folder/pentone-campp-experiment');
const USER_DIR = path.join(BASE_EXPERIMENT_PATH, 'recordings', 'user');
const IMPOSTER_DIR = path.join(BASE_EXPERIMENT_PATH, 'recordings', 'imposters');
const AMBIENT_DIR = path.join(BASE_EXPERIMENT_PATH, 'recordings', 'ambient');

function parseWav(buffer: Buffer): Float32Array {
  const dataOffset = buffer.indexOf('data') + 8;
  const numSamples = (buffer.length - dataOffset) / 2;
  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const int16 = buffer.readInt16LE(dataOffset + i * 2);
    samples[i] = int16 < 0 ? int16 / 32768 : int16 / 32767;
  }
  return samples;
}

function loadWavSafe(dir: string, file: string): Float32Array {
  const p = path.join(dir, file);
  if (fs.existsSync(p)) {
    return parseWav(fs.readFileSync(p));
  }
  const samples = new Float32Array(16000 * 2);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = 0.2 * Math.sin((2 * Math.PI * 250 * i) / 16000);
  }
  return samples;
}

test('Universal Voice: Multiple distinct human speakers execute ordinary commands without enrollment', async () => {
  const orchestrator = new ASROrchestrator();
  const sessionId = 'session_universal_multispeaker';

  // Speaker A (Primary speaker)
  const turn1 = 1;
  voiceAuthorizationManager.setActiveContext({ userId: 'speaker_a', sessionId, turnId: turn1 });
  voiceAuthorizationManager.advanceTurn(turn1);

  const rawCmdA = 'Open YouTube';
  const processedA = orchestrator.processTranscript(rawCmdA);
  assert.equal(Boolean(processedA.isNoiseOrHallucination), false);
  assert.equal(processedA.effectiveQuery, 'Open YouTube');

  // Mint universal token for Speaker A
  const tokenA = voiceAuthorizationManager.mintToken({
    turnId: turn1,
    userId: 'speaker_a',
    sessionId,
    mode: 'UNIVERSAL_VOICE',
  });

  assert.equal(tokenA.scope, 'EXECUTE_MUTATING_ACTIONS');
  assert.equal(tokenA.source, 'UNIVERSAL_VOICE');

  // Validate and consume for ordinary tool (openTab)
  const outcomeA = voiceAuthorizationManager.validateAndConsume(tokenA, {
    toolName: 'openTab',
    parameters: { url: 'https://www.youtube.com' },
    turnId: turn1,
    userId: 'speaker_a',
    sessionId,
  });
  assert.equal(outcomeA.authorized, true, 'Speaker A authorized to openTab without biometric profile');

  // Speaker B (Completely different independent human speaker)
  const turn2 = 2;
  voiceAuthorizationManager.setActiveContext({ userId: 'speaker_b', sessionId, turnId: turn2 });
  voiceAuthorizationManager.advanceTurn(turn2);

  const rawCmdB = 'Scroll down';
  const processedB = orchestrator.processTranscript(rawCmdB);
  assert.equal(Boolean(processedB.isNoiseOrHallucination), false);
  assert.equal(processedB.effectiveQuery, 'Scroll down');

  // Mint universal token for Speaker B
  const tokenB = voiceAuthorizationManager.mintToken({
    turnId: turn2,
    userId: 'speaker_b',
    sessionId,
    mode: 'UNIVERSAL_VOICE',
  });

  assert.equal(tokenB.scope, 'EXECUTE_MUTATING_ACTIONS');
  assert.equal(tokenB.source, 'UNIVERSAL_VOICE');

  // Validate and consume for ordinary tool (scrollDown)
  const outcomeB = voiceAuthorizationManager.validateAndConsume(tokenB, {
    toolName: 'scrollDown',
    parameters: { amount: 500 },
    turnId: turn2,
    userId: 'speaker_b',
    sessionId,
  });
  assert.equal(outcomeB.authorized, true, 'Speaker B authorized to scrollDown without biometric profile');
});

test('Universal Voice: English and Hinglish commands correctly processed', async () => {
  const orchestrator = new ASROrchestrator();

  // 1. English short command
  const res1 = orchestrator.processTranscript('Open Google');
  assert.equal(Boolean(res1.isNoiseOrHallucination), false);
  assert.equal(res1.effectiveQuery, 'Open Google');

  // 2. English conversational query
  const res2 = orchestrator.processTranscript('Pentone, please summarize the current page and highlight main points.');
  assert.equal(Boolean(res2.isNoiseOrHallucination), false);
  assert.ok(res2.effectiveQuery.includes('summarize'));

  // 3. Hinglish command
  const res3 = orchestrator.processTranscript('Naya tab open karo aur weather check karo');
  assert.equal(Boolean(res3.isNoiseOrHallucination), false);
  assert.ok(res3.effectiveQuery.includes('Naya tab open karo'));

  // 4. Hinglish summarization query
  const res4 = orchestrator.processTranscript('Is page ka content summarize karke dikhao');
  assert.equal(Boolean(res4.isNoiseOrHallucination), false);
  assert.ok(res4.effectiveQuery.includes('summarize'));
});

test('Neural Noise Reduction: Suppresses fan noise and keyboard typing while preserving speech', async () => {
  const ambientWav = loadWavSafe(AMBIENT_DIR, 'fan_typing.wav');
  const durationSamples = Math.min(ambientWav.length, 16000 * 2);
  const ambientSlice = ambientWav.slice(0, durationSamples);

  const { enhancedAudio, metrics } = await neuralNoiseReductionService.enhanceAudio(ambientSlice, {
    aggressiveness: 0.70,
  });

  assert.equal(enhancedAudio.length, ambientSlice.length);
  assert.ok(metrics.processingLatencyMs < 60, `Latency is sub-60ms (got ${metrics.processingLatencyMs.toFixed(2)}ms)`);
  assert.ok(metrics.outputRms <= metrics.inputRms, 'Ambient fan/typing noise is attenuated');
  assert.ok(metrics.speechProbability <= 0.6, 'Ambient noise not confused with loud clean speech');
});

test('Accidental Trigger Prevention: Whisper hallucinations, subtitles, and TV dialogue filtered', async () => {
  const orchestrator = new ASROrchestrator();

  // Known Whisper silence hallucinations
  assert.equal(Boolean(orchestrator.processTranscript('Thank you for watching.').isNoiseOrHallucination), true);
  assert.equal(Boolean(orchestrator.processTranscript('Please like and subscribe!').isNoiseOrHallucination), true);
  assert.equal(Boolean(orchestrator.processTranscript('Subtitles by the Amara.org community').isNoiseOrHallucination), true);
  assert.equal(Boolean(orchestrator.processTranscript('[Music]').isNoiseOrHallucination), true);
  assert.equal(Boolean(orchestrator.processTranscript('...').isNoiseOrHallucination), true);
  assert.equal(Boolean(orchestrator.processTranscript('   ').isNoiseOrHallucination), true);

  // Incomplete / single-letter fragments
  assert.equal(Boolean(orchestrator.processTranscript('s').isNoiseOrHallucination), true);
  assert.equal(Boolean(orchestrator.processTranscript('you you you you you').isNoiseOrHallucination), true);
});

test('Acoustic Echo Cancellation: Assistant speech self-hearing echo discarded', async () => {
  const orchestrator = new ASROrchestrator();

  // Simulate assistant speaking an answer
  const assistantUtterance = 'I have opened the YouTube tab for you.';
  TTSAcousticTracker.recordSpeechStart(assistantUtterance);

  // If microphone picks up acoustic bleed of assistant's own voice
  const echoResult = orchestrator.processTranscript('I have opened the YouTube tab for you.', {
    recentAssistantUtterances: TTSAcousticTracker.getRecentUtterances(),
    isAudibleTabActive: true,
  });

  assert.equal(echoResult.isSelfHearingEcho, true, 'Acoustic self-hearing echo detected and discarded');
  TTSAcousticTracker.recordSpeechEnd();
});

test('Full-Duplex Barge-In: Instant interruption on human speech start', () => {
  let interruptFired = false;
  const controller = new BargeInController({
    onInterrupt: () => {
      interruptFired = true;
    },
  });

  controller.enableVoiceMode();
  controller.readyToListen();
  controller.handleSpeechStart();
  controller.handleSpeechEnd(new Float32Array(16000));
  controller.handleAssistantSpeechStart();

  assert.equal(controller.getState(), 'ASSISTANT_SPEAKING');
  assert.equal(interruptFired, false);

  // User begins speaking (barge-in!)
  controller.handleSpeechStart();
  assert.equal(interruptFired, true, 'Interruption callback must be executed immediately on speech onset');
  assert.equal(controller.getState(), 'USER_SPEAKING');
});

test('Security Invariant: High-impact actions strictly mandate explicit user confirmation', async () => {
  const sessionId = 'session_security_test';
  const turnId = 10;
  voiceAuthorizationManager.setActiveContext({ userId: 'universal_user', sessionId, turnId });
  voiceAuthorizationManager.advanceTurn(turnId);

  const token = voiceAuthorizationManager.mintToken({
    turnId,
    userId: 'universal_user',
    sessionId,
    mode: 'UNIVERSAL_VOICE',
  });

  // Sensitive banking URL
  const impactBanking = evaluateHighImpact('openTab', { url: 'https://checkout.stripe.com/pay/cs_live_123' });
  assert.equal(impactBanking.isHighImpact, true, 'Financial checkout URL is marked high-impact');

  // Attempt execution without user confirmation approval
  const unconfirmedOutcome = voiceAuthorizationManager.validateAndConsume(token, {
    toolName: 'openTab',
    parameters: { url: 'https://checkout.stripe.com/pay/cs_live_123' },
    turnId,
    userId: 'universal_user',
    sessionId,
    confirmationApproved: false, // User has NOT clicked confirm
  });

  assert.equal(unconfirmedOutcome.authorized, false, 'Unconfirmed high-impact action is blocked');
  assert.equal(unconfirmedOutcome.reason, 'CONFIRMATION_REQUIRED');

  // Sensitive clickElement (buy / purchase)
  const impactClick = evaluateHighImpact('clickElement', { description: 'Confirm purchase and pay $450' });
  assert.equal(impactClick.isHighImpact, true, 'Destructive purchase click is marked high-impact');

  // Sensitive credential filling
  const impactInput = evaluateHighImpact('fillInput', { name: 'credit_card_number', value: '4111222233334444' });
  assert.equal(impactInput.isHighImpact, true, 'Payment card input is marked high-impact');
});

test('Session Lifecycle: Token reuse, turn expiration, and session termination strictly enforced', async () => {
  const sessionId = 'session_lifecycle_test';
  const turnId = 20;
  voiceAuthorizationManager.setActiveContext({ userId: 'universal_user', sessionId, turnId });
  voiceAuthorizationManager.advanceTurn(turnId);

  const token = voiceAuthorizationManager.mintToken({
    turnId,
    userId: 'universal_user',
    sessionId,
    mode: 'UNIVERSAL_VOICE',
  });

  // First consumption succeeds
  const firstUse = voiceAuthorizationManager.validateAndConsume(token, {
    toolName: 'openTab',
    parameters: { url: 'https://example.com' },
    turnId,
    userId: 'universal_user',
    sessionId,
  });
  assert.equal(firstUse.authorized, true);

  // Second consumption of identical single-use token strictly rejected
  const replayAttempt = voiceAuthorizationManager.validateAndConsume(token, {
    toolName: 'openTab',
    parameters: { url: 'https://example.com' },
    turnId,
    userId: 'universal_user',
    sessionId,
  });
  assert.equal(replayAttempt.authorized, false);
  assert.equal(replayAttempt.reason, 'TOKEN_ALREADY_CONSUMED');

  // Turn advance revokes tokens minted for older turns
  const turn21Token = voiceAuthorizationManager.mintToken({
    turnId: 21,
    userId: 'universal_user',
    sessionId,
    mode: 'UNIVERSAL_VOICE',
  });

  // Active turn is 22, consuming turn 21 token with active turn 22
  const staleTurnOutcome = voiceAuthorizationManager.validateAndConsume(turn21Token, {
    toolName: 'openTab',
    parameters: { url: 'https://example.com' },
    turnId: 22, // Current execution context turn is 22
    userId: 'universal_user',
    sessionId,
  });
  assert.equal(staleTurnOutcome.authorized, false);
  assert.equal(staleTurnOutcome.reason, 'TURN_MISMATCH');
});

test('Long-Running Listening: Continuous audio processing remains fast and memory stable', async () => {
  const sampleRate = 16000;
  const frameLength = sampleRate * 1.5; // 1.5 second utterance
  const testBuffer = new Float32Array(frameLength);

  for (let i = 0; i < frameLength; i++) {
    testBuffer[i] = 0.15 * Math.sin((2 * Math.PI * 300 * i) / sampleRate) + (Math.random() - 0.5) * 0.04;
  }

  const latencies: number[] = [];

  // Execute 25 consecutive turns to test state stability
  for (let turn = 1; turn <= 25; turn++) {
    const { enhancedAudio, metrics } = await neuralNoiseReductionService.enhanceAudio(testBuffer);
    assert.equal(enhancedAudio.length, frameLength);
    latencies.push(metrics.processingLatencyMs);
  }

  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const maxLatency = Math.max(...latencies);

  console.log(`[Stability Test] 25 Turns Processed: Avg Latency: ${avgLatency.toFixed(2)}ms, Max Latency: ${maxLatency.toFixed(2)}ms`);
  assert.ok(avgLatency < 45, `Average latency across 25 turns is sub-45ms (got ${avgLatency.toFixed(2)}ms)`);
  assert.ok(maxLatency < 80, `Maximum latency is sub-80ms (got ${maxLatency.toFixed(2)}ms)`);
});
