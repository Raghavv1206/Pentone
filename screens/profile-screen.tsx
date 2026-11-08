import React, { useState, useEffect } from 'react'
import { 
  User, Link2, Briefcase, GraduationCap, ShieldCheck, 
  HelpCircle, Upload, Save, Plus, Trash2, Check, FileText, Sparkles, AlertCircle 
} from 'lucide-react'
import { AppHeader } from '../components/navigation/app-header'
import { type Screen } from '../lib/config'
import { 
  loadAutofillProfile, 
  saveAutofillProfile, 
  DEFAULT_AUTOFILL_PROFILE, 
  createEmptyProfile,
  saveStoredResumeFile,
  loadStoredResumeFile,
  deleteStoredResumeFile,
  type AutofillProfile,
  type StoredResumeFile,
  type WorkExperienceItem,
  type EducationItem,
  type CustomQAItem 
} from '../lib/autofill/profile-vault'
import { extractTextFromPDF, parseResumeTextToProfile } from '../lib/autofill/resume-parser'

interface ProfileScreenProps {
  onNavigate: (screen: Screen) => void
  onOpenSidePanel?: () => void
}

type ProfileTab = 'personal' | 'links' | 'experience' | 'education' | 'demographics' | 'custom'

export const ProfileScreen: React.FC<ProfileScreenProps> = ({ onNavigate, onOpenSidePanel }) => {
  const [profile, setProfile] = useState<AutofillProfile>(DEFAULT_AUTOFILL_PROFILE)
  const [activeTab, setActiveTab] = useState<ProfileTab>('personal')
  const [isSaving, setIsSaving] = useState(false)
  const [showSavedToast, setShowSavedToast] = useState(false)
  const [isParsingResume, setIsParsingResume] = useState(false)
  const [parseStatus, setParseStatus] = useState<string | null>(null)

  const [storedResume, setStoredResume] = useState<StoredResumeFile | null>(null)

  useEffect(() => {
    loadAutofillProfile().then(setProfile)
    loadStoredResumeFile().then(setStoredResume)
  }, [])

  const handleSave = async () => {
    setIsSaving(true)
    await saveAutofillProfile(profile)
    setIsSaving(false)
    setShowSavedToast(true)
    setTimeout(() => setShowSavedToast(false), 2500)
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Security & Reliability: 10MB file size ceiling to prevent memory exhaustion
    const MAX_FILE_SIZE = 10 * 1024 * 1024
    if (file.size > MAX_FILE_SIZE) {
      setParseStatus('File exceeds 10MB limit. Please upload a smaller resume.')
      setTimeout(() => setParseStatus(null), 4000)
      e.target.value = ''
      return
    }

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    const isTxt = file.type.startsWith('text/') || file.name.toLowerCase().endsWith('.txt')

    if (!isPdf && !isTxt) {
      setParseStatus('Unsupported file format. Please upload a PDF or TXT resume.')
      setTimeout(() => setParseStatus(null), 4000)
      e.target.value = ''
      return
    }

    setIsParsingResume(true)
    setParseStatus(`Reading ${file.name}...`)

    try {
      let extractedText = ''
      if (isPdf) {
        setParseStatus('Extracting PDF text offline...')
        const buffer = await file.arrayBuffer()
        extractedText = await extractTextFromPDF(buffer)
      } else {
        extractedText = await file.text()
      }

      setParseStatus('Structuring profile with Gemini Nano...')
      const updatedPartial = await parseResumeTextToProfile(extractedText)

      // Strictly derive personal & online contact data from the uploaded resume.
      // Unmentioned fields remain strictly empty "" without forcing or carrying over old/demo mock values.
      const newPersonal = {
        firstName: updatedPartial.personal?.firstName || '',
        lastName: updatedPartial.personal?.lastName || '',
        fullName: updatedPartial.personal?.fullName || '',
        preferredName: updatedPartial.personal?.preferredName || '',
        email: updatedPartial.personal?.email || '',
        phone: updatedPartial.personal?.phone || '',
        addressLine1: updatedPartial.personal?.addressLine1 || '',
        addressLine2: updatedPartial.personal?.addressLine2 || '',
        city: updatedPartial.personal?.city || '',
        state: updatedPartial.personal?.state || '',
        postalCode: updatedPartial.personal?.postalCode || '',
        country: updatedPartial.personal?.country || ''
      }

      const newOnline = {
        linkedinUrl: updatedPartial.online?.linkedinUrl || '',
        githubUrl: updatedPartial.online?.githubUrl || '',
        portfolioUrl: updatedPartial.online?.portfolioUrl || '',
        twitterUrl: updatedPartial.online?.twitterUrl || '',
        otherUrls: updatedPartial.online?.otherUrls || []
      }

      const merged: AutofillProfile = {
        ...profile,
        personal: newPersonal,
        online: newOnline,
        workExperience: Array.isArray(updatedPartial.workExperience) ? updatedPartial.workExperience : [],
        education: Array.isArray(updatedPartial.education) ? updatedPartial.education : [],
        skills: Array.isArray(updatedPartial.skills) ? updatedPartial.skills : [],
        lastUpdated: Date.now()
      }

      // Save file for 1-click auto-drop upload in job applications
      try {
        const reader = new FileReader()
        const base64 = await new Promise<string>((resolve) => {
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = () => resolve('')
          reader.readAsDataURL(file)
        })
        if (base64) {
          const stored: StoredResumeFile = {
            name: file.name,
            type: file.type || (isPdf ? 'application/pdf' : 'text/plain'),
            size: file.size,
            lastModified: file.lastModified,
            base64
          }
          await saveStoredResumeFile(stored)
          setStoredResume(stored)
        }
      } catch (fileErr) {
        console.warn('[ProfileScreen] Failed to store resume binary:', fileErr)
      }

      setProfile(merged)
      await saveAutofillProfile(merged)
      setParseStatus('Resume successfully imported and ready for 1-click file drops!')
      setShowSavedToast(true)
      setTimeout(() => {
        setParseStatus(null)
        setShowSavedToast(false)
      }, 3000)
    } catch (err: any) {
      console.error('[ProfileScreen] Resume upload failed:', err)
      setParseStatus(`Import notice: ${err?.message || 'Could not parse file'}`)
      setTimeout(() => setParseStatus(null), 4000)
    } finally {
      setIsParsingResume(false)
      e.target.value = ''
    }
  }

  const addWorkExperience = () => {
    const newItem: WorkExperienceItem = {
      id: `exp-${Date.now()}`,
      company: '',
      title: '',
      location: '',
      startDate: '',
      endDate: 'Present',
      current: true,
      description: '',
      bulletPoints: []
    }
    setProfile(prev => ({ ...prev, workExperience: [newItem, ...prev.workExperience] }))
  }

  const removeWorkExperience = (id: string) => {
    setProfile(prev => ({ ...prev, workExperience: prev.workExperience.filter(x => x.id !== id) }))
  }

  const updateWorkExperience = (id: string, field: keyof WorkExperienceItem, val: any) => {
    setProfile(prev => ({
      ...prev,
      workExperience: prev.workExperience.map(item => item.id === id ? { ...item, [field]: val } : item)
    }))
  }

  const addEducation = () => {
    const newItem: EducationItem = {
      id: `edu-${Date.now()}`,
      institution: '',
      degree: '',
      fieldOfStudy: '',
      startDate: '',
      graduationDate: ''
    }
    setProfile(prev => ({ ...prev, education: [newItem, ...prev.education] }))
  }

  const removeEducation = (id: string) => {
    setProfile(prev => ({ ...prev, education: prev.education.filter(x => x.id !== id) }))
  }

  const updateEducation = (id: string, field: keyof EducationItem, val: any) => {
    setProfile(prev => ({
      ...prev,
      education: prev.education.map(item => item.id === id ? { ...item, [field]: val } : item)
    }))
  }

  const addCustomQA = () => {
    const newItem: CustomQAItem = {
      id: `qa-${Date.now()}`,
      questionPattern: '',
      answer: '',
      category: 'logistics'
    }
    setProfile(prev => ({ ...prev, customAnswers: [newItem, ...prev.customAnswers] }))
  }

  const removeCustomQA = (id: string) => {
    setProfile(prev => ({ ...prev, customAnswers: prev.customAnswers.filter(x => x.id !== id) }))
  }

  const updateCustomQA = (id: string, field: keyof CustomQAItem, val: any) => {
    setProfile(prev => ({
      ...prev,
      customAnswers: prev.customAnswers.map(item => item.id === id ? { ...item, [field]: val } : item)
    }))
  }

  const loadDemoProfile = () => {
    const demo: AutofillProfile = {
      personal: {
        firstName: 'Alex',
        lastName: 'Taylor',
        fullName: 'Alex Taylor',
        preferredName: 'Alex',
        email: 'alex.taylor@example.com',
        phone: '415-555-0198',
        addressLine1: '548 Market St',
        addressLine2: 'Suite 200',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94104',
        country: 'United States'
      },
      online: {
        linkedinUrl: 'https://linkedin.com/in/alextaylor-demo',
        githubUrl: 'https://github.com/alextaylor',
        portfolioUrl: 'https://alextaylor.dev',
        twitterUrl: 'https://x.com/alextaylor',
        otherUrls: []
      },
      workExperience: [
        {
          id: 'exp-demo-1',
          company: 'Acme Technologies',
          title: 'Senior Frontend Engineer',
          location: 'San Francisco, CA',
          startDate: '2022-01',
          endDate: 'Present',
          current: true,
          description: 'Led architecture of high-performance React applications. Reduced bundle size by 40%.',
          bulletPoints: ['Architected frontend design system', 'Mentored junior engineers']
        }
      ],
      education: [
        {
          id: 'edu-demo-1',
          institution: 'University of California, Berkeley',
          degree: 'Bachelor of Science',
          fieldOfStudy: 'Computer Science',
          gpa: '3.85',
          startDate: '2017-09',
          graduationDate: '2021-05'
        }
      ],
      skills: ['React', 'TypeScript', 'TailwindCSS', 'Node.js', 'Next.js', 'Chrome Extensions'],
      demographics: {
        gender: 'Prefer not to say',
        pronouns: 'they/them',
        raceEthnicity: 'Decline to self-identify',
        veteranStatus: 'I am not a protected veteran',
        disabilityStatus: 'I do not have a disability',
        authorizedToWorkInCountry: true,
        requiresSponsorship: false,
        citizenship: 'United States'
      },
      customAnswers: [
        {
          id: 'qa-1',
          questionPattern: 'hear about this job|referral|source',
          answer: 'LinkedIn / Career Site',
          category: 'logistics'
        },
        {
          id: 'qa-2',
          questionPattern: 'notice period|start date|availability',
          answer: 'Immediately / 2 weeks notice',
          category: 'logistics'
        }
      ],
      lastUpdated: Date.now()
    }

    setProfile(demo)
    saveAutofillProfile(demo)
    setShowSavedToast(true)
    setTimeout(() => setShowSavedToast(false), 2000)
  }

  const handleClearProfile = async () => {
    const empty = createEmptyProfile()
    setProfile(empty)
    await saveAutofillProfile(empty)
    await deleteStoredResumeFile()
    setStoredResume(null)
    setShowSavedToast(true)
    setTimeout(() => setShowSavedToast(false), 2000)
  }

  const tabs = [
    { id: 'personal' as ProfileTab, label: 'Contact', icon: <User className="w-3.5 h-3.5" /> },
    { id: 'links' as ProfileTab, label: 'Links', icon: <Link2 className="w-3.5 h-3.5" /> },
    { id: 'experience' as ProfileTab, label: 'Experience', icon: <Briefcase className="w-3.5 h-3.5" /> },
    { id: 'education' as ProfileTab, label: 'Education', icon: <GraduationCap className="w-3.5 h-3.5" /> },
    { id: 'demographics' as ProfileTab, label: 'EEO & Auth', icon: <ShieldCheck className="w-3.5 h-3.5" /> },
    { id: 'custom' as ProfileTab, label: 'Custom Q&A', icon: <HelpCircle className="w-3.5 h-3.5" /> }
  ]

  return (
    <div className="flex flex-col h-full bg-[#FFFEEF] dark:bg-[#171816] text-[#191919] dark:text-[#F5F1E7]">
      <AppHeader currentScreen="profile" onNavigate={onNavigate} onOpenSidePanel={onOpenSidePanel} />

      {/* Profile Header & Resume Import Banner */}
      <div className="p-3.5 border-b border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/60 dark:bg-[#1E1F1C]/60 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#005447] text-[#67E2C8] flex items-center justify-center font-bold text-xs shadow-xs">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-bold text-[#191919] dark:text-[#F5F1E7]">Autofill Profile Vault</h2>
              <p className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">100% offline & encrypted on device</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={handleClearProfile}
              className="text-[10.5px] px-2 py-1 rounded-md border border-red-300 dark:border-red-900/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
              title="Clear all profile fields"
            >
              Clear
            </button>
            <button
              onClick={loadDemoProfile}
              className="text-[10.5px] px-2 py-1 rounded-md border border-[#DDDCCB] dark:border-[#373832] text-[#56564E] dark:text-[#A6A49B] hover:text-[#191919] dark:hover:text-[#F5F1E7] transition-colors"
              title="Load demo data for quick testing"
            >
              Demo Profile
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-1 px-3 py-1 bg-[#005447] hover:bg-[#003F36] text-[#67E2C8] text-[11px] font-semibold rounded-md shadow-xs transition-colors"
            >
              <Save className="w-3 h-3" />
              <span>{isSaving ? 'Saving...' : 'Save'}</span>
            </button>
          </div>
        </div>

        {/* 1-Click Resume Upload Area */}
        <div className="flex items-center justify-between p-2 rounded-xl border border-dashed border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816]">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" />
            <div className="text-[10.5px]">
              <span className="font-semibold">Import Resume (PDF/TXT): </span>
              <span className="text-[#77776E] dark:text-[#A6A49B]">Auto-extract into vault with local AI</span>
            </div>
          </div>
          <label className="cursor-pointer flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#EBE7D0] dark:bg-[#2A2B27] hover:bg-[#DDDCCB] dark:hover:bg-[#373832] text-[10.5px] font-medium transition-colors">
            <Upload className="w-3 h-3" />
            <span>{isParsingResume ? 'Parsing...' : 'Upload PDF'}</span>
            <input 
              type="file" 
              accept=".pdf,.txt,.docx" 
              className="hidden" 
              onChange={handleFileUpload} 
              disabled={isParsingResume}
            />
          </label>
        </div>

        {storedResume && !parseStatus && (
          <div className="flex items-center justify-between text-[10px] text-[#005447] dark:text-[#67E2C8] px-2 bg-[#005447]/10 dark:bg-[#67E2C8]/10 rounded-md py-1 border border-[#005447]/20 dark:border-[#67E2C8]/20">
            <span className="flex items-center gap-1 font-medium truncate">
              <Check className="w-3 h-3 flex-shrink-0" />
              <span>Auto-drop ready: {storedResume.name}</span>
            </span>
            <span className="text-[9.5px] opacity-75">{(storedResume.size / 1024).toFixed(0)} KB</span>
          </div>
        )}

        {parseStatus && (
          <div className="text-[10px] text-[#005447] dark:text-[#67E2C8] flex items-center gap-1 px-1">
            <Sparkles className="w-3 h-3 animate-spin" />
            <span>{parseStatus}</span>
          </div>
        )}
      </div>

      {/* Navigation tabs */}
      <div className="flex border-b border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816] px-2 overflow-x-auto no-scrollbar">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium border-b-2 whitespace-nowrap transition-colors ${
              activeTab === t.id 
                ? 'border-[#005447] dark:border-[#67E2C8] text-[#005447] dark:text-[#67E2C8]' 
                : 'border-transparent text-[#77776E] dark:text-[#A6A49B] hover:text-[#191919] dark:hover:text-[#F5F1E7]'
            }`}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Form Content Body */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5 text-xs">
        {/* TAB 1: PERSONAL / CONTACT */}
        {activeTab === 'personal' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="text-[10px] text-[#77776E] dark:text-[#A6A49B] block mb-1">First Name</label>
                <input
                  type="text"
                  value={profile.personal.firstName}
                  onChange={e => setProfile({ ...profile, personal: { ...profile.personal, firstName: e.target.value, fullName: `${e.target.value} ${profile.personal.lastName}`.trim() } })}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF] dark:bg-[#22231F] text-[#191919] dark:text-[#F5F1E7] focus:outline-none focus:border-[#005447]"
                  placeholder="First name"
                />
              </div>
              <div>
                <label className="text-[10px] text-[#77776E] dark:text-[#A6A49B] block mb-1">Last Name</label>
                <input
                  type="text"
                  value={profile.personal.lastName}
                  onChange={e => setProfile({ ...profile, personal: { ...profile.personal, lastName: e.target.value, fullName: `${profile.personal.firstName} ${e.target.value}`.trim() } })}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF] dark:bg-[#22231F] text-[#191919] dark:text-[#F5F1E7] focus:outline-none focus:border-[#005447]"
                  placeholder="Last name"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="text-[10px] text-[#77776E] dark:text-[#A6A49B] block mb-1">Email</label>
                <input
                  type="email"
                  value={profile.personal.email}
                  onChange={e => setProfile({ ...profile, personal: { ...profile.personal, email: e.target.value } })}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF] dark:bg-[#22231F] text-[#191919] dark:text-[#F5F1E7] focus:outline-none focus:border-[#005447]"
                  placeholder="email@example.com"
                />
                {profile.personal.email && profile.personal.email.includes('@') && (
                  <div className="mt-1 flex items-center gap-1 text-[9px] text-[#005447] dark:text-[#67E2C8] leading-tight">
                    <ShieldCheck size={10} className="shrink-0" />
                    <span>Auto-alias ready ({profile.personal.email.split('@')[0]}+site@...)</span>
                  </div>
                )}
              </div>
              <div>
                <label className="text-[10px] text-[#77776E] dark:text-[#A6A49B] block mb-1">Phone</label>
                <input
                  type="tel"
                  value={profile.personal.phone}
                  onChange={e => setProfile({ ...profile, personal: { ...profile.personal, phone: e.target.value } })}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF] dark:bg-[#22231F] text-[#191919] dark:text-[#F5F1E7] focus:outline-none focus:border-[#005447]"
                  placeholder="Phone number"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] text-[#77776E] dark:text-[#A6A49B] block mb-1">Street Address</label>
              <input
                type="text"
                value={profile.personal.addressLine1}
                onChange={e => setProfile({ ...profile, personal: { ...profile.personal, addressLine1: e.target.value } })}
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF] dark:bg-[#22231F] text-[#191919] dark:text-[#F5F1E7] focus:outline-none focus:border-[#005447]"
                placeholder="Not provided in resume (optional)"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-[#77776E] dark:text-[#A6A49B] block mb-1">City</label>
                <input
                  type="text"
                  value={profile.personal.city}
                  onChange={e => setProfile({ ...profile, personal: { ...profile.personal, city: e.target.value } })}
                  className="w-full px-2 py-1.5 rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF] dark:bg-[#22231F] text-[#191919] dark:text-[#F5F1E7] focus:outline-none focus:border-[#005447]"
                  placeholder="City"
                />
              </div>
              <div>
                <label className="text-[10px] text-[#77776E] dark:text-[#A6A49B] block mb-1">State / Province</label>
                <input
                  type="text"
                  value={profile.personal.state}
                  onChange={e => setProfile({ ...profile, personal: { ...profile.personal, state: e.target.value } })}
                  className="w-full px-2 py-1.5 rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF] dark:bg-[#22231F] text-[#191919] dark:text-[#F5F1E7] focus:outline-none focus:border-[#005447]"
                  placeholder="State / Province"
                />
              </div>
              <div>
                <label className="text-[10px] text-[#77776E] dark:text-[#A6A49B] block mb-1">ZIP / Postal</label>
                <input
                  type="text"
                  value={profile.personal.postalCode}
                  onChange={e => setProfile({ ...profile, personal: { ...profile.personal, postalCode: e.target.value } })}
                  className="w-full px-2 py-1.5 rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF] dark:bg-[#22231F] text-[#191919] dark:text-[#F5F1E7] focus:outline-none focus:border-[#005447]"
                  placeholder="Not provided in resume (optional)"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] text-[#77776E] dark:text-[#A6A49B] block mb-1">Country</label>
              <input
                type="text"
                value={profile.personal.country}
                onChange={e => setProfile({ ...profile, personal: { ...profile.personal, country: e.target.value } })}
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF] dark:bg-[#22231F] text-[#191919] dark:text-[#F5F1E7] focus:outline-none focus:border-[#005447]"
                placeholder="Country (or from resume)"
              />
            </div>
          </div>
        )}

        {/* TAB 2: LINKS */}
        {activeTab === 'links' && (
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-[#77776E] dark:text-[#A6A49B] block mb-1">LinkedIn Profile</label>
              <input
                type="url"
                value={profile.online.linkedinUrl || ''}
                onChange={e => setProfile({ ...profile, online: { ...profile.online, linkedinUrl: e.target.value } })}
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF] dark:bg-[#22231F] text-[#191919] dark:text-[#F5F1E7] focus:outline-none focus:border-[#005447]"
                placeholder="https://linkedin.com/in/username"
              />
            </div>

            <div>
              <label className="text-[10px] text-[#77776E] dark:text-[#A6A49B] block mb-1">GitHub Profile</label>
              <input
                type="url"
                value={profile.online.githubUrl || ''}
                onChange={e => setProfile({ ...profile, online: { ...profile.online, githubUrl: e.target.value } })}
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF] dark:bg-[#22231F] text-[#191919] dark:text-[#F5F1E7] focus:outline-none focus:border-[#005447]"
                placeholder="https://github.com/username"
              />
            </div>

            <div>
              <label className="text-[10px] text-[#77776E] dark:text-[#A6A49B] block mb-1">Portfolio / Personal Website</label>
              <input
                type="url"
                value={profile.online.portfolioUrl || ''}
                onChange={e => setProfile({ ...profile, online: { ...profile.online, portfolioUrl: e.target.value } })}
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF] dark:bg-[#22231F] text-[#191919] dark:text-[#F5F1E7] focus:outline-none focus:border-[#005447]"
                placeholder="https://mywebsite.dev"
              />
            </div>

            <div>
              <label className="text-[10px] text-[#77776E] dark:text-[#A6A49B] block mb-1">Twitter / X Profile</label>
              <input
                type="url"
                value={profile.online.twitterUrl || ''}
                onChange={e => setProfile({ ...profile, online: { ...profile.online, twitterUrl: e.target.value } })}
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF] dark:bg-[#22231F] text-[#191919] dark:text-[#F5F1E7] focus:outline-none focus:border-[#005447]"
                placeholder="https://x.com/username"
              />
            </div>

            <div>
              <label className="text-[10px] text-[#77776E] dark:text-[#A6A49B] block mb-1">Skills (comma-separated)</label>
              <textarea
                value={profile.skills.join(', ')}
                onChange={e => setProfile({ ...profile, skills: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                rows={3}
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF] dark:bg-[#22231F] text-[#191919] dark:text-[#F5F1E7] focus:outline-none focus:border-[#005447]"
                placeholder="React, TypeScript, Node.js, Python, Chrome Extensions"
              />
            </div>
          </div>
        )}

        {/* TAB 3: WORK EXPERIENCE */}
        {activeTab === 'experience' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold">Work History</span>
              <button
                onClick={addWorkExperience}
                className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-[#005447] text-[#005447] dark:text-[#67E2C8]"
              >
                <Plus className="w-3 h-3" />
                <span>Add Position</span>
              </button>
            </div>

            {profile.workExperience.length === 0 && (
              <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B] italic">No work experience added. Upload a resume or click "Add Position".</p>
            )}

            {profile.workExperience.map((item, index) => (
              <div key={item.id} className="p-3 rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/40 dark:bg-[#22231F]/40 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[11px]">Position #{index + 1}</span>
                  <button onClick={() => removeWorkExperience(item.id)} className="text-red-500 hover:text-red-700">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={item.company}
                    onChange={e => updateWorkExperience(item.id, 'company', e.target.value)}
                    placeholder="Company Name"
                    className="px-2 py-1 rounded border border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816]"
                  />
                  <input
                    type="text"
                    value={item.title}
                    onChange={e => updateWorkExperience(item.id, 'title', e.target.value)}
                    placeholder="Job Title"
                    className="px-2 py-1 rounded border border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816]"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="text"
                    value={item.location}
                    onChange={e => updateWorkExperience(item.id, 'location', e.target.value)}
                    placeholder="City, State"
                    className="px-2 py-1 rounded border border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816]"
                  />
                  <input
                    type="text"
                    value={item.startDate}
                    onChange={e => updateWorkExperience(item.id, 'startDate', e.target.value)}
                    placeholder="Start (YYYY-MM)"
                    className="px-2 py-1 rounded border border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816]"
                  />
                  <input
                    type="text"
                    value={item.endDate}
                    onChange={e => updateWorkExperience(item.id, 'endDate', e.target.value)}
                    placeholder="End (or Present)"
                    className="px-2 py-1 rounded border border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816]"
                  />
                </div>

                <textarea
                  value={item.description}
                  onChange={e => updateWorkExperience(item.id, 'description', e.target.value)}
                  placeholder="Key responsibilities and bullet points..."
                  rows={2}
                  className="w-full px-2 py-1 rounded border border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816]"
                />
              </div>
            ))}
          </div>
        )}

        {/* TAB 4: EDUCATION */}
        {activeTab === 'education' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold">Education</span>
              <button
                onClick={addEducation}
                className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-[#005447] text-[#005447] dark:text-[#67E2C8]"
              >
                <Plus className="w-3 h-3" />
                <span>Add School</span>
              </button>
            </div>

            {profile.education.length === 0 && (
              <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B] italic">No education history added yet.</p>
            )}

            {profile.education.map((item, index) => (
              <div key={item.id} className="p-3 rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/40 dark:bg-[#22231F]/40 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[11px]">Degree #{index + 1}</span>
                  <button onClick={() => removeEducation(item.id)} className="text-red-500 hover:text-red-700">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <input
                  type="text"
                  value={item.institution}
                  onChange={e => updateEducation(item.id, 'institution', e.target.value)}
                  placeholder="College / University Name"
                  className="w-full px-2 py-1 rounded border border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816]"
                />

                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={item.degree}
                    onChange={e => updateEducation(item.id, 'degree', e.target.value)}
                    placeholder="Degree (e.g. Bachelor of Science)"
                    className="px-2 py-1 rounded border border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816]"
                  />
                  <input
                    type="text"
                    value={item.fieldOfStudy}
                    onChange={e => updateEducation(item.id, 'fieldOfStudy', e.target.value)}
                    placeholder="Major / Field (e.g. Computer Science)"
                    className="px-2 py-1 rounded border border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={item.graduationDate}
                    onChange={e => updateEducation(item.id, 'graduationDate', e.target.value)}
                    placeholder="Graduation Date (YYYY-MM)"
                    className="px-2 py-1 rounded border border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816]"
                  />
                  <input
                    type="text"
                    value={item.gpa || ''}
                    onChange={e => updateEducation(item.id, 'gpa', e.target.value)}
                    placeholder="GPA (Optional)"
                    className="px-2 py-1 rounded border border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816]"
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TAB 5: DEMOGRAPHICS & EEO */}
        {activeTab === 'demographics' && (
          <div className="space-y-3">
            <div className="p-2.5 rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/40 dark:bg-[#22231F]/40 space-y-2">
              <span className="font-semibold text-[11px] block text-[#005447] dark:text-[#67E2C8]">Work Authorization</span>
              
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={profile.demographics.authorizedToWorkInCountry}
                  onChange={e => setProfile({ ...profile, demographics: { ...profile.demographics, authorizedToWorkInCountry: e.target.checked } })}
                  className="rounded text-[#005447]"
                />
                <span className="text-[11px]">Legally authorized to work in target country</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={profile.demographics.requiresSponsorship}
                  onChange={e => setProfile({ ...profile, demographics: { ...profile.demographics, requiresSponsorship: e.target.checked } })}
                  className="rounded text-[#005447]"
                />
                <span className="text-[11px]">Will require future visa sponsorship (H-1B, etc.)</span>
              </label>
            </div>

            <div>
              <label className="text-[10px] text-[#77776E] dark:text-[#A6A49B] block mb-1">Gender</label>
              <select
                value={profile.demographics.gender || 'Prefer not to say'}
                onChange={e => setProfile({ ...profile, demographics: { ...profile.demographics, gender: e.target.value } })}
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF] dark:bg-[#22231F] text-[#191919] dark:text-[#F5F1E7]"
              >
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Non-Binary">Non-Binary</option>
                <option value="Prefer not to say">Prefer not to say</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] text-[#77776E] dark:text-[#A6A49B] block mb-1">Pronouns</label>
              <input
                type="text"
                value={profile.demographics.pronouns || ''}
                onChange={e => setProfile({ ...profile, demographics: { ...profile.demographics, pronouns: e.target.value } })}
                placeholder="e.g. he/him, she/her, they/them"
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF] dark:bg-[#22231F]"
              />
            </div>

            <div>
              <label className="text-[10px] text-[#77776E] dark:text-[#A6A49B] block mb-1">Race / Ethnicity</label>
              <select
                value={profile.demographics.raceEthnicity || 'Decline to self-identify'}
                onChange={e => setProfile({ ...profile, demographics: { ...profile.demographics, raceEthnicity: e.target.value } })}
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF] dark:bg-[#22231F]"
              >
                <option value="Decline to self-identify">Decline to self-identify</option>
                <option value="Asian">Asian</option>
                <option value="White">White</option>
                <option value="Black or African American">Black or African American</option>
                <option value="Hispanic or Latino">Hispanic or Latino</option>
                <option value="Two or More Races">Two or More Races</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] text-[#77776E] dark:text-[#A6A49B] block mb-1">Veteran Status</label>
              <select
                value={profile.demographics.veteranStatus || 'I am not a protected veteran'}
                onChange={e => setProfile({ ...profile, demographics: { ...profile.demographics, veteranStatus: e.target.value } })}
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF] dark:bg-[#22231F]"
              >
                <option value="I am not a protected veteran">I am not a protected veteran</option>
                <option value="I identify as one or more protected veteran categories">I identify as a protected veteran</option>
                <option value="I decline to state">I decline to state</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] text-[#77776E] dark:text-[#A6A49B] block mb-1">Disability Status</label>
              <select
                value={profile.demographics.disabilityStatus || 'I do not have a disability'}
                onChange={e => setProfile({ ...profile, demographics: { ...profile.demographics, disabilityStatus: e.target.value } })}
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF] dark:bg-[#22231F]"
              >
                <option value="I do not have a disability">No, I do not have a disability</option>
                <option value="Yes, I have a disability">Yes, I have a disability</option>
                <option value="I decline to answer">I decline to answer</option>
              </select>
            </div>
          </div>
        )}

        {/* TAB 6: CUSTOM Q&A */}
        {activeTab === 'custom' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold">Custom Questions & Answers</span>
              <button
                onClick={addCustomQA}
                className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-[#005447] text-[#005447] dark:text-[#67E2C8]"
              >
                <Plus className="w-3 h-3" />
                <span>Add Q&A</span>
              </button>
            </div>

            <p className="text-[10.5px] text-[#77776E] dark:text-[#A6A49B]">
              Define responses for repeating questions. The pattern matches question labels on the page.
            </p>

            {profile.customAnswers.map(item => (
              <div key={item.id} className="p-2.5 rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/40 dark:bg-[#22231F]/40 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-[#77776E] dark:text-[#A6A49B] font-mono">Pattern / Keywords</span>
                  <button onClick={() => removeCustomQA(item.id)} className="text-red-500 hover:text-red-700">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                <input
                  type="text"
                  value={item.questionPattern}
                  onChange={e => updateCustomQA(item.id, 'questionPattern', e.target.value)}
                  placeholder="e.g. hear about us|referral"
                  className="w-full px-2 py-1 rounded border border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816] font-mono text-[10.5px]"
                />
                <input
                  type="text"
                  value={item.answer}
                  onChange={e => updateCustomQA(item.id, 'answer', e.target.value)}
                  placeholder="Default answer to fill"
                  className="w-full px-2 py-1 rounded border border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816]"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Saved Toast */}
      {showSavedToast && (
        <div className="fixed bottom-3 right-3 bg-[#005447] text-[#67E2C8] px-3 py-1.5 rounded-lg shadow-lg flex items-center gap-1.5 text-xs font-semibold animate-fadeIn z-50">
          <Check className="w-3.5 h-3.5" />
          <span>Profile saved offline!</span>
        </div>
      )}
    </div>
  )
}
