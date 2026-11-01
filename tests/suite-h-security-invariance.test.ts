import test from 'node:test'
import assert from 'node:assert/strict'
import { voiceAuthorizationManager } from '../lib/audio/voice-authorization-manager'
import { classifyTool } from '../lib/audio/tool-authorization-classifier'
import { buildTaskCheckpoint, formatCheckpointForCompactedSession } from '../lib/task-checkpoint'
import { createActiveTask } from '../lib/task-state'

test('Suite H: Security Invariance & Authorization Gate Regression', async (t) => {

  await t.test('1. Turn-bound execution token is single-use and rejected on replay', () => {
    voiceAuthorizationManager.clear()
    const turnId = 401
    const userId = 'user_secure_01'
    const sessionId = 'session_secure_01'

    voiceAuthorizationManager.setActiveContext({ userId, sessionId, turnId })
    voiceAuthorizationManager.advanceTurn(turnId)

    const token = voiceAuthorizationManager.mintToken({
      turnId,
      userId,
      sessionId,
      mode: 'UNIVERSAL_VOICE',
      activationMethod: 'PUSH_TO_TALK',
      isPttActive: true
    })

    // First consumption succeeds
    const firstAuth = voiceAuthorizationManager.validateAndConsume(token, {
      toolName: 'openTab',
      parameters: { url: 'https://www.youtube.com' },
      turnId,
      userId,
      sessionId
    })
    assert.equal(firstAuth.authorized, true)

    // Replay with identical consumed token MUST be rejected
    const replayAuth = voiceAuthorizationManager.validateAndConsume(token, {
      toolName: 'openTab',
      parameters: { url: 'https://www.youtube.com' },
      turnId,
      userId,
      sessionId
    })
    assert.equal(replayAuth.authorized, false)
    assert.equal(replayAuth.reason, 'TOKEN_ALREADY_CONSUMED')
  })

  await t.test('2. Token with mismatched turnId or userId is rejected', () => {
    voiceAuthorizationManager.clear()
    const turnId = 501
    const userId = 'user_01'
    const sessionId = 'session_01'

    voiceAuthorizationManager.setActiveContext({ userId, sessionId, turnId })
    voiceAuthorizationManager.advanceTurn(turnId)

    const token = voiceAuthorizationManager.mintToken({
      turnId,
      userId,
      sessionId,
      mode: 'UNIVERSAL_VOICE',
      activationMethod: 'PUSH_TO_TALK',
      isPttActive: true
    })

    // Turn ID mismatch
    const turnMismatch = voiceAuthorizationManager.validateAndConsume(token, {
      toolName: 'openTab',
      parameters: { url: 'https://www.youtube.com' },
      turnId: turnId + 1, // Wrong turn ID!
      userId,
      sessionId
    })
    assert.equal(turnMismatch.authorized, false)
    assert.equal(turnMismatch.reason, 'TURN_MISMATCH')

    // User ID mismatch
    const userMismatch = voiceAuthorizationManager.validateAndConsume(token, {
      toolName: 'openTab',
      parameters: { url: 'https://www.youtube.com' },
      turnId,
      userId: 'attacker_user', // Wrong user!
      sessionId
    })
    assert.equal(userMismatch.authorized, false)
    assert.equal(userMismatch.reason, 'USER_MISMATCH')
  })

  await t.test('3. High-impact mutation actions require explicit confirmation approval', () => {
    const memoryClass = classifyTool('storeMemory')
    assert.equal(memoryClass.actionType, 'MUTATING')
    assert.equal(memoryClass.requiredScope, 'EXECUTE_MUTATING_ACTIONS')

    const findClass = classifyTool('findElements')
    assert.equal(findClass.actionType, 'READ_ONLY')
    assert.equal(findClass.requiredScope, 'READ_ONLY_INFORMATIONAL')

    const tabClass = classifyTool('openTab')
    assert.equal(tabClass.actionType, 'MUTATING')
  })

  await t.test('4. Task checkpoints guarantee zero credentials or tokens are stored', () => {
    const task = createActiveTask('open YouTube and search for React')
    task.extractedData = {
      credentials: 'bearer_token_secret_xyz',
      apiKey: 'api_secret_12345',
      authCookie: 'session_auth=abcdef',
      candidates: [{ title: 'React Tutorial', views: '1.2M' }]
    }

    const checkpoint = buildTaskCheckpoint(task)
    const formatted = formatCheckpointForCompactedSession(checkpoint)

    assert.ok(!formatted.includes('bearer_token_secret_xyz'))
    assert.ok(!formatted.includes('api_secret_12345'))
    assert.ok(!formatted.includes('session_auth=abcdef'))
    assert.ok(formatted.includes('ACTIVE TASK RESUMPTION CHECKPOINT'))
  })
})
