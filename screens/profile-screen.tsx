import { resumeFileToStored, validateResumeFile } from '../lib/autofill/profile-vault'
import React, { useState, useEffect } from 'react'
import { 
  UserCheck2, Globe2, Briefcase, GraduationCap, ShieldCheck, 
  FileQuestion, UploadCloud, Save, Plus, Trash2, Check, FileText, 
  Sparkles, AlertCircle, RotateCcw, FileUp, Mail, Phone, MapPin, 
  Building2, Calendar, Award, Linkedin, Github, User
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
    loadAutofillProfile().then(p => {
      if (p) setProfile(p)
    })
    loadStoredResumeFile().then(f => {
      if (f) setStoredResume(f)
    })
  }, [])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await saveAutofillProfile(profile)
      setShowSavedToast(true)
      setTimeout(() => setShowSavedToast(false), 2000)
    } catch (error: any) {
      setParseStatus(`Could not save profile: ${error.message}`)
    } finally {
      setIsSaving(false)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsParsingResume(true)
    setParseStatus('Reading file bytes...')

    try {
      validateResumeFile(file)
      let rawText = ''
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        setParseStatus('Extracting text via local pdf.js...')
        const buffer = await file.arrayBuffer()
        rawText = await extractTextFromPDF(buffer)
      } else {
        setParseStatus('Reading plain text...')
        rawText = await file.text()
      }

      if (!rawText || rawText.trim().length < 50) {
        throw new Error('Could not extract sufficient text from resume.')
      }

      setParseStatus('Zero-shot parsing into profile vault...')
      const parsedPartial = await parseResumeTextToProfile(rawText)

      // Merge into active profile state
      const prev = profile
      const merged: AutofillProfile = {
        ...prev,
        personal: {
          ...prev.personal,
          ...parsedPartial.personal,
          fullName: parsedPartial.personal?.fullName || prev.personal.fullName,
          firstName: parsedPartial.personal?.firstName || prev.personal.firstName,
          lastName: parsedPartial.personal?.lastName || prev.personal.lastName,
          email: parsedPartial.personal?.email || prev.personal.email,
          phone: parsedPartial.personal?.phone || prev.personal.phone,
          city: parsedPartial.personal?.city || prev.personal.city,
          state: parsedPartial.personal?.state || prev.personal.state,
          country: parsedPartial.personal?.country || prev.personal.country
        },
        online: {
          ...prev.online,
          ...parsedPartial.online
        },
        skills: parsedPartial.skills && parsedPartial.skills.length > 0 
          ? Array.from(new Set([...prev.skills, ...parsedPartial.skills])) 
          : prev.skills,
        workExperience: parsedPartial.workExperience && parsedPartial.workExperience.length > 0 
          ? parsedPartial.workExperience 
          : prev.workExperience,
        education: parsedPartial.education && parsedPartial.education.length > 0 
          ? parsedPartial.education 
          : prev.education,
        lastUpdated: Date.now()
      }

      // Persist the actual binary resume file for 1-click drag/drop uploads into career portals
      setParseStatus('Saving resume locally for 1-click job uploads...')
      const savedStored = await resumeFileToStored(file)
      await saveStoredResumeFile(savedStored)
      setStoredResume(savedStored)

      // Persist the same parsed profile that is displayed.
      await saveAutofillProfile(merged)
      setProfile(merged)

      setParseStatus(null)
      setShowSavedToast(true)
      setTimeout(() => setShowSavedToast(false), 2500)
    } catch (err: any) {
      console.error('[ProfileScreen] Resume upload failed:', err)
      setParseStatus(`Error: ${err?.message || 'Failed to parse resume'}`)
      setTimeout(() => setParseStatus(null), 5000)
    } finally {
      setIsParsingResume(false)
      // Reset input
      e.target.value = ''
    }
  }

  const loadDemoProfile = () => {
    setProfile(DEFAULT_AUTOFILL_PROFILE)
    setShowSavedToast(true)
    setTimeout(() => setShowSavedToast(false), 2000)
  }

  const addWorkExperience = () => {
    const newItem: WorkExperienceItem = {
      id: Date.now().toString(),
      company: '',
      title: '',
      startDate: '',
      endDate: 'Present',
      location: '',
      current: true,
      bulletPoints: [],
      description: ''
    }
    setProfile(prev => ({ ...prev, workExperience: [newItem, ...prev.workExperience] }))
  }

  const updateWorkExperience = (id: string, field: keyof WorkExperienceItem, val: string) => {
    setProfile(prev => ({
      ...prev,
      workExperience: prev.workExperience.map(item => item.id === id ? { ...item, [field]: val } : item)
    }))
  }

  const removeWorkExperience = (id: string) => {
    setProfile(prev => ({
      ...prev,
      workExperience: prev.workExperience.filter(item => item.id !== id)
    }))
  }

  const addEducation = () => {
    const newItem: EducationItem = {
      id: Date.now().toString(),
      institution: '',
      degree: '',
      fieldOfStudy: '',
      startDate: '',
      graduationDate: '',
      gpa: ''
    }
    setProfile(prev => ({ ...prev, education: [newItem, ...prev.education] }))
  }

  const updateEducation = (id: string, field: keyof EducationItem, val: string) => {
    setProfile(prev => ({
      ...prev,
      education: prev.education.map(item => item.id === id ? { ...item, [field]: val } : item)
    }))
  }

  const removeEducation = (id: string) => {
    setProfile(prev => ({
      ...prev,
      education: prev.education.filter(item => item.id !== id)
    }))
  }

  const addCustomQA = () => {
    const newItem: CustomQAItem = {
      id: Date.now().toString(),
      questionPattern: '',
      answer: ''
    }
    setProfile(prev => ({ ...prev, customAnswers: [...prev.customAnswers, newItem] }))
  }

  const updateCustomQA = (id: string, field: keyof CustomQAItem, val: string) => {
    setProfile(prev => ({
      ...prev,
      customAnswers: prev.customAnswers.map(item => item.id === id ? { ...item, [field]: val } : item)
    }))
  }

  const removeCustomQA = (id: string) => {
    setProfile(prev => ({
      ...prev,
      customAnswers: prev.customAnswers.filter(item => item.id !== id)
    }))
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
    { id: 'personal' as ProfileTab, label: 'Contact', icon: <UserCheck2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" /> },
    { id: 'links' as ProfileTab, label: 'Links', icon: <Globe2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" /> },
    { id: 'experience' as ProfileTab, label: 'Experience', icon: <Briefcase className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" /> },
    { id: 'education' as ProfileTab, label: 'Education', icon: <GraduationCap className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" /> },
    { id: 'demographics' as ProfileTab, label: 'EEO & Auth', icon: <ShieldCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" /> },
    { id: 'custom' as ProfileTab, label: 'Custom Q&A', icon: <FileQuestion className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" /> }
  ]

  return (
    <div className="flex flex-col h-full bg-[#FFFEEF] dark:bg-[#171816] text-[#191919] dark:text-[#F5F1E7]">
      <AppHeader currentScreen="profile" onNavigate={onNavigate} onOpenSidePanel={onOpenSidePanel} />

      {/* Profile Header & Resume Import Banner */}
      <div className="p-3.5 border-b border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/60 dark:bg-[#1E1F1C]/60 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-[#005447] text-[#67E2C8] flex items-center justify-center font-bold text-xs shadow-xs shrink-0">
              <Sparkles className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
            </div>
            <div>
              <h2 className="text-xs sm:text-sm font-bold text-[#191919] dark:text-[#F5F1E7]">Autofill Profile Vault</h2>
              <p className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">Stored locally on this device</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={handleClearProfile}
              className="text-[10.5px] px-2 py-1 rounded-md border border-red-300 dark:border-red-900/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors flex items-center gap-1 shrink-0"
              title="Clear all profile fields"
            >
              <RotateCcw className="w-3 h-3 shrink-0" />
              <span>Clear</span>
            </button>
            <button
              onClick={loadDemoProfile}
              className="text-[10.5px] px-2 py-1 rounded-md border border-[#DDDCCB] dark:border-[#373832] text-[#56564E] dark:text-[#A6A49B] hover:text-[#191919] dark:hover:text-[#F5F1E7] transition-colors flex items-center gap-1 shrink-0"
              title="Load demo data for quick testing"
            >
              <Sparkles className="w-3 h-3 shrink-0 text-[#67E2C8]" />
              <span>Demo</span>
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-1 px-3 py-1 bg-[#005447] hover:bg-[#003F36] text-[#67E2C8] text-[11px] font-semibold rounded-md shadow-xs transition-colors shrink-0"
            >
              <Save className="w-3.5 h-3.5 shrink-0" />
              <span>{isSaving ? 'Saving...' : 'Save'}</span>
            </button>
          </div>
        </div>

        {/* 1-Click Resume Upload Area */}
        <div className="flex items-center justify-between p-2 rounded-xl border border-dashed border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816]">
          <div className="flex items-center gap-2">
            <FileUp className="w-4 h-4 sm:w-5 sm:h-5 text-[#005447] dark:text-[#67E2C8] shrink-0" />
            <div className="text-[10.5px]">
              <span className="font-semibold">Import Resume (PDF/TXT): </span>
              <span className="text-[#77776E] dark:text-[#A6A49B]">Auto-extract into vault with local AI</span>
            </div>
          </div>
          <label className="cursor-pointer flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#EBE7D0] dark:bg-[#2A2B27] hover:bg-[#DDDCCB] dark:hover:bg-[#373832] text-[10.5px] font-medium transition-colors shrink-0">
            <UploadCloud className="w-3.5 h-3.5 shrink-0" />
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
            <Sparkles className="w-3 h-3 animate-spin shrink-0" />
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
            className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium border-b-2 whitespace-nowrap transition-colors shrink-0 ${
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
                <label className="text-[10px] text-[#77776E] dark:text-[#A6A49B] flex items-center gap-1 mb-1">
                  <User className="w-3 h-3 shrink-0" />
                  <span>First Name</span>
                </label>
                <input
                  type="text"
                  value={profile.personal.firstName}
                  onChange={e => setProfile({ ...profile, personal: { ...profile.personal, firstName: e.target.value, fullName: `${e.target.value} ${profile.personal.lastName}`.trim() } })}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF] dark:bg-[#22231F] text-[#191919] dark:text-[#F5F1E7] focus:outline-none focus:border-[#005447]"
                  placeholder="First name"
                />
              </div>
              <div>
                <label className="text-[10px] text-[#77776E] dark:text-[#A6A49B] flex items-center gap-1 mb-1">
                  <User className="w-3 h-3 shrink-0" />
                  <span>Last Name</span>
                </label>
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
                <label className="text-[10px] text-[#77776E] dark:text-[#A6A49B] flex items-center gap-1 mb-1">
                  <Mail className="w-3 h-3 shrink-0" />
                  <span>Email</span>
                </label>
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
                <label className="text-[10px] text-[#77776E] dark:text-[#A6A49B] flex items-center gap-1 mb-1">
                  <Phone className="w-3 h-3 shrink-0" />
                  <span>Phone</span>
                </label>
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
              <label className="text-[10px] text-[#77776E] dark:text-[#A6A49B] flex items-center gap-1 mb-1">
                <MapPin className="w-3 h-3 shrink-0" />
                <span>Street Address</span>
              </label>
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
              <label className="text-[10px] text-[#77776E] dark:text-[#A6A49B] flex items-center gap-1 mb-1">
                <Linkedin className="w-3 h-3 text-[#0A66C2] shrink-0" />
                <span>LinkedIn Profile</span>
              </label>
              <input
                type="url"
                value={profile.online.linkedinUrl || ''}
                onChange={e => setProfile({ ...profile, online: { ...profile.online, linkedinUrl: e.target.value } })}
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF] dark:bg-[#22231F] text-[#191919] dark:text-[#F5F1E7] focus:outline-none focus:border-[#005447]"
                placeholder="https://linkedin.com/in/username"
              />
            </div>

            <div>
              <label className="text-[10px] text-[#77776E] dark:text-[#A6A49B] flex items-center gap-1 mb-1">
                <Github className="w-3 h-3 text-[#191919] dark:text-[#F5F1E7] shrink-0" />
                <span>GitHub Profile</span>
              </label>
              <input
                type="url"
                value={profile.online.githubUrl || ''}
                onChange={e => setProfile({ ...profile, online: { ...profile.online, githubUrl: e.target.value } })}
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF] dark:bg-[#22231F] text-[#191919] dark:text-[#F5F1E7] focus:outline-none focus:border-[#005447]"
                placeholder="https://github.com/username"
              />
            </div>

            <div>
              <label className="text-[10px] text-[#77776E] dark:text-[#A6A49B] flex items-center gap-1 mb-1">
                <Globe2 className="w-3 h-3 text-[#67E2C8] shrink-0" />
                <span>Portfolio / Personal Website</span>
              </label>
              <input
                type="url"
                value={profile.online.portfolioUrl || ''}
                onChange={e => setProfile({ ...profile, online: { ...profile.online, portfolioUrl: e.target.value } })}
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF] dark:bg-[#22231F] text-[#191919] dark:text-[#F5F1E7] focus:outline-none focus:border-[#005447]"
                placeholder="https://mywebsite.dev"
              />
            </div>

            <div>
              <label className="text-[10px] text-[#77776E] dark:text-[#A6A49B] flex items-center gap-1 mb-1">
                <Globe2 className="w-3 h-3 text-[#38BDF8] shrink-0" />
                <span>Twitter / X Profile</span>
              </label>
              <input
                type="url"
                value={profile.online.twitterUrl || ''}
                onChange={e => setProfile({ ...profile, online: { ...profile.online, twitterUrl: e.target.value } })}
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF] dark:bg-[#22231F] text-[#191919] dark:text-[#F5F1E7] focus:outline-none focus:border-[#005447]"
                placeholder="https://x.com/username"
              />
            </div>

            <div>
              <label className="text-[10px] text-[#77776E] dark:text-[#A6A49B] flex items-center gap-1 mb-1">
                <Award className="w-3 h-3 text-[#F59E0B] shrink-0" />
                <span>Skills (comma-separated)</span>
              </label>
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
              <span className="text-[11px] font-semibold flex items-center gap-1.5">
                <Briefcase className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8] shrink-0" />
                <span>Work History</span>
              </span>
              <button
                onClick={addWorkExperience}
                className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-[#005447] text-[#005447] dark:text-[#67E2C8] hover:bg-[#005447]/10 transition-colors shrink-0"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span>Add Position</span>
              </button>
            </div>

            {profile.workExperience.length === 0 && (
              <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B] italic">No work experience added. Upload a resume or click "Add Position".</p>
            )}

            {profile.workExperience.map((item, index) => (
              <div key={item.id} className="p-3 rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/40 dark:bg-[#22231F]/40 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[11px] flex items-center gap-1">
                    <Building2 className="w-3 h-3 text-[#77776E] shrink-0" />
                    <span>Position #{index + 1}</span>
                  </span>
                  <button onClick={() => removeWorkExperience(item.id)} className="text-red-500 hover:text-red-700 p-1">
                    <Trash2 className="w-3.5 h-3.5 shrink-0" />
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
              <span className="text-[11px] font-semibold flex items-center gap-1.5">
                <GraduationCap className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8] shrink-0" />
                <span>Education</span>
              </span>
              <button
                onClick={addEducation}
                className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-[#005447] text-[#005447] dark:text-[#67E2C8] hover:bg-[#005447]/10 transition-colors shrink-0"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span>Add School</span>
              </button>
            </div>

            {profile.education.length === 0 && (
              <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B] italic">No education history added yet.</p>
            )}

            {profile.education.map((item, index) => (
              <div key={item.id} className="p-3 rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/40 dark:bg-[#22231F]/40 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[11px] flex items-center gap-1">
                    <GraduationCap className="w-3 h-3 text-[#77776E] shrink-0" />
                    <span>Degree #{index + 1}</span>
                  </span>
                  <button onClick={() => removeEducation(item.id)} className="text-red-500 hover:text-red-700 p-1">
                    <Trash2 className="w-3.5 h-3.5 shrink-0" />
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
              <span className="font-semibold text-[11px] block text-[#005447] dark:text-[#67E2C8] flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                <span>Work Authorization</span>
              </span>
              
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
              <span className="text-[11px] font-semibold flex items-center gap-1.5">
                <FileQuestion className="w-3.5 h-3.5 text-[#005447] dark:text-[#67E2C8] shrink-0" />
                <span>Custom Questions & Answers</span>
              </span>
              <button
                onClick={addCustomQA}
                className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-[#005447] text-[#005447] dark:text-[#67E2C8] hover:bg-[#005447]/10 transition-colors shrink-0"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
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
                  <button onClick={() => removeCustomQA(item.id)} className="text-red-500 hover:text-red-700 p-1">
                    <Trash2 className="w-3.5 h-3.5 shrink-0" />
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
          <Check className="w-3.5 h-3.5 shrink-0" />
          <span>Profile saved offline!</span>
        </div>
      )}
    </div>
  )
}
