/**
 * Resume Parser - Offline local extraction of resumes (PDF / Plain text)
 * Uses on-device pdfjs-dist and Chrome Gemini Nano Prompt API.
 */

import type { AutofillProfile, WorkExperienceItem, EducationItem } from './profile-vault'
import { ensureSession } from '../ai'

/**
 * Heuristic fallback extraction for phone, email, and social links
 */
export function extractContactHeuristics(text: string) {
  const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/i
  const phoneRegex = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/
  const linkedinRegex = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9_-]+)/i
  const githubRegex = /(?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9_-]+)/i

  const emailMatch = text.match(emailRegex)
  const phoneMatch = text.match(phoneRegex)
  const linkedinMatch = text.match(linkedinRegex)
  const githubMatch = text.match(githubRegex)

  // Remove email and known social platforms to prevent false positive domain matches
  const textWithoutEmailOrSocial = text
    .replace(emailRegex, ' ')
    .replace(/(?:https?:\/\/)?(?:www\.)?(?:linkedin|github)\.com\/[a-zA-Z0-9_-]+/gi, ' ')

  const portfolioRegex = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9_-]+\.(?:io|dev|me|site|tech|app|com|org|net)(?:\/[^\s,]*)?)/i
  const portfolioMatch = textWithoutEmailOrSocial.match(portfolioRegex)

  // Name heuristic: usually the first non-empty line
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  let firstName = ''
  let lastName = ''
  let fullName = ''

  if (lines.length > 0) {
    const candidateName = lines[0].replace(/[^a-zA-Z\s'-]/g, '').trim()
    const parts = candidateName.split(/\s+/)
    if (parts.length >= 2 && parts.length <= 4) {
      firstName = parts[0]
      lastName = parts[parts.length - 1]
      fullName = candidateName
    }
  }

  return {
    firstName,
    lastName,
    fullName,
    email: emailMatch ? emailMatch[1] : '',
    phone: phoneMatch ? phoneMatch[0] : '',
    linkedinUrl: linkedinMatch ? `https://linkedin.com/in/${linkedinMatch[1]}` : '',
    githubUrl: githubMatch ? `https://github.com/${githubMatch[1]}` : '',
    portfolioUrl: portfolioMatch ? (portfolioMatch[0].startsWith('http') ? portfolioMatch[0] : `https://${portfolioMatch[0]}`) : ''
  }
}

/**
 * Extract text from PDF file buffer in the browser
 */
export async function extractTextFromPDF(arrayBuffer: ArrayBuffer): Promise<string> {
  try {
    // Dynamic import to keep bundle splitting clean
    const pdfjsLib = await import('pdfjs-dist')
    
    // Configure worker
    if (typeof window !== 'undefined' && typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('assets/pdf.worker.min.mjs')
      } catch {}
    }

    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
    const pdfDoc = await loadingTask.promise
    let fullText = ''

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum)
      const textContent = await page.getTextContent()
      const pageText = textContent.items
        .map((item: any) => item.str || '')
        .join(' ')
      fullText += pageText + '\n\n'
    }

    return fullText.trim()
  } catch (err) {
    console.warn('[ResumeParser] PDF.js extraction encountered an error, trying text decoder fallback:', err)
    // Fallback: decode as UTF-8 string to extract visible ASCII text streams
    const decoder = new TextDecoder('utf-8', { fatal: false })
    const raw = decoder.decode(arrayBuffer)
    const cleaned = raw.replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s+/g, ' ')
    return cleaned.slice(0, 8000)
  }
}

/**
 * Parse resume text into structured AutofillProfile using Gemini Nano + Heuristics
 */
export async function parseResumeTextToProfile(
  resumeText: string,
  existingProfile?: Partial<AutofillProfile>
): Promise<Partial<AutofillProfile>> {
  const heuristics = extractContactHeuristics(resumeText)

  // Try parsing with on-device Gemini Nano Prompt API
  try {
    const session = await ensureSession()
    const prompt = `You are a resume parsing assistant. Extract candidate profile details from this resume text into valid JSON matching the schema below.
Output ONLY raw JSON with no Markdown backticks, no preamble, and no explanation.

Target JSON Schema:
{
  "firstName": "string",
  "lastName": "string",
  "email": "string",
  "phone": "string",
  "city": "string",
  "state": "string",
  "country": "string",
  "linkedinUrl": "string",
  "githubUrl": "string",
  "portfolioUrl": "string",
  "skills": ["string"],
  "workExperience": [
    {
      "company": "string",
      "title": "string",
      "location": "string",
      "startDate": "YYYY-MM",
      "endDate": "YYYY-MM or Present",
      "description": "string"
    }
  ],
  "education": [
    {
      "institution": "string",
      "degree": "string",
      "fieldOfStudy": "string",
      "graduationDate": "YYYY-MM"
    }
  ]
}

Resume Text:
${resumeText.slice(0, 5000)}`

    const rawResponse = await session.prompt(prompt)
    const jsonStr = (rawResponse || '')
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim()

    const parsed = JSON.parse(jsonStr)

    const workExperience: WorkExperienceItem[] = (parsed.workExperience || []).map((w: any, idx: number) => ({
      id: `exp-${Date.now()}-${idx}`,
      company: w.company || '',
      title: w.title || '',
      location: w.location || '',
      startDate: w.startDate || '',
      endDate: w.endDate || 'Present',
      current: (w.endDate || '').toLowerCase().includes('present'),
      description: w.description || '',
      bulletPoints: (w.description || '').split('.').map((s: string) => s.trim()).filter((s: string) => s.length > 5)
    }))

    const education: EducationItem[] = (parsed.education || []).map((e: any, idx: number) => ({
      id: `edu-${Date.now()}-${idx}`,
      institution: e.institution || '',
      degree: e.degree || '',
      fieldOfStudy: e.fieldOfStudy || '',
      startDate: e.startDate || '',
      graduationDate: e.graduationDate || ''
    }))

    return {
      personal: {
        firstName: parsed.firstName || heuristics.firstName || existingProfile?.personal?.firstName || '',
        lastName: parsed.lastName || heuristics.lastName || existingProfile?.personal?.lastName || '',
        fullName: `${parsed.firstName || heuristics.firstName || ''} ${parsed.lastName || heuristics.lastName || ''}`.trim() || heuristics.fullName || existingProfile?.personal?.fullName || '',
        preferredName: existingProfile?.personal?.preferredName || '',
        email: parsed.email || heuristics.email || existingProfile?.personal?.email || '',
        phone: parsed.phone || heuristics.phone || existingProfile?.personal?.phone || '',
        addressLine1: existingProfile?.personal?.addressLine1 || '',
        addressLine2: existingProfile?.personal?.addressLine2 || '',
        city: parsed.city || existingProfile?.personal?.city || '',
        state: parsed.state || existingProfile?.personal?.state || '',
        postalCode: existingProfile?.personal?.postalCode || '',
        country: parsed.country || existingProfile?.personal?.country || 'United States'
      },
      online: {
        linkedinUrl: parsed.linkedinUrl || heuristics.linkedinUrl || existingProfile?.online?.linkedinUrl || '',
        githubUrl: parsed.githubUrl || heuristics.githubUrl || existingProfile?.online?.githubUrl || '',
        portfolioUrl: parsed.portfolioUrl || heuristics.portfolioUrl || existingProfile?.online?.portfolioUrl || '',
        twitterUrl: existingProfile?.online?.twitterUrl || '',
        otherUrls: existingProfile?.online?.otherUrls || []
      },
      skills: Array.isArray(parsed.skills) && parsed.skills.length > 0 ? parsed.skills : existingProfile?.skills || [],
      workExperience: workExperience.length > 0 ? workExperience : existingProfile?.workExperience || [],
      education: education.length > 0 ? education : existingProfile?.education || []
    }
  } catch (nanoErr) {
    console.warn('[ResumeParser] Local AI structured parse failed, falling back to heuristics:', nanoErr)
    // Fallback: return pure heuristics
    return {
      personal: {
        firstName: heuristics.firstName || existingProfile?.personal?.firstName || '',
        lastName: heuristics.lastName || existingProfile?.personal?.lastName || '',
        fullName: heuristics.fullName || existingProfile?.personal?.fullName || '',
        preferredName: existingProfile?.personal?.preferredName || '',
        email: heuristics.email || existingProfile?.personal?.email || '',
        phone: heuristics.phone || existingProfile?.personal?.phone || '',
        addressLine1: existingProfile?.personal?.addressLine1 || '',
        addressLine2: existingProfile?.personal?.addressLine2 || '',
        city: existingProfile?.personal?.city || '',
        state: existingProfile?.personal?.state || '',
        postalCode: existingProfile?.personal?.postalCode || '',
        country: existingProfile?.personal?.country || 'United States'
      },
      online: {
        linkedinUrl: heuristics.linkedinUrl || existingProfile?.online?.linkedinUrl || '',
        githubUrl: heuristics.githubUrl || existingProfile?.online?.githubUrl || '',
        portfolioUrl: heuristics.portfolioUrl || existingProfile?.online?.portfolioUrl || '',
        twitterUrl: existingProfile?.online?.twitterUrl || '',
        otherUrls: existingProfile?.online?.otherUrls || []
      }
    }
  }
}
