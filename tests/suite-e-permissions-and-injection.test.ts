import test from 'node:test'
import assert from 'node:assert/strict'
import captureAudio from '../lib/tools/captureAudio'
import fillInput from '../lib/tools/fillInput'
import clickElement from '../lib/tools/clickElement'

test('Suite E: Permissions, ActiveTab, and Dynamic Injection', async (t) => {

  await t.test('1. Internal browser pages (chrome://, about:) are cleanly rejected', async () => {
    (globalThis as any).chrome = {
      tabs: {
        query: async () => [{ id: 99, url: 'chrome://settings' }]
      }
    }

    const audioRes = await captureAudio({ duration: 5 })
    assert.equal(audioRes.success, false)
    assert.ok(audioRes.error?.includes('internal pages'))

    const fillRes = await fillInput({ index: 0, value: 'test' })
    assert.equal(fillRes.success, false)
    assert.ok(fillRes.error?.includes('internal pages'))

    const clickRes = await clickElement({ index: 0 })
    assert.equal(clickRes.success, false)
    assert.ok(clickRes.error?.includes('internal pages'))
  })

  await t.test('2. Extension invocation failure (activeTab) returns actionable guidance', async () => {
    (globalThis as any).chrome = {
      tabs: {
        query: async () => [{ id: 101, url: 'https://news.ycombinator.com' }]
      },
      tabCapture: {
        getMediaStreamId: (opts: any, cb: (id: string) => void) => {
          (chrome.runtime as any).lastError = {
            message: 'Extension has not been invoked for the current page (see activeTab permission).'
          }
          cb('')
        }
      },
      runtime: {
        lastError: {
          message: 'Extension has not been invoked for the current page (see activeTab permission).'
        }
      }
    }

    const audioRes = await captureAudio({ duration: 5 })
    assert.equal(audioRes.success, false)
    assert.equal(audioRes.isPermissionError, true)
    assert.ok(audioRes.error?.includes('activeTab invocation'))
  })

  await t.test('3. fillInput falls back to direct scripting execution if content script is unmounted', async () => {
    let scriptExecuted = false;

    (globalThis as any).chrome = {
      tabs: {
        query: async () => [{ id: 202, url: 'https://example.com/form' }],
        sendMessage: (tabId: number, msg: any, cb: any) => {
          // Simulate missing content script: "Could not establish connection."
          (chrome.runtime as any).lastError = { message: 'Could not establish connection. Receiving end does not exist.' }
          cb(null)
        }
      },
      scripting: {
        executeScript: async (params: any) => {
          scriptExecuted = true
          return [{ result: { success: true, message: 'Filled "Search input"' } }]
        }
      },
      runtime: {
        lastError: null
      }
    }

    const fillRes = await fillInput({ index: 1, value: 'React Tutorials' })
    assert.equal(fillRes.success, true)
    assert.equal(scriptExecuted, true, 'Must execute direct scripting fallback when content script is missing')
    assert.ok(fillRes.result?.includes('Search input'))
  })
})
