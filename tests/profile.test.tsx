import React from 'react'
import { test, expect, vi } from 'vitest'
import { render, fireEvent, waitFor } from '@testing-library/react'
import { data, seed } from './setup'
vi.mock('../components/navigation/app-header', () => ({ AppHeader: () => null }))
vi.mock('../lib/pdf-parser', () => ({ extractTextFromPDF: async () => 'Resume '.repeat(30) }))
vi.mock('../lib/autofill/resume-parser', () => ({ parseResumeTextToProfile: async () => ({ personal: { fullName: 'Imported Person', email: 'new@example.com' }, skills: ['TypeScript'] }) }))
import { ProfileScreen } from '../screens/profile-screen'
import { createEmptyProfile } from '../lib/autofill/profile-vault'
test('resume import persists the newly parsed profile and file together', async () => {
  const profile = createEmptyProfile(); profile.personal.email = 'old@example.com'
  seed({ pentone_autofill_profile: profile })
  const view = render(<ProfileScreen onNavigate={() => {}} />)
  await waitFor(() => expect(view.container.querySelector('input[type="file"]')).toBeTruthy())
  const file = new File(['Sample resume content '.repeat(10)], 'resume.txt', { type: 'text/plain' })
  Object.defineProperty(file, 'text', { value: async () => 'Sample resume content '.repeat(10) })
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [file] } })
  await waitFor(() => expect(data.pentone_autofill_profile.personal.email).toBe('new@example.com'))
  expect(data.pentone_autofill_profile.personal.fullName).toBe('Imported Person')
  expect(data.pentone_stored_resume_file.base64).toMatch(/^data:text\/plain;base64,/)
})
