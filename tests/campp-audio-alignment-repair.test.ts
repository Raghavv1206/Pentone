import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

import {
  PersistentProfileVaultManager,
  IndexedDBKeyStore,
  IndexedDBProfileStore,
  InMemoryStructuredCloneDriver,
} from '../lib/audio/speaker-profile-vault';
import {
  SpeakerVerificationEngine,
  type EnrollmentUtterance,
} from '../lib/audio/speaker-verification-engine';
import { BiometricAudioExtractor } from '../lib/audio/biometric-audio-extractor';
import { VoiceEnrollmentService } from '../lib/audio/voice-enrollment-service';
import { AudioLoader } from '../../pentone-campp-experiment/src/audio-loader';
import { voiceAuthorizationManager } from '../lib/audio/voice-authorization-manager';
import { voiceDiagnosticTracker } from '../lib/audio/voice-diagnostic-tracker';
import { classifyTool, evaluateHighImpact } from '../lib/audio/tool-authorization-classifier';

// Paths to recordings
const RECORDINGS_BASE = path.resolve('C:/project/New folder/pentone-campp-experiment/recordings');
const USER_DIR = path.join(RECORDINGS_BASE, 'user');
const IMPOSTER_DIR = path.join(RECORDINGS_BASE, 'imposters');
const AMBIENT_DIR = path.join(RECORDINGS_BASE, 'ambient');

function loadWavSample(dir: string, file: string): Float32Array {
  const filePath = path.join(dir, file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Test recording not found at ${filePath}`);
  }
  const buf = fs.readFileSync(filePath);
  return AudioLoader.parseWav(buf).samples;
}

function createVault(dbSuffix: string): PersistentProfileVaultManager {
  const keyStore = new IndexedDBKeyStore(`align_keys_${dbSuffix}`);
  const profileStore = new IndexedDBProfileStore(`align_profiles_${dbSuffix}`);
  return new PersistentProfileVaultManager(keyStore, profileStore);
}

const testUserId = 'alignment_test_user';
let sharedVault: PersistentProfileVaultManager;

test('Phase 1 Setup: Enroll test profile with real recordings', async () => {
  InMemoryStructuredCloneDriver.clearAllForTest();
  sharedVault = createVault('phase1');
  const engine = SpeakerVerificationEngine.getInstance();
  await engine.initialize();

  // Load conversational and short samples
  const conv1 = loadWavSample(USER_DIR, 'user_normal_1.wav');
  const conv2 = loadWavSample(USER_DIR, 'user_normal_2.wav');
  const conv3 = loadWavSample(USER_DIR, 'user_normal_3.wav');
  const short1 = loadWavSample(USER_DIR, 'user_short_1.wav');
  const short2 = short1.slice(8000, 24000); // 1.0s active speech slice (RMS ~0.045)

  const service = new VoiceEnrollmentService(sharedVault, engine);
  const convUtterances: EnrollmentUtterance[] = [
    { id: 'conv_1', waveform: conv1 },
    { id: 'conv_2', waveform: conv2 },
    { id: 'conv_3', waveform: conv3 },
  ];
  const shortUtterances: EnrollmentUtterance[] = [
    { id: 'short_1', waveform: short1 },
    { id: 'short_2', waveform: short2 },
  ];

  const profileInfo = await service.enrollFromUtterances(
    testUserId,
    convUtterances,
    shortUtterances,
    0.005
  );

  assert.equal(profileInfo.status, 'ENROLLED');
  assert.equal(profileInfo.conversationalExemplarsCount, 2);
  assert.equal(profileInfo.shortCommandExemplarsCount, 2);
});

// =====================================================================
// Test 1: Short command with 250ms pre-padding and 450ms post-padding
// =====================================================================
test('Regression 1: Short command with 250ms pre-padding and 450ms post-padding correctly routes to SHORT_COMMAND', async () => {
  const engine = SpeakerVerificationEngine.getInstance();
  const profile = await sharedVault.loadProfile(testUserId);

  const rawShort = loadWavSample(USER_DIR, 'user_short_1.wav').slice(8000, 22000); // 0.875s active speech
  const prePad = new Float32Array(Math.floor(0.25 * 16000)); // 250ms silence
  const postPad = new Float32Array(Math.floor(0.45 * 16000)); // 450ms silence
  const paddedBuffer = new Float32Array(prePad.length + rawShort.length + postPad.length);
  paddedBuffer.set(prePad, 0);
  paddedBuffer.set(rawShort, prePad.length);
  paddedBuffer.set(postPad, prePad.length + rawShort.length);

  const rawDuration = paddedBuffer.length / 16000;
  assert.ok(rawDuration >= 1.40, `Padded buffer duration (${rawDuration.toFixed(2)}s) must be >= 1.40s`);

  // Extract separate biometric segment
  const biometricSegment = BiometricAudioExtractor.extractBiometricSegment(paddedBuffer, {
    preSpeechPadMs: 250,
    redemptionMs: 450,
  });

  assert.ok(biometricSegment.qualityValid, 'Biometric segment must pass quality gate');
  assert.ok(biometricSegment.voicedDurationSeconds < 1.20, `Voiced duration (${biometricSegment.voicedDurationSeconds.toFixed(2)}s) must be < 1.20s`);
  assert.ok(biometricSegment.voicedFrameCount >= 20, `Voiced frame count (${biometricSegment.voicedFrameCount}) must be >= 20`);

  const outcome = await engine.verifySpeech(
    {
      requestId: 'req_reg_1',
      turnId: 101,
      audioBuffer: paddedBuffer,
      biometricSegment,
      expectedUserId: testUserId,
      capturedAt: Date.now(),
    },
    profile
  );

  assert.equal(outcome.routingPath, 'SHORT_COMMAND', `Padded short command must route to SHORT_COMMAND, got ${outcome.routingPath}`);
  assert.equal(outcome.scoringPolicy, 'ROUTED_SHORT_COMMAND');
  assert.ok(outcome.shortCommandCentroidScore !== undefined);
  assert.ok(outcome.conversationalCentroidScore !== undefined);
  assert.ok(outcome.similarityScore >= 0.620, `Short command similarity score (${outcome.similarityScore.toFixed(3)}) must meet accept threshold 0.620`);
  assert.equal(outcome.decision, 'REGISTERED_USER');
});

// =====================================================================
// Test 2: Normal conversational speech (user_normal_4.wav)
// =====================================================================
test('Regression 2: Normal conversational speech correctly routes to CONVERSATIONAL', async () => {
  const engine = SpeakerVerificationEngine.getInstance();
  const profile = await sharedVault.loadProfile(testUserId);
  const normalSpeech = loadWavSample(USER_DIR, 'user_normal_4.wav');

  const biometricSegment = BiometricAudioExtractor.extractBiometricSegment(normalSpeech);
  assert.ok(biometricSegment.voicedDurationSeconds >= 1.20, `Conversational speech must be >= 1.20s, got ${biometricSegment.voicedDurationSeconds.toFixed(2)}s`);

  const outcome = await engine.verifySpeech(
    {
      requestId: 'req_reg_2',
      turnId: 102,
      audioBuffer: normalSpeech,
      biometricSegment,
      expectedUserId: testUserId,
      capturedAt: Date.now(),
    },
    profile
  );

  assert.equal(outcome.routingPath, 'CONVERSATIONAL');
  assert.equal(outcome.scoringPolicy, 'ROUTED_CONVERSATIONAL');
  assert.ok(outcome.similarityScore >= 0.620, `Conversational similarity (${outcome.similarityScore.toFixed(3)}) should be >= 0.620`);
  assert.equal(outcome.decision, 'REGISTERED_USER');
});

// =====================================================================
// Test 3: Quiet speech (user_quiet_1.wav)
// =====================================================================
test('Regression 3: Quiet speech maintains safe conservative evaluation', async () => {
  const engine = SpeakerVerificationEngine.getInstance();
  const profile = await sharedVault.loadProfile(testUserId);
  const quietSpeech = loadWavSample(USER_DIR, 'user_quiet_1.wav');

  const outcome = await engine.verifySpeech(
    {
      requestId: 'req_reg_3',
      turnId: 103,
      audioBuffer: quietSpeech,
      expectedUserId: testUserId,
      capturedAt: Date.now(),
    },
    profile
  );

  assert.ok(
    outcome.decision === 'REGISTERED_USER' || outcome.decision === 'UNCERTAIN',
    `Quiet speech must evaluate to safe state (REGISTERED_USER or UNCERTAIN), got ${outcome.decision}`
  );
});

// =====================================================================
// Test 4: Loud speech (user_loud_1.wav)
// =====================================================================
test('Regression 4: Loud speech correctly verified with high confidence', async () => {
  const engine = SpeakerVerificationEngine.getInstance();
  const profile = await sharedVault.loadProfile(testUserId);
  const loudSpeech = loadWavSample(USER_DIR, 'user_loud_1.wav');

  const outcome = await engine.verifySpeech(
    {
      requestId: 'req_reg_4',
      turnId: 104,
      audioBuffer: loudSpeech,
      expectedUserId: testUserId,
      capturedAt: Date.now(),
    },
    profile
  );

  assert.equal(outcome.decision, 'REGISTERED_USER');
  assert.ok(outcome.similarityScore >= 0.680, `Loud speech score (${outcome.similarityScore.toFixed(3)}) must be >= 0.680`);
});

// =====================================================================
// Test 5: Short command with background fan noise
// =====================================================================
test('Regression 5: Short command with background fan noise correctly routes to SHORT_COMMAND', async () => {
  const engine = SpeakerVerificationEngine.getInstance();
  const profile = await sharedVault.loadProfile(testUserId);

  const rawShort = loadWavSample(USER_DIR, 'user_short_1.wav').slice(8000, 22000); // 0.875s active speech
  const fanWav = loadWavSample(AMBIENT_DIR, 'fan_typing.wav');
  
  // Mix ambient fan noise with short command
  const noisyShort = new Float32Array(rawShort.length);
  for (let i = 0; i < rawShort.length; i++) {
    noisyShort[i] = rawShort[i] + fanWav[i % fanWav.length] * 0.05;
  }

  const biometricSegment = BiometricAudioExtractor.extractBiometricSegment(noisyShort);
  const outcome = await engine.verifySpeech(
    {
      requestId: 'req_reg_5',
      turnId: 105,
      audioBuffer: noisyShort,
      biometricSegment,
      expectedUserId: testUserId,
      capturedAt: Date.now(),
    },
    profile
  );

  assert.equal(outcome.routingPath, 'SHORT_COMMAND');
  assert.ok(outcome.similarityScore >= 0.620, `Noisy short command score (${outcome.similarityScore.toFixed(3)}) should be >= 0.620`);
  assert.equal(outcome.decision, 'REGISTERED_USER');
});

// =====================================================================
// Test 6: Short command with background conversation
// =====================================================================
test('Regression 6: Short command with background conversation evaluated conservatively', async () => {
  const engine = SpeakerVerificationEngine.getInstance();
  const profile = await sharedVault.loadProfile(testUserId);

  const rawShort = loadWavSample(USER_DIR, 'user_short_1.wav').slice(8000, 22000); // 0.875s active speech
  const tvWav = loadWavSample(AMBIENT_DIR, 'tv_speech.wav');

  // Heavy background speech interference (15% TV speech bleed)
  const interferedShort = new Float32Array(rawShort.length);
  for (let i = 0; i < rawShort.length; i++) {
    interferedShort[i] = rawShort[i] + tvWav[i % tvWav.length] * 0.15;
  }

  const outcome = await engine.verifySpeech(
    {
      requestId: 'req_reg_6',
      turnId: 106,
      audioBuffer: interferedShort,
      expectedUserId: testUserId,
      capturedAt: Date.now(),
    },
    profile
  );

  // Must either pass or fail closed (UNCERTAIN/OTHER_SPEAKER), never panic or produce NaN
  assert.ok(Number.isFinite(outcome.similarityScore));
  assert.ok(
    outcome.decision === 'REGISTERED_USER' || outcome.decision === 'UNCERTAIN' || outcome.decision === 'OTHER_SPEAKER'
  );
});

// =====================================================================
// Test 7: Another speaker saying the same command
// =====================================================================
test('Regression 7: Imposter saying the same command strictly rejected with OTHER_SPEAKER', async () => {
  const engine = SpeakerVerificationEngine.getInstance();
  const profile = await sharedVault.loadProfile(testUserId);

  const imposterAudio = loadWavSample(IMPOSTER_DIR, 'speaker2_normal_1.wav');
  const imposterShort = imposterAudio.slice(0, Math.floor(0.90 * 16000));

  const biometricSegment = BiometricAudioExtractor.extractBiometricSegment(imposterShort);
  const outcome = await engine.verifySpeech(
    {
      requestId: 'req_reg_7',
      turnId: 107,
      audioBuffer: imposterShort,
      biometricSegment,
      expectedUserId: testUserId,
      capturedAt: Date.now(),
    },
    profile
  );

  assert.equal(outcome.decision, 'OTHER_SPEAKER', `Imposter must be strictly rejected as OTHER_SPEAKER, got ${outcome.decision}`);
  assert.ok(outcome.similarityScore < 0.520, `Imposter score (${outcome.similarityScore.toFixed(3)}) must be < 0.520 rejection threshold`);
});

// =====================================================================
// Test 8: Overlapping speech and Security Gate Invariants
// =====================================================================
test('Regression 8: Overlapping speech fails closed; tools remain locked behind authorization gate', async () => {
  const engine = SpeakerVerificationEngine.getInstance();
  const profile = await sharedVault.loadProfile(testUserId);

  // Mix user speech with imposter speech at equal amplitude (simultaneous overlapping speakers)
  const userAudio = loadWavSample(USER_DIR, 'user_normal_1.wav').slice(0, 32000); // 2.0s
  const impAudio = loadWavSample(IMPOSTER_DIR, 'speaker2_normal_1.wav').slice(0, 32000); // 2.0s
  const overlapping = new Float32Array(32000);
  for (let i = 0; i < 32000; i++) {
    overlapping[i] = 0.5 * userAudio[i] + 0.5 * impAudio[i];
  }

  const result = await engine.segmentAndVerifySpeech(
    {
      requestId: 'req_reg_8',
      turnId: 108,
      audioBuffer: overlapping,
      expectedUserId: testUserId,
      capturedAt: Date.now(),
    },
    profile
  );

  // Overlapping audio must fail closed
  assert.ok(
    result.decision === 'OTHER_SPEAKER' || result.decision === 'UNCERTAIN',
    `Overlapping speech must fail closed (OTHER_SPEAKER or UNCERTAIN), got ${result.decision}`
  );

  // Verify that an unauthorized decision produces DENIED capability scope and blocks mutating tools
  const token = voiceAuthorizationManager.mintToken({
    turnId: 108,
    userId: testUserId,
    sessionId: 'session_align_8',
    verificationResult: result,
  });

  assert.equal(token.scope, 'DENIED', 'Mutating tool must receive DENIED scope for unauthorized decision');
  assert.equal(token.turnId, 108);

  const toolClassification = classifyTool('clickElement');
  const impact = evaluateHighImpact('openTab', { url: 'https://banking.example.com/transfer' });
  assert.equal(toolClassification?.actionType, 'MUTATING');
  assert.equal(impact.isHighImpact, true);
});
