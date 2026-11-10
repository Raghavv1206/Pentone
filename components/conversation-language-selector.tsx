import React, { useState } from 'react'
import { useConversationLanguage } from '../lib/language-preferences'

export function ConversationLanguageSelector({ disabled = false }: { disabled?: boolean }) {
  const { language, save } = useConversationLanguage()
  const [notice, setNotice] = useState('')
  return <div className="text-xs min-w-0">
    <label className="flex items-center gap-2">
      <span>Conversation language</span>
      <select aria-label="Conversation language" value={language} disabled={disabled} onChange={event => {
        setNotice(''); void save(event.target.value).catch(() => setNotice('Could not save the language. Please try again.'))
      }} className="min-w-0 flex-1 rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#22231F] p-2 text-[#191919] dark:text-[#F5F1E7]">
        <option value="auto">Auto · English microphone</option>
        <option value="en">English</option>
        <option value="hi">हिन्दी · Hindi</option>
        <option value="hinglish">Hinglish</option>
      </select>
    </label>
    {notice && <p role="status">{notice}</p>}
  </div>
}
