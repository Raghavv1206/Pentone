/**
 * Speaker Verification Contracts & Type Definitions
 * 
 * Defines strongly typed contracts for CAM++ speaker verification,
 * acoustic embeddings, speaker profiles, and verification decisions.
 * 
 * Invariants:
 * - 512-dimensional bottleneck representation (EMBEDDING_DIMENSION = 512).
 * - Discrete separation between raw cosine similarity, confidence estimate, and final decision.
 * - Zero raw PCM audio persistence in profile schemas.
 * - Similarity scores are geometric metrics, NOT calibrated Bayesian probabilities.
 */

import type { BiometricAudioSegment } from './biometric-audio-extractor';

export const CAM_SPEAKER_EMBEDDING_DIMENSION = 512;

/**
 * Tri-state verification decisions representing the biometric identity assessment.
 */
export type SpeakerVerificationDecision =
  | 'REGISTERED_USER' // Acoustic properties match registered profile above acceptance threshold
  | 'OTHER_SPEAKER'   // Acoustic properties match imposter/media below rejection floor
  | 'UNCERTAIN';      // Score falls into borderline zone; requires accumulation or fail-closed

/**
 * Acoustic routing paths based on utterance temporal characteristics.
 */
export type AcousticRoutingPath =
  | 'CONVERSATIONAL' // Audio duration >= 1.20s: evaluated against conversational centroid
  | 'SHORT_COMMAND'  // Audio duration 0.40s - 1.20s: evaluated against multi-sample short centroid
  | 'DISCARDED';      // Audio duration < 0.40s: rejected by hard duration floor

/**
 * High-level status of the CAM++ ONNX model session.
 */
export type ModelSessionStatus =
  | 'UNINITIALIZED'
  | 'LOADING_ASSET'
  | 'WARMING_UP'
  | 'READY'
  | 'IDLE_SUSPENDED'
  | 'DISPOSED'
  | 'ERROR';

/**
 * Authoritative lifecycle status of the user's voice biometric profile.
 */
export type VoiceProfileState =
  | 'PROFILE_IDLE'
  | 'PROFILE_LOADING'
  | 'PROFILE_LOADED'
  | 'PROFILE_NOT_ENROLLED'
  | 'PROFILE_DECRYPTION_FAILED'
  | 'PROFILE_STORAGE_ERROR';

/**
 * Standard thresholds governing tri-state biometric routing.
 */
export interface SpeakerVerificationThresholds {
  readonly acceptThreshold: number; // e.g. 0.62: scores >= acceptThreshold -> REGISTERED_USER
  readonly rejectThreshold: number; // e.g. 0.52: scores < rejectThreshold -> OTHER_SPEAKER
  readonly minAudioDurationSeconds: number; // e.g. 0.40s: minimum floor to prevent transient false accepts
  readonly shortCommandCutoffSeconds: number; // e.g. 1.20s: boundary between short and conversational
}

export const DEFAULT_VERIFICATION_THRESHOLDS: SpeakerVerificationThresholds = Object.freeze({
  acceptThreshold: 0.62,
  rejectThreshold: 0.52,
  minAudioDurationSeconds: 0.40,
  shortCommandCutoffSeconds: 1.20,
});

/**
 * Metadata accompanying a persistent speaker profile.
 * Zero raw PCM audio is retained.
 */
export interface SpeakerProfileMetadata {
  readonly schemaVersion: 2;
  readonly modelVersion: 'campplus-en-voxceleb-512-v1';
  readonly userId: string;
  readonly enrolledAt: number; // Unix timestamp ms
  readonly lastCalibratedAt: number; // Unix timestamp ms
  readonly noiseFloorRms: number;
  readonly conversationalSampleCount: number;
  readonly shortUtteranceSampleCount: number;
  readonly conversationalMeanSimilarity: number;
  readonly shortMeanSimilarity: number;
  readonly thresholds: SpeakerVerificationThresholds;
}

/**
 * In-memory unencrypted speaker profile containing mathematical centroids and exemplars.
 * All vector buffers are strictly 512-dimensional Float32Arrays.
 */
export interface UnencryptedSpeakerProfile {
  readonly metadata: SpeakerProfileMetadata;
  readonly conversationalCentroid: Float32Array; // 512-dim unit vector
  readonly conversationalExemplars: readonly Float32Array[]; // Top 2 exemplars (512-dim each)
  readonly shortCommandCentroid: Float32Array; // 512-dim unit vector from multi-sample enrollment
  readonly shortCommandExemplars: readonly Float32Array[]; // Top short exemplars (512-dim each)
}

/**
 * Serialized, encrypted at-rest profile package stored in IndexedDB.
 */
export interface EncryptedProfilePackage {
  readonly schemaVersion: 2;
  readonly userId: string;
  readonly ivBase64: string; // 12-byte AES-GCM IV
  readonly ciphertextBase64: string; // AES-256-GCM ciphertext with appended 16-byte auth tag
  readonly storedAt: number;
}

/**
 * Input request presented to the verification engine.
 */
export interface SpeakerVerificationRequest {
  readonly requestId: string; // Unique correlation identifier
  readonly turnId: number; // Active conversational voice turn ID
  readonly audioBuffer: Float32Array; // 16 kHz mono PCM float samples [-1.0, 1.0]
  readonly expectedUserId: string; // Expected account identity
  readonly capturedAt: number;
  readonly biometricSegment?: BiometricAudioSegment; // Optional extracted voiced segment
}

/**
 * Immutable biometric evaluation outcome produced by SpeakerVerificationEngine.
 */
export interface SpeakerVerificationResult {
  readonly requestId: string; // Correlation identifier matching request
  readonly turnId: number; // Correlation identifier matching speech turn
  readonly decision: SpeakerVerificationDecision;
  readonly similarityScore: number; // Authoritative weighted cosine similarity [-1.0, 1.0]
  readonly confidenceEstimate: number; // Non-probabilistic margin metric [0.0, 1.0]
  readonly durationSeconds: number; // Voiced duration in seconds
  readonly routingPath: AcousticRoutingPath;
  readonly centroidSimilarity: number;
  readonly exemplarSimilarity: number;
  readonly evaluatedAt: number;
  readonly failureReason?: string;
  readonly detectedSpeaker?: 'VERIFIED_USER' | 'OTHER_SPEAKER' | 'UNCERTAIN_SPEAKER' | 'OVERLAPPING_SPEECH';
  readonly speakerAttribution?: 'VERIFIED_USER' | 'OTHER_SPEAKER' | 'OVERLAPPING' | 'UNATTRIBUTED';
  readonly isolatedUserAudio?: Float32Array;
  readonly segmentCount?: number;
  readonly conversationalCentroidScore?: number;
  readonly shortCommandCentroidScore?: number;
  readonly scoringPolicy?: string;
  readonly rawDurationSeconds?: number;
  readonly voicedDurationSeconds?: number;
  readonly voicedFrameCount?: number;
  readonly preSpeechPadMs?: number;
  readonly postSpeechPadMs?: number;
}

/**
 * Validates that an acoustic vector adheres to the 512-dimensional CAM++ embedding specification.
 */
export function validateEmbeddingVector(vector: unknown): { valid: boolean; error?: string } {
  if (!vector || !(vector instanceof Float32Array)) {
    return { valid: false, error: 'Embedding must be an instance of Float32Array' };
  }
  if (vector.length !== CAM_SPEAKER_EMBEDDING_DIMENSION) {
    return {
      valid: false,
      error: `Invalid embedding dimension: expected ${CAM_SPEAKER_EMBEDDING_DIMENSION}, got ${vector.length}`,
    };
  }
  for (let i = 0; i < vector.length; i++) {
    if (!Number.isFinite(vector[i])) {
      return { valid: false, error: `Embedding contains non-finite value at index ${i}` };
    }
  }
  return { valid: true };
}

/**
 * Validates the internal consistency between similarity score, thresholds, and decision.
 */
export function validateDecisionConsistency(
  score: number,
  decision: SpeakerVerificationDecision,
  thresholds: SpeakerVerificationThresholds = DEFAULT_VERIFICATION_THRESHOLDS
): { consistent: boolean; error?: string } {
  if (!Number.isFinite(score)) {
    return { consistent: false, error: 'Similarity score must be a finite number' };
  }
  if (score < -1.0 || score > 1.0) {
    return { consistent: false, error: `Similarity score out of bounds [-1.0, 1.0]: ${score}` };
  }
  if (thresholds.rejectThreshold >= thresholds.acceptThreshold) {
    return { consistent: false, error: 'Reject threshold must be strictly less than accept threshold' };
  }

  if (score >= thresholds.acceptThreshold && decision !== 'REGISTERED_USER') {
    return {
      consistent: false,
      error: `Inconsistent decision: score ${score} meets accept threshold ${thresholds.acceptThreshold} but decision is ${decision}`,
    };
  }

  if (score < thresholds.rejectThreshold && decision !== 'OTHER_SPEAKER') {
    return {
      consistent: false,
      error: `Inconsistent decision: score ${score} below reject threshold ${thresholds.rejectThreshold} but decision is ${decision}`,
    };
  }

  if (
    score >= thresholds.rejectThreshold &&
    score < thresholds.acceptThreshold &&
    decision !== 'UNCERTAIN'
  ) {
    return {
      consistent: false,
      error: `Inconsistent decision: score ${score} in uncertain zone [${thresholds.rejectThreshold}, ${thresholds.acceptThreshold}) but decision is ${decision}`,
    };
  }

  return { consistent: true };
}
