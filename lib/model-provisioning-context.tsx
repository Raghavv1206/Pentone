/**
 * Pentone Model Provisioning Context & React Hook
 * 
 * Exposes a lightweight React hook `useModelProvisioning()` and `ModelProvisioningProvider`
 * that wraps the singleton `ModelProvisioningService` and `GenerativeRuntime`.
 * 
 * Guarantees:
 * 1. Non-duplicative pub-sub synchronization across components.
 * 2. Real-time download progress, cache presence, and memory residency state.
 * 3. Safe invocation of download, cancellation, delete, and memory unload operations.
 * 4. Transparent first-run banner dismissal tracking.
 */

import React, { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import {
  modelProvisioning,
  type ModelDownloadProgress,
  type ModelStorageInfo,
  QWEN_MODEL_ID
} from './model-provisioning'
import { generativeRuntime } from './generative-runtime'

export interface ModelProvisioningContextValue {
  progress: ModelDownloadProgress
  isCached: boolean
  isResident: boolean
  storageInfo: ModelStorageInfo | null
  isChecking: boolean
  bannerDismissed: boolean
  downloadModel: () => Promise<boolean>
  cancelDownload: () => void
  deleteModel: () => Promise<void>
  unloadModel: () => Promise<void>
  refresh: () => Promise<void>
  dismissBanner: () => void
}

const ModelProvisioningContext = createContext<ModelProvisioningContextValue | null>(null)

export const ModelProvisioningProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [progress, setProgress] = useState<ModelDownloadProgress>(modelProvisioning.getState())
  const [isCached, setIsCached] = useState<boolean>(false)
  const [isResident, setIsResident] = useState<boolean>(generativeRuntime.isModelResident())
  const [storageInfo, setStorageInfo] = useState<ModelStorageInfo | null>(null)
  const [isChecking, setIsChecking] = useState<boolean>(true)
  const [bannerDismissed, setBannerDismissed] = useState<boolean>(false)

  const checkStatus = useCallback(async () => {
    setIsChecking(true)
    try {
      const cached = await modelProvisioning.checkModelCached()
      setIsCached(cached)
      setIsResident(generativeRuntime.isModelResident())
      const storage = await modelProvisioning.checkStorageQuota()
      setStorageInfo(storage)
    } catch (e) {
      console.warn('[ModelProvisioningContext] checkStatus error:', e)
    } finally {
      setIsChecking(false)
    }
  }, [])

  useEffect(() => {
    // Check initial state
    checkStatus()

    // Subscribe to ModelProvisioningService progress events
    const unsubscribe = modelProvisioning.subscribe((newProgress) => {
      setProgress(newProgress)
      if (newProgress.state === 'downloaded' || newProgress.state === 'ready') {
        setIsCached(true)
      } else if (newProgress.state === 'not_downloaded') {
        setIsCached(false)
      }
      setIsResident(generativeRuntime.isModelResident())
    })

    // Load banner dismissal state from chrome.storage.local
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get(['pentone_ai_banner_dismissed'], (res) => {
        if (res && res.pentone_ai_banner_dismissed === true) {
          setBannerDismissed(true)
        }
      })
    }

    return () => {
      unsubscribe()
    }
  }, [checkStatus])

  const downloadModel = useCallback(async (): Promise<boolean> => {
    const success = await modelProvisioning.downloadModel()
    await checkStatus()
    return success
  }, [checkStatus])

  const cancelDownload = useCallback(() => {
    modelProvisioning.cancelDownload()
  }, [])

  const deleteModel = useCallback(async () => {
    await generativeRuntime.unloadModel()
    await modelProvisioning.deleteModel()
    await checkStatus()
  }, [checkStatus])

  const unloadModel = useCallback(async () => {
    await generativeRuntime.unloadModel()
    setIsResident(false)
  }, [])

  const dismissBanner = useCallback(() => {
    setBannerDismissed(true)
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ pentone_ai_banner_dismissed: true })
    }
  }, [])

  const value: ModelProvisioningContextValue = {
    progress,
    isCached,
    isResident,
    storageInfo,
    isChecking,
    bannerDismissed,
    downloadModel,
    cancelDownload,
    deleteModel,
    unloadModel,
    refresh: checkStatus,
    dismissBanner
  }

  return (
    <ModelProvisioningContext.Provider value={value}>
      {children}
    </ModelProvisioningContext.Provider>
  )
}

export const useModelProvisioning = (): ModelProvisioningContextValue => {
  const context = useContext(ModelProvisioningContext)
  if (!context) {
    // Safe fallback if used outside provider (e.g. in isolated component tests)
    return {
      progress: modelProvisioning.getState(),
      isCached: false,
      isResident: generativeRuntime.isModelResident(),
      storageInfo: null,
      isChecking: false,
      bannerDismissed: false,
      downloadModel: () => modelProvisioning.downloadModel(),
      cancelDownload: () => modelProvisioning.cancelDownload(),
      deleteModel: async () => {
        await generativeRuntime.unloadModel()
        await modelProvisioning.deleteModel()
      },
      unloadModel: () => generativeRuntime.unloadModel(),
      refresh: async () => {},
      dismissBanner: () => {}
    }
  }
  return context
}
