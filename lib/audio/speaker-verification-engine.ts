/**
 * CAM++ Speaker Verification Engine
 * 
 * Production implementation of the CAM++ speaker verification engine for Pentone.
 * 
 * Architectural Guarantees:
 * - Local-first MV3 execution via single-threaded WASM SIMD ONNX runtime.
 * - 512-dimensional bottleneck acoustic embeddings.
 * - Pure biometric evaluation returning `SpeakerVerificationResult`.
 * - Zero tool capability token issuance (strictly isolated from action authorization).
 * - Dual-path routing: Short Command (< 1.20s) vs. Conversational (>= 1.20s).
 * - Hard duration floor: Audio < 0.40s immediately fails closed to `OTHER_SPEAKER`.
 * - Robust cancellation and fail-closed error recovery.
 */


import { KaldiFbankExtractor } from './kaldi-fbank-extractor';
import { VectorMath } from './vector-math';
import { BiometricAudioExtractor, type BiometricAudioSegment } from './biometric-audio-extractor';
import {
  CAM_SPEAKER_EMBEDDING_DIMENSION,
  DEFAULT_VERIFICATION_THRESHOLDS,
  type AcousticRoutingPath,
  type ModelSessionStatus,
  type SpeakerProfileMetadata,
  type SpeakerVerificationDecision,
  type SpeakerVerificationRequest,
  type SpeakerVerificationResult,
  type SpeakerVerificationThresholds,
  type UnencryptedSpeakerProfile,
  validateDecisionConsistency,
  validateEmbeddingVector,
} from './speaker-types';

export interface SpeakerVerificationEngineOptions {
  modelPath?: string;
  sampleRate?: number;
  thresholds?: SpeakerVerificationThresholds;
}

export interface EnrollmentUtterance {
  id: string;
  waveform: Float32Array; // 16 kHz mono PCM
}

export class SpeakerVerificationEngine {
  private static instance: SpeakerVerificationEngine | null = null;
  private session: any = null;
  private ort: any = null;
  private extractor: KaldiFbankExtractor;
  private modelPath: string;
  private thresholds: SpeakerVerificationThresholds;
  private status: ModelSessionStatus = 'UNINITIALIZED';
  private isCancelled = false;
  private lastInferenceTimestamp: number = Date.now();

  private constructor(options: SpeakerVerificationEngineOptions = {}) {
    this.modelPath = options.modelPath || this.resolveDefaultModelPath();
    this.thresholds = options.thresholds || DEFAULT_VERIFICATION_THRESHOLDS;
    this.extractor = new KaldiFbankExtractor({
      sampleRate: options.sampleRate || 16000,
      meanNormalization: true,
    });
  }

  /**
   * Singleton accessor for the speaker verification engine.
   */
  public static getInstance(options?: SpeakerVerificationEngineOptions): SpeakerVerificationEngine {
    if (!this.instance) {
      this.instance = new SpeakerVerificationEngine(options);
    }
    return this.instance;
  }

  /**
   * Reset the singleton instance (primarily for testing and lifecycle re-init).
   */
  public static resetInstance(): void {
    if (this.instance) {
      this.instance.dispose().catch(() => {});
      this.instance = null;
    }
  }

  /**
   * Returns current engine session status.
   */
  public getStatus(): ModelSessionStatus {
    return this.status;
  }

  /**
   * Resolves default model asset path across Chrome extension and Node.js test environments.
   */
  private resolveDefaultModelPath(): string {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      return chrome.runtime.getURL('assets/cam_speaker.onnx');
    }
    // Node.js fallback
    try {
      const p = (typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : eval('require'))('path');
      return p.resolve(process.cwd(), 'assets/cam_speaker.onnx');
    } catch {
      return 'assets/cam_speaker.onnx';
    }
  }

  /**
   * Loads ONNX model binary from filesystem or network/extension asset URL.
   */
  private async loadModelBuffer(targetPath: string): Promise<ArrayBuffer> {
    if (
      typeof fetch === 'function' &&
      (targetPath.startsWith('chrome-extension://') ||
        targetPath.startsWith('http://') ||
        targetPath.startsWith('https://'))
    ) {
      const response = await fetch(targetPath);
      if (!response.ok) {
        throw new Error(`Failed to fetch model asset from ${targetPath}: HTTP ${response.status}`);
      }
      return await response.arrayBuffer();
    }

    if (typeof process !== 'undefined' && process.versions && process.versions.node) {
      try {
        const fsModule = (typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : eval('require'))('fs');
        if (fsModule.existsSync(targetPath)) {
          const fileBuffer = fsModule.readFileSync(targetPath);
          return fileBuffer.buffer.slice(
            fileBuffer.byteOffset,
            fileBuffer.byteOffset + fileBuffer.byteLength
          );
        }
      } catch {}
    }

    // Default fallback to fetch
    const response = await fetch(targetPath);
    if (!response.ok) {
      throw new Error(`Failed to load model asset from ${targetPath}: HTTP ${response.status}`);
    }
    return await response.arrayBuffer();
  }

  /**
   * Initializes the ONNX Runtime session and warms up WASM JIT execution.
   */
  public async initialize(): Promise<void> {
    if (this.status === 'READY' && this.session) {
      return;
    }

    this.status = 'LOADING_ASSET';
    this.isCancelled = false;

    try {
      const modelBuffer = await this.loadModelBuffer(this.modelPath);

      // Load verified WASM ONNX runtime backend
      if (typeof process !== 'undefined' && process.versions && process.versions.node) {
        try {
          const req = typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : eval('require');
          const reqOrt = req('onnxruntime-web');
          this.ort = reqOrt?.default || reqOrt;
        } catch (_) {}
      }

      if (!this.ort) {
        try {
          const mod: any = await import('@xenova/transformers/src/backends/onnx.js');
          this.ort = mod?.ONNX || mod?.default?.ONNX || mod;
        } catch (_) {}
      }

      if (!this.ort || !this.ort.InferenceSession) {
        throw new Error('Failed to resolve ONNX Runtime backend');
      }

      // Configure single-threaded WASM SIMD environment
      if (this.ort.env?.wasm) {
        this.ort.env.wasm.numThreads = 1;
        this.ort.env.wasm.simd = true;
        this.ort.env.wasm.proxy = false;
      }

      this.status = 'WARMING_UP';

      this.session = await this.ort.InferenceSession.create(modelBuffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
        logSeverityLevel: 3,
      });

      // Warmup inference with 148 frames dummy tensor (148 x 80)
      const dummyFbank = new Float32Array(148 * 80);
      const warmupTensor = new this.ort.Tensor('float32', dummyFbank, [1, 148, 80]);
      await this.session.run({ x: warmupTensor });

      this.status = 'READY';
    } catch (err: any) {
      this.status = 'ERROR';
      throw new Error(`SpeakerVerificationEngine initialization failed: ${err.message}`);
    }
  }

  /**
   * Cancels any in-flight verification request.
   */
  public cancel(): void {
    this.isCancelled = true;
  }

  /**
   * Releases ONNX session and resources.
   */
  public async dispose(): Promise<void> {
    this.cancel();
    if (this.session && typeof this.session.release === 'function') {
      try {
        await this.session.release();
      } catch {
        // Ignore release errors during shutdown
      }
    }
    this.session = null;
    this.status = 'DISPOSED';
  }

  /**
   * Extracts a 512-dimensional L2-normalized embedding vector from raw 16 kHz PCM audio.
   * Throws on invalid or below-floor audio buffers.
   */
  public async extractEmbedding(waveform: Float32Array): Promise<Float32Array> {
    if (this.status !== 'READY' || !this.session) {
      await this.initialize();
    }

    if (!waveform || waveform.length === 0) {
      throw new Error('Cannot extract embedding from empty audio buffer.');
    }

    // Minimum audio duration floor: 0.40s (6400 samples at 16 kHz)
    if (waveform.length < 6400) {
      throw new Error(`Audio buffer too short: ${waveform.length} samples (< 0.40s floor).`);
    }

    // Numerical finite validation
    for (let i = 0; i < Math.min(waveform.length, 1000); i++) {
      if (!Number.isFinite(waveform[i])) {
        throw new Error(`Audio buffer contains non-finite numerical values at sample ${i}`);
      }
    }

    const fbankFrames = this.extractor.extract(waveform);
    if (fbankFrames.length === 0) {
      throw new Error('Fbank feature extraction returned zero frames.');
    }

    this.lastInferenceTimestamp = Date.now();
    let tensor: any = null;
    let output: any = null;
    try {
      const tensorData = this.extractor.toTensorData(fbankFrames);
      tensor = new this.ort.Tensor('float32', tensorData.data, tensorData.shape);

      output = await this.session.run({ x: tensor });
      const rawEmb = output?.embedding?.data as Float32Array;

      if (!rawEmb || rawEmb.length !== CAM_SPEAKER_EMBEDDING_DIMENSION) {
        throw new Error(
          `Unexpected embedding dimension: expected ${CAM_SPEAKER_EMBEDDING_DIMENSION}, got ${rawEmb?.length}`
        );
      }

      const normalizedEmb = VectorMath.normalize(rawEmb);
      const validation = validateEmbeddingVector(normalizedEmb);
      if (!validation.valid) {
        throw new Error(`Extracted embedding failed validation: ${validation.error}`);
      }

      return normalizedEmb;
    } finally {
      if (tensor && typeof tensor.dispose === 'function') {
        try {
          tensor.dispose();
        } catch {}
      }
      if (output?.embedding && typeof output.embedding.dispose === 'function') {
        try {
          output.embedding.dispose();
        } catch {}
      }
    }
  }

  /**
   * Suspends ONNX session if idle for longer than timeout (default: 5 minutes / 300,000ms),
   * releasing ~30MB of WASM memory back to the runtime while preserving warm recovery capability.
   */
  public async suspendIfIdle(idleTimeoutMs: number = 300_000): Promise<boolean> {
    if (this.status !== 'READY' || !this.session) return false;
    if (Date.now() - this.lastInferenceTimestamp >= idleTimeoutMs) {
      console.log(`[SpeakerVerificationEngine] Idle timeout reached (${Math.round(idleTimeoutMs / 1000)}s), suspending ONNX session to free WASM memory...`);
      try {
        if (typeof this.session.release === 'function') {
          await this.session.release();
        }
      } catch {}
      this.session = null;
      this.status = 'IDLE_SUSPENDED';
      return true;
    }
    return false;
  }

  /**
   * Verifies speech utterance against an unencrypted speaker profile.
   * Deterministic fail-closed design: any error, abort, or under-duration returns OTHER_SPEAKER.
   */
  public async verifySpeech(
    request: SpeakerVerificationRequest,
    profile: UnencryptedSpeakerProfile
  ): Promise<SpeakerVerificationResult> {
    const evaluatedAt = Date.now();
    const thresholds = profile.metadata.thresholds || this.thresholds;

    // 1. Resolve biometric audio segment and boundary metadata
    const bio = request.biometricSegment || BiometricAudioExtractor.extractBiometricSegment(request.audioBuffer);
    const audioToEvaluate = bio.trimmedAudio;
    const voicedDurationSeconds = bio.voicedDurationSeconds;
    const rawDurationSeconds = bio.rawDurationSeconds;
    const voicedFrameCount = bio.voicedFrameCount;
    const preSpeechPadMs = bio.preSpeechPadMs;
    const postSpeechPadMs = bio.postSpeechPadMs;

    // Hard duration floor & quality gate: discard anything under 0.40s or quality invalid immediately
    if (!bio.qualityValid || !audioToEvaluate || voicedDurationSeconds < thresholds.minAudioDurationSeconds) {
      return {
        requestId: request.requestId,
        turnId: request.turnId,
        decision: 'OTHER_SPEAKER',
        similarityScore: 0.0,
        confidenceEstimate: 0.0,
        durationSeconds: voicedDurationSeconds,
        routingPath: 'DISCARDED',
        centroidSimilarity: 0.0,
        exemplarSimilarity: 0.0,
        evaluatedAt,
        failureReason: bio.qualityError || `Voiced duration (${voicedDurationSeconds.toFixed(2)}s) below minimum floor (${thresholds.minAudioDurationSeconds}s)`,
        rawDurationSeconds,
        voicedDurationSeconds,
        voicedFrameCount,
        preSpeechPadMs,
        postSpeechPadMs,
      };
    }

    // Check cancellation
    if (this.isCancelled) {
      this.isCancelled = false; // reset
      return {
        requestId: request.requestId,
        turnId: request.turnId,
        decision: 'OTHER_SPEAKER',
        similarityScore: 0.0,
        confidenceEstimate: 0.0,
        durationSeconds: voicedDurationSeconds,
        routingPath: 'DISCARDED',
        centroidSimilarity: 0.0,
        exemplarSimilarity: 0.0,
        evaluatedAt,
        failureReason: 'Verification cancelled',
        rawDurationSeconds,
        voicedDurationSeconds,
        voicedFrameCount,
        preSpeechPadMs,
        postSpeechPadMs,
      };
    }

    let embedding: Float32Array;
    try {
      embedding = await this.extractEmbedding(audioToEvaluate);
    } catch (err: any) {
      return {
        requestId: request.requestId,
        turnId: request.turnId,
        decision: 'OTHER_SPEAKER',
        similarityScore: 0.0,
        confidenceEstimate: 0.0,
        durationSeconds: voicedDurationSeconds,
        routingPath: 'DISCARDED',
        centroidSimilarity: 0.0,
        exemplarSimilarity: 0.0,
        evaluatedAt,
        failureReason: `Embedding extraction failed: ${err.message}`,
        rawDurationSeconds,
        voicedDurationSeconds,
        voicedFrameCount,
        preSpeechPadMs,
        postSpeechPadMs,
      };
    }

    // 2. Dual-Centroid Evaluation: evaluate BOTH centroids independently
    const convCentroidSim = VectorMath.cosineSimilarity(embedding, profile.conversationalCentroid);
    const shortCentroidSim = VectorMath.cosineSimilarity(embedding, profile.shortCommandCentroid);

    // Evaluate against conversational exemplars
    let maxConvExemplarSim = convCentroidSim;
    if (profile.conversationalExemplars && profile.conversationalExemplars.length > 0) {
      for (const ex of profile.conversationalExemplars) {
        const sim = VectorMath.cosineSimilarity(embedding, ex);
        if (sim > maxConvExemplarSim) {
          maxConvExemplarSim = sim;
        }
      }
    }

    // Evaluate against short command exemplars
    let maxShortExemplarSim = shortCentroidSim;
    if (profile.shortCommandExemplars && profile.shortCommandExemplars.length > 0) {
      for (const ex of profile.shortCommandExemplars) {
        const sim = VectorMath.cosineSimilarity(embedding, ex);
        if (sim > maxShortExemplarSim) {
          maxShortExemplarSim = sim;
        }
      }
    }

    const convScore = 0.70 * convCentroidSim + 0.30 * maxConvExemplarSim;
    const shortScore = 0.70 * shortCentroidSim + 0.30 * maxShortExemplarSim;

    // 3. Routing Decision based on actual VOICED duration (not padded buffer duration!)
    const isShort = voicedDurationSeconds < thresholds.shortCommandCutoffSeconds;
    const routingPath: AcousticRoutingPath = isShort ? 'SHORT_COMMAND' : 'CONVERSATIONAL';
    const scoringPolicy = isShort ? 'ROUTED_SHORT_COMMAND' : 'ROUTED_CONVERSATIONAL';

    const targetCentroidSim = isShort ? shortCentroidSim : convCentroidSim;
    const targetExemplarSim = isShort ? maxShortExemplarSim : maxConvExemplarSim;
    const authoritativeScore = isShort ? shortScore : convScore;

    // 4. Decision based on authoritative score against strict biometric boundaries
    let decision: SpeakerVerificationDecision;
    let confidenceEstimate = 0.0;

    if (authoritativeScore >= thresholds.acceptThreshold) {
      decision = 'REGISTERED_USER';
      confidenceEstimate = Math.min(
        1.0,
        Math.max(0.0, (authoritativeScore - thresholds.acceptThreshold) / (1.0 - thresholds.acceptThreshold))
      );
    } else if (authoritativeScore < thresholds.rejectThreshold) {
      decision = 'OTHER_SPEAKER';
      confidenceEstimate = Math.min(
        1.0,
        Math.max(0.0, (thresholds.rejectThreshold - authoritativeScore) / (thresholds.rejectThreshold - (-1.0)))
      );
    } else {
      decision = 'UNCERTAIN';
      confidenceEstimate = 0.0;
    }

    // Verify decision consistency invariant
    const consistency = validateDecisionConsistency(authoritativeScore, decision, thresholds);
    if (!consistency.consistent) {
      console.warn(`[SpeakerVerificationEngine] Decision consistency warning: ${consistency.error}`);
    }

    return {
      requestId: request.requestId,
      turnId: request.turnId,
      decision,
      similarityScore: authoritativeScore,
      confidenceEstimate,
      durationSeconds: voicedDurationSeconds,
      routingPath,
      centroidSimilarity: targetCentroidSim,
      exemplarSimilarity: targetExemplarSim,
      evaluatedAt,
      detectedSpeaker: decision === 'REGISTERED_USER' ? 'VERIFIED_USER' : decision === 'OTHER_SPEAKER' ? 'OTHER_SPEAKER' : 'UNCERTAIN_SPEAKER',
      speakerAttribution: decision === 'REGISTERED_USER' ? 'VERIFIED_USER' : decision === 'OTHER_SPEAKER' ? 'OTHER_SPEAKER' : 'UNATTRIBUTED',
      segmentCount: 1,
      conversationalCentroidScore: convScore,
      shortCommandCentroidScore: shortScore,
      scoringPolicy,
      rawDurationSeconds,
      voicedDurationSeconds,
      voicedFrameCount,
      preSpeechPadMs,
      postSpeechPadMs,
    };
  }

  /**
   * Speaker-aware multi-segment evaluation and diarization.
   * Distinguishes registered user speech from background voices and overlapping speakers.
   * If multi-speaker speech contains a separable enrolled user command, isolates that PCM segment.
   * If speakers overlap or attribution is uncertain, fails closed to OVERLAPPING_SPEECH / UNCERTAIN.
   */
  public async segmentAndVerifySpeech(
    request: SpeakerVerificationRequest,
    profile: UnencryptedSpeakerProfile
  ): Promise<SpeakerVerificationResult> {
    const baseResult = await this.verifySpeech(request, profile);

    const voicedDuration = baseResult.voicedDurationSeconds ?? (request.audioBuffer ? request.audioBuffer.length / 16000 : 0);
    const thresholds = profile.metadata.thresholds || this.thresholds;

    // For short utterances (< 1.40s) or routed short commands, sub-windowing is not mathematically viable
    if (voicedDuration < 1.40 || baseResult.routingPath === 'SHORT_COMMAND' || !request.audioBuffer) {
      return baseResult;
    }

    // Sliding-window parameters for temporal diarization across voiced speech
    const windowLengthSamples = 12800; // 0.80s
    const hopLengthSamples = 6400; // 0.40s hop
    const audio = request.biometricSegment?.trimmedAudio || request.audioBuffer;

    interface WindowEval {
      startSample: number;
      endSample: number;
      score: number;
      decision: SpeakerVerificationDecision;
    }

    const windowEvals: WindowEval[] = [];

    for (let start = 0; start + windowLengthSamples <= audio.length; start += hopLengthSamples) {
      const end = start + windowLengthSamples;
      const slice = audio.subarray(start, end);

      // Check slice energy
      let sumSq = 0;
      for (let i = 0; i < slice.length; i++) {
        sumSq += slice[i] * slice[i];
      }
      const rms = Math.sqrt(sumSq / slice.length);
      if (rms < 0.012) {
        continue; // Skip quiet ambient pause between words
      }

      try {
        const emb = await this.extractEmbedding(slice);
        // Compare with both conversational and short command centroids
        const convSim = VectorMath.cosineSimilarity(emb, profile.conversationalCentroid);
        const shortSim = VectorMath.cosineSimilarity(emb, profile.shortCommandCentroid);
        const bestCentroidSim = Math.max(convSim, shortSim);

        let maxEx = bestCentroidSim;
        const allEx = [...profile.conversationalExemplars, ...profile.shortCommandExemplars];
        for (const ex of allEx) {
          const sim = VectorMath.cosineSimilarity(emb, ex);
          if (sim > maxEx) maxEx = sim;
        }

        const score = 0.7 * bestCentroidSim + 0.3 * maxEx;
        let dec: SpeakerVerificationDecision = 'UNCERTAIN';
        if (score >= thresholds.acceptThreshold) {
          dec = 'REGISTERED_USER';
        } else if (score < thresholds.rejectThreshold) {
          dec = 'OTHER_SPEAKER';
        }

        windowEvals.push({
          startSample: start,
          endSample: end,
          score,
          decision: dec,
        });
      } catch {
        // Skip any sub-window extraction failure
      }
    }

    if (windowEvals.length === 0) {
      return baseResult;
    }

    const regWindows = windowEvals.filter((w) => w.decision === 'REGISTERED_USER');
    const otherWindows = windowEvals.filter((w) => w.decision === 'OTHER_SPEAKER');
    const uncertainWindows = windowEvals.filter((w) => w.decision === 'UNCERTAIN');

    // Case 1: All active speech windows belong to the registered user
    if (regWindows.length > 0 && otherWindows.length === 0 && uncertainWindows.length === 0) {
      return {
        ...baseResult,
        detectedSpeaker: 'VERIFIED_USER',
        speakerAttribution: 'VERIFIED_USER',
        segmentCount: windowEvals.length,
      };
    }

    // Case 2: All active speech windows belong to another speaker
    if (regWindows.length === 0 && otherWindows.length > 0) {
      return {
        ...baseResult,
        decision: 'OTHER_SPEAKER',
        detectedSpeaker: 'OTHER_SPEAKER',
        speakerAttribution: 'OTHER_SPEAKER',
        segmentCount: windowEvals.length,
      };
    }

    // Case 3: Both registered user and other speaker detected (multi-speaker audio)
    if (regWindows.length > 0 && otherWindows.length > 0) {
      // Find contiguous registered user segments
      let earliestReg = regWindows[0].startSample;
      let latestReg = regWindows[0].endSample;
      for (const rw of regWindows) {
        if (rw.startSample < earliestReg) earliestReg = rw.startSample;
        if (rw.endSample > latestReg) latestReg = rw.endSample;
      }

      // Check if other speaker windows overlap inside the registered interval
      const hasOverlappingInterference = otherWindows.some(
        (ow) => ow.startSample >= earliestReg && ow.endSample <= latestReg
      );

      if (hasOverlappingInterference) {
        // Simultaneous / overlapping voices: fail closed
        return {
          ...baseResult,
          decision: 'UNCERTAIN',
          detectedSpeaker: 'OVERLAPPING_SPEECH',
          speakerAttribution: 'OVERLAPPING',
          failureReason: 'Overlapping speech detected: simultaneous competing speakers',
          segmentCount: windowEvals.length,
        };
      }

      // Distinct separate speech: isolate the registered user's speech segment
      const isolatedAudio = audio.slice(earliestReg, latestReg);
      if (isolatedAudio.length >= 6400) {
        // Re-verify isolated segment
        const isolatedReq = {
          ...request,
          audioBuffer: isolatedAudio,
        };
        const isolatedResult = await this.verifySpeech(isolatedReq, profile);
        if (isolatedResult.decision === 'REGISTERED_USER') {
          return {
            ...isolatedResult,
            detectedSpeaker: 'VERIFIED_USER',
            speakerAttribution: 'VERIFIED_USER',
            isolatedUserAudio: isolatedAudio,
            segmentCount: windowEvals.length,
          };
        }
      }

      // Fall through to fail closed if isolated segment cannot be confidently verified
      return {
        ...baseResult,
        decision: 'UNCERTAIN',
        detectedSpeaker: 'UNCERTAIN_SPEAKER',
        speakerAttribution: 'UNATTRIBUTED',
        failureReason: 'Ambiguous speaker separation in multi-speaker audio',
        segmentCount: windowEvals.length,
      };
    }

    // Default: return base result
    return {
      ...baseResult,
      detectedSpeaker: baseResult.decision === 'REGISTERED_USER' ? 'VERIFIED_USER' : baseResult.decision === 'OTHER_SPEAKER' ? 'OTHER_SPEAKER' : 'UNCERTAIN_SPEAKER',
      speakerAttribution: baseResult.decision === 'REGISTERED_USER' ? 'VERIFIED_USER' : baseResult.decision === 'OTHER_SPEAKER' ? 'OTHER_SPEAKER' : 'UNATTRIBUTED',
      segmentCount: windowEvals.length,
    };
  }

  /**
   * Multi-sample enrollment for generating a verified unencrypted speaker profile.
   * Requires at least 3 conversational samples and at least 2 short command samples.
   */
  public async enrollSpeaker(
    userId: string,
    conversationalSamples: EnrollmentUtterance[],
    shortSamples: EnrollmentUtterance[],
    noiseFloorRms: number = 0.005
  ): Promise<UnencryptedSpeakerProfile> {
    if (conversationalSamples.length < 3) {
      throw new Error(
        `Enrollment requires at least 3 conversational utterances, got ${conversationalSamples.length}`
      );
    }

    if (shortSamples.length < 2) {
      throw new Error(
        `Enrollment requires at least 2 short-command utterances (no single-exemplar bypass), got ${shortSamples.length}`
      );
    }

    // 1. Process conversational utterances
    const convVectors: Float32Array[] = [];
    for (const u of conversationalSamples) {
      const emb = await this.extractEmbedding(u.waveform);
      convVectors.push(emb);
    }

    // Outlier rejection via median pairwise similarity
    const convMatrix = VectorMath.pairwiseSimilarities(convVectors);
    const validConv: Float32Array[] = [];
    const n = convVectors.length;

    for (let i = 0; i < n; i++) {
      const otherSims: number[] = [];
      for (let j = 0; j < n; j++) {
        if (i !== j) otherSims.push(convMatrix[i][j]);
      }
      otherSims.sort((a, b) => a - b);
      const mid = Math.floor(otherSims.length / 2);
      const median =
        otherSims.length % 2 === 0
          ? (otherSims[mid - 1] + otherSims[mid]) / 2
          : otherSims[mid];

      if (median >= 0.50) {
        validConv.push(convVectors[i]);
      }
    }

    if (validConv.length < 3) {
      throw new Error(
        `Inconsistent conversational utterances: accepted ${validConv.length}/${n}. Please re-record.`
      );
    }

    const convCentroid = VectorMath.computeCentroid(validConv);
    const scoredConv = validConv.map((v) => ({
      v,
      sim: VectorMath.cosineSimilarity(v, convCentroid),
    }));
    scoredConv.sort((a, b) => b.sim - a.sim);
    const convExemplars = scoredConv.slice(0, 2).map((s) => s.v);

    // Compute clean mean pairwise similarity
    const cleanConvMatrix = VectorMath.pairwiseSimilarities(validConv);
    let convTotal = 0;
    let convPairs = 0;
    for (let i = 0; i < validConv.length; i++) {
      for (let j = i + 1; j < validConv.length; j++) {
        convTotal += cleanConvMatrix[i][j];
        convPairs++;
      }
    }
    const convMeanSim = convPairs > 0 ? convTotal / convPairs : 1.0;

    // 2. Process multi-sample short utterances (Centroid, not single exemplar!)
    const shortVectors: Float32Array[] = [];
    for (const s of shortSamples) {
      const emb = await this.extractEmbedding(s.waveform);
      shortVectors.push(emb);
    }

    const shortCentroid = VectorMath.computeCentroid(shortVectors);
    const shortExemplars = shortVectors.slice(0, 2);

    const shortMatrix = VectorMath.pairwiseSimilarities(shortVectors);
    let shortTotal = 0;
    let shortPairs = 0;
    for (let i = 0; i < shortVectors.length; i++) {
      for (let j = i + 1; j < shortVectors.length; j++) {
        shortTotal += shortMatrix[i][j];
        shortPairs++;
      }
    }
    const shortMeanSim = shortPairs > 0 ? shortTotal / shortPairs : 1.0;

    const metadata: SpeakerProfileMetadata = {
      schemaVersion: 2,
      modelVersion: 'campplus-en-voxceleb-512-v1',
      userId,
      enrolledAt: Date.now(),
      lastCalibratedAt: Date.now(),
      noiseFloorRms,
      conversationalSampleCount: validConv.length,
      shortUtteranceSampleCount: shortVectors.length,
      conversationalMeanSimilarity: convMeanSim,
      shortMeanSimilarity: shortMeanSim,
      thresholds: this.thresholds,
    };

    return {
      metadata,
      conversationalCentroid: convCentroid,
      conversationalExemplars: convExemplars,
      shortCommandCentroid: shortCentroid,
      shortCommandExemplars: shortExemplars,
    };
  }
}
