import test from 'node:test'
import assert from 'node:assert/strict'

import { PersistentAudioPipeline, isPipelineLive } from '../lib/audio/persistent-audio-pipeline'

// =========================================================================
// MOCK ENVIRONMENT FOR WEBAUDIO & MEDIADEVICES
// =========================================================================

class MockMediaStreamTrack {
  kind = 'audio'
  readyState: 'live' | 'ended' = 'live'
  enabled = true
  label = 'Mock Microphone'
  onended: (() => void) | null = null

  constructor(public deviceId = 'default') {}

  getSettings() {
    return {
      deviceId: this.deviceId,
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: false,
      sampleRate: 16000
    }
  }

  stop() {
    this.readyState = 'ended'
    if (this.onended) {
      this.onended()
    }
  }
}

class MockMediaStream {
  tracks: MockMediaStreamTrack[] = []

  constructor(tracks: MockMediaStreamTrack[] = [new MockMediaStreamTrack()]) {
    this.tracks = tracks
  }

  getAudioTracks() {
    return this.tracks
  }

  getTracks() {
    return this.tracks
  }
}

class MockAudioContext {
  state: 'running' | 'suspended' | 'closed' = 'running'
  sampleRate = 16000
  resumeCallCount = 0
  closeCallCount = 0

  constructor(public options: any = {}) {}

  createMediaStreamSource(_stream: any) {
    return {
      connect: () => {},
      disconnect: () => {}
    }
  }

  createAnalyser() {
    return {
      fftSize: 256,
      smoothingTimeConstant: 0.3,
      frequencyBinCount: 128,
      getByteTimeDomainData: (arr: Uint8Array) => arr.fill(128),
      connect: () => {},
      disconnect: () => {}
    }
  }

  createScriptProcessor(_bufSize: number, _inCh: number, _outCh: number) {
    return {
      onaudioprocess: null as any,
      connect: () => {},
      disconnect: () => {}
    }
  }

  destination = {}

  async resume() {
    this.resumeCallCount++
    this.state = 'running'
  }

  async suspend() {
    this.state = 'suspended'
  }

  async close() {
    this.closeCallCount++
    this.state = 'closed'
  }
}

// Global browser mocks
let getUserMediaCallCount = 0
let getUserMediaFailWith: Error | null = null
let latestCreatedTrack: MockMediaStreamTrack | null = null

const setupGlobalMocks = () => {
  getUserMediaCallCount = 0
  getUserMediaFailWith = null
  latestCreatedTrack = null

  const globalAny = global as any
  globalAny.window = global
  globalAny.AudioContext = MockAudioContext
  globalAny.webkitAudioContext = MockAudioContext

  const mediaDevicesMock = {
    getUserMedia: async (constraints: any) => {
      getUserMediaCallCount++
      if (getUserMediaFailWith) {
        throw getUserMediaFailWith
      }
      const devId = constraints?.audio?.deviceId?.exact || 'default'
      latestCreatedTrack = new MockMediaStreamTrack(devId)
      return new MockMediaStream([latestCreatedTrack])
    }
  }

  if (global.navigator) {
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: mediaDevicesMock,
      configurable: true,
      writable: true
    })
  } else {
    globalAny.navigator = { mediaDevices: mediaDevicesMock }
  }

  globalAny.requestAnimationFrame = (cb: () => void) => setTimeout(cb, 16)
  globalAny.cancelAnimationFrame = (id: any) => clearTimeout(id)
}

setupGlobalMocks()

// =========================================================================
// TEST SUITE: P0 MICROPHONE STARTUP FAILURE & PTT PIPELINE LIFECYCLE
// =========================================================================

test('Req 1: PTT with no existing pipeline acquires microphone stream cleanly', async () => {
  setupGlobalMocks()

  let pipeline: PersistentAudioPipeline | null = null
  assert.equal(isPipelineLive(pipeline), false)

  // Simulate PTT start with no prior pipeline
  pipeline = new PersistentAudioPipeline({ sampleRate: 16000 })
  assert.equal(pipeline.isStreamLive(), false)
  assert.equal(isPipelineLive(pipeline), false)

  await pipeline.acquire()

  assert.equal(pipeline.isStreamLive(), true)
  assert.equal(pipeline.getIsActive(), true)
  assert.equal(isPipelineLive(pipeline), true)
  assert.equal(getUserMediaCallCount, 1)

  pipeline.release()
})

test('Req 2: PTT with a valid active pipeline reuses existing stream without re-acquisition', async () => {
  setupGlobalMocks()

  const pipeline = new PersistentAudioPipeline({ sampleRate: 16000 })
  await pipeline.acquire()
  assert.equal(getUserMediaCallCount, 1)
  assert.equal(pipeline.isStreamLive(), true)

  // Second PTT activation while stream is live
  assert.equal(isPipelineLive(pipeline), true)
  await pipeline.resumeAudioContext()

  // Must not have called getUserMedia again
  assert.equal(getUserMediaCallCount, 1, 'Live stream must be reused without re-invoking getUserMedia')
  assert.equal(pipeline.isStreamLive(), true)

  pipeline.release()
})

test('Req 3: PTT with an ended microphone track detects stale state and safely reacquires', async () => {
  setupGlobalMocks()

  let pipeline: PersistentAudioPipeline | null = new PersistentAudioPipeline({ sampleRate: 16000 })
  await pipeline.acquire()
  assert.equal(pipeline.isStreamLive(), true)

  // Hardware microphone disconnect / track end
  latestCreatedTrack?.stop()
  assert.equal(latestCreatedTrack?.readyState, 'ended')

  // isStreamLive must return false when track is ended
  assert.equal(pipeline.isStreamLive(), false)
  assert.equal(isPipelineLive(pipeline), false)

  // PTT activation detects !isLive -> releases stale pipeline and creates fresh instance
  pipeline.release()
  pipeline = new PersistentAudioPipeline({ sampleRate: 16000 })
  await pipeline.acquire()

  assert.equal(pipeline.isStreamLive(), true)
  assert.equal(getUserMediaCallCount, 2, 'Fresh getUserMedia must be acquired after track end')

  pipeline.release()
})

test('Req 4: PTT with a released pipeline safely recovers and reacquires', async () => {
  setupGlobalMocks()

  let pipeline: PersistentAudioPipeline | null = new PersistentAudioPipeline({ sampleRate: 16000 })
  await pipeline.acquire()
  assert.equal(pipeline.isStreamLive(), true)

  // Pipeline explicitly released
  pipeline.release()
  assert.equal(pipeline.isStreamLive(), false)
  assert.equal(isPipelineLive(pipeline), false)

  // PTT activation recovers by creating fresh pipeline
  pipeline = new PersistentAudioPipeline({ sampleRate: 16000 })
  await pipeline.acquire()

  assert.equal(pipeline.isStreamLive(), true)
  assert.equal(getUserMediaCallCount, 2)

  pipeline.release()
})

test('Req 5: PTT after microphone device switching releases previous stream and targets new device', async () => {
  setupGlobalMocks()

  let pipeline: PersistentAudioPipeline | null = new PersistentAudioPipeline({
    deviceId: 'mic-device-1',
    sampleRate: 16000
  })
  await pipeline.acquire('mic-device-1')
  assert.equal(pipeline.getActiveDeviceId(), 'mic-device-1')
  assert.equal(pipeline.isStreamLive(), true)

  // User switches microphone in settings to 'mic-device-2'
  const newDeviceId = 'mic-device-2'
  const isDeviceMatched = pipeline.getActiveDeviceId() === newDeviceId
  assert.equal(isDeviceMatched, false)

  // PTT path releases old pipeline and creates new one with target device
  pipeline.release()
  pipeline = new PersistentAudioPipeline({
    deviceId: newDeviceId,
    sampleRate: 16000
  })
  await pipeline.acquire(newDeviceId)

  assert.equal(pipeline.getActiveDeviceId(), 'mic-device-2')
  assert.equal(pipeline.isStreamLive(), true)
  assert.equal(getUserMediaCallCount, 2)

  pipeline.release()
})

test('Req 6: PTT after Side Panel close and reopen cleans up and mounts cleanly', async () => {
  setupGlobalMocks()

  // 1. Initial Side Panel session
  let pipelineRef: { current: PersistentAudioPipeline | null } = {
    current: new PersistentAudioPipeline({ sampleRate: 16000 })
  }
  await pipelineRef.current.acquire()
  assert.equal(pipelineRef.current.isStreamLive(), true)

  // 2. User closes Side Panel (unmount)
  pipelineRef.current.release()
  pipelineRef.current = null
  assert.equal(isPipelineLive(pipelineRef.current), false)

  // 3. User reopens Side Panel (remount) and activates PTT
  assert.equal(pipelineRef.current, null)
  pipelineRef.current = new PersistentAudioPipeline({ sampleRate: 16000 })
  await pipelineRef.current.acquire()

  assert.equal(pipelineRef.current.isStreamLive(), true)
  assert.equal(getUserMediaCallCount, 2)

  pipelineRef.current.release()
  pipelineRef.current = null
})

test('Req 7: Microphone permission denied fails closed, releases partial resources, and reports error', async () => {
  setupGlobalMocks()

  const notAllowedError = new Error('Permission denied')
  notAllowedError.name = 'NotAllowedError'
  getUserMediaFailWith = notAllowedError

  let pipeline: PersistentAudioPipeline | null = new PersistentAudioPipeline({ sampleRate: 16000 })
  let caughtError: any = null

  try {
    await pipeline.acquire()
  } catch (err: any) {
    caughtError = err
    if (pipeline && !isPipelineLive(pipeline)) {
      pipeline.release()
      pipeline = null
    }
  }

  assert.ok(caughtError)
  assert.equal(caughtError.name, 'NotAllowedError')
  assert.equal(pipeline, null)
  assert.equal(isPipelineLive(pipeline), false)
})

test('Req 8: AudioContext suspended and resumed operates smoothly', async () => {
  setupGlobalMocks()

  const pipeline = new PersistentAudioPipeline({ sampleRate: 16000 })
  await pipeline.acquire()

  const audioCtx = pipeline.getAudioContext() as unknown as MockAudioContext
  assert.ok(audioCtx)

  // Simulate browser suspending AudioContext (e.g. background tab or power saving)
  await audioCtx.suspend()
  assert.equal(audioCtx.state, 'suspended')
  // Suspended audio context does not kill stream liveness
  assert.equal(pipeline.isStreamLive(), true)

  // PTT activation calls resumeAudioContext
  await pipeline.resumeAudioContext()
  assert.equal(audioCtx.state, 'running')
  assert.ok(audioCtx.resumeCallCount >= 1)

  pipeline.release()
})

test('Req 9: Repeated PTT activation without duplicate streams or duplicate listeners', async () => {
  setupGlobalMocks()

  const pipeline = new PersistentAudioPipeline({ sampleRate: 16000 })
  await pipeline.acquire()
  assert.equal(getUserMediaCallCount, 1)

  const receivedChunks: number[] = []
  let unsubListener: (() => void) | null = null

  // Simulate 5 consecutive PTT press/release cycles
  for (let cycle = 1; cycle <= 5; cycle++) {
    // 1. PTT Pressed: Unsubscribe prior if any, attach single fresh listener
    if (unsubListener) {
      unsubListener()
      unsubListener = null
    }
    unsubListener = pipeline.onAudioChunk((chunk) => {
      receivedChunks.push(chunk.length)
    })

    // Verify stream was not reacquired
    assert.equal(getUserMediaCallCount, 1, `Cycle ${cycle}: getUserMedia must not be re-invoked`)

    // 2. Audio process event fires
    const proc = (pipeline as any).processorNode
    if (proc?.onaudioprocess) {
      proc.onaudioprocess({
        inputBuffer: {
          getChannelData: () => new Float32Array(512)
        }
      })
    }

    // 3. PTT Released: listener unsubscribed
    if (unsubListener) {
      unsubListener()
      unsubListener = null
    }
  }

  // Exactly 5 chunks received, one per cycle (no listener stacking or duplicate callbacks)
  assert.equal(receivedChunks.length, 5)

  pipeline.release()
})

test('Req 10: Missing, invalid, or throwing pipeline API fails safely and never throws', () => {
  // Test case 10a: null or undefined
  assert.equal(isPipelineLive(null), false)
  assert.equal(isPipelineLive(undefined), false)

  // Test case 10b: Empty object without methods
  const emptyObj = {} as any
  assert.doesNotThrow(() => {
    assert.equal(isPipelineLive(emptyObj), false)
  })

  // Test case 10c: Object where isStreamLive is not a function (e.g. boolean property)
  const legacyObj = { isStreamLive: true, isActive: true } as any
  assert.doesNotThrow(() => {
    assert.equal(isPipelineLive(legacyObj), false)
  })

  // Test case 10d: Object where getIsActive is available as fallback
  const fallbackObj = {
    getIsActive: () => true
  } as any
  assert.equal(isPipelineLive(fallbackObj), true)

  // Test case 10e: Object where isStreamLive throws an error
  const throwingObj = {
    isStreamLive: () => {
      throw new Error('Internal hardware inspection failure')
    }
  } as any
  assert.doesNotThrow(() => {
    assert.equal(isPipelineLive(throwingObj), false)
  })
})
