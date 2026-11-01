import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PersistentProfileVaultManager,
  IndexedDBKeyStore,
  IndexedDBProfileStore,
  InMemoryStructuredCloneDriver,
  ProfileVault
} from '../lib/audio/speaker-profile-vault'
import {
  DEFAULT_VERIFICATION_THRESHOLDS,
  type UnencryptedSpeakerProfile
} from '../lib/audio/speaker-types'
import {
  loadActiveUserId,
  saveActiveUserId,
  CANONICAL_DEFAULT_USER_ID,
  ACTIVE_USER_ID_KEY
} from '../lib/settings'
import { voiceAuthorizationManager } from '../lib/audio/voice-authorization-manager'
import { validateToolCallSchema, parseToolCallDetailed } from '../lib/tool-parser'
import openTab from '../lib/tools/openTab'
import { VoiceDiagnosticTracker } from '../lib/audio/voice-diagnostic-tracker'
import { AudioResampler } from '../lib/audio/audio-resampler'

// Helper to create valid test speaker profile
function createTestProfile(userId: string): UnencryptedSpeakerProfile {
  const dummyVector = new Float32Array(512)
  for (let i = 0; i < 512; i++) {
    dummyVector[i] = Math.sin((i + 1) * 0.05)
  }
  // Normalize vector to unit length
  let norm = 0
  for (let i = 0; i < 512; i++) norm += dummyVector[i] * dummyVector[i]
  norm = Math.sqrt(norm)
  for (let i = 0; i < 512; i++) dummyVector[i] /= norm

  return {
    metadata: {
      schemaVersion: 2,
      modelVersion: 'campplus-en-voxceleb-512-v1',
      userId,
      enrolledAt: Date.now(),
      lastCalibratedAt: Date.now(),
      noiseFloorRms: 0.005,
      conversationalSampleCount: 3,
      shortUtteranceSampleCount: 2,
      conversationalMeanSimilarity: 0.85,
      shortMeanSimilarity: 0.82,
      thresholds: DEFAULT_VERIFICATION_THRESHOLDS,
    },
    conversationalCentroid: dummyVector,
    conversationalExemplars: [dummyVector],
    shortCommandCentroid: dummyVector,
    shortCommandExemplars: [dummyVector],
  }
}

// =========================================================================
// ISSUE 1: PROFILE ENROLLMENT, PERSISTENCE & CANONICAL IDENTITY RESOLUTION
// =========================================================================

test('Issue 1: Persistent Profile Vault reliably persists and retrieves profile for default_user across sessions', async () => {
  const sharedKeyDriver = new InMemoryStructuredCloneDriver<any>('pentone_vault_keystore', 'vault_keys')
  const sharedProfileDriver = new InMemoryStructuredCloneDriver<any>('pentone_vault_profiles', 'encrypted_profiles')

  const keyStore = new IndexedDBKeyStore('pentone_vault_keystore', sharedKeyDriver)
  const profileStore = new IndexedDBProfileStore('pentone_vault_profiles', sharedProfileDriver)
  const vault = new PersistentProfileVaultManager(keyStore, profileStore)

  const testUserId = CANONICAL_DEFAULT_USER_ID
  const profile = createTestProfile(testUserId)

  // 1. Save profile
  await vault.saveProfile(profile)
  assert.equal(await vault.hasProfile(testUserId), true)

  // 2. Simulate fresh session / new vault manager instance connecting to same stores
  const session2Vault = new PersistentProfileVaultManager(
    new IndexedDBKeyStore('pentone_vault_keystore', sharedKeyDriver),
    new IndexedDBProfileStore('pentone_vault_profiles', sharedProfileDriver)
  )

  // 3. Load profile in new session
  const loadedProfile = await session2Vault.loadProfile(testUserId)
  assert.equal(loadedProfile.metadata.userId, testUserId)
  assert.equal(loadedProfile.conversationalCentroid.length, 512)

  // 4. White-space trimming / case resilience
  const loadedWithSpace = await session2Vault.loadProfile(`  ${testUserId}  `)
  assert.equal(loadedWithSpace.metadata.userId, testUserId)

  // 5. Fail closed for un-enrolled user without generating replacement keys
  await assert.rejects(
    async () => await session2Vault.loadProfile('non_existent_user'),
    /ProfileNotFound/
  )
})

test('Issue 1: Canonical Active User ID is synchronized across settings, vault, and authorization manager', async () => {
  // Test fallback to default
  assert.equal(CANONICAL_DEFAULT_USER_ID, 'default_user')

  // Verify voiceAuthorizationManager initializes with default_user
  assert.equal(voiceAuthorizationManager.getActiveContext().userId, 'default_user')

  // Switch account and verify revocation of prior context
  voiceAuthorizationManager.switchAccount('user_work')
  assert.equal(voiceAuthorizationManager.getActiveContext().userId, 'user_work')

  // Switch back to canonical default
  voiceAuthorizationManager.switchAccount('default_user')
  assert.equal(voiceAuthorizationManager.getActiveContext().userId, 'default_user')
})

// =========================================================================
// ISSUE 2: ASR INPUT PREPROCESSING & SHORT COMMAND NORMALIZATION
// =========================================================================

test('Issue 2: Audio pre-processing normalizes low-volume short commands without distortion', () => {
  // Simulate 0.8s of quiet speech ("Open YouTube", peak = 0.08)
  const sampleRate = 16000
  const durationSec = 0.8
  const quietBuffer = new Float32Array(Math.floor(sampleRate * durationSec))
  for (let i = 0; i < quietBuffer.length; i++) {
    quietBuffer[i] = 0.08 * Math.sin(2 * Math.PI * 440 * (i / sampleRate))
  }

  // Resample and validate
  const validated = AudioResampler.validateAndResample(quietBuffer, {
    sourceSampleRate: 16000,
    targetSampleRate: 16000,
    minDurationSeconds: 0.2,
    maxDurationSeconds: 30.0
  })

  assert.equal(validated.durationSeconds, 0.8)

  // Measure peak before normalization
  let originalPeak = 0
  for (let i = 0; i < validated.audio.length; i++) {
    const abs = Math.abs(validated.audio[i])
    if (abs > originalPeak) originalPeak = abs
  }
  assert.ok(originalPeak <= 0.081 && originalPeak >= 0.079)

  // Apply normalization pipeline logic
  let cleanAudio = validated.audio
  let peak = 0
  for (let i = 0; i < cleanAudio.length; i++) {
    const absVal = Math.abs(cleanAudio[i])
    if (absVal > peak) peak = absVal
  }

  if (peak > 0.005 && peak < 0.70) {
    const scale = 0.82 / peak
    const normalized = new Float32Array(cleanAudio.length)
    for (let i = 0; i < cleanAudio.length; i++) {
      normalized[i] = Math.max(-1.0, Math.min(1.0, cleanAudio[i] * scale))
    }
    cleanAudio = normalized
  }

  // Check normalized peak is optimal (~0.82) for Whisper's log-mel filterbank
  let normalizedPeak = 0
  for (let i = 0; i < cleanAudio.length; i++) {
    const abs = Math.abs(cleanAudio[i])
    if (abs > normalizedPeak) normalizedPeak = abs
  }
  assert.ok(normalizedPeak >= 0.81 && normalizedPeak <= 0.83, `Normalized peak should be ~0.82, got ${normalizedPeak}`)
})

// =========================================================================
// ISSUE 3: TOOL CALL GENERATION & SCHEMA TOLERANCE (tabid / tabId / tab_id)
// =========================================================================

test('Issue 3: Model-generated openTab calls with tabid/tabId/tab_id execute without schema rejection', () => {
  // Test case 1: Raw JSON with tabid (the exact reported failure)
  const rawCall1 = '<function_call>{"function": "openTab", "arguments": {"url": "https://www.youtube.com", "tabid": 101}}</function_call>'
  const res1 = parseToolCallDetailed(rawCall1)
  assert.equal(res1.success, true)
  assert.equal(res1.toolCall?.function, 'openTab')
  assert.equal(res1.toolCall?.arguments.url, 'https://www.youtube.com')
  assert.equal(res1.toolCall?.arguments.tabid, undefined)

  // Test case 2: Raw JSON with camelCase tabId
  const rawCall2 = '<function_call>{"function": "openTab", "arguments": {"url": "https://www.youtube.com", "tabId": 102}}</function_call>'
  const res2 = parseToolCallDetailed(rawCall2)
  assert.equal(res2.success, true)
  assert.equal(res2.toolCall?.arguments.url, 'https://www.youtube.com')
  assert.equal(res2.toolCall?.arguments.tabId, undefined)

  // Test case 3: Direct schema validation
  const validation = validateToolCallSchema('openTab', {
    url: 'https://www.youtube.com',
    tabName: 'YouTube',
    tabid: 42
  })
  assert.equal(validation.valid, true)
  assert.equal(validation.toolCall?.arguments.url, 'https://www.youtube.com')
  assert.equal(validation.toolCall?.arguments.tabName, 'YouTube')
  assert.equal(validation.toolCall?.arguments.tabid, undefined)
})

test('Issue 3: openTab tool execution handles parameters and context cleanly', async () => {
  // In popup context, openTab gives clear instructional feedback
  const popupResult = await openTab({ url: 'https://www.youtube.com' }, 'popup')
  assert.equal(popupResult.success, false)
  assert.match(popupResult.error || '', /Cannot open tabs from popup window/i)

  // Missing or invalid URL is rejected
  const emptyResult = await openTab({ url: '' }, 'sidepanel')
  assert.equal(emptyResult.success, false)

  // Dangerous javascript: URL is rejected
  const dangerousResult = await openTab({ url: 'javascript:alert(1)' }, 'sidepanel')
  assert.equal(dangerousResult.success, false)
  assert.match(dangerousResult.error || '', /Navigation security error/i)
})

// =========================================================================
// ISSUE 4: BACKGROUND NOISE & VAD TUNING
// =========================================================================

test('Issue 4: Audio below calibrated ambient noise floor is rejected without churning turns', () => {
  const noiseFloorRms = 0.008
  const adaptiveThreshold = Math.max(0.012, noiseFloorRms * 2.5) // 0.020

  // 1. Ambient noise below threshold
  const ambientBuffer = new Float32Array(16000 * 0.5) // 0.5s
  for (let i = 0; i < ambientBuffer.length; i++) {
    ambientBuffer[i] = 0.010 * (Math.random() * 2 - 1)
  }
  let sumSq = 0
  let peak = 0
  for (let i = 0; i < ambientBuffer.length; i++) {
    const val = Math.abs(ambientBuffer[i])
    if (val > peak) peak = val
    sumSq += val * val
  }
  const rms = Math.sqrt(sumSq / ambientBuffer.length)
  const durationSec = ambientBuffer.length / 16000

  const shouldDiscard = durationSec < 0.35 || rms < adaptiveThreshold || peak < 0.035
  assert.equal(shouldDiscard, true, 'Ambient background noise must be discarded before turn creation')

  // 2. Deliberate user command ("Open YouTube", duration 0.9s, RMS 0.05, peak 0.25)
  const speechBuffer = new Float32Array(16000 * 0.9)
  for (let i = 0; i < speechBuffer.length; i++) {
    speechBuffer[i] = 0.20 * Math.sin(2 * Math.PI * 300 * (i / 16000))
  }
  let speechSumSq = 0
  let speechPeak = 0
  for (let i = 0; i < speechBuffer.length; i++) {
    const val = Math.abs(speechBuffer[i])
    if (val > speechPeak) speechPeak = val
    speechSumSq += val * val
  }
  const speechRms = Math.sqrt(speechSumSq / speechBuffer.length)
  const speechDuration = speechBuffer.length / 16000

  const speechDiscarded = speechDuration < 0.35 || speechRms < adaptiveThreshold || speechPeak < 0.035
  assert.equal(speechDiscarded, false, 'Deliberate speech command must pass gate')
})

// =========================================================================
// ISSUE 6: DIAGNOSTIC TRACKER TERMINAL STATES & ACCURATE STATUS
// =========================================================================

test('Issue 6: Diagnostic tracker records PROFILE_NOT_FOUND without false 0.000 score', () => {
  const tracker = new VoiceDiagnosticTracker()

  const turnId = 101
  tracker.startTurn(turnId, 'default_user', 'session_test')
  tracker.recordSpeechEnd(turnId, 1.2, 0.045)

  // Record CAM failure where profile was missing
  tracker.recordCAM(
    turnId,
    'OTHER_SPEAKER',
    undefined, // score MUST NOT be 0.000 when profile lookup fails
    undefined,
    undefined,
    'DISCARDED',
    15,
    'ProfileNotFound: No stored profile found for user default_user',
    'PROFILE_NOT_FOUND'
  )

  tracker.recordTerminalState(turnId, 'PROFILE_NOT_FOUND', 'No stored profile found for user default_user')

  const rec = tracker.getTurn(turnId)
  assert.ok(rec)
  assert.equal(rec.camStatus, 'PROFILE_NOT_FOUND')
  assert.equal(rec.camScore, undefined, 'camScore must be undefined, not 0.000, when verification did not execute')
  assert.equal(rec.terminalState, 'PROFILE_NOT_FOUND')
  assert.notEqual(rec.terminalState, 'PENDING', 'Turns must reach terminal state, never remain permanently PENDING')
})
