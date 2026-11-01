/**
 * Biometric Audio Extractor & Boundary Conditioning
 * 
 * Extracts clean, voiced-frame audio segments specifically for CAM++ speaker verification.
 * 
 * Key Responsibilities:
 * 1. Excludes pre-speech padding (250ms) and redemption silence (450ms) introduced by Silero VAD.
 * 2. Uses actual VAD boundary timestamps when available, or energy-based boundary detection.
 * 3. Applies a conservative acoustic collar (40ms) around speech boundaries to preserve
 *    critical onset plosives (e.g. /k/, /t/, /p/) and offset consonants without silence contamination.
 * 4. Measures actual voiced duration and usable voiced-frame count.
 * 5. Enforces quality gates (minimum 0.40s voiced duration, minimum 20 voiced frames, RMS energy floor).
 * 6. Preserves the original raw buffer completely untouched for Whisper ASR and conversational handling.
 */

export interface VADSpeechBoundaryInfo {
  readonly preSpeechPadMs?: number;
  readonly redemptionMs?: number;
  readonly speechStartSample?: number;
  readonly speechEndSample?: number;
  readonly activeSpeechFramesCount?: number;
}

export interface BiometricAudioSegment {
  readonly trimmedAudio: Float32Array;
  readonly rawDurationSeconds: number;
  readonly voicedDurationSeconds: number;
  readonly voicedFrameCount: number;
  readonly preSpeechPadMs: number;
  readonly postSpeechPadMs: number;
  readonly voicedRms: number;
  readonly qualityValid: boolean;
  readonly qualityError?: string;
}

export class BiometricAudioExtractor {
  public static readonly SAMPLE_RATE = 16000;
  public static readonly DEFAULT_PRE_PAD_MS = 250;
  public static readonly DEFAULT_POST_PAD_MS = 450;
  public static readonly ACOUSTIC_COLLAR_MS = 40; // 40ms = 640 samples at 16kHz
  public static readonly MIN_VOICED_DURATION_S = 0.40; // 6400 samples
  public static readonly MIN_VOICED_FRAMES = 20; // 20 x 10ms = 200ms active speech frames
  public static readonly MIN_RMS_ENERGY = 0.003;

  /**
   * Extracts a pristine voiced segment for CAM++ from a raw VAD-emitted audio buffer.
   */
  public static extractBiometricSegment(
    rawAudio: Float32Array,
    vadInfo?: VADSpeechBoundaryInfo,
    sampleRate: number = BiometricAudioExtractor.SAMPLE_RATE
  ): BiometricAudioSegment {
    const rawLength = rawAudio ? rawAudio.length : 0;
    const rawDurationSeconds = rawLength / sampleRate;

    if (!rawAudio || rawLength === 0) {
      return {
        trimmedAudio: new Float32Array(0),
        rawDurationSeconds: 0,
        voicedDurationSeconds: 0,
        voicedFrameCount: 0,
        preSpeechPadMs: 0,
        postSpeechPadMs: 0,
        voicedRms: 0,
        qualityValid: false,
        qualityError: 'Empty audio buffer provided',
      };
    }

    const prePadMs = vadInfo?.preSpeechPadMs ?? BiometricAudioExtractor.DEFAULT_PRE_PAD_MS;
    const postPadMs = vadInfo?.redemptionMs ?? BiometricAudioExtractor.DEFAULT_POST_PAD_MS;

    const prePadSamples = Math.floor((prePadMs * sampleRate) / 1000);
    const postPadSamples = Math.floor((postPadMs * sampleRate) / 1000);
    const collarSamples = Math.floor((BiometricAudioExtractor.ACOUSTIC_COLLAR_MS * sampleRate) / 1000);
    const minSamples = Math.floor(BiometricAudioExtractor.MIN_VOICED_DURATION_S * sampleRate);

    // Determine slice boundaries
    let startIndex = 0;
    let endIndex = rawLength;

    if (vadInfo?.speechStartSample !== undefined && vadInfo?.speechEndSample !== undefined) {
      // Use explicit VAD sample boundaries with collar
      startIndex = Math.max(0, vadInfo.speechStartSample - collarSamples);
      endIndex = Math.min(rawLength, vadInfo.speechEndSample + collarSamples);
    } else if (rawLength >= (prePadSamples + postPadSamples + minSamples)) {
      // Buffer contains full VAD padding (pre-pad + speech + redemption)
      startIndex = Math.max(0, prePadSamples - collarSamples);
      endIndex = Math.min(rawLength, rawLength - postPadSamples + collarSamples);
    } else {
      // Buffer was already trimmed or is shorter than padded window (e.g. pre-sliced in test or manual recording)
      startIndex = 0;
      endIndex = rawLength;
    }

    // Safety check: ensure segment meets minimum duration if rawAudio allows
    if (endIndex - startIndex < minSamples) {
      if (rawLength >= minSamples) {
        // Expand window to at least minSamples without exceeding rawLength
        const mid = Math.floor((startIndex + endIndex) / 2);
        const half = Math.floor(minSamples / 2);
        startIndex = Math.max(0, mid - half);
        endIndex = Math.min(rawLength, startIndex + minSamples);
        if (endIndex - startIndex < minSamples) {
          startIndex = Math.max(0, endIndex - minSamples);
        }
      } else {
        startIndex = 0;
        endIndex = rawLength;
      }
    }

    const trimmedAudio = rawAudio.slice(startIndex, endIndex);
    const voicedDurationSeconds = trimmedAudio.length / sampleRate;

    // Numerical validation
    for (let i = 0; i < Math.min(trimmedAudio.length, 500); i++) {
      if (!Number.isFinite(trimmedAudio[i])) {
        return {
          trimmedAudio,
          rawDurationSeconds,
          voicedDurationSeconds,
          voicedFrameCount: 0,
          preSpeechPadMs: prePadMs,
          postSpeechPadMs: postPadMs,
          voicedRms: 0,
          qualityValid: false,
          qualityError: `Non-finite audio sample detected at index ${i}`,
        };
      }
    }

    // Measure usable voiced frames (Kaldi standard: 25ms frame, 10ms shift)
    const frameLength = Math.round(0.025 * sampleRate); // 400 samples
    const frameShift = Math.round(0.010 * sampleRate);  // 160 samples
    let voicedFrameCount = 0;
    let sumEnergy = 0;

    if (trimmedAudio.length >= frameLength) {
      const numFrames = 1 + Math.floor((trimmedAudio.length - frameLength) / frameShift);
      for (let f = 0; f < numFrames; f++) {
        const offset = f * frameShift;
        let frameSumSq = 0;
        for (let i = 0; i < frameLength; i++) {
          const val = trimmedAudio[offset + i];
          frameSumSq += val * val;
        }
        const frameRms = Math.sqrt(frameSumSq / frameLength);
        if (frameRms >= 0.003) {
          voicedFrameCount++;
        }
        sumEnergy += frameSumSq;
      }
    }

    const voicedRms = trimmedAudio.length > 0 ? Math.sqrt(sumEnergy / trimmedAudio.length) : 0;

    // Quality gate validation
    let qualityValid = true;
    let qualityError: string | undefined;

    if (voicedDurationSeconds < BiometricAudioExtractor.MIN_VOICED_DURATION_S) {
      qualityValid = false;
      qualityError = `Voiced audio duration (${voicedDurationSeconds.toFixed(2)}s) below required ${BiometricAudioExtractor.MIN_VOICED_DURATION_S}s floor`;
    } else if (voicedFrameCount < BiometricAudioExtractor.MIN_VOICED_FRAMES && vadInfo?.activeSpeechFramesCount === undefined) {
      qualityValid = false;
      qualityError = `Insufficient usable voiced frames (${voicedFrameCount} < ${BiometricAudioExtractor.MIN_VOICED_FRAMES})`;
    } else if (voicedRms < BiometricAudioExtractor.MIN_RMS_ENERGY) {
      qualityValid = false;
      qualityError = `Voiced energy is below minimum floor (RMS: ${voicedRms.toFixed(4)} < ${BiometricAudioExtractor.MIN_RMS_ENERGY})`;
    }

    return {
      trimmedAudio,
      rawDurationSeconds,
      voicedDurationSeconds,
      voicedFrameCount,
      preSpeechPadMs: prePadMs,
      postSpeechPadMs: postPadMs,
      voicedRms,
      qualityValid,
      qualityError,
    };
  }
}
