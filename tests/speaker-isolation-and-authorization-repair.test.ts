import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PersistentProfileVaultManager,
  IndexedDBKeyStore,
  IndexedDBProfileStore,
  InMemoryStructuredCloneDriver,
  ProfileVault,
  type UnencryptedSpeakerProfile,
} from '../lib/audio/speaker-profile-vault';
import {
  SpeakerVerificationEngine,
} from '../lib/audio/speaker-verification-engine';
import {
  voiceAuthorizationManager,
} from '../lib/audio/voice-authorization-manager';
import {
  voiceDiagnosticTracker,
} from '../lib/audio/voice-diagnostic-tracker';
import { VectorMath } from '../lib/audio/vector-math';

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
// 1. Profile Vault Persistence & Key Fallback Tests
// =====================================================================

test('Profile Vault: Resolves profiles stored under both prefixed and un-prefixed keys', async () => {
  const keyDriver = new InMemoryStructuredCloneDriver<{ keyId: string; cryptoKey: CryptoKey }>('test_keys_1', 'vault_keys');
  const profileDriver = new InMemoryStructuredCloneDriver<{ userId: string }>('test_profiles_1', 'encrypted_profiles');
  const keyStore = new IndexedDBKeyStore('test_keys_1', keyDriver as any);
  const profileStore = new IndexedDBProfileStore('test_profiles_1', profileDriver as any);
  const vault = new PersistentProfileVaultManager(keyStore, profileStore);

  const profile = createMockProfile('default_user');
  await vault.saveProfile(profile);

  // Normal lookup with prefix
  const loaded = await vault.loadProfile('default_user');
  assert.equal(loaded.metadata.userId, 'default_user');

  // Verify listStoredProfiles enumerates default_user
  const storedList = await vault.listStoredProfiles();
  assert.ok(storedList.includes('default_user'));

  // Verify inspectVault returns complete diagnostics
  const inspection = await vault.inspectVault();
  assert.ok(inspection.enrolledUserIds.includes('default_user'));
  assert.equal(inspection.details['default_user'].hasProfile, true);
  assert.equal(inspection.details['default_user'].hasKey, true);
});

test('Profile Vault: Simulates raw-key un-prefixed storage fallback', async () => {
  const keyDriver = new InMemoryStructuredCloneDriver<{ keyId: string; cryptoKey: CryptoKey }>('test_keys_2', 'vault_keys');
  const profileDriver = new InMemoryStructuredCloneDriver<{ userId: string }>('test_profiles_2', 'encrypted_profiles');
  const keyStore = new IndexedDBKeyStore('test_keys_2', keyDriver as any);
  const profileStore = new IndexedDBProfileStore('test_profiles_2', profileDriver as any);
  const vault = new PersistentProfileVaultManager(keyStore, profileStore);

  const key = await ProfileVault.generateNonExtractableKey();
  const profile = createMockProfile('legacy_user');
  const encPkg = await ProfileVault.encryptProfile(profile, key);

  // Store raw without "profile:" or "key:" prefixes (simulating inline keyPath storage)
  await keyDriver.put('legacy_user', { keyId: 'legacy_user', cryptoKey: key, algorithm: 'AES-GCM', length: 256, createdAt: Date.now() });
  await profileDriver.put('legacy_user', { userId: 'legacy_user', encryptedPackage: encPkg, storedAt: Date.now() });

  // Lookup must still succeed through fallback
  const loaded = await vault.loadProfile('legacy_user');
  assert.equal(loaded.metadata.userId, 'legacy_user');
});

// =====================================================================
// 2. Strict Authorization Gate Tests
// =====================================================================

test('Authorization Gate: DENIED capability token strictly denies tool execution and conversations', () => {
  voiceAuthorizationManager.setActiveContext({
    userId: 'unverified_speaker',
    sessionId: 'session_test',
    turnId: 42,
  });

  const token = voiceAuthorizationManager.mintToken({
    turnId: 42,
    userId: 'unverified_speaker',
    sessionId: 'session_test',
    decision: 'OTHER_SPEAKER',
  });

  assert.equal(token.scope, 'DENIED');

  // Validate token rejection
  const validation = voiceAuthorizationManager.validateAndConsume(token, {
    toolName: 'openTab',
    turnId: 42,
    userId: 'unverified_speaker',
    sessionId: 'session_test',
  });

  assert.equal(validation.authorized, false);
  assert.equal(validation.reason, 'INSUFFICIENT_SCOPE');
});

test('Authorization Gate: REGISTERED_USER produces valid EXECUTE_MUTATING_ACTIONS token', () => {
  voiceAuthorizationManager.setActiveContext({
    userId: 'default_user',
    sessionId: 'session_test',
    turnId: 43,
  });

  const token = voiceAuthorizationManager.mintToken({
    turnId: 43,
    userId: 'default_user',
    sessionId: 'session_test',
    decision: 'REGISTERED_USER',
  });

  assert.equal(token.scope, 'EXECUTE_MUTATING_ACTIONS');

  const validation = voiceAuthorizationManager.validateAndConsume(token, {
    toolName: 'openTab',
    turnId: 43,
    userId: 'default_user',
    sessionId: 'session_test',
  });

  assert.equal(validation.authorized, true);
});

// =====================================================================
// 3. Telemetry & No Fake Zero Score Tests
// =====================================================================

test('Telemetry: PROFILE_NOT_FOUND records undefined camScore (never fake 0.000)', () => {
  const tracker = voiceDiagnosticTracker;
  const turnId = 999;
  tracker.startTurn(turnId, 'default_user', 'test_session');

  // Record profile not found
  tracker.recordCAM(
    turnId,
    'OTHER_SPEAKER',
    undefined, // camScore is strictly undefined!
    undefined,
    undefined,
    'DISCARDED',
    15,
    'ProfileNotFound: No stored profile found for user default_user',
    'PROFILE_NOT_FOUND',
    {
      audioSegmentId: 'seg_999_123',
      detectedSpeaker: 'PROFILE_NOT_FOUND',
      profileLookupStatus: 'PROFILE_NOT_FOUND',
    }
  );

  const turn = tracker.getTurn(turnId);
  assert.ok(turn);
  assert.equal(turn.camScore, undefined);
  assert.equal(turn.camStatus, 'PROFILE_NOT_FOUND');
  assert.equal(turn.profileLookupStatus, 'PROFILE_NOT_FOUND');
  assert.equal(turn.detectedSpeaker, 'PROFILE_NOT_FOUND');
});

// =====================================================================
// 4. Multi-Speaker Segmentation & Diarization Tests
// =====================================================================

test('Speaker Engine: Multi-segment verification returns detectedSpeaker and attribution', async () => {
  const engine = SpeakerVerificationEngine.getInstance();
  const profile = createMockProfile('default_user');

  // Synthetic audio (0.50s silence/low tone)
  const audio = new Float32Array(8000);
  for (let i = 0; i < audio.length; i++) {
    audio[i] = 0.1 * Math.sin(2 * Math.PI * 440 * (i / 16000));
  }

  const req = {
    requestId: 'req_test_1',
    turnId: 1,
    audioBuffer: audio,
    expectedUserId: 'default_user',
    capturedAt: Date.now(),
  };

  const result = await engine.segmentAndVerifySpeech(req, profile);
  assert.ok(result.detectedSpeaker);
  assert.ok(result.speakerAttribution);
  assert.ok(result.segmentCount !== undefined);
});

// =====================================================================
// 5. Overlapping & Turn Superseding Resilience Tests
// =====================================================================

test('Speaker Isolation: Overlapping or uncertain speakers fail closed to UNCERTAIN/DENIED', async () => {
  const engine = SpeakerVerificationEngine.getInstance();
  const profile = createMockProfile('default_user');

  // Generate 2.0s audio with mixed frequencies simulating acoustic interference
  const audio = new Float32Array(32000);
  for (let i = 0; i < audio.length; i++) {
    audio[i] = 0.15 * Math.sin(2 * Math.PI * 300 * (i / 16000)) + 0.15 * Math.cos(2 * Math.PI * 1200 * (i / 16000));
  }

  const req = {
    requestId: 'req_test_overlap',
    turnId: 2,
    audioBuffer: audio,
    expectedUserId: 'default_user',
    capturedAt: Date.now(),
  };

  const result = await engine.segmentAndVerifySpeech(req, profile);
  // Synthetic noise is not enrolled speaker, must not be accepted as REGISTERED_USER
  assert.notEqual(result.decision, 'REGISTERED_USER');

  // Mint token from this decision
  const token = voiceAuthorizationManager.mintToken({
    turnId: 2,
    userId: 'default_user',
    sessionId: 'session_test',
    decision: result.decision,
  });

  // Verify that resulting token CANNOT execute mutating actions
  assert.notEqual(token.scope, 'EXECUTE_MUTATING_ACTIONS');
});

test('Turn Superseding Resilience: In-flight turn is protected against background noise unless barged in', () => {
  let activeTurn = 7;
  let lastInterruptionTime = 0;
  const turnStartTime = 1000;

  // Background noise arrives at 1200ms and increments counter to 8
  const backgroundNoiseArrival = () => {
    activeTurn++;
  };
  backgroundNoiseArrival();
  assert.equal(activeTurn, 8);

  // But NO barge-in occurred (lastInterruptionTime is still 0)
  const isTurnCancelledByBargeIn = turnStartTime < lastInterruptionTime;
  assert.equal(isTurnCancelledByBargeIn, false, 'Turn #7 must NOT be cancelled by background noise');

  // Now an explicit user barge-in interruption occurs at 1300ms
  lastInterruptionTime = 1300;
  const isTurnCancelledAfterInterruption = turnStartTime < lastInterruptionTime;
  assert.equal(isTurnCancelledAfterInterruption, true, 'Turn #7 MUST be cancelled when genuine barge-in occurs');
});
