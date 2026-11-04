/**
 * Pentone Model Provisioning Context & React Hook
 * 
 * Exposes a lightweight React hook `useModelProvisioning()` and `ModelProvisioningProvider`
 * that wraps the unified singleton `ModelProvisioningService` and `GenerativeRuntime`.
 * 
 * Guarantees:
 * 1. Non-duplicative pub-sub synchronization across components.
 * 2. Real-time download progress, cache presence, and memory residency state.
 * 3. Safe invocation of single-model or all-model downloads, cancellation, and deletes.
 * 4. Transparent offline readiness reporting across Qwen, Embeddings, and Whisper.
 * 5. Transparent first-run banner dismissal tracking.
 */

import React, { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import {
  modelProvisioning,
  type ModelDownloadProgress,
  type ModelStorageInfo,
  type ProvisionedModelKey,
  type OfflineReadinessReport,
  type ModelStatusState,
  QWEN_MODEL_ID
} from './model-provisioning'
import { generativeRuntime } from './generative-runtime'

export interface ModelProvisioningContextValue {
  progress: ModelDownloadProgress
  allProgress: Record<ProvisionedModelKey, ModelDownloadProgress>
  isCached: boolean
  allCached: boolean
  modelsCached: Record<ProvisionedModelKey, boolean>
  isResident: boolean
  storageInfo: ModelStorageInfo | null
  isChecking: boolean
  bannerDismissed: boolean
  readinessReport: OfflineReadinessReport | null
  downloadModel: (modelKey?: ProvisionedModelKey) => Promise<boolean>
  downloadAllModels: (options?: { includeOptionalVision?: boolean }) => Promise<boolean>
  retryDownload: (modelKey?: ProvisionedModelKey | 'all', options?: { includeOptionalVision?: boolean }) => Promise<boolean>
  cancelDownload: () => void
  deleteModel: (modelKey?: ProvisionedModelKey | 'all') => Promise<void>
  unloadModel: () => Promise<void>
  refresh: () => Promise<void>
  checkOfflineReadiness: (testInference?: boolean) => Promise<OfflineReadinessReport>
  dismissBanner: () => void
}

const ModelProvisioningContext = createContext<ModelProvisioningContextValue | null>(null)

export const ModelProvisioningProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [progress, setProgress] = useState<ModelDownloadProgress>(modelProvisioning.getProgress())
  const [allProgress, setAllProgress] = useState<Record<ProvisionedModelKey, ModelDownloadProgress>>(
    modelProvisioning.getAllProgress()
  )
  const [isCached, setIsCached] = useState<boolean>(false)
  const [allCached, setAllCached] = useState<boolean>(false)
  const [modelsCached, setModelsCached] = useState<Record<ProvisionedModelKey, boolean>>({
    qwen: false,
    embeddings: false,
    whisper: false,
    vision: false
  })
  const [isResident, setIsResident] = useState<boolean>(generativeRuntime.isModelResident())
  const [storageInfo, setStorageInfo] = useState<ModelStorageInfo | null>(null)
  const [isChecking, setIsChecking] = useState<boolean>(true)
  const [bannerDismissed, setBannerDismissed] = useState<boolean>(false)
  const [readinessReport, setReadinessReport] = useState<OfflineReadinessReport | null>(null)

  const checkStatus = useCallback(async () => {
    setIsChecking(true)
    try {
      const qwenCached = await modelProvisioning.checkModelCached('qwen')
      const embCached = await modelProvisioning.checkModelCached('embeddings')
      const whisperCached = await modelProvisioning.checkModelCached('whisper')
      const visionCached = await modelProvisioning.checkModelCached('vision')

      setIsCached(qwenCached)
      setModelsCached({
        qwen: qwenCached,
        embeddings: embCached,
        whisper: whisperCached,
        vision: visionCached
      })
      setAllCached(qwenCached && embCached && whisperCached && visionCached)
      setIsResident(generativeRuntime.isModelResident())

      const storage = await modelProvisioning.checkStorageQuota('all')
      setStorageInfo(storage)

      const report = await modelProvisioning.checkOfflineReadiness(false)
      setReadinessReport(report)
    } catch (e) {
      console.warn('[ModelProvisioningContext] checkStatus error:', e)
    } finally {
      setIsChecking(false)
    }
  }, [])

  useEffect(() => {
    // Initial inspection
    checkStatus()

    // Subscribe to ModelProvisioningService progress updates
    const unsubscribe = modelProvisioning.subscribe((newProgress) => {
      setProgress(newProgress)
      setAllProgress(modelProvisioning.getAllProgress())

      if (newProgress.state === 'downloaded' || newProgress.state === 'ready') {
        if (newProgress.modelKey === 'qwen') setIsCached(true)
      } else if (newProgress.state === 'not_downloaded') {
        if (newProgress.modelKey === 'qwen') setIsCached(false)
      }
      setIsResident(generativeRuntime.isModelResident())
    })

    // Load banner dismissal state
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

  const downloadModel = useCallback(async (modelKey: ProvisionedModelKey = 'qwen'): Promise<boolean> => {
    try {
      const success = await modelProvisioning.downloadModel(modelKey)
      return success
    } finally {
      await checkStatus()
    }
  }, [checkStatus])

  const downloadAllModels = useCallback(async (options: { includeOptionalVision?: boolean } = { includeOptionalVision: true }): Promise<boolean> => {
    try {
      const success = await modelProvisioning.downloadAllModels(options)
      return success
    } finally {
      await checkStatus()
    }
  }, [checkStatus])

  const retryDownload = useCallback(async (
    modelKey: ProvisionedModelKey | 'all' = 'qwen',
    options: { includeOptionalVision?: boolean } = { includeOptionalVision: true }
  ): Promise<boolean> => {
    try {
      const success = await modelProvisioning.retryDownload(modelKey, options)
      return success
    } finally {
      await checkStatus()
    }
  }, [checkStatus])

  const cancelDownload = useCallback(() => {
    modelProvisioning.cancelDownload()
  }, [])

  const deleteModel = useCallback(async (modelKey: ProvisionedModelKey | 'all' = 'qwen') => {
    if (modelKey === 'qwen' || modelKey === 'all') {
      await generativeRuntime.unloadModel()
    }
    await modelProvisioning.deleteModel(modelKey)
    await checkStatus()
  }, [checkStatus])

  const unloadModel = useCallback(async () => {
    await generativeRuntime.unloadModel()
    setIsResident(false)
  }, [])

  const checkOfflineReadiness = useCallback(async (testInference: boolean = false): Promise<OfflineReadinessReport> => {
    const report = await modelProvisioning.checkOfflineReadiness(testInference)
    setReadinessReport(report)
    return report
  }, [])

  const dismissBanner = useCallback(() => {
    setBannerDismissed(true)
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ pentone_ai_banner_dismissed: true })
    }
  }, [])

  const value: ModelProvisioningContextValue = {
    progress,
    allProgress,
    isCached,
    allCached,
    modelsCached,
    isResident,
    storageInfo,
    isChecking,
    bannerDismissed,
    readinessReport,
    downloadModel,
    downloadAllModels,
    retryDownload,
    cancelDownload,
    deleteModel,
    unloadModel,
    refresh: checkStatus,
    checkOfflineReadiness,
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
      progress: modelProvisioning.getProgress(),
      allProgress: modelProvisioning.getAllProgress(),
      isCached: false,
      allCached: false,
      modelsCached: { qwen: false, embeddings: false, whisper: false },
      isResident: generativeRuntime.isModelResident(),
      storageInfo: null,
      isChecking: false,
      bannerDismissed: false,
      readinessReport: null,
      downloadModel: (key) => modelProvisioning.downloadModel(key),
      downloadAllModels: () => modelProvisioning.downloadAllModels(),
      retryDownload: (key) => modelProvisioning.retryDownload(key),
      cancelDownload: () => modelProvisioning.cancelDownload(),
      deleteModel: async (key) => {
        if (key === 'qwen' || key === 'all' || !key) {
          await generativeRuntime.unloadModel()
        }
        await modelProvisioning.deleteModel(key)
      },
      unloadModel: () => generativeRuntime.unloadModel(),
      refresh: async () => {},
      checkOfflineReadiness: (t) => modelProvisioning.checkOfflineReadiness(t),
      dismissBanner: () => {}
    }
  }
  return context
}
