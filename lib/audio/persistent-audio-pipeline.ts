/**
 * Persistent Microphone & Audio Capture Pipeline
 * 
 * Manages a single, persistent getUserMedia audio stream while voice mode is active.
 * Integrates browser-native Acoustic Echo Cancellation (AEC), Automatic Gain Control (AGC),
 * and Noise Suppression (NS) to ensure clean full-duplex capture.
 * 
 * Rules:
 * 1. Acquire mic once when voice mode is enabled; keep active across turns.
 * 2. Never repeatedly acquire/destroy stream during normal conversation.
 * 3. Release hardware tracks immediately when voice mode is disabled or panel unmounts.
 * 4. Gracefully handle device switching without tearing down consumer state.
 */

export interface AudioPipelineOptions {
  deviceId?: string | null
  echoCancellation?: boolean
  noiseSuppression?: boolean
  autoGainControl?: boolean
  sampleRate?: number
}

export interface AudioMetrics {
  volume: number // 0 to 1 RMS
  isClipping: boolean
}

/**
 * Safely determines if a persistent audio pipeline is currently active and healthy.
 * Guaranteed never to throw, even if methods are missing or mock implementations differ.
 */
export function isPipelineLive(pipeline: PersistentAudioPipeline | null | undefined): boolean {
  if (!pipeline) return false
  try {
    if (typeof pipeline.isStreamLive === 'function') {
      return pipeline.isStreamLive()
    }
    if (typeof (pipeline as any).getIsActive === 'function') {
      return (pipeline as any).getIsActive()
    }
  } catch {
    return false
  }
  return false
}

export class PersistentAudioPipeline {
  private mediaStream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private analyserNode: AnalyserNode | null = null
  private processorNode: ScriptProcessorNode | null = null
  private audioChunkListeners: Array<(chunk: Float32Array) => void> = []
  private activeDeviceId: string | null = null
  private isActive = false
  private metricsAnimationId: number | null = null
  private onMetricsCallback: ((metrics: AudioMetrics) => void) | null = null
  private measuredNoiseFloorRms: number = 0.005

  constructor(private options: AudioPipelineOptions = {}) {}

  /**
   * Initializes or returns the existing active microphone stream.
   */
  async acquire(deviceId?: string | null): Promise<MediaStream> {
    const targetDeviceId = deviceId !== undefined ? deviceId : this.options.deviceId

    // Reuse existing stream if already active on the same device
    if (this.mediaStream && this.isActive && this.activeDeviceId === targetDeviceId) {
      const activeTracks = this.mediaStream.getAudioTracks().filter(t => t.readyState === 'live')
      if (activeTracks.length > 0) {
        return this.mediaStream
      }
    }

    // Clean up previous stream if switching devices
    if (this.mediaStream) {
      this.stopTracks()
    }

    const constraints: MediaStreamConstraints = {
      audio: {
        deviceId: targetDeviceId ? { exact: targetDeviceId } : undefined,
        echoCancellation: this.options.echoCancellation !== false,
        noiseSuppression: this.options.noiseSuppression !== false,
        autoGainControl: this.options.autoGainControl !== false,
        channelCount: 1,
        sampleRate: this.options.sampleRate || 16000
      }
    }

    console.log('[AudioPipeline] Acquiring persistent microphone stream with constraints:', constraints)

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints)
      this.activeDeviceId = targetDeviceId || null
      this.isActive = true

      // Verify track settings
      const track = this.mediaStream.getAudioTracks()[0]
      if (track) {
        const settings = track.getSettings()
        console.log('[AudioPipeline] Microphone acquired successfully:', {
          label: track.label,
          echoCancellation: settings.echoCancellation,
          noiseSuppression: settings.noiseSuppression,
          autoGainControl: settings.autoGainControl,
          sampleRate: settings.sampleRate
        })

        // Listen for hardware mute / disconnection
        track.onended = () => {
          console.warn('[AudioPipeline] Audio track ended unexpectedly')
          this.isActive = false
        }
      }

      this.setupAudioContext()
      return this.mediaStream
    } catch (err: any) {
      this.isActive = false
      this.stopTracks()
      this.teardownAudioNodes()
      console.error('[AudioPipeline] Failed to acquire microphone stream:', err)
      throw err
    }
  }

  /**
   * Safely disconnects and clears WebAudio processing nodes
   */
  private teardownAudioNodes(): void {
    if (this.processorNode) {
      try {
        this.processorNode.onaudioprocess = null
        this.processorNode.disconnect()
      } catch {}
      this.processorNode = null
    }
    if (this.analyserNode) {
      try {
        this.analyserNode.disconnect()
      } catch {}
      this.analyserNode = null
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect()
      } catch {}
      this.sourceNode = null
    }
  }

  /**
   * Sets up AudioContext and AnalyserNode for volume metering
   */
  private setupAudioContext(): void {
    if (!this.mediaStream) return

    try {
      this.teardownAudioNodes()
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext
      if (!this.audioContext || this.audioContext.state === 'closed') {
        this.audioContext = new AudioCtxClass({
          sampleRate: this.options.sampleRate || 16000
        })
      }

      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(e => console.warn('[AudioPipeline] Resume audio context failed:', e))
      }

      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream)
      this.analyserNode = this.audioContext.createAnalyser()
      this.analyserNode.fftSize = 256
      this.analyserNode.smoothingTimeConstant = 0.3
      this.sourceNode.connect(this.analyserNode)

      if (this.audioContext.createScriptProcessor) {
        this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1)
        this.processorNode.onaudioprocess = (e) => {
          if (!this.isActive || this.audioChunkListeners.length === 0) return
          const input = e.inputBuffer.getChannelData(0)
          const copy = new Float32Array(input.length)
          copy.set(input)
          for (const listener of this.audioChunkListeners) {
            listener(copy)
          }
        }
        this.sourceNode.connect(this.processorNode)
        this.processorNode.connect(this.audioContext.destination)
      }

      this.startMetricsLoop()
    } catch (e) {
      console.warn('[AudioPipeline] AudioContext initialization deferred/failed:', e)
    }
  }

  /**
   * Subscribes to real-time volume metrics (RMS) for UI feedback
   */
  onMetrics(callback: (metrics: AudioMetrics) => void): void {
    this.onMetricsCallback = callback
  }

  /**
   * Subscribes to raw 16 kHz Float32 PCM audio chunks for intentional PTT capture.
   */
  onAudioChunk(listener: (chunk: Float32Array) => void): () => void {
    this.audioChunkListeners.push(listener)
    return () => {
      this.audioChunkListeners = this.audioChunkListeners.filter(l => l !== listener)
    }
  }

  async resumeAudioContext(): Promise<void> {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume()
        console.log('[AudioPipeline] AudioContext resumed successfully')
      } catch (e) {
        console.warn('[AudioPipeline] Failed to resume AudioContext:', e)
      }
    }
  }

  private startMetricsLoop(): void {
    if (!this.analyserNode) return
    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount)

    const update = () => {
      if (!this.isActive || !this.analyserNode) return

      this.analyserNode.getByteTimeDomainData(dataArray)
      let sum = 0
      let maxVal = 0

      for (let i = 0; i < dataArray.length; i++) {
        const normalized = (dataArray[i] - 128) / 128
        sum += normalized * normalized
        const absVal = Math.abs(normalized)
        if (absVal > maxVal) maxVal = absVal
      }

      const rms = Math.sqrt(sum / dataArray.length)
      const volume = Math.min(1, rms * 4) // Scale for visual clarity

      if (this.onMetricsCallback) {
        this.onMetricsCallback({
          volume,
          isClipping: maxVal >= 0.99
        })
      }

      this.metricsAnimationId = requestAnimationFrame(update)
    }

    update()
  }

  /**
   * Samples ambient room audio over a calibration window to estimate baseline background noise RMS
   */
  async measureAmbientNoise(durationMs: number = 600): Promise<{ noiseFloorRms: number, peakRms: number }> {
    if (!this.isActive || !this.analyserNode) {
      return { noiseFloorRms: 0.005, peakRms: 0.010 }
    }

    const samples: number[] = []
    const peaks: number[] = []
    const sampleInterval = 50 // measure every 50ms
    const totalSteps = Math.max(3, Math.floor(durationMs / sampleInterval))
    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount)

    for (let step = 0; step < totalSteps; step++) {
      if (!this.isActive || !this.analyserNode) break

      this.analyserNode.getByteTimeDomainData(dataArray)
      let sum = 0
      let maxVal = 0

      for (let i = 0; i < dataArray.length; i++) {
        const normalized = (dataArray[i] - 128) / 128
        sum += normalized * normalized
        const absVal = Math.abs(normalized)
        if (absVal > maxVal) maxVal = absVal
      }

      const rms = Math.sqrt(sum / dataArray.length)
      samples.push(rms)
      peaks.push(maxVal)

      await new Promise(r => setTimeout(r, sampleInterval))
    }

    const avgRms = samples.length > 0
      ? samples.reduce((a, b) => a + b, 0) / samples.length
      : 0.005
    const peakRms = peaks.length > 0
      ? Math.max(...peaks)
      : 0.010

    this.measuredNoiseFloorRms = Math.max(0.002, avgRms)
    console.log(`[AudioPipeline] Noise calibration complete: avg RMS ${avgRms.toFixed(4)}, peak ${peakRms.toFixed(4)}`)

    return { noiseFloorRms: this.measuredNoiseFloorRms, peakRms }
  }

  getNoiseFloor(): number {
    return this.measuredNoiseFloorRms
  }

  setNoiseFloor(floor: number): void {
    this.measuredNoiseFloorRms = Math.max(0.002, floor)
  }

  /**
   * Slowly updates the baseline noise floor via exponential moving average (EMA)
   * strictly during confirmed silence intervals (0.002 <= RMS <= 0.025).
   * Contamination protection: speech or background voices (RMS > 0.025) are strictly rejected.
   */
  updateAdaptiveNoiseFloor(currentRms: number): number {
    if (currentRms >= 0.002 && currentRms <= 0.025) {
      const alpha = 0.02 // slow 2% adaptation rate
      this.measuredNoiseFloorRms = (1 - alpha) * this.measuredNoiseFloorRms + alpha * currentRms
    }
    return this.measuredNoiseFloorRms
  }

  /**
   * Switches input device seamlessly without dropping pipeline
   */
  async switchDevice(deviceId: string): Promise<MediaStream> {
    console.log('[AudioPipeline] Switching microphone to device:', deviceId)
    return this.acquire(deviceId)
  }

  /**
   * Returns current active MediaStream
   */
  getStream(): MediaStream | null {
    return this.mediaStream
  }

  /**
   * Returns current AudioContext
   */
  getAudioContext(): AudioContext | null {
    return this.audioContext
  }

  /**
   * Checks whether the audio pipeline is actively capturing and its underlying
   * MediaStream has at least one audio track in the 'live' readyState.
   * Returns false if the pipeline is uninitialized, released, or if AudioContext is closed.
   */
  isStreamLive(): boolean {
    if (!this.isActive || !this.mediaStream) {
      return false
    }
    if (this.audioContext && this.audioContext.state === 'closed') {
      return false
    }
    const audioTracks = this.mediaStream.getAudioTracks()
    return audioTracks.length > 0 && audioTracks.some(t => t.readyState === 'live')
  }

  /**
   * Returns whether the microphone is actively capturing.
   * Backward-compatible alias for isStreamLive().
   */
  getIsActive(): boolean {
    return this.isStreamLive()
  }

  /**
   * Returns the deviceId of the currently active microphone stream, or null if default.
   */
  getActiveDeviceId(): string | null {
    return this.activeDeviceId
  }

  /**
   * Internal track stopper
   */
  private stopTracks(): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => {
        try {
          track.onended = null
          track.stop()
        } catch (e) {
          console.warn('[AudioPipeline] Error stopping track:', e)
        }
      })
      this.mediaStream = null
    }
  }

  /**
   * Full cleanup: stops all tracks, closes AudioContext, resets state
   */
  release(): void {
    console.log('[AudioPipeline] Releasing persistent microphone hardware...')
    this.isActive = false

    if (this.metricsAnimationId) {
      cancelAnimationFrame(this.metricsAnimationId)
      this.metricsAnimationId = null
    }

    this.teardownAudioNodes()
    this.stopTracks()
    this.audioChunkListeners = []

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close()
      } catch (e) {
        console.warn('[AudioPipeline] Error closing AudioContext:', e)
      }
      this.audioContext = null
    }

    this.onMetricsCallback = null
    console.log('[AudioPipeline] Microphone hardware released completely')
  }
}
