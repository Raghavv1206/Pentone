/**
 * Kaldi-Compliant 80-dimensional Log Mel-Filterbank (Fbank) Extractor
 * 
 * Implements the acoustic frontend required by Alibaba DAMO Academy /
 * ModelScope 3D-Speaker CAM++ model (`speech_campplus_sv_en_voxceleb_16k`).
 * 
 * Specifications:
 * - Sampling rate: 16,000 Hz
 * - Frame length: 25 ms (400 samples)
 * - Frame shift: 10 ms (160 samples)
 * - Window type: 'povey' (Kaldi standard: Hamming window raised to power 0.85)
 * - Pre-emphasis coefficient: 0.97 (computed backwards)
 * - FFT size: 512
 * - Mel bins: 80
 * - Low frequency: 20 Hz
 * - High frequency: 8,000 Hz (Nyquist)
 * - Snip edges: true
 * - Dither: 0.0 (deterministic inference)
 * - Remove DC offset: true
 * - Mean normalization: true (Temporal Cepstral Mean Normalization across frames)
 */

export interface KaldiFbankOptions {
  sampleRate?: number;        // default: 16000
  frameLengthMs?: number;     // default: 25.0 (400 samples at 16kHz)
  frameShiftMs?: number;      // default: 10.0 (160 samples at 16kHz)
  numMelBins?: number;        // default: 80
  lowFreq?: number;           // default: 20.0
  highFreq?: number;          // default: 8000.0 (sampleRate / 2)
  preemphasis?: number;       // default: 0.97
  removeDcOffset?: boolean;   // default: true
  meanNormalization?: boolean;// default: true
}

export class KaldiFbankExtractor {
  public readonly sampleRate: number;
  public readonly frameLength: number;
  public readonly frameShift: number;
  public readonly numMelBins: number;
  public readonly lowFreq: number;
  public readonly highFreq: number;
  public readonly preemphasis: number;
  public readonly removeDcOffset: boolean;
  public readonly meanNormalization: boolean;
  public readonly fftSize: number;

  private readonly window: Float32Array;
  private readonly melBank: Float32Array[]; // [numMelBins][fftBins]

  constructor(options: KaldiFbankOptions = {}) {
    this.sampleRate = options.sampleRate ?? 16000;
    this.frameLength = Math.round((options.frameLengthMs ?? 25.0) * (this.sampleRate / 1000)); // 400
    this.frameShift = Math.round((options.frameShiftMs ?? 10.0) * (this.sampleRate / 1000));   // 160
    this.numMelBins = options.numMelBins ?? 80;
    this.lowFreq = options.lowFreq ?? 20.0;
    this.highFreq = (options.highFreq && options.highFreq > 0) ? options.highFreq : (this.sampleRate / 2); // 8000.0
    this.preemphasis = options.preemphasis ?? 0.97;
    this.removeDcOffset = options.removeDcOffset ?? true;
    this.meanNormalization = options.meanNormalization ?? true;

    // Smallest power of 2 >= frameLength
    let fft = 1;
    while (fft < this.frameLength) {
      fft <<= 1;
    }
    this.fftSize = fft; // 512 for 400 samples

    // Initialize Povey Window: w[i] = (0.5 - 0.5 * cos(2 * pi * i / (N - 1))) ^ 0.85
    this.window = new Float32Array(this.frameLength);
    const a = 2.0 * Math.PI / (this.frameLength - 1);
    for (let i = 0; i < this.frameLength; i++) {
      const hanning = 0.5 - 0.5 * Math.cos(a * i);
      this.window[i] = Math.pow(hanning, 0.85);
    }

    // Initialize Mel Filterbank Matrix
    this.melBank = this.initMelFilterbank();
  }

  /**
   * Convert frequency in Hz to Mel scale using Kaldi formula:
   * mel = 1127.0 * ln(1.0 + freq / 700.0)
   */
  public static hzToMel(hz: number): number {
    return 1127.0 * Math.log(1.0 + hz / 700.0);
  }

  /**
   * Convert Mel scale to frequency in Hz:
   * freq = 700.0 * (exp(mel / 1127.0) - 1.0)
   */
  public static melToHz(mel: number): number {
    return 700.0 * (Math.exp(mel / 1127.0) - 1.0);
  }

  private initMelFilterbank(): Float32Array[] {
    const numFftBins = (this.fftSize / 2) + 1; // 257 bins for 512 FFT
    const lowMel = KaldiFbankExtractor.hzToMel(this.lowFreq);
    const highMel = KaldiFbankExtractor.hzToMel(this.highFreq);
    const melDelta = (highMel - lowMel) / (this.numMelBins + 1);

    const melPoints = new Float64Array(this.numMelBins + 2);
    for (let i = 0; i < this.numMelBins + 2; i++) {
      melPoints[i] = lowMel + i * melDelta;
    }

    const hzPoints = new Float64Array(this.numMelBins + 2);
    for (let i = 0; i < this.numMelBins + 2; i++) {
      hzPoints[i] = KaldiFbankExtractor.melToHz(melPoints[i]);
    }

    // Bin index corresponding to frequency: bin = (hz * fftSize) / sampleRate
    const binPoints = new Float64Array(this.numMelBins + 2);
    for (let i = 0; i < this.numMelBins + 2; i++) {
      binPoints[i] = (hzPoints[i] * this.fftSize) / this.sampleRate;
    }

    const bank: Float32Array[] = [];
    for (let m = 0; m < this.numMelBins; m++) {
      const filter = new Float32Array(numFftBins);
      const leftBin = binPoints[m];
      const centerBin = binPoints[m + 1];
      const rightBin = binPoints[m + 2];

      for (let k = 0; k < numFftBins; k++) {
        if (k > leftBin && k < centerBin) {
          filter[k] = (k - leftBin) / (centerBin - leftBin);
        } else if (k >= centerBin && k < rightBin) {
          filter[k] = (rightBin - k) / (rightBin - centerBin);
        } else {
          filter[k] = 0.0;
        }
      }
      bank.push(filter);
    }

    return bank;
  }

  /**
   * Computes 80-dimensional log Mel filterbank features from raw PCM audio.
   * Input waveform is expected to be mono at 16,000 Hz with values in [-1.0, 1.0]
   * (or already scaled 16-bit integer range).
   * 
   * Output shape: [numFrames, 80]
   */
  public extract(waveform: Float32Array): Float32Array[] {
    if (!waveform || waveform.length === 0) {
      return [];
    }

    const numSamples = waveform.length;
    if (numSamples < this.frameLength) {
      return [];
    }

    // Check for NaN or Inf values in input
    for (let i = 0; i < Math.min(numSamples, 1000); i++) {
      if (!Number.isFinite(waveform[i])) {
        throw new Error(`Audio buffer contains non-finite numerical values at sample ${i}`);
      }
    }

    // Snip edges frame count: 1 + floor((numSamples - frameLength) / frameShift)
    const numFrames = 1 + Math.floor((numSamples - this.frameLength) / this.frameShift);
    const numFftBins = (this.fftSize / 2) + 1;

    // Detect if input is normalized in [-1.0, 1.0]. If so, scale by 32768.0 to match Kaldi native range
    let maxVal = 0.0;
    for (let i = 0; i < numSamples; i++) {
      const abs = Math.abs(waveform[i]);
      if (abs > maxVal) maxVal = abs;
    }
    const scaleFactor = (maxVal <= 1.5 && maxVal > 0.0) ? 32768.0 : 1.0;

    const frames: Float32Array[] = [];

    // Preallocated buffers for FFT
    const real = new Float64Array(this.fftSize);
    const imag = new Float64Array(this.fftSize);
    const powerSpectrum = new Float64Array(numFftBins);

    for (let f = 0; f < numFrames; f++) {
      const offset = f * this.frameShift;

      // 1. Copy frame samples and apply scaling
      let sum = 0.0;
      for (let i = 0; i < this.frameLength; i++) {
        const val = waveform[offset + i] * scaleFactor;
        real[i] = val;
        sum += val;
      }

      // 2. Remove DC offset
      if (this.removeDcOffset) {
        const mean = sum / this.frameLength;
        for (let i = 0; i < this.frameLength; i++) {
          real[i] -= mean;
        }
      }

      // 3. Pre-emphasis: y[n] = x[n] - preemphasis * x[n-1]
      // In Kaldi, preemphasis is computed backwards so x[n] does not overwrite earlier state
      for (let i = this.frameLength - 1; i > 0; i--) {
        real[i] -= this.preemphasis * real[i - 1];
      }
      real[0] -= this.preemphasis * real[0];

      // 4. Multiply by Povey window
      for (let i = 0; i < this.frameLength; i++) {
        real[i] *= this.window[i];
      }

      // 5. Zero-pad remaining FFT bins
      for (let i = this.frameLength; i < this.fftSize; i++) {
        real[i] = 0.0;
      }
      imag.fill(0.0);

      // 6. In-place Cooley-Tukey Radix-2 FFT
      this.fft(real, imag);

      // 7. Compute Power Spectrum: P[k] = real[k]^2 + imag[k]^2
      for (let k = 0; k < numFftBins; k++) {
        powerSpectrum[k] = real[k] * real[k] + imag[k] * imag[k];
      }

      // 8. Apply 80 Mel filters and take natural logarithm
      const fbankFrame = new Float32Array(this.numMelBins);
      for (let m = 0; m < this.numMelBins; m++) {
        const filter = this.melBank[m];
        let energy = 0.0;
        for (let k = 0; k < numFftBins; k++) {
          energy += powerSpectrum[k] * filter[k];
        }
        // Kaldi floor: log(max(energy, 1.19209290e-7))
        fbankFrame[m] = Math.log(Math.max(energy, 1.1920928955078125e-7));
      }

      frames.push(fbankFrame);
    }

    // 9. Mean Normalization (CMN: Cepstral Mean Normalization over time)
    if (this.meanNormalization && frames.length > 0) {
      const means = new Float64Array(this.numMelBins);
      for (let f = 0; f < frames.length; f++) {
        const frame = frames[f];
        for (let m = 0; m < this.numMelBins; m++) {
          means[m] += frame[m];
        }
      }
      for (let m = 0; m < this.numMelBins; m++) {
        means[m] /= frames.length;
      }
      for (let f = 0; f < frames.length; f++) {
        const frame = frames[f];
        for (let m = 0; m < this.numMelBins; m++) {
          frame[m] -= means[m];
        }
      }
    }

    return frames;
  }

  /**
   * Flattens 2D frame array into a single Float32Array formatted for ONNX input:
   * Shape: [1, numFrames, numMelBins]
   */
  public toTensorData(frames: Float32Array[]): { data: Float32Array; shape: [number, number, number] } {
    const numFrames = frames.length;
    const data = new Float32Array(numFrames * this.numMelBins);
    for (let f = 0; f < numFrames; f++) {
      data.set(frames[f], f * this.numMelBins);
    }
    return {
      data,
      shape: [1, numFrames, this.numMelBins],
    };
  }

  /**
   * In-place Cooley-Tukey Radix-2 Fast Fourier Transform
   */
  private fft(real: Float64Array, imag: Float64Array): void {
    const n = real.length;
    let j = 0;
    for (let i = 0; i < n - 1; i++) {
      if (i < j) {
        let temp = real[i]; real[i] = real[j]; real[j] = temp;
        temp = imag[i]; imag[i] = imag[j]; imag[j] = temp;
      }
      let k = n >> 1;
      while (k <= j) {
        j -= k;
        k >>= 1;
      }
      j += k;
    }

    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const angle = -2.0 * Math.PI / len;
      const wStepR = Math.cos(angle);
      const wStepI = Math.sin(angle);

      for (let i = 0; i < n; i += len) {
        let wR = 1.0;
        let wI = 0.0;
        for (let k = 0; k < half; k++) {
          const uR = real[i + k];
          const uI = imag[i + k];
          const vR = real[i + k + half] * wR - imag[i + k + half] * wI;
          const vI = real[i + k + half] * wI + imag[i + k + half] * wR;

          real[i + k] = uR + vR;
          imag[i + k] = uI + vI;
          real[i + k + half] = uR - vR;
          imag[i + k + half] = uI - vI;

          const nextWR = wR * wStepR - wI * wStepI;
          wI = wR * wStepI + wI * wStepR;
          wR = nextWR;
        }
      }
    }
  }
}
