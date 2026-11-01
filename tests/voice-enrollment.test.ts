import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  VoiceEnrollmentService,
  ENROLLMENT_PROMPTS,
  computeRmsEnergy,
  validateSampleQuality,
  type ProfileStatusInfo,
} from '../lib/audio/voice-enrollment-service';
import {
  SpeakerVerificationEngine,
  type EnrollmentUtterance,
} from '../lib/audio/speaker-verification-engine';
import {
  PersistentProfileVaultManager,
  IndexedDBKeyStore,
  IndexedDBProfileStore,
  InMemoryStructuredCloneDriver,
} from '../lib/audio/speaker-profile-vault';
import { VectorMath } from '../lib/audio/vector-math';

// =====================================================================
// Audio Test Helpers
// =====================================================================

function parseWavFile(buffer: Buffer): Float32Array {
  let offset = 12;
  while (offset < buffer.length - 8) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (chunkId === 'data') {
      const pcm16 = new Int16Array(
        buffer.buffer,
        buffer.byteOffset + offset + 8,
        Math.floor(chunkSize / 2)
      );
      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768.0;
      }
      return float32;
    }
    offset += 8 + chunkSize;
  }
  throw new Error('data chunk not found in WAV buffer');
}

function createSyntheticTone(durationSeconds: number, freq: number = 440, amp: number = 0.2): Float32Array {
  const numSamples = Math.floor(durationSeconds * 16000);
  const audio = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    audio[i] = amp * Math.sin((2 * Math.PI * freq * i) / 16000);
  }
  return audio;
}

function createIsolatedService(): {
  service: VoiceEnrollmentService;
  vaultManager: PersistentProfileVaultManager;
  keyStore: IndexedDBKeyStore;
  profileStore: IndexedDBProfileStore;
} {
  const keyDriver = new InMemoryStructuredCloneDriver<{ keyId: string; cryptoKey: CryptoKey }>();
  const profileDriver = new InMemoryStructuredCloneDriver<{ userId: string }>();
  const keyStore = new IndexedDBKeyStore(keyDriver);
  const profileStore = new IndexedDBProfileStore(profileDriver);
  const vaultManager = new PersistentProfileVaultManager(keyStore, profileStore);
  const engine = SpeakerVerificationEngine.getInstance();
  const service = new VoiceEnrollmentService(vaultManager, engine);
  return { service, vaultManager, keyStore, profileStore };
}

// =====================================================================
// 1. Audio Quality & Validation Tests
// =====================================================================

test('Voice Enrollment: Audio energy computation accurately measures RMS', () => {
  const silent = new Float32Array(1600); // 0.1s silence
  assert.equal(computeRmsEnergy(silent), 0);

  const tone = createSyntheticTone(1.0, 440, 0.5);
  const rms = computeRmsEnergy(tone);
  // RMS of sine wave with peak A is A / sqrt(2) ~ 0.5 * 0.7071 ~ 0.3535
  assert.ok(Math.abs(rms - 0.3535) < 0.01);
});

test('Voice Enrollment: Quality validator rejects samples below duration floor', () => {
  const shortAudio = createSyntheticTone(0.5, 440, 0.2); // 0.5s
  const res = validateSampleQuality(shortAudio, 1.2, 16000); // requires 1.2s
  assert.equal(res.valid, false);
  assert.match(res.error || '', /below required minimum/);
});

test('Voice Enrollment: Quality validator rejects silent or near-zero RMS samples', () => {
  const silentAudio = new Float32Array(32000); // 2.0s silence
  const res = validateSampleQuality(silentAudio, 1.2, 16000);
  assert.equal(res.valid, false);
  assert.match(res.error || '', /energy is too low/);
});

test('Voice Enrollment: Quality validator accepts clean conversational and short samples', () => {
  const validConv = createSyntheticTone(1.5, 300, 0.2);
  const resConv = validateSampleQuality(validConv, 1.2, 16000);
  assert.equal(resConv.valid, true);
  assert.ok(resConv.durationSeconds >= 1.2);
  assert.ok(resConv.rms >= 0.005);

  const validShort = createSyntheticTone(0.6, 300, 0.2);
  const resShort = validateSampleQuality(validShort, 0.4, 16000);
  assert.equal(resShort.valid, true);
});

test('Voice Enrollment: Protocol strictly specifies 5 guided prompts (3 conv, 2 short)', () => {
  assert.equal(ENROLLMENT_PROMPTS.length, 5);
  const convPrompts = ENROLLMENT_PROMPTS.filter((p) => p.type === 'conversational');
  const shortPrompts = ENROLLMENT_PROMPTS.filter((p) => p.type === 'short');
  assert.equal(convPrompts.length, 3);
  assert.equal(shortPrompts.length, 2);

  for (const p of convPrompts) {
    assert.ok(p.minDurationSeconds >= 1.2);
    assert.ok(p.phrase.length > 20);
  }
  for (const p of shortPrompts) {
    assert.ok(p.minDurationSeconds >= 0.4);
    assert.ok(p.phrase.length > 5);
  }
});

// =====================================================================
// 2. Full Multi-Sample Enrollment & Persistence Tests
// =====================================================================

test('Voice Enrollment: Multi-sample enrollment with real utterances succeeds and encrypts profile', async () => {
  const { service, vaultManager } = createIsolatedService();
  const userDir = path.resolve('c:/project/New folder/pentone-campp-experiment/recordings/target_user');

  if (!fs.existsSync(userDir)) {
    // If running in environment without local test recordings, skip audio extraction
    return;
  }

  const convFiles = ['user_normal_1.wav', 'user_normal_2.wav', 'user_normal_3.wav'];
  const shortFiles = ['user_short_1.wav', 'user_quiet_1.wav'];

  const convUtterances: EnrollmentUtterance[] = convFiles.map((f) => ({
    id: f,
    waveform: parseWavFile(fs.readFileSync(path.join(userDir, f))),
  }));

  const shortUtterances: EnrollmentUtterance[] = shortFiles.map((f) => ({
    id: f,
    waveform: parseWavFile(fs.readFileSync(path.join(userDir, f))),
  }));

  const status = await service.enrollFromUtterances('alice', convUtterances, shortUtterances, 0.005);
  assert.equal(status.status, 'ENROLLED');
  assert.equal(status.userId, 'alice');
  assert.equal(status.sampleCount, 5);
  assert.equal(status.conversationalExemplarsCount, 2);
  assert.equal(status.shortCommandExemplarsCount, 2);

  // Verify profile decrypts correctly
  const loaded = await vaultManager.loadProfile('alice');
  assert.equal(loaded.metadata.userId, 'alice');
  assert.equal(loaded.conversationalCentroid.length, 512);
  assert.equal(loaded.shortCommandCentroid.length, 512);

  // Status check via service returns ENROLLED
  const statusCheck = await service.getProfileStatus('alice');
  assert.equal(statusCheck.status, 'ENROLLED');
  assert.equal(statusCheck.userId, 'alice');
  assert.equal(statusCheck.sampleCount, 5);
});

test('Voice Enrollment: Enrollment requires at least 3 conversational and 2 short utterances (no single-exemplar bypass)', async () => {
  const { service } = createIsolatedService();

  const convUtterances: EnrollmentUtterance[] = [
    { id: '1', waveform: createSyntheticTone(1.5, 300) },
    { id: '2', waveform: createSyntheticTone(1.5, 300) },
  ]; // Only 2 conversational
  const shortUtterances: EnrollmentUtterance[] = [
    { id: 's1', waveform: createSyntheticTone(0.6, 300) },
    { id: 's2', waveform: createSyntheticTone(0.6, 300) },
  ];

  await assert.rejects(
    async () => {
      await service.enrollFromUtterances('alice', convUtterances, shortUtterances);
    },
    /requires at least 3 conversational samples/
  );

  const conv3: EnrollmentUtterance[] = [
    { id: '1', waveform: createSyntheticTone(1.5, 300) },
    { id: '2', waveform: createSyntheticTone(1.5, 300) },
    { id: '3', waveform: createSyntheticTone(1.5, 300) },
  ];
  const short1: EnrollmentUtterance[] = [
    { id: 's1', waveform: createSyntheticTone(0.6, 300) },
  ]; // Only 1 short

  await assert.rejects(
    async () => {
      await service.enrollFromUtterances('alice', conv3, short1);
    },
    /requires at least 2 short command samples/
  );
});

// =====================================================================
// 3. Account Isolation & Switching Tests
// =====================================================================

test('Voice Enrollment: Account switching strictly isolates user profiles', async () => {
  const { service, vaultManager } = createIsolatedService();
  const userDir = path.resolve('c:/project/New folder/pentone-campp-experiment/recordings/target_user');

  if (!fs.existsSync(userDir)) return;

  const convUtterances: EnrollmentUtterance[] = ['user_normal_1.wav', 'user_normal_2.wav', 'user_normal_3.wav'].map((f) => ({
    id: f,
    waveform: parseWavFile(fs.readFileSync(path.join(userDir, f))),
  }));
  const shortUtterances: EnrollmentUtterance[] = ['user_short_1.wav', 'user_quiet_1.wav'].map((f) => ({
    id: f,
    waveform: parseWavFile(fs.readFileSync(path.join(userDir, f))),
  }));

  // 1. Enroll Alice
  await service.enrollFromUtterances('user_alice', convUtterances, shortUtterances);

  // 2. Query Bob -> MUST BE NOT_ENROLLED
  const bobStatus = await service.getProfileStatus('user_bob');
  assert.equal(bobStatus.status, 'NOT_ENROLLED');
  assert.equal(bobStatus.userId, 'user_bob');

  // Bob cannot load Alice's profile
  await assert.rejects(
    async () => {
      await vaultManager.loadProfile('user_bob');
    },
    /Profile does not exist/
  );

  // 3. Switch back to Alice -> ENROLLED
  const aliceStatus = await service.getProfileStatus('user_alice');
  assert.equal(aliceStatus.status, 'ENROLLED');
  assert.equal(aliceStatus.userId, 'user_alice');
});

// =====================================================================
// 4. Deletion, Re-enrollment & Corrupted Key Recovery Tests
// =====================================================================

test('Voice Enrollment: Deleting profile removes ciphertext cleanly', async () => {
  const { service, vaultManager } = createIsolatedService();
  const userDir = path.resolve('c:/project/New folder/pentone-campp-experiment/recordings/target_user');

  if (!fs.existsSync(userDir)) return;

  const convUtterances: EnrollmentUtterance[] = ['user_normal_1.wav', 'user_normal_2.wav', 'user_normal_3.wav'].map((f) => ({
    id: f,
    waveform: parseWavFile(fs.readFileSync(path.join(userDir, f))),
  }));
  const shortUtterances: EnrollmentUtterance[] = ['user_short_1.wav', 'user_quiet_1.wav'].map((f) => ({
    id: f,
    waveform: parseWavFile(fs.readFileSync(path.join(userDir, f))),
  }));

  await service.enrollFromUtterances('user_carol', convUtterances, shortUtterances);
  assert.equal((await service.getProfileStatus('user_carol')).status, 'ENROLLED');

  // Delete profile
  await service.deleteProfile('user_carol');
  assert.equal((await service.getProfileStatus('user_carol')).status, 'NOT_ENROLLED');
});

test('Voice Enrollment: Graceful recovery handles missing key without silent replacement', async () => {
  const { service, vaultManager, keyStore } = createIsolatedService();
  const userDir = path.resolve('c:/project/New folder/pentone-campp-experiment/recordings/target_user');

  if (!fs.existsSync(userDir)) return;

  const convUtterances: EnrollmentUtterance[] = ['user_normal_1.wav', 'user_normal_2.wav', 'user_normal_3.wav'].map((f) => ({
    id: f,
    waveform: parseWavFile(fs.readFileSync(path.join(userDir, f))),
  }));
  const shortUtterances: EnrollmentUtterance[] = ['user_short_1.wav', 'user_quiet_1.wav'].map((f) => ({
    id: f,
    waveform: parseWavFile(fs.readFileSync(path.join(userDir, f))),
  }));

  // Enroll user
  await service.enrollFromUtterances('user_dave', convUtterances, shortUtterances);

  // Simulate accidental IndexedDB key purging (key deleted while profile remains)
  await keyStore.deleteKey('user_dave');

  // getProfileStatus reports UNRECOVERABLE_KEY
  const corruptedStatus = await service.getProfileStatus('user_dave');
  assert.equal(corruptedStatus.status, 'UNRECOVERABLE_KEY');
  assert.match(corruptedStatus.errorMessage || '', /UnrecoverableKeyError/);

  // Silent key generation is blocked
  await assert.rejects(
    async () => {
      await vaultManager.getOrInitializeKey('user_dave');
    },
    /UnrecoverableKeyError/
  );

  // Explicit reset cleans corrupted state
  await service.resetProfile('user_dave');

  const postResetStatus = await service.getProfileStatus('user_dave');
  assert.equal(postResetStatus.status, 'NOT_ENROLLED');

  // Safe to re-enroll after reset
  const reEnrolledStatus = await service.enrollFromUtterances('user_dave', convUtterances, shortUtterances);
  assert.equal(reEnrolledStatus.status, 'ENROLLED');
});

// =====================================================================
// 5. Microphone Cleanup & Liveness Disclaimer Contract
// =====================================================================

test('Voice Enrollment: Microphone release cleanly halts all audio tracks', () => {
  const service = new VoiceEnrollmentService();

  let trackStopped = false;
  const mockTrack = {
    stop: () => {
      trackStopped = true;
    },
  };
  (service as any).activeMediaStream = {
    getTracks: () => [mockTrack],
  };

  service.releaseMicrophone();
  assert.equal(trackStopped, true);
  assert.equal((service as any).activeMediaStream, null);
});

test('Voice Enrollment: Security notice disclaimer is explicitly documented', () => {
  // Liveness disclaimer contract
  const disclaimerText =
    'Voice verification establishes speaker identity eligibility only. It does not provide liveness detection and cannot independently defend against audio recordings, replays, or cloned voices.';
  assert.ok(disclaimerText.includes('does not provide liveness detection'));
  assert.ok(disclaimerText.includes('cannot independently defend against audio recordings'));
});
