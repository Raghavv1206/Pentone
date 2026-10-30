/**
 * Audio Buffer Resampler & Validator
 * 
 * Ensures audio buffers passed to Whisper ASR are:
 * 1. Valid Float32Array instances with finite values within [-1.0, 1.0].
 * 2. Exactly 16,000 Hz sample rate (Whisper standard).
 * 3. Bounded between minimum and maximum acceptable durations.
 * 
 * Note: getUserMedia and AudioContext sample rates vary by hardware (often 44.1kHz or 48kHz on Windows).
 * This module guarantees standard 16kHz Float32Array conversion via interpolation.
 */

export interface AudioValidationOptions {
  sourceSampleRate?: number
  targetSampleRate?: number
  minDurationSeconds?: number // Default: 0.2s
  maxDurationSeconds?: number // Default: 30.0s
}

export interface ValidatedAudio {
  audio: Float32Array
  sampleRate: number
  durationSeconds: number
  wasResampled: boolean
}

export class AudioResampler {
  public static readonly TARGET_SAMPLE_RATE = 16000

  /**
   * Validates and resamples an audio buffer to 16kHz Float32Array.
   */
  public static validateAndResample(
    input: Float32Array,
    options: AudioValidationOptions = {}
  ): ValidatedAudio {
    if (!input || !(input instanceof Float32Array)) {
      throw new Error('Invalid audio buffer: Input must be a Float32Array')
    }

    if (input.length === 0) {
      throw new Error('Invalid audio buffer: Buffer is empty (0 samples)')
    }

    const sourceRate = options.sourceSampleRate || 16000
    const targetRate = options.targetSampleRate || AudioResampler.TARGET_SAMPLE_RATE
    const minSecs = options.minDurationSeconds ?? 0.2
    const maxSecs = options.maxDurationSeconds ?? 30.0

    // 1. Sanitize buffer (replace NaN / Infinity, clamp [-1, 1])
    let hasNonZero = false
    const sanitized = new Float32Array(input.length)
    for (let i = 0; i < input.length; i++) {
      let val = input[i]
      if (!Number.isFinite(val)) {
        val = 0
      } else if (val > 1.0) {
        val = 1.0
      } else if (val < -1.0) {
        val = -1.0
      }
      sanitized[i] = val
      if (Math.abs(val) > 0.0001) {
        hasNonZero = true
      }
    }

    if (!hasNonZero) {
      throw new Error('Invalid audio buffer: Buffer contains only silence (all zero samples)')
    }

    // 2. Resample if sourceRate !== targetRate
    let finalAudio: Float32Array
    let wasResampled = false

    if (sourceRate === targetRate) {
      finalAudio = sanitized
    } else {
      finalAudio = AudioResampler.resample(sanitized, sourceRate, targetRate)
      wasResampled = true
    }

    // 3. Duration validation
    const duration = finalAudio.length / targetRate
    if (duration < minSecs) {
      throw new Error(`Audio duration too short: ${duration.toFixed(2)}s (minimum ${minSecs}s required)`)
    }

    if (duration > maxSecs) {
      // Truncate to maximum duration to avoid GPU/RAM exhaustion
      const maxSamples = Math.floor(maxSecs * targetRate)
      finalAudio = finalAudio.subarray(0, maxSamples)
    }

    return {
      audio: finalAudio,
      sampleRate: targetRate,
      durationSeconds: finalAudio.length / targetRate,
      wasResampled
    }
  }

  /**
   * High-quality linear interpolation resampling
   */
  public static resample(
    input: Float32Array,
    sourceRate: number,
    targetRate: number
  ): Float32Array {
    if (sourceRate <= 0 || targetRate <= 0) {
      throw new Error(`Invalid sample rates: source=${sourceRate}, target=${targetRate}`)
    }

    if (sourceRate === targetRate) {
      return input
    }

    const ratio = sourceRate / targetRate
    const outputLength = Math.round(input.length / ratio)
    const output = new Float32Array(outputLength)

    for (let i = 0; i < outputLength; i++) {
      const position = i * ratio
      const index = Math.floor(position)
      const fraction = position - index

      const sample1 = input[index] || 0
      const sample2 = input[index + 1] ?? sample1

      output[i] = sample1 + fraction * (sample2 - sample1)
    }

    return output
  }
}
