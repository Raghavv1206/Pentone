import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Mic,
  Square,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Shield,
  Volume2,
  Trash2,
} from 'lucide-react';
import {
  VoiceEnrollmentService,
  ENROLLMENT_PROMPTS,
  computeRmsEnergy,
  validateSampleQuality,
  type ProfileStatusInfo,
  type EnrollmentPrompt,
} from '../lib/audio/voice-enrollment-service';
import { AudioResampler } from '../lib/audio/audio-resampler';
import type { EnrollmentUtterance } from '../lib/audio/speaker-verification-engine';
import { voiceAuthorizationManager } from '../lib/audio/voice-authorization-manager';
import { saveActiveUserId } from '../lib/settings';
import { useMediaDevice } from '../lib/media-device-context';

interface VoiceEnrollmentScreenProps {
  onBack: () => void;
  userId?: string;
  onEnrollmentComplete?: () => void;
}

type EnrollmentStep =
  | 'intro'
  | 'permission'
  | 'recording'
  | 'processing'
  | 'completed'
  | 'error';

export const VoiceEnrollmentScreen: React.FC<VoiceEnrollmentScreenProps> = ({
  onBack,
  userId = 'default_user',
  onEnrollmentComplete,
}) => {
  const { selectedMicId } = useMediaDevice();
  const [step, setStep] = useState<EnrollmentStep>('intro');
  const [currentPromptIndex, setCurrentPromptIndex] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedUtterances, setRecordedUtterances] = useState<Map<string, Float32Array>>(new Map());
  const [currentRms, setCurrentRms] = useState(0);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [profileStatus, setProfileStatus] = useState<ProfileStatusInfo | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);

  const serviceRef = useRef<VoiceEnrollmentService>(new VoiceEnrollmentService());
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | AudioWorkletNode | null>(null);
  const audioChunksRef = useRef<Float32Array[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Load initial profile status
  useEffect(() => {
    loadStatus();
    return () => {
      cleanupAudio();
    };
  }, [userId]);

  const loadStatus = async () => {
    setIsLoadingStatus(true);
    try {
      const s = await serviceRef.current.getProfileStatus(userId);
      setProfileStatus(s);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load profile status');
    } finally {
      setIsLoadingStatus(false);
    }
  };

  const cleanupAudio = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (processorNodeRef.current) {
      try {
        if ('onaudioprocess' in processorNodeRef.current) {
          (processorNodeRef.current as any).onaudioprocess = null;
        }
        if ('port' in processorNodeRef.current) {
          (processorNodeRef.current as any).port.onmessage = null;
        }
        processorNodeRef.current.disconnect();
      } catch {}
      processorNodeRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try {
        audioContextRef.current.close().catch(() => {});
      } catch {}
      audioContextRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    audioChunksRef.current = [];
    serviceRef.current.releaseMicrophone();
  };

  const startMicrophoneCheck = async () => {
    setStep('permission');
    setErrorMessage('');
    try {
      const stream = await serviceRef.current.requestMicrophone(selectedMicId);
      mediaStreamRef.current = stream;
      setStep('recording');
      setCurrentPromptIndex(0);
      setRecordedUtterances(new Map());
    } catch (err: any) {
      setErrorMessage(err.message || 'Microphone access denied');
      setStep('error');
    }
  };

  const startSampleRecording = async () => {
    audioChunksRef.current = [];
    setIsRecording(true);
    setRecordingSeconds(0);
    setErrorMessage('');
    setStatusMessage('Listening... speak the phrase naturally.');

    try {
      if (!mediaStreamRef.current) {
        mediaStreamRef.current = await serviceRef.current.requestMicrophone(selectedMicId);
      }

      const stream = mediaStreamRef.current;
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);

      // Attempt modern AudioWorkletNode first to avoid ScriptProcessor deprecation warning
      let workletAttached = false;
      if (audioCtx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
        try {
          if (!(audioCtx as any).__pentoneWorkletRegistered) {
            let loaded = false;
            if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
              try {
                const assetUrl = chrome.runtime.getURL('assets/pentone-audio-processor.js');
                await audioCtx.audioWorklet.addModule(assetUrl);
                loaded = true;
              } catch (e) {
                console.warn('[VoiceEnrollment] Asset worklet addModule failed, trying inline blob fallback:', e);
              }
            }

            if (!loaded) {
              const workletCode = `
class PentoneAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.bytesWritten = 0;
    this.port.onmessage = (event) => {
      if (event.data && event.data.command === 'flush' && this.bytesWritten > 0) {
        const remaining = this.buffer.subarray(0, this.bytesWritten);
        const copy = new Float32Array(remaining.length);
        copy.set(remaining);
        this.port.postMessage(copy);
        this.bytesWritten = 0;
      }
    };
  }
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channel = input[0];
      if (channel && channel.length > 0) {
        let i = 0;
        while (i < channel.length) {
          const toWrite = Math.min(channel.length - i, this.bufferSize - this.bytesWritten);
          this.buffer.set(channel.subarray(i, i + toWrite), this.bytesWritten);
          this.bytesWritten += toWrite;
          i += toWrite;
          if (this.bytesWritten >= this.bufferSize) {
            const chunk = new Float32Array(this.bufferSize);
            chunk.set(this.buffer);
            this.port.postMessage(chunk);
            this.bytesWritten = 0;
          }
        }
      }
    }
    return true;
  }
}
registerProcessor('pentone-audio-processor', PentoneAudioProcessor);
`;
              const blob = new Blob([workletCode], { type: 'application/javascript' });
              const blobUrl = URL.createObjectURL(blob);
              try {
                await audioCtx.audioWorklet.addModule(blobUrl);
                loaded = true;
              } finally {
                URL.revokeObjectURL(blobUrl);
              }
            }

            if (loaded) {
              (audioCtx as any).__pentoneWorkletRegistered = true;
            }
          }

          if (audioCtx.state !== 'closed') {
            const workletNode = new AudioWorkletNode(audioCtx, 'pentone-audio-processor');
            workletNode.port.onmessage = (e) => {
              const chunk = e.data as Float32Array;
              audioChunksRef.current.push(chunk);
              const rms = computeRmsEnergy(chunk);
              setCurrentRms(rms);
            };

            source.connect(workletNode);
            workletNode.connect(audioCtx.destination);
            processorNodeRef.current = workletNode;
            workletAttached = true;
          }
        } catch (e) {
          console.warn('[VoiceEnrollment] AudioWorklet init failed, falling back:', e);
        }
      }

      // ScriptProcessorNode fallback for environments without AudioWorklet
      if (!workletAttached && audioCtx.createScriptProcessor) {
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);
        processorNodeRef.current = processor;

        processor.onaudioprocess = (e) => {
          const inputData = e.inputBuffer.getChannelData(0);
          const chunk = new Float32Array(inputData.length);
          chunk.set(inputData);
          audioChunksRef.current.push(chunk);

          const rms = computeRmsEnergy(chunk);
          setCurrentRms(rms);
        };

        source.connect(processor);
        processor.connect(audioCtx.destination);
      }

      const startTime = Date.now();
      timerRef.current = setInterval(() => {
        setRecordingSeconds((Date.now() - startTime) / 1000);
      }, 100);
    } catch (err: any) {
      setIsRecording(false);
      setErrorMessage(err.message || 'Failed to start recording');
    }
  };

  const stopSampleRecording = async () => {
    if (!isRecording) return;
    setIsRecording(false);

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (processorNodeRef.current) {
      try {
        if ('onaudioprocess' in processorNodeRef.current) {
          (processorNodeRef.current as any).onaudioprocess = null;
        }
        if ('port' in processorNodeRef.current) {
          (processorNodeRef.current as any).port.onmessage = null;
        }
        processorNodeRef.current.disconnect();
      } catch {}
      processorNodeRef.current = null;
    }

    // Merge chunks
    const totalSamples = audioChunksRef.current.reduce((acc, c) => acc + c.length, 0);
    if (totalSamples === 0) {
      setErrorMessage('No audio captured. Please try recording again.');
      return;
    }

    const merged = new Float32Array(totalSamples);
    let offset = 0;
    for (const chunk of audioChunksRef.current) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    const sourceRate = audioContextRef.current?.sampleRate || 48000;
    audioChunksRef.current = [];

    // Resample to 16 kHz
    let resampled16k: Float32Array;
    try {
      const validated = AudioResampler.validateAndResample(merged, {
        sourceSampleRate: sourceRate,
        targetSampleRate: 16000,
        minDurationSeconds: 0.2,
      });
      resampled16k = validated.audio;
    } catch (err: any) {
      setErrorMessage(err.message || 'Audio resampling failed');
      return;
    }

    // Validate quality
    const prompt = ENROLLMENT_PROMPTS[currentPromptIndex];
    const quality = validateSampleQuality(resampled16k, prompt.minDurationSeconds);
    if (!quality.valid) {
      setErrorMessage(quality.error || 'Sample quality check failed');
      return;
    }

    // Save utterance
    const nextMap = new Map(recordedUtterances);
    nextMap.set(prompt.id, resampled16k);
    setRecordedUtterances(nextMap);
    setStatusMessage(`Sample ${currentPromptIndex + 1} accepted (${quality.durationSeconds.toFixed(1)}s, RMS: ${quality.rms.toFixed(3)})`);
  };

  const handleNextPrompt = () => {
    setErrorMessage('');
    setStatusMessage('');
    if (currentPromptIndex + 1 < ENROLLMENT_PROMPTS.length) {
      setCurrentPromptIndex(currentPromptIndex + 1);
    } else {
      processEnrollment();
    }
  };

  const handlePrevPrompt = () => {
    setErrorMessage('');
    setStatusMessage('');
    if (currentPromptIndex > 0) {
      setCurrentPromptIndex(currentPromptIndex - 1);
    }
  };

  const processEnrollment = async () => {
    setStep('processing');
    setErrorMessage('');
    cleanupAudio();

    try {
      const convUtterances: EnrollmentUtterance[] = [];
      const shortUtterances: EnrollmentUtterance[] = [];

      for (const prompt of ENROLLMENT_PROMPTS) {
        const waveform = recordedUtterances.get(prompt.id);
        if (!waveform) {
          throw new Error(`Missing audio for prompt: ${prompt.title}`);
        }
        if (prompt.type === 'conversational') {
          convUtterances.push({ id: prompt.id, waveform });
        } else {
          shortUtterances.push({ id: prompt.id, waveform });
        }
      }

      const status = await serviceRef.current.enrollFromUtterances(
        userId,
        convUtterances,
        shortUtterances
      );

      // Synchronize canonical account ID across authorization manager and persistent storage
      voiceAuthorizationManager.switchAccount(userId);
      await saveActiveUserId(userId).catch(() => {});

      setProfileStatus(status);
      setStep('completed');
      if (onEnrollmentComplete) onEnrollmentComplete();
    } catch (err: any) {
      setErrorMessage(err.message || 'Biometric model enrollment failed');
      setStep('error');
    }
  };

  const handleDeleteProfile = async () => {
    if (!confirm('Are you sure you want to delete your voice profile? You will need to re-enroll to authorize mutating voice actions.')) {
      return;
    }
    try {
      await serviceRef.current.deleteProfile(userId);
      await loadStatus();
      alert('Voice profile deleted successfully.');
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  const handleResetVault = async () => {
    if (!confirm('This will purge any corrupted cryptographic keys and ciphertext for this account. Proceed?')) {
      return;
    }
    try {
      await serviceRef.current.resetProfile(userId);
      await loadStatus();
      alert('Vault reset complete. You can now perform a clean enrollment.');
    } catch (err: any) {
      alert(`Reset failed: ${err.message}`);
    }
  };

  const currentPrompt: EnrollmentPrompt = ENROLLMENT_PROMPTS[currentPromptIndex];
  const hasRecordedCurrent = recordedUtterances.has(currentPrompt.id);

  return (
    <div className="w-full h-full bg-black text-white flex flex-col min-h-0 overflow-hidden select-none">
      {/* Header */}
      <div className="flex-shrink-0 p-3 sm:p-4 border-b border-gray-800 bg-black/90 backdrop-blur-md sticky top-0 z-20 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <button onClick={onBack} className="p-1.5 hover:bg-gray-800 text-gray-300 hover:text-white rounded-md transition-colors" title="Back">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="font-mono text-xs sm:text-sm font-bold tracking-wide">VOICE ENROLLMENT</div>
            <div className="text-[10px] text-gray-500 font-mono hidden sm:block">Biometric Identity Verification</div>
          </div>
        </div>
        <div className="text-xs font-mono text-gray-400 bg-gray-900 border border-gray-800 px-2 py-0.5 rounded">
          {userId}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 p-3.5 sm:p-6 overflow-y-auto overflow-x-hidden pb-16">
        <div className="max-w-md mx-auto space-y-6">
          {/* Liveness & Replay Security Disclaimer Banner */}
          <div className="p-3 bg-yellow-950/40 border border-yellow-800/60 rounded text-xs text-yellow-300 flex items-start gap-2">
            <Shield className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Security Notice:</span> Voice verification establishes speaker identity eligibility only. It does not provide liveness detection and cannot independently defend against physical audio recordings, replays, or cloned voices.
            </div>
          </div>

          {/* STEP 1: INTRO / STATUS OVERVIEW */}
          {step === 'intro' && (
            <div className="space-y-6">
              {isLoadingStatus ? (
                <div className="p-8 text-center font-mono text-xs text-gray-500">Checking profile status...</div>
              ) : profileStatus?.status === 'ENROLLED' ? (
                <div className="p-4 bg-gray-900 border border-green-800/60 rounded space-y-4">
                  <div className="flex items-center gap-2 text-green-400 font-mono text-sm">
                    <CheckCircle className="w-5 h-5" />
                    <span>Voice Profile Active</span>
                  </div>
                  <div className="text-xs text-gray-300 space-y-1 font-mono">
                    <div>Enrolled: {new Date(profileStatus.enrolledAt || 0).toLocaleString()}</div>
                    <div>Samples: {profileStatus.sampleCount} (3 Conversational, 2 Short Commands)</div>
                    <div>Exemplars: {profileStatus.conversationalExemplarsCount} Conv / {profileStatus.shortCommandExemplarsCount} Short</div>
                    {profileStatus.meanPairwiseSimilarity && (
                      <div>Mean Consistency: {(profileStatus.meanPairwiseSimilarity * 100).toFixed(1)}%</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 pt-2 border-t border-gray-800">
                    <button
                      onClick={startMicrophoneCheck}
                      className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-mono text-xs flex items-center justify-center gap-2"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Re-enroll Voice
                    </button>
                    <button
                      onClick={handleDeleteProfile}
                      className="p-2 bg-red-950 hover:bg-red-900 text-red-300 rounded border border-red-800"
                      title="Delete Profile"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : profileStatus?.status === 'UNRECOVERABLE_KEY' ? (
                <div className="p-4 bg-red-950/50 border border-red-800 rounded space-y-3">
                  <div className="flex items-center gap-2 text-red-400 font-mono text-sm font-semibold">
                    <AlertTriangle className="w-5 h-5" />
                    <span>Cryptographic Key Missing</span>
                  </div>
                  <p className="text-xs text-gray-300">
                    An encrypted profile exists for this account, but its non-extractable key handle is missing from IndexedDB. To protect data integrity, silent key replacement is blocked.
                  </p>
                  <button
                    onClick={handleResetVault}
                    className="w-full py-2 bg-red-800 hover:bg-red-700 text-white font-mono text-xs rounded"
                  >
                    Reset Vault & Clear Orphaned Data
                  </button>
                </div>
              ) : (
                <div className="p-4 bg-gray-900 border border-gray-800 rounded space-y-4">
                  <div className="text-sm font-mono font-semibold">No Voice Profile Enrolled</div>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    Enroll your voice to authorize mutating browser actions (clicking elements, navigating tabs, typing inputs) securely via voice commands.
                  </p>
                  <button
                    onClick={startMicrophoneCheck}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-mono text-xs flex items-center justify-center gap-2"
                  >
                    <Mic className="w-4 h-4" /> Start Voice Enrollment
                  </button>
                </div>
              )}
            </div>
          )}

          {/* STEP 2: PERMISSION REQUEST */}
          {step === 'permission' && (
            <div className="p-6 bg-gray-900 border border-gray-800 rounded text-center space-y-4">
              <Mic className="w-8 h-8 text-blue-400 mx-auto animate-pulse" />
              <div className="font-mono text-sm">Requesting Microphone Access...</div>
              <p className="text-xs text-gray-400">
                Please grant microphone permission when prompted by Chrome.
              </p>
            </div>
          )}

          {/* STEP 3: SAMPLE RECORDING FLOW */}
          {step === 'recording' && (
            <div className="space-y-6">
              {/* Progress Steps Header */}
              <div className="flex items-center justify-between text-xs font-mono text-gray-400">
                <span>{currentPrompt.title}</span>
                <span>{recordedUtterances.size} / 5 Completed</span>
              </div>

              {/* Progress bar */}
              <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${((currentPromptIndex + (hasRecordedCurrent ? 1 : 0)) / 5) * 100}%` }}
                />
              </div>

              {/* Prompt Card */}
              <div className="p-5 bg-gray-900 border border-gray-800 rounded space-y-3">
                <div className="text-[11px] font-mono text-blue-400 uppercase tracking-wider">
                  Please speak the following phrase clearly:
                </div>
                <div className="text-sm font-medium text-white bg-black/50 p-3 rounded border border-gray-800 leading-relaxed">
                  "{currentPrompt.phrase}"
                </div>
                <div className="text-[11px] text-gray-500 font-mono">
                  Type: {currentPrompt.type === 'conversational' ? 'Conversational (>= 1.2s)' : 'Short Command (>= 0.4s)'}
                </div>
              </div>

              {/* Live Audio Visualizer / Timer */}
              {isRecording && (
                <div className="p-4 bg-gray-950 border border-blue-900/60 rounded flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
                    <span className="font-mono text-xs text-red-400 font-bold">RECORDING</span>
                  </div>
                  <div className="font-mono text-xs text-gray-300">
                    {recordingSeconds.toFixed(1)}s
                  </div>
                  <div className="flex items-center gap-1 w-24 h-2 bg-gray-800 rounded overflow-hidden">
                    <div
                      className="h-full bg-green-500 transition-all"
                      style={{ width: `${Math.min(100, currentRms * 1000)}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Feedback & Error Messages */}
              {statusMessage && (
                <div className="text-xs font-mono text-green-400 bg-green-950/40 p-2.5 rounded border border-green-900/50 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  <span>{statusMessage}</span>
                </div>
              )}
              {errorMessage && (
                <div className="text-xs font-mono text-red-400 bg-red-950/40 p-2.5 rounded border border-red-900/50 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="space-y-3 pt-2">
                {!isRecording ? (
                  <button
                    onClick={startSampleRecording}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded font-mono text-xs flex items-center justify-center gap-2 font-bold"
                  >
                    <Mic className="w-4 h-4" /> {hasRecordedCurrent ? 'Re-record Sample' : 'Record Sample'}
                  </button>
                ) : (
                  <button
                    onClick={stopSampleRecording}
                    className="w-full py-3 bg-red-600 hover:bg-red-700 text-white rounded font-mono text-xs flex items-center justify-center gap-2 font-bold"
                  >
                    <Square className="w-4 h-4 fill-white" /> Stop & Validate Sample
                  </button>
                )}

                <div className="flex items-center justify-between gap-2 pt-2">
                  <button
                    onClick={handlePrevPrompt}
                    disabled={currentPromptIndex === 0 || isRecording}
                    className="px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 font-mono text-xs rounded"
                  >
                    Previous
                  </button>
                  <button
                    onClick={handleNextPrompt}
                    disabled={!hasRecordedCurrent || isRecording}
                    className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-white font-mono text-xs rounded font-bold"
                  >
                    {currentPromptIndex + 1 === ENROLLMENT_PROMPTS.length ? 'Finalize & Build Profile' : 'Next Sample'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: PROCESSING */}
          {step === 'processing' && (
            <div className="p-8 bg-gray-900 border border-gray-800 rounded text-center space-y-4">
              <RefreshCw className="w-8 h-8 text-blue-400 mx-auto animate-spin" />
              <div className="font-mono text-sm font-semibold">Generating Biometric Profile...</div>
              <p className="text-xs text-gray-400 leading-relaxed">
                Extracting 512-dimensional CAM++ acoustic embeddings, evaluating outlier consistency, and encrypting with Web Crypto AES-256-GCM.
              </p>
            </div>
          )}

          {/* STEP 5: COMPLETED */}
          {step === 'completed' && (
            <div className="p-6 bg-gray-900 border border-green-800/80 rounded text-center space-y-4">
              <CheckCircle className="w-10 h-10 text-green-400 mx-auto" />
              <div className="font-mono text-sm font-semibold text-green-400">Voice Profile Successfully Enrolled</div>
              <p className="text-xs text-gray-300 leading-relaxed">
                Your biometric profile has been encrypted with a hardware/runtime non-extractable key and stored securely in IndexedDB.
              </p>
              <button
                onClick={onBack}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-mono text-xs rounded"
              >
                Return to Settings
              </button>
            </div>
          )}

          {/* ERROR STATE */}
          {step === 'error' && (
            <div className="p-6 bg-red-950/40 border border-red-800 rounded text-center space-y-4">
              <AlertTriangle className="w-8 h-8 text-red-400 mx-auto" />
              <div className="font-mono text-sm font-semibold text-red-400">Enrollment Error</div>
              <p className="text-xs text-gray-300">{errorMessage || 'An error occurred during enrollment.'}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setStep('intro')}
                  className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 font-mono text-xs rounded"
                >
                  Cancel
                </button>
                <button
                  onClick={startMicrophoneCheck}
                  className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white font-mono text-xs rounded"
                >
                  Retry
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
