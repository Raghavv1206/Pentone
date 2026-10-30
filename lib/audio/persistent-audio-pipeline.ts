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

export class PersistentAudioPipeline {
  private mediaStream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private analyserNode: AnalyserNode | null = null
  private activeDeviceId: string | null = null
  private isActive = false
  private metricsAnimationId: number | null = null
  private onMetricsCallback: ((metrics: AudioMetrics) => void) | null = null

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
      console.error('[AudioPipeline] Failed to acquire microphone stream:', err)
      throw err
    }
  }

  /**
   * Sets up AudioContext and AnalyserNode for volume metering
   */
  private setupAudioContext(): void {
    if (!this.mediaStream) return

    try {
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
   * Returns whether the microphone is actively capturing
   */
  getIsActive(): boolean {
    return this.isActive && !!this.mediaStream && this.mediaStream.getAudioTracks().some(t => t.readyState === 'live')
  }

  /**
   * Internal track stopper
   */
  private stopTracks(): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => {
        try {
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

    this.stopTracks()

    if (this.sourceNode) {
      try { this.sourceNode.disconnect() } catch {}
      this.sourceNode = null
    }

    if (this.analyserNode) {
      try { this.analyserNode.disconnect() } catch {}
      this.analyserNode = null
    }

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
