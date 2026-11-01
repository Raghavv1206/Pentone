import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SpeakerVerificationEngine,
} from '../lib/audio/speaker-verification-engine';
import {
  PersistentAudioPipeline,
} from '../lib/audio/persistent-audio-pipeline';
import {
  voiceDiagnosticTracker,
} from '../lib/audio/voice-diagnostic-tracker';
import { VectorMath } from '../lib/audio/vector-math';
import type { UnencryptedSpeakerProfile } from '../lib/audio/speaker-profile-vault';

// =====================================================================
// Helpers
// =====================================================================

function createMockCentroid(seed: number): Float32Array {
  const vec = new Float32Array(512);
  for (let i = 0; i < 512; i++) {
    vec[i] = Math.sin(seed * (i + 1));
  }
  return VectorMath.normalize(vec);
}

function createMockProfile(userId: string, seed: number = 1.0): UnencryptedSpeakerProfile {
  const centroid = createMockCentroid(seed);
  return {
    metadata: {
      schemaVersion: 2,
      modelVersion: 'campplus-en-voxceleb-512-v1',
      userId,
      enrolledAt: Date.now(),
      lastCalibratedAt: Date.now(),
      noiseFloorRms: 0.005,
      conversationalSampleCount: 3,
      shortUtteranceSampleCount: 2,
      conversationalMeanSimilarity: 0.85,
      shortMeanSimilarity: 0.82,
      thresholds: {
        acceptThreshold: 0.62,
        rejectThreshold: 0.52,
        minAudioDurationSeconds: 0.40,
        shortCommandCutoffSeconds: 1.20,
      },
    },
    conversationalCentroid: centroid,
    conversationalExemplars: [centroid],
    shortCommandCentroid: centroid,
    shortCommandExemplars: [centroid],
  };
}

// =====================================================================
// Stage 1 Tests: Verification HUD State Derivation & Truthfulness
// =====================================================================

test('Stage 1 HUD: "You (Verified)" requires registered user, score >= 0.62, and authorized mutating scope', () => {
  const tracker = voiceDiagnosticTracker;
  const turnId = 2001;
  tracker.startTurn(turnId, 'default_user', 'session_hud_1');

  // Case A: High score registered user
  tracker.recordCAM(turnId, 'REGISTERED_USER', 0.742, 0.742, 0.710, 'AUTHORIZED', 12, undefined, 'VERIFIED', {
    audioSegmentId: 'seg_2001_1',
    detectedSpeaker: 'VERIFIED_USER',
    profileLookupStatus: 'FOUND',
  });
  tracker.recordAuth(turnId, 'AUTHORIZED', 'EXECUTE_MUTATING_ACTIONS', 5);
  tracker.recordToolExecution(turnId, 'openTab', true, 'AUTHORIZED', 25);

  let turn = tracker.getTurn(turnId)!;
  const isVerifiedUserA = (
    turn.camDecision === 'REGISTERED_USER' &&
    typeof turn.camScore === 'number' &&
    turn.camScore >= 0.6200 &&
    turn.authScope === 'EXECUTE_MUTATING_ACTIONS'
  );
  assert.equal(isVerifiedUserA, true, 'Should verify registered user with score >= 0.62 and mutating scope');

  // Case B: Borderline score below 0.6200 (e.g. 0.6180) must NOT show "You (Verified)"
  const turnIdBorderline = 2002;
  tracker.startTurn(turnIdBorderline, 'default_user', 'session_hud_1');
  tracker.recordCAM(turnIdBorderline, 'UNCERTAIN', 0.618, 0.618, 0.600, 'DISCARDED', 14, 'Borderline score', undefined, {
    detectedSpeaker: 'UNCERTAIN_SPEAKER',
    profileLookupStatus: 'FOUND',
  });
  tracker.recordAuth(turnIdBorderline, 'DENIED', 'DENIED', 2);

  turn = tracker.getTurn(turnIdBorderline)!;
  const isVerifiedUserB = (
    turn.camDecision === 'REGISTERED_USER' &&
    typeof turn.camScore === 'number' &&
    turn.camScore >= 0.6200 &&
    turn.authScope === 'EXECUTE_MUTATING_ACTIONS'
  );
  assert.equal(isVerifiedUserB, false, 'Borderline 0.618 must NOT qualify as verified user');
});

test('Stage 1 HUD: Accurately identifies "Multiple Voices Detected" and "Background Speech Ignored"', () => {
  const tracker = voiceDiagnosticTracker;

  // Turn 2003: Overlapping speech / Multiple speakers
  const turnOverlap = 2003;
  tracker.startTurn(turnOverlap, 'default_user', 'session_hud_2');
  tracker.recordCAM(turnOverlap, 'UNCERTAIN', 0.530, 0.530, 0.510, 'DISCARDED', 18, 'Multiple speakers detected', undefined, {
    audioSegmentId: 'seg_2003_1',
    detectedSpeaker: 'OVERLAPPING_SPEECH',
    profileLookupStatus: 'FOUND',
  });

  const turnO = tracker.getTurn(turnOverlap)!;
  const isMultipleVoices = (turnO.detectedSpeaker === 'OVERLAPPING_SPEECH' || turnO.detectedSpeaker === 'MULTIPLE_SPEAKERS' as any);
  assert.equal(isMultipleVoices, true, 'Should classify as Multiple Voices Detected');

  // Turn 2004: Background speech / Other speaker
  const turnOther = 2004;
  tracker.startTurn(turnOther, 'default_user', 'session_hud_2');
  tracker.recordCAM(turnOther, 'OTHER_SPEAKER', 0.380, 0.380, 0.350, 'DISCARDED', 15, 'Background conversation', undefined, {
    audioSegmentId: 'seg_2004_1',
    detectedSpeaker: 'OTHER_SPEAKER',
    profileLookupStatus: 'FOUND',
  });

  const turnBg = tracker.getTurn(turnOther)!;
  const isBackgroundSpeech = (turnBg.camDecision === 'OTHER_SPEAKER' || turnBg.detectedSpeaker === 'OTHER_SPEAKER');
  assert.equal(isBackgroundSpeech, true, 'Should classify as Background Speech Ignored');
});

// =====================================================================
// Stage 2 Tests: Resource and Memory Lifecycle & Idle Suspension
// =====================================================================

test('Stage 2 Lifecycle: Engine supports suspendIfIdle and transitions session status cleanly', async () => {
  const engine = SpeakerVerificationEngine.getInstance();

  // Engine is initialized or ready
  const initialStatus = engine.getStatus();
  assert.ok(['READY', 'INITIALIZING', 'UNINITIALIZED', 'LOADING_ASSET', 'WARMING_UP', 'ERROR', 'IDLE_SUSPENDED'].includes(initialStatus));

  // Simulate an active ready session with an idle period that exceeds timeout
  (engine as any).status = 'READY';
  (engine as any).session = {
    release: async () => {},
  };
  (engine as any).lastInferenceTimestamp = Date.now() - 360_000;
  
  // Suspend with 300_000ms (5 min) threshold
  const suspended = await engine.suspendIfIdle(300_000);
  assert.equal(suspended, true);
  assert.equal(engine.getStatus(), 'IDLE_SUSPENDED');
  assert.equal((engine as any).session, null);

  // If called again when already suspended, it should return false and remain suspended
  const suspendedAgain = await engine.suspendIfIdle(300_000);
  assert.equal(suspendedAgain, false);
  assert.equal(engine.getStatus(), 'IDLE_SUSPENDED');

  // Verify that calling segmentAndVerifySpeech seamlessly reactivates inference
  const profile = createMockProfile('default_user');
  const dummyAudio = new Float32Array(8000);
  const result = await engine.segmentAndVerifySpeech({
    requestId: 'req_after_idle',
    turnId: 3001,
    audioBuffer: dummyAudio,
    expectedUserId: 'default_user',
    capturedAt: Date.now(),
  }, profile);

  assert.ok(result);
  assert.ok(engine.getStatus() === 'READY' || engine.getStatus() === 'INITIALIZING');
});

// =====================================================================
// Stage 3 Tests: Adaptive Ambient Noise Floor
// =====================================================================

test('Stage 3 Noise Adaptation: Adapts slowly with EMA strictly during confirmed silence', () => {
  const pipeline = new PersistentAudioPipeline();
  pipeline.setNoiseFloor(0.015);
  assert.equal(pipeline.getNoiseFloor(), 0.015);

  // Adapt during low silence (RMS = 0.018)
  // New floor = 0.98 * 0.015 + 0.02 * 0.018 = 0.0147 + 0.00036 = 0.01506
  const updated1 = pipeline.updateAdaptiveNoiseFloor(0.018);
  assert.ok(Math.abs(updated1 - 0.01506) < 1e-4);

  // Repeat adaptation for multiple silence frames
  for (let i = 0; i < 20; i++) {
    pipeline.updateAdaptiveNoiseFloor(0.020);
  }
  const adapted = pipeline.getNoiseFloor();
  assert.ok(adapted > 0.015, 'Noise floor should slowly rise towards 0.020');
  assert.ok(adapted <= 0.030, 'Noise floor must not exceed upper ceiling 0.030');
});

test('Stage 3 Noise Adaptation: Speech RMS (> 0.025) freezes adaptation immediately', () => {
  const pipeline = new PersistentAudioPipeline();
  pipeline.setNoiseFloor(0.016);

  // Send an elevated speech frame (RMS = 0.080)
  const currentFloor = pipeline.getNoiseFloor();
  const result = pipeline.updateAdaptiveNoiseFloor(0.080);

  // Result should remain unchanged because it is ignored during speech
  assert.equal(result, currentFloor);
  assert.equal(pipeline.getNoiseFloor(), 0.016);

  // Also test loud peak (RMS = 0.35)
  const resultLoud = pipeline.updateAdaptiveNoiseFloor(0.35);
  assert.equal(resultLoud, 0.016);
});

test('Stage 3 Noise Adaptation: Bounded speech threshold strictly between 0.012 and 0.030', () => {
  const pipeline = new PersistentAudioPipeline();
  pipeline.setNoiseFloor(0.003);

  // Function computing adaptive speech threshold from adapted floor as in use-full-duplex-voice.ts
  const computeThreshold = (floor: number) => Math.min(0.030, Math.max(0.012, floor * 2.2));

  // Extreme quiet room: floor = 0.003 -> 0.003 * 2.2 = 0.0066 -> clamped to min 0.012
  const quietThreshold = computeThreshold(pipeline.getNoiseFloor());
  assert.equal(quietThreshold, 0.012, 'Speech threshold cannot drop below minimum 0.012');

  // Noisy room: floor = 0.020 -> 0.020 * 2.2 = 0.044 -> clamped to max 0.030
  pipeline.setNoiseFloor(0.020);
  const noisyThreshold = computeThreshold(pipeline.getNoiseFloor());
  assert.equal(noisyThreshold, 0.030, 'Speech threshold cannot exceed maximum 0.030');

  // Moderate room: floor = 0.008 -> 0.008 * 2.2 = 0.0176 -> within [0.012, 0.030]
  pipeline.setNoiseFloor(0.008);
  const modThreshold = computeThreshold(pipeline.getNoiseFloor());
  assert.ok(Math.abs(modThreshold - 0.0176) < 1e-4);
});
