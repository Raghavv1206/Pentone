import { useState, useEffect } from 'react'

interface PageContext {
  title: string
  url: string
  domain: string
  contextString: string
  memories: string
}

// Retrieve and format all stored memories
async function getAllMemories(): Promise<string> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const storage = await chrome.storage.local.get(['agent_memories'])
      const memories = storage?.agent_memories || []
      
      if (memories.length === 0) {
        return ''
      }
      
      // Sort by timestamp (most recent first)
      const sortedMemories = memories.sort((a: any, b: any) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
      
      // Format memories concisely for AI context
      const memoryList = sortedMemories
        .slice(0, 10) // Only include top 10 most recent
        .map((m: any) => m.content)
        .join('; ')
      
      return memoryList ? `User info: ${memoryList}. ` : ''
    }
    return ''
  } catch (error) {
    console.error('[usePageContext] Error loading memories:', error)
    return ''
  }
}

// Hook to get current page context for AI APIs
export const usePageContext = () => {
  const [context, setContext] = useState<PageContext>({
    title: '',
    url: '',
    domain: '',
    contextString: '',
    memories: ''
  })

  useEffect(() => {
    let isMounted = true

    const updateContext = async () => {
      try {
        let title = ''
        let url = ''
        let domain = ''

        // 1. Extension page context (popup, sidepanel, background)
        if (typeof chrome !== 'undefined' && chrome.tabs && typeof chrome.tabs.query === 'function') {
          try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
            if (tab && tab.url) {
              if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:')) {
                if (isMounted) {
                  setContext({
                    title: tab.title || '',
                    url: tab.url,
                    domain: '',
                    contextString: '',
                    memories: ''
                  })
                }
                return
              }
              title = tab.title || 'Untitled'
              url = tab.url
              try {
                const urlObj = new URL(tab.url)
                domain = urlObj.hostname
              } catch {
                domain = ''
              }
            }
          } catch (err) {
            console.warn('[usePageContext] chrome.tabs.query failed, falling back to window.location:', err)
          }
        }

        // 2. Content script context fallback: read directly from document and window
        if (!url && typeof window !== 'undefined' && window.location) {
          const currentUrl = window.location.href || ''
          if (currentUrl && !currentUrl.startsWith('chrome://') && !currentUrl.startsWith('chrome-extension://') && !currentUrl.startsWith('about:')) {
            title = typeof document !== 'undefined' ? (document.title || 'Untitled') : 'Untitled'
            url = currentUrl
            domain = window.location.hostname || ''
          }
        }

        if (!url) {
          if (isMounted) {
            setContext({
              title: '',
              url: '',
              domain: '',
              contextString: '',
              memories: ''
            })
          }
          return
        }
        
        // Get user memories
        const memories = await getAllMemories()
        
        // Build rich context string
        let contextString = `Current page: "${title}" on ${domain}. `
        
        // Add page type context
        if (domain.includes('google.com')) {
          contextString += 'This is Google Search. '
        } else if (domain.includes('youtube.com')) {
          contextString += 'This is YouTube. '
        } else if (domain.includes('github.com')) {
          contextString += 'This is GitHub. '
        } else if (domain.includes('twitter.com') || domain.includes('x.com')) {
          contextString += 'This is Twitter/X. '
        } else if (domain.includes('linkedin.com')) {
          contextString += 'This is LinkedIn. '
        } else if (domain.includes('reddit.com')) {
          contextString += 'This is Reddit. '
        } else if (domain.includes('amazon.com')) {
          contextString += 'This is Amazon. '
        } else if (domain.includes('facebook.com')) {
          contextString += 'This is Facebook. '
        } else if (domain.includes('instagram.com')) {
          contextString += 'This is Instagram. '
        }
        
        // Add memories to context
        contextString += memories
        
        if (isMounted) {
          setContext({
            title,
            url,
            domain,
            contextString,
            memories
          })
        }
      } catch (error) {
        console.error('[usePageContext] Error getting page context:', error)
        if (isMounted) {
          setContext({
            title: '',
            url: '',
            domain: '',
            contextString: '',
            memories: ''
          })
        }
      }
    }

    updateContext()

    // Listen for tab changes if chrome.tabs is available
    if (typeof chrome !== 'undefined' && chrome.tabs?.onActivated && chrome.tabs?.onUpdated) {
      const handleTabUpdate = () => {
        updateContext()
      }

      chrome.tabs.onActivated.addListener(handleTabUpdate)
      chrome.tabs.onUpdated.addListener(handleTabUpdate)

      return () => {
        isMounted = false
        chrome.tabs.onActivated.removeListener(handleTabUpdate)
        chrome.tabs.onUpdated.removeListener(handleTabUpdate)
      }
    }

    return () => {
      isMounted = false
    }
  }, [])

  return context
}

// Standalone function for non-hook contexts (safe for both extension pages and content scripts)
export async function getPageContext(): Promise<string> {
  try {
    let title = ''
    let url = ''
    let domain = ''

    // 1. Extension page context (popup, sidepanel, background)
    if (typeof chrome !== 'undefined' && chrome.tabs && typeof chrome.tabs.query === 'function') {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (tab && tab.url) {
          if (!tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://') && !tab.url.startsWith('about:')) {
            title = tab.title || 'Untitled'
            url = tab.url
            try {
              const urlObj = new URL(tab.url)
              domain = urlObj.hostname
            } catch {
              domain = ''
            }
          }
        }
      } catch (err) {
        console.warn('[getPageContext] chrome.tabs.query failed, falling back to window.location:', err)
      }
    }

    // 2. Content script context fallback: read directly from document and window
    if (!url && typeof window !== 'undefined' && window.location) {
      const currentUrl = window.location.href || ''
      if (currentUrl && !currentUrl.startsWith('chrome://') && !currentUrl.startsWith('chrome-extension://') && !currentUrl.startsWith('about:')) {
        title = typeof document !== 'undefined' ? (document.title || 'Untitled') : 'Untitled'
        url = currentUrl
        domain = window.location.hostname || ''
      }
    }

    if (!url) {
      return ''
    }
    
    // Get user memories
    const memories = await getAllMemories()
    
    // Build rich context string with more details
    let contextString = `Current page: "${title}" on ${domain}. `
    
    // Add page type context
    if (domain.includes('google.com')) {
      contextString += 'This is Google Search. '
    } else if (domain.includes('youtube.com')) {
      contextString += 'This is YouTube. '
    } else if (domain.includes('github.com')) {
      contextString += 'This is GitHub. '
    } else if (domain.includes('twitter.com') || domain.includes('x.com')) {
      contextString += 'This is Twitter/X. '
    } else if (domain.includes('linkedin.com')) {
      contextString += 'This is LinkedIn. '
    } else if (domain.includes('reddit.com')) {
      contextString += 'This is Reddit. '
    } else if (domain.includes('amazon.com')) {
      contextString += 'This is Amazon. '
    } else if (domain.includes('facebook.com')) {
      contextString += 'This is Facebook. '
    } else if (domain.includes('instagram.com')) {
      contextString += 'This is Instagram. '
    }
    
    // Add memories to context
    contextString += memories
    
    return contextString
  } catch (error) {
    console.error('[getPageContext] Error getting page context:', error)
    return ''
  }
}
