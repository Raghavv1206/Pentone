import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { KaldiFbankExtractor } from '../lib/audio/kaldi-fbank-extractor';
import { VectorMath } from '../lib/audio/vector-math';
import {
  CAM_SPEAKER_EMBEDDING_DIMENSION,
  DEFAULT_VERIFICATION_THRESHOLDS,
  type SpeakerVerificationRequest,
  type UnencryptedSpeakerProfile,
} from '../lib/audio/speaker-types';
import {
  SpeakerVerificationEngine,
  type EnrollmentUtterance,
} from '../lib/audio/speaker-verification-engine';

// Self-contained RIFF WAV parser for test audio fixtures
function parseWavFile(buffer: Buffer): Float32Array {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const riff = String.fromCharCode(...buffer.subarray(0, 4));
  if (riff !== 'RIFF') {
    throw new Error('Invalid RIFF header');
  }

  let offset = 12;
  let audioFormat = 1;
  let channels = 1;
  let bitsPerSample = 16;
  let dataOffset = 0;
  let dataLength = 0;

  while (offset < buffer.byteLength) {
    const chunkId = String.fromCharCode(...buffer.subarray(offset, offset + 4));
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === 'fmt ') {
      audioFormat = view.getUint16(offset + 8, true);
      channels = view.getUint16(offset + 10, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataLength = chunkSize;
      break;
    }

    offset += 8 + chunkSize;
  }

  if (dataOffset === 0 || dataLength === 0) {
    throw new Error('WAV data chunk not found');
  }

  const bytesPerSample = bitsPerSample / 8;
  const totalSamples = Math.floor(dataLength / (bytesPerSample * channels));
  const monoSamples = new Float32Array(totalSamples);

  if (audioFormat === 1 && bitsPerSample === 16) {
    for (let i = 0; i < totalSamples; i++) {
      let sum = 0;
      for (let ch = 0; ch < channels; ch++) {
        const sampleIndex = dataOffset + (i * channels + ch) * 2;
        sum += view.getInt16(sampleIndex, true) / 32768.0;
      }
      monoSamples[i] = sum / channels;
    }
  } else {
    throw new Error(`Unsupported WAV format ${audioFormat} / ${bitsPerSample} bit`);
  }

  return monoSamples;
}

// Helper to synthesize synthetic speech-like harmonic waveforms at 16 kHz
function generateSyntheticTone(
  fundamentalHz: number,
  durationSeconds: number,
  sampleRate: number = 16000
): Float32Array {
  const numSamples = Math.floor(durationSeconds * sampleRate);
  const buffer = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    buffer[i] = 0.5 * Math.sin(2 * Math.PI * fundamentalHz * t);
  }
  return buffer;
}

// =================================================================
// 1. Kaldi Fbank Extractor Tests
// =================================================================

test('KaldiFbankExtractor: Frequency to Mel conversion is mathematically sound and invertible', () => {
  const freqs = [20, 100, 300, 1000, 3400, 8000];
  for (const hz of freqs) {
    const mel = KaldiFbankExtractor.hzToMel(hz);
    const roundtripHz = KaldiFbankExtractor.melToHz(mel);
    assert.ok(Math.abs(hz - roundtripHz) < 1e-4, `Hz roundtrip failed for ${hz}: got ${roundtripHz}`);
  }
});

test('KaldiFbankExtractor: Feature extraction produces exact [numFrames, 80] dimensions', () => {
  const extractor = new KaldiFbankExtractor({ sampleRate: 16000 });
  const audio = generateSyntheticTone(150, 1.0);
  const frames = extractor.extract(audio);

  assert.equal(frames.length, 98);
  for (const frame of frames) {
    assert.equal(frame.length, 80);
    for (let m = 0; m < 80; m++) {
      assert.ok(Number.isFinite(frame[m]), `Mel bin ${m} is non-finite`);
    }
  }

  // Tensor flattening verification
  const tensor = extractor.toTensorData(frames);
  assert.equal(tensor.shape[0], 1);
  assert.equal(tensor.shape[1], 98);
  assert.equal(tensor.shape[2], 80);
  assert.equal(tensor.data.length, 98 * 80);
});

test('KaldiFbankExtractor: Audio under frame length (400 samples) returns empty frames', () => {
  const extractor = new KaldiFbankExtractor();
  const shortAudio = new Float32Array(350);
  const frames = extractor.extract(shortAudio);
  assert.equal(frames.length, 0);

  const emptyFrames = extractor.extract(new Float32Array(0));
  assert.equal(emptyFrames.length, 0);
});

test('KaldiFbankExtractor: Rejects non-finite numerical input samples', () => {
  const extractor = new KaldiFbankExtractor();
  const badAudio = new Float32Array(1000);
  badAudio[100] = NaN;
  assert.throws(() => extractor.extract(badAudio), /non-finite numerical values/);
});

// =================================================================
// 2. VectorMath Unit Tests
// =================================================================

test('VectorMath: Computes dot product, norm, and unit normalization correctly', () => {
  const v1 = new Float32Array([3, 4]);
  assert.equal(VectorMath.norm(v1), 5.0);

  const normalized = VectorMath.normalize(v1);
  assert.ok(Math.abs(normalized[0] - 0.6) < 1e-6);
  assert.ok(Math.abs(normalized[1] - 0.8) < 1e-6);
  assert.ok(Math.abs(VectorMath.norm(normalized) - 1.0) < 1e-6);

  const v2 = new Float32Array([4, -3]); // orthogonal
  assert.equal(VectorMath.dot(v1, v2), 0.0);
  assert.equal(VectorMath.cosineSimilarity(v1, v2), 0.0);
});

test('VectorMath: Computes centroid and pairwise similarities accurately', () => {
  const a = VectorMath.normalize(new Float32Array([1, 0, 0]));
  const b = VectorMath.normalize(new Float32Array([0, 1, 0]));
  const centroid = VectorMath.computeCentroid([a, b]);

  assert.ok(Math.abs(VectorMath.norm(centroid) - 1.0) < 1e-6);
  assert.ok(Math.abs(centroid[0] - centroid[1]) < 1e-6);
  assert.equal(centroid[2], 0);

  const pairMatrix = VectorMath.pairwiseSimilarities([a, b]);
  assert.equal(pairMatrix[0][0], 1.0);
  assert.equal(pairMatrix[1][1], 1.0);
  assert.equal(pairMatrix[0][1], 0.0);
});

// =================================================================
// 3. SpeakerVerificationEngine Inference & Verification Tests
// =================================================================

test('SpeakerVerificationEngine: Singleton initialization and session warming', async () => {
  SpeakerVerificationEngine.resetInstance();
  const modelPath = path.resolve(process.cwd(), 'assets/cam_speaker.onnx');
  const engine = SpeakerVerificationEngine.getInstance({ modelPath });

  assert.equal(engine.getStatus(), 'UNINITIALIZED');
  await engine.initialize();
  assert.equal(engine.getStatus(), 'READY');
});

test('SpeakerVerificationEngine: Extracts 512-dim L2 unit normalized embedding', async () => {
  const engine = SpeakerVerificationEngine.getInstance();
  const audio = generateSyntheticTone(180, 1.5); // 1.5 seconds

  const embedding = await engine.extractEmbedding(audio);
  assert.equal(embedding.length, CAM_SPEAKER_EMBEDDING_DIMENSION);

  // Validate unit norm
  const norm = VectorMath.norm(embedding);
  assert.ok(Math.abs(norm - 1.0) < 1e-4, `Expected unit norm ~1.0, got ${norm}`);

  // Determinism check: Same audio produces identical embedding
  const repeatEmbedding = await engine.extractEmbedding(audio);
  const similarity = VectorMath.cosineSimilarity(embedding, repeatEmbedding);
  assert.ok(
    Math.abs(similarity - 1.0) < 1e-5,
    `Deterministic inference violated: cosine similarity was ${similarity}`
  );
});

test('SpeakerVerificationEngine: Rejects audio under 0.40s duration floor', async () => {
  const engine = SpeakerVerificationEngine.getInstance();
  const shortAudio = generateSyntheticTone(180, 0.35); // 0.35s < 0.40s

  await assert.rejects(
    async () => await engine.extractEmbedding(shortAudio),
    /Audio buffer too short/
  );
});

test('SpeakerVerificationEngine: Hard duration floor fails closed in verifySpeech with DISCARDED', async () => {
  const engine = SpeakerVerificationEngine.getInstance();
  const dummyProfile: UnencryptedSpeakerProfile = {
    metadata: {
      schemaVersion: 2,
      modelVersion: 'campplus-en-voxceleb-512-v1',
      userId: 'test-user',
      enrolledAt: Date.now(),
      lastCalibratedAt: Date.now(),
      noiseFloorRms: 0.005,
      conversationalSampleCount: 3,
      shortUtteranceSampleCount: 2,
      conversationalMeanSimilarity: 0.85,
      shortMeanSimilarity: 0.82,
      thresholds: DEFAULT_VERIFICATION_THRESHOLDS,
    },
    conversationalCentroid: new Float32Array(512),
    conversationalExemplars: [new Float32Array(512)],
    shortCommandCentroid: new Float32Array(512),
    shortCommandExemplars: [new Float32Array(512)],
  };

  const shortRequest: SpeakerVerificationRequest = {
    requestId: 'req-floor-1',
    turnId: 1,
    audioBuffer: generateSyntheticTone(180, 0.25), // 0.25s
    expectedUserId: 'test-user',
    capturedAt: Date.now(),
  };

  const result = await engine.verifySpeech(shortRequest, dummyProfile);
  assert.equal(result.decision, 'OTHER_SPEAKER');
  assert.equal(result.routingPath, 'DISCARDED');
  assert.equal(result.similarityScore, 0.0);
  assert.ok(result.failureReason?.includes('below minimum floor'));
});

test('SpeakerVerificationEngine: Tri-state decisions and dual-path routing on real recordings', async () => {
  const engine = SpeakerVerificationEngine.getInstance();

  const userDir = path.resolve('../pentone-campp-experiment/recordings/user');
  const impDir = path.resolve('../pentone-campp-experiment/recordings/imposters');
  const ambDir = path.resolve('../pentone-campp-experiment/recordings/ambient');

  if (fs.existsSync(userDir) && fs.existsSync(impDir)) {
    // 1. Multi-sample enrollment with real physical microphone recordings
    // List all files and durations
    const rawShort = parseWavFile(fs.readFileSync(path.join(userDir, 'user_short_1.wav')));
    let maxIdx = 0, maxVal = 0;
    for (let i = 0; i < rawShort.length; i++) {
      if (Math.abs(rawShort[i]) > maxVal) { maxVal = Math.abs(rawShort[i]); maxIdx = i; }
    }

    const convFiles = [
      'user_normal_1.wav',
      'user_normal_2.wav',
      'user_normal_3.wav',
      'user_normal_4.wav',
      'user_normal_5.wav',
    ];
    const shortFiles = ['user_short_1.wav', 'user_quiet_1.wav'];

    const convSamples: EnrollmentUtterance[] = convFiles.map((f) => ({
      id: f,
      waveform: parseWavFile(fs.readFileSync(path.join(userDir, f))),
    }));

    const shortSamples: EnrollmentUtterance[] = shortFiles.map((f) => ({
      id: f,
      waveform: parseWavFile(fs.readFileSync(path.join(userDir, f))),
    }));

    const profile = await engine.enrollSpeaker('real-user-test', convSamples, shortSamples, 0.005);
    assert.equal(profile.conversationalCentroid.length, 512);
    assert.equal(profile.shortCommandCentroid.length, 512);

    // 2. Evaluate held-out genuine conversational utterance (user_loud_1.wav, duration > 1.20s)
    const convUtterance = parseWavFile(fs.readFileSync(path.join(userDir, 'user_loud_1.wav')));
    const convReq: SpeakerVerificationRequest = {
      requestId: 'req-conv-eval',
      turnId: 11,
      audioBuffer: convUtterance,
      expectedUserId: 'real-user-test',
      capturedAt: Date.now(),
    };
    const convRes = await engine.verifySpeech(convReq, profile);
    assert.equal(convRes.routingPath, 'CONVERSATIONAL');
    assert.equal(convRes.decision, 'REGISTERED_USER');
    assert.ok(convRes.similarityScore >= 0.62);

    // 3. Evaluate short command utterance (< 1.20s cutoff)
    // Slices 0.85s around peak energy from genuine short utterance
    const shortUtterance = rawShort.slice(Math.max(0, maxIdx - 6800), Math.max(0, maxIdx - 6800) + 13600);
    const shortReq: SpeakerVerificationRequest = {
      requestId: 'req-short-eval',
      turnId: 12,
      audioBuffer: shortUtterance,
      expectedUserId: 'real-user-test',
      capturedAt: Date.now(),
    };
    const shortRes = await engine.verifySpeech(shortReq, profile);
    assert.equal(shortRes.routingPath, 'SHORT_COMMAND');
    // Short command evaluated against multi-sample short centroid
    assert.ok(shortRes.similarityScore > 0.40);

    // 4. Evaluate physical imposter utterance (speaker2_normal_1.wav)
    const impUtterance = parseWavFile(fs.readFileSync(path.join(impDir, 'speaker2_normal_1.wav')));
    const impReq: SpeakerVerificationRequest = {
      requestId: 'req-imp-eval',
      turnId: 13,
      audioBuffer: impUtterance,
      expectedUserId: 'real-user-test',
      capturedAt: Date.now(),
    };
    const impRes = await engine.verifySpeech(impReq, profile);
    assert.equal(impRes.routingPath, 'CONVERSATIONAL');
    assert.equal(impRes.decision, 'OTHER_SPEAKER');
    assert.ok(impRes.similarityScore < 0.52);

    // 5. Evaluate ambient noise utterance (fan_typing.wav)
    if (fs.existsSync(path.join(ambDir, 'fan_typing.wav'))) {
      const ambUtterance = parseWavFile(fs.readFileSync(path.join(ambDir, 'fan_typing.wav')));
      const ambReq: SpeakerVerificationRequest = {
        requestId: 'req-amb-eval',
        turnId: 14,
        audioBuffer: ambUtterance,
        expectedUserId: 'real-user-test',
        capturedAt: Date.now(),
      };
      const ambRes = await engine.verifySpeech(ambReq, profile);
      assert.equal(ambRes.decision, 'OTHER_SPEAKER');
      assert.ok(ambRes.similarityScore < 0.52);
    }
  } else {
    // Synthetic fallback when recordings directory is absent
    const dummyCentroid = VectorMath.normalize(new Float32Array(512).fill(0.1));
    const fallbackProfile: UnencryptedSpeakerProfile = {
      metadata: {
        schemaVersion: 2,
        modelVersion: 'campplus-en-voxceleb-512-v1',
        userId: 'synthetic-user',
        enrolledAt: Date.now(),
        lastCalibratedAt: Date.now(),
        noiseFloorRms: 0.005,
        conversationalSampleCount: 3,
        shortUtteranceSampleCount: 2,
        conversationalMeanSimilarity: 0.85,
        shortMeanSimilarity: 0.82,
        thresholds: DEFAULT_VERIFICATION_THRESHOLDS,
      },
      conversationalCentroid: dummyCentroid,
      conversationalExemplars: [dummyCentroid],
      shortCommandCentroid: dummyCentroid,
      shortCommandExemplars: [dummyCentroid],
    };

    const req: SpeakerVerificationRequest = {
      requestId: 'req-syn',
      turnId: 15,
      audioBuffer: generateSyntheticTone(180, 0.8),
      expectedUserId: 'synthetic-user',
      capturedAt: Date.now(),
    };
    const res = await engine.verifySpeech(req, fallbackProfile);
    assert.equal(res.routingPath, 'SHORT_COMMAND');
  }
});

test('SpeakerVerificationEngine: Cancellation handling', async () => {
  const engine = SpeakerVerificationEngine.getInstance();
  const dummyCentroid = VectorMath.normalize(new Float32Array(512).fill(0.2));
  const dummyProfile: UnencryptedSpeakerProfile = {
    metadata: {
      schemaVersion: 2,
      modelVersion: 'campplus-en-voxceleb-512-v1',
      userId: 'user-cancel',
      enrolledAt: Date.now(),
      lastCalibratedAt: Date.now(),
      noiseFloorRms: 0.005,
      conversationalSampleCount: 3,
      shortUtteranceSampleCount: 2,
      conversationalMeanSimilarity: 0.85,
      shortMeanSimilarity: 0.82,
      thresholds: DEFAULT_VERIFICATION_THRESHOLDS,
    },
    conversationalCentroid: dummyCentroid,
    conversationalExemplars: [dummyCentroid],
    shortCommandCentroid: dummyCentroid,
    shortCommandExemplars: [dummyCentroid],
  };

  engine.cancel();

  const cancelRequest: SpeakerVerificationRequest = {
    requestId: 'req-cancel-1',
    turnId: 5,
    audioBuffer: generateSyntheticTone(140, 1.5),
    expectedUserId: 'user-cancel',
    capturedAt: Date.now(),
  };

  const result = await engine.verifySpeech(cancelRequest, dummyProfile);
  assert.equal(result.decision, 'OTHER_SPEAKER');
  assert.equal(result.routingPath, 'DISCARDED');
  assert.equal(result.failureReason, 'Verification cancelled');
});

test('SpeakerVerificationEngine: Resource disposal', async () => {
  const engine = SpeakerVerificationEngine.getInstance();
  await engine.dispose();
  assert.equal(engine.getStatus(), 'DISPOSED');
});
