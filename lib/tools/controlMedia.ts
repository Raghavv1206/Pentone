// controlMedia tool - Control video/audio playback, volume, speed, and fullscreen across websites
import type { ToolSpec } from '../tool-registry'

interface ControlMediaParams {
  action: 'play' | 'pause' | 'toggle' | 'mute' | 'unmute' | 'toggleMute' | 'fullscreen' | 'exitFullscreen' | 'speed' | 'seek' | 'restart' | 'skipAd' | 'skip' | 'skip_ad'
  rate?: number
  seconds?: number
}

async function controlMedia(params: ControlMediaParams) {
  try {
    const action = params.action?.toLowerCase() || 'toggle'
    const rate = typeof params.rate === 'number' ? params.rate : 1.0
    const seconds = typeof params.seconds === 'number' ? params.seconds : 10

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      return { success: false, error: 'No active tab found' }
    }

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({
        pentone_selected: true,
        pentone_sidepanel_open: true,
        pentone_selected_timestamp: Date.now()
      }).catch(() => {})
    }

    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (act: string, playbackRate: number, seekSeconds: number) => {
        // 1. YouTube Player API check
        const ytPlayer = document.getElementById('movie_player') as any
        const hasYtApi = ytPlayer && typeof ytPlayer.playVideo === 'function'

        // 2. HTML5 Media Elements check
        const mediaElements = Array.from(document.querySelectorAll('video, audio')) as HTMLMediaElement[]
        // Prefer playing video or the largest video on screen
        const activeMedia = mediaElements.find(m => !m.paused) || 
          mediaElements.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0]

        if (!hasYtApi && !activeMedia) {
          return { handled: false, error: 'No media element or player found on page' }
        }

        switch (act) {
          case 'play': {
            if (hasYtApi) {
              ytPlayer.playVideo()
            } else if (activeMedia) {
              await activeMedia.play()
            }
            return { handled: true, status: 'playing' }
          }

          case 'pause': {
            if (hasYtApi) {
              ytPlayer.pauseVideo()
            } else if (activeMedia) {
              activeMedia.pause()
            }
            return { handled: true, status: 'paused' }
          }

          case 'toggle': {
            if (hasYtApi) {
              const state = ytPlayer.getPlayerState() // 1 = playing, 2 = paused
              if (state === 1) {
                ytPlayer.pauseVideo()
                return { handled: true, status: 'paused' }
              } else {
                ytPlayer.playVideo()
                return { handled: true, status: 'playing' }
              }
            } else if (activeMedia) {
              if (activeMedia.paused) {
                await activeMedia.play()
                return { handled: true, status: 'playing' }
              } else {
                activeMedia.pause()
                return { handled: true, status: 'paused' }
              }
            }
            break
          }

          case 'mute': {
            if (hasYtApi) {
              ytPlayer.mute()
            }
            mediaElements.forEach(m => { m.muted = true })
            return { handled: true, status: 'muted' }
          }

          case 'unmute': {
            if (hasYtApi) {
              ytPlayer.unMute()
            }
            mediaElements.forEach(m => { m.muted = false })
            return { handled: true, status: 'unmuted' }
          }

          case 'toggleMute':
          case 'togglemute': {
            let isMuted = false
            if (hasYtApi) {
              isMuted = ytPlayer.isMuted()
              if (isMuted) {
                ytPlayer.unMute()
                isMuted = false
              } else {
                ytPlayer.mute()
                isMuted = true
              }
            } else if (activeMedia) {
              activeMedia.muted = !activeMedia.muted
              isMuted = activeMedia.muted
            }
            return { handled: true, status: isMuted ? 'muted' : 'unmuted' }
          }

          case 'speed': {
            const targetRate = Math.max(0.25, Math.min(playbackRate, 4.0))
            if (hasYtApi) {
              ytPlayer.setPlaybackRate(targetRate)
            }
            mediaElements.forEach(m => { m.playbackRate = targetRate })
            return { handled: true, status: `speed_${targetRate}x`, rate: targetRate }
          }

          case 'seek': {
            if (hasYtApi) {
              ytPlayer.seekBy(seekSeconds)
            } else if (activeMedia) {
              activeMedia.currentTime = Math.max(0, activeMedia.currentTime + seekSeconds)
            }
            return { handled: true, status: `seeked_${seekSeconds}s`, seconds: seekSeconds }
          }

          case 'restart':
          case 'replay': {
            if (hasYtApi) {
              ytPlayer.seekTo(0, true)
              ytPlayer.playVideo()
            } else if (activeMedia) {
              activeMedia.currentTime = 0
              await activeMedia.play()
            }
            return { handled: true, status: 'restarted' }
          }

          case 'fullscreen': {
            if (hasYtApi && typeof ytPlayer.toggleFullscreen === 'function') {
              ytPlayer.toggleFullscreen()
            } else if (activeMedia && activeMedia.requestFullscreen) {
              await activeMedia.requestFullscreen()
            } else {
              if (!document.documentElement.requestFullscreen) throw new Error('Fullscreen is unavailable')
              await document.documentElement.requestFullscreen()
            }
            return { handled: true, status: 'fullscreen' }
          }

          case 'exitFullscreen':
          case 'exitfullscreen': {
            if (document.fullscreenElement) {
              await document.exitFullscreen()
            }
            return { handled: true, status: 'exit_fullscreen' }
          }

          case 'skip':
          case 'skipad':
          case 'skip_ad': {
            // 1. YouTube Player API check
            if (hasYtApi && typeof ytPlayer.skipAd === 'function') {
              try {
                ytPlayer.skipAd()
                return { handled: true, status: 'ad_skipped' }
              } catch (_) {}
            }

            // 2. DOM Skip Buttons across YouTube, streaming platforms, and sites
            const skipSelectors = [
              '.ytp-skip-ad-button',
              '.ytp-ad-skip-button',
              '.ytp-ad-skip-button-modern',
              'button.ytp-ad-skip-button',
              'button.ytp-ad-skip-button-modern',
              'button.ytp-skip-ad-button',
              '.ytp-ad-skip-button-container button',
              '.ytp-ad-skip-button-slot button',
              '[class*="ytp-ad-skip-button"]',
              '[class*="ytp-skip-ad-button"]',
              'button[id^="skip-button"]',
              '.videoAdUiSkipButton',
              '[aria-label*="Skip ad" i]',
              '[aria-label*="Skip ads" i]',
              '[aria-label*="Skip advertisement" i]',
              '[aria-label*="Skip" i]'
            ]
            for (const sel of skipSelectors) {
              const btn = document.querySelector(sel) as HTMLElement | null
              if (btn) {
                try {
                  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
                  btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
                } catch (_) {}
                btn.click()
                return { handled: true, status: 'ad_skipped' }
              }
            }

            // 3. Fast-forward actively showing video ad if on YouTube or media player
            const isYtAdShowing = ytPlayer?.classList?.contains('ad-showing') || 
                                  ytPlayer?.classList?.contains('ad-interrupting') || 
                                  document.querySelector('.ad-showing, .ad-interrupting') !== null
            if (isYtAdShowing && activeMedia) {
              try {
                activeMedia.currentTime = activeMedia.duration || 99999
                return { handled: true, status: 'ad_skipped' }
              } catch (_) {}
            }

            return { handled: false, error: 'No active or skippable ad found on this page.' }
          }

          default:
            return { handled: false, error: `Unknown media action: ${act}` }
        }
      },
      args: [action, rate, seconds]
    })

    const res = injectionResults?.[0]?.result
    if (!res || !res.handled) {
      // Fallback for muting: mute entire tab via Chrome tabs API
      if (action === 'mute' || action === 'unmute' || action === 'toggleMute') {
        const shouldMute = action === 'mute' ? true : action === 'unmute' ? false : !tab.mutedInfo?.muted
        await chrome.tabs.update(tab.id, { muted: shouldMute })
        return { success: true, result: shouldMute ? 'Muted the tab.' : 'Unmuted the tab.' }
      }
      return { success: false, error: res?.error || 'Could not control media playback on this page.' }
    }

    if (res.status === 'playing') return { success: true, result: 'Media playback started.' }
    if (res.status === 'paused') return { success: true, result: 'Media playback paused.' }
    if (res.status === 'muted') return { success: true, result: 'Media audio muted.' }
    if (res.status === 'unmuted') return { success: true, result: 'Media audio unmuted.' }
    if (res.status === 'ad_skipped') return { success: true, result: 'Skipped the ad.' }
    if (res.rate) return { success: true, result: `Media playback speed set to ${res.rate}x.` }
    if (res.seconds) {
      const dir = res.seconds > 0 ? 'forward' : 'backward'
      return { success: true, result: `Seeked ${Math.abs(res.seconds)} seconds ${dir}.` }
    }
    if (res.status === 'restarted') return { success: true, result: 'Restarted media playback from the beginning.' }
    if (res.status === 'fullscreen') return { success: true, result: 'Toggled fullscreen mode.' }
    if (res.status === 'exit_fullscreen') return { success: true, result: 'Exited fullscreen mode.' }

    return { success: true, result: `Media control ${action} executed successfully.` }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'controlMedia',
  description: 'Controls video and audio playback across YouTube, streaming platforms, and websites: play, pause, toggle, mute, unmute, skip ad, fullscreen, change speed (e.g. 1.5x, 2x), seek forward/backward, and restart.',
  parameters: [
    {
      name: 'action',
      type: 'string',
      description: 'The media control action: "play", "pause", "toggle", "mute", "unmute", "toggleMute", "skipAd", "fullscreen", "exitFullscreen", "speed", "seek", or "restart".',
      required: true
    },
    {
      name: 'rate',
      type: 'number',
      description: 'Playback speed multiplier (e.g. 0.5, 1.25, 1.5, 2.0). Used when action is "speed".',
      required: false
    },
    {
      name: 'seconds',
      type: 'number',
      description: 'Number of seconds to seek forward (positive, e.g. 10) or backward (negative, e.g. -10). Used when action is "seek".',
      required: false
    }
  ],
  spokenLine: 'Controlling media playback',
  examples: [
    'User: "pause the video" → controlMedia with action: "pause"',
    'User: "play the video" → controlMedia with action: "play"',
    'User: "mute the video" → controlMedia with action: "mute"',
    'User: "unmute" → controlMedia with action: "unmute"',
    'User: "play at 2x speed" → controlMedia with action: "speed", rate: 2.0',
    'User: "forward 10 seconds" → controlMedia with action: "seek", seconds: 10',
    'User: "rewind 10 seconds" → controlMedia with action: "seek", seconds: -10',
    'User: "restart the video" → controlMedia with action: "restart"',
    'User: "fullscreen" → controlMedia with action: "fullscreen"'
  ]
}

export default controlMedia
