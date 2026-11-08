/**
 * Profile Vault - Master user data store for intelligent form autofilling
 * 100% offline and stored in chrome.storage.local / IndexedDB
 */

export interface WorkExperienceItem {
  id: string
  company: string
  title: string
  location: string
  startDate: string // YYYY-MM
  endDate: string   // YYYY-MM or 'Present'
  current: boolean
  description: string
  bulletPoints: string[]
}

export interface EducationItem {
  id: string
  institution: string
  degree: string
  fieldOfStudy: string
  gpa?: string
  startDate: string
  graduationDate: string
}

export interface CustomQAItem {
  id: string
  questionPattern: string
  answer: string
  category?: 'technical' | 'behavioral' | 'logistics' | 'compensation'
}

export interface AutofillProfile {
  personal: {
    firstName: string
    lastName: string
    fullName: string
    preferredName?: string
    email: string
    phone: string
    addressLine1: string
    addressLine2?: string
    city: string
    state: string
    postalCode: string
    country: string
  }
  online: {
    linkedinUrl?: string
    githubUrl?: string
    portfolioUrl?: string
    twitterUrl?: string
    otherUrls?: { label: string; url: string }[]
  }
  workExperience: WorkExperienceItem[]
  education: EducationItem[]
  skills: string[]
  demographics: {
    gender?: string
    pronouns?: string
    raceEthnicity?: string
    veteranStatus?: string
    disabilityStatus?: string
    authorizedToWorkInCountry: boolean
    requiresSponsorship: boolean
    citizenship?: string
  }
  customAnswers: CustomQAItem[]
  lastUpdated: number
}

export const STORAGE_KEY_AUTOFILL_PROFILE = 'pentone_autofill_profile'
export const STORAGE_KEY_STORED_RESUME_FILE = 'pentone_stored_resume_file'

export interface StoredResumeFile {
  name: string
  type: string
  size: number
  lastModified: number
  base64: string // Base64 data string for automated file dropping
}

/**
 * Save resume file metadata & base64 into local storage for automated file upload
 */
export async function saveStoredResumeFile(file: StoredResumeFile): Promise<void> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      try {
        localStorage.setItem(STORAGE_KEY_STORED_RESUME_FILE, JSON.stringify(file))
      } catch {}
      resolve()
      return
    }

    chrome.storage.local.set({ [STORAGE_KEY_STORED_RESUME_FILE]: file }, () => {
      resolve()
    })
  })
}

/**
 * Load stored resume file from local storage
 */
export async function loadStoredResumeFile(): Promise<StoredResumeFile | null> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      try {
        const item = localStorage.getItem(STORAGE_KEY_STORED_RESUME_FILE)
        resolve(item ? JSON.parse(item) : null)
      } catch {
        resolve(null)
      }
      return
    }

    chrome.storage.local.get([STORAGE_KEY_STORED_RESUME_FILE], (res) => {
      resolve((res?.[STORAGE_KEY_STORED_RESUME_FILE] as StoredResumeFile) || null)
    })
  })
}

/**
 * Delete stored resume file
 */
export async function deleteStoredResumeFile(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      localStorage.removeItem(STORAGE_KEY_STORED_RESUME_FILE)
      resolve()
      return
    }
    chrome.storage.local.remove([STORAGE_KEY_STORED_RESUME_FILE], () => {
      resolve()
    })
  })
}

export const DEFAULT_AUTOFILL_PROFILE: AutofillProfile = {
  personal: {
    firstName: '',
    lastName: '',
    fullName: '',
    preferredName: '',
    email: '',
    phone: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: '',
    country: ''
  },
  online: {
    linkedinUrl: '',
    githubUrl: '',
    portfolioUrl: '',
    twitterUrl: '',
    otherUrls: []
  },
  workExperience: [],
  education: [],
  skills: [],
  demographics: {
    gender: 'Prefer not to say',
    pronouns: '',
    raceEthnicity: 'Decline to self-identify',
    veteranStatus: 'I am not a protected veteran',
    disabilityStatus: 'I do not have a disability',
    authorizedToWorkInCountry: true,
    requiresSponsorship: false,
    citizenship: ''
  },
  customAnswers: [
    {
      id: 'qa-1',
      questionPattern: 'hear about this job|hear about us|referral',
      answer: 'LinkedIn / Company Career Page',
      category: 'logistics'
    },
    {
      id: 'qa-2',
      questionPattern: 'notice period|start date|earliest availability',
      answer: 'Immediately / 2 weeks',
      category: 'logistics'
    }
  ],
  lastUpdated: Date.now()
}

/**
 * Load autofill profile from local storage
 */
export async function loadAutofillProfile(): Promise<AutofillProfile> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve(DEFAULT_AUTOFILL_PROFILE)
      return
    }

    chrome.storage.local.get([STORAGE_KEY_AUTOFILL_PROFILE], (res) => {
      if (res?.[STORAGE_KEY_AUTOFILL_PROFILE]) {
        const profile = res[STORAGE_KEY_AUTOFILL_PROFILE] as AutofillProfile
        // Ensure all required sections exist in case of schema upgrade
        const merged: AutofillProfile = {
          ...DEFAULT_AUTOFILL_PROFILE,
          ...profile,
          personal: { ...DEFAULT_AUTOFILL_PROFILE.personal, ...(profile.personal || {}) },
          online: { ...DEFAULT_AUTOFILL_PROFILE.online, ...(profile.online || {}) },
          demographics: { ...DEFAULT_AUTOFILL_PROFILE.demographics, ...(profile.demographics || {}) },
          workExperience: Array.isArray(profile.workExperience) ? profile.workExperience : [],
          education: Array.isArray(profile.education) ? profile.education : [],
          skills: Array.isArray(profile.skills) ? profile.skills : [],
          customAnswers: Array.isArray(profile.customAnswers) ? profile.customAnswers : DEFAULT_AUTOFILL_PROFILE.customAnswers
        }
        resolve(merged)
      } else {
        resolve(DEFAULT_AUTOFILL_PROFILE)
      }
    })
  })
}

/**
 * Save autofill profile to local storage
 */
export async function saveAutofillProfile(profile: AutofillProfile): Promise<void> {
  const toSave: AutofillProfile = {
    ...profile,
    lastUpdated: Date.now()
  }

  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve()
      return
    }

    chrome.storage.local.set({ [STORAGE_KEY_AUTOFILL_PROFILE]: toSave }, () => {
      if (chrome.runtime?.lastError) {
        console.error('[ProfileVault] Error saving profile to chrome.storage.local:', chrome.runtime.lastError.message)
        resolve()
        return
      }
      // Notify active tabs and views of updated profile
      try {
        chrome.runtime.sendMessage({ type: 'pentone_autofill_profile_updated', profile: toSave }).catch(() => {})
      } catch {}
      resolve()
    })
  })
}

/**
 * Update a specific section of the profile
 */
export async function updateProfileSection<K extends keyof AutofillProfile>(
  section: K,
  data: AutofillProfile[K]
): Promise<AutofillProfile> {
  const current = await loadAutofillProfile()
  const updated: AutofillProfile = {
    ...current,
    [section]: data,
    lastUpdated: Date.now()
  }
  await saveAutofillProfile(updated)
  return updated
}

/**
 * Create a completely clean, empty profile without any pre-filled or mock values
 */
export function createEmptyProfile(): AutofillProfile {
  return {
    personal: {
      firstName: '',
      lastName: '',
      fullName: '',
      preferredName: '',
      email: '',
      phone: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      postalCode: '',
      country: ''
    },
    online: {
      linkedinUrl: '',
      githubUrl: '',
      portfolioUrl: '',
      twitterUrl: '',
      otherUrls: []
    },
    workExperience: [],
    education: [],
    skills: [],
    demographics: {
      gender: '',
      pronouns: '',
      raceEthnicity: '',
      veteranStatus: '',
      disabilityStatus: '',
      authorizedToWorkInCountry: true,
      requiresSponsorship: false,
      citizenship: ''
    },
    customAnswers: [],
    lastUpdated: Date.now()
  }
}

/**
 * Reset profile back to defaults
 */
export async function resetAutofillProfile(): Promise<void> {
  await saveAutofillProfile(createEmptyProfile())
}
