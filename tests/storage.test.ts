import { test, expect, vi } from 'vitest'
import { chromeMock, data } from './setup'
vi.mock('../lib/embeddings', () => ({ generateEmbedding: async () => [1, 0], cosineSimilarity: () => 1 }))
import { storePageInVault, getAllVaultEntries, deleteVaultEntry, searchVault, clearVault, cleanupVault } from '../lib/vault'
import { resumeFileToStored, validateResumeFile, saveStoredResumeFile, saveAutofillProfile, createEmptyProfile } from '../lib/autofill/profile-vault'
test('100 simultaneous page writes have unique IDs; deletion removes page and chunks', async () => {
  await clearVault()
  const ids = await Promise.all(Array.from({ length: 100 }, (_, i) => storePageInVault({ url: `https://example.com/${i}`, title: `Page ${i}`, content: 'Long article content. '.repeat(70), excerpt: 'Excerpt', domain: 'example.com', wordCount: 210 })))
  expect(new Set(ids).size).toBe(100); expect(await getAllVaultEntries()).toHaveLength(100)
  await deleteVaultEntry(ids[0]); expect((await searchVault('article', 100)).some(p => p.id === ids[0])).toBe(false)
  expect(await cleanupVault(10)).toBe(89); expect(await getAllVaultEntries()).toHaveLength(10)
  await clearVault(); expect(await searchVault('article')).toHaveLength(0)
})
test('resume bytes and metadata persist; unsupported or oversized files are rejected', async () => {
  const file = new File(['Resume contents'], 'resume.txt', { type: 'text/plain', lastModified: 42 })
  const stored = await resumeFileToStored(file)
  expect(atob(stored.base64.split(',')[1])).toBe('Resume contents')
  await saveStoredResumeFile(stored); expect(data.pentone_stored_resume_file.lastModified).toBe(42)
  expect(() => validateResumeFile(new File(['x'], 'bad.exe'))).toThrow('PDF or TXT')
  const large = new File(['x'], 'large.pdf'); Object.defineProperty(large, 'size', { value: 11 * 1024 * 1024 })
  expect(() => validateResumeFile(large)).toThrow('10 MB')
})
test('profile storage errors reject instead of showing false saved success', async () => {
  chromeMock.storage.local.set.mockImplementationOnce((_value: any, cb: Function) => {
    chromeMock.runtime.lastError = { message: 'Quota exceeded' }; cb(); chromeMock.runtime.lastError = undefined
  })
  await expect(saveAutofillProfile(createEmptyProfile())).rejects.toThrow('Quota exceeded')
})
