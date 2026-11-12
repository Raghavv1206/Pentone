import { test, expect } from 'vitest'
import { detectIntents, detectIntent } from '../lib/intent-detector'
import { polishAcousticTranscript, polishSearchQuery } from '../lib/acoustic-normalizer'

test('polishAcousticTranscript corrects ASR phonetic mishearings for Seedhe Maut and Bure Din', () => {
  expect(polishAcousticTranscript('Open YouTube search for burethan by siremath'))
    .toBe('Open YouTube search for bure din by seedhe maut')

  expect(polishAcousticTranscript('Search for burethin by siddhi moth'))
    .toBe('Search for bure din by seedhe maut')

  expect(polishAcousticTranscript('search for search for bure din by seedhe maut'))
    .toBe('search for bure din by seedhe maut')
})

test('polishSearchQuery unwraps query and removes stutter prefixes', () => {
  expect(polishSearchQuery('search for search for burethin by siddhi moth'))
    .toBe('bure din by seedhe maut')

  expect(polishSearchQuery('burethan by siremath'))
    .toBe('bure din by seedhe maut')

  expect(polishSearchQuery('"bure din by seedhe maut"?'))
    .toBe('bure din by seedhe maut')
})

test('explicit YouTube search command searches YouTube and applies phonetic correction', () => {
  const intents = detectIntents('Open YouTube search for burethan by siremath')
  expect(intents).toHaveLength(1)
  expect(intents[0].toolCall.function).toBe('openTab')
  expect(intents[0].toolCall.arguments.url).toContain('youtube.com/results?search_query=bure%20din%20by%20seedhe%20maut')
  expect(intents[0].confirmationText).toBe('Opening YouTube and searching for "bure din by seedhe maut".')
})

test('general search command while on YouTube searches within YouTube instead of opening Google', () => {
  const ytContext = { activeTabUrl: 'https://www.youtube.com/results?search_query=test', activeTabTitle: 'YouTube' }
  const intents = detectIntents('Search for burethin by siddhi moth', ytContext)
  expect(intents).toHaveLength(1)
  expect(intents[0].toolCall.function).toBe('openTab')
  expect(intents[0].toolCall.arguments.url).toContain('youtube.com/results?search_query=bure%20din%20by%20seedhe%20maut')
  expect(intents[0].confirmationText).toBe('Searching YouTube for "bure din by seedhe maut".')
})

test('repetitive speech stutter search on YouTube extracts clean query and searches YouTube', () => {
  const ytContext = { activeTabUrl: 'https://www.youtube.com', activeTabTitle: 'YouTube' }
  const intents = detectIntents('search for search for bure din by seedhe maut', ytContext)
  expect(intents).toHaveLength(1)
  expect(intents[0].toolCall.function).toBe('openTab')
  expect(intents[0].toolCall.arguments.url).toContain('youtube.com/results?search_query=bure%20din%20by%20seedhe%20maut')
  expect(intents[0].confirmationText).toBe('Searching YouTube for "bure din by seedhe maut".')
})

test('play media command automatically directs to YouTube', () => {
  const intents = detectIntents('play bure din by seedhe maut')
  expect(intents).toHaveLength(1)
  expect(intents[0].toolCall.function).toBe('openTab')
  expect(intents[0].toolCall.arguments.url).toContain('youtube.com/results?search_query=bure%20din%20by%20seedhe%20maut')
  expect(intents[0].confirmationText).toBe('Playing "bure din by seedhe maut" on YouTube.')
})

test('search command while on Amazon searches Amazon', () => {
  const amazonContext = { activeTabUrl: 'https://www.amazon.com/dp/B08N5WRWNW', activeTabTitle: 'Amazon.com' }
  const intents = detectIntents('search for wireless headphones', amazonContext)
  expect(intents).toHaveLength(1)
  expect(intents[0].toolCall.function).toBe('openTab')
  expect(intents[0].toolCall.arguments.url).toContain('amazon.com/s?k=wireless%20headphones')
  expect(intents[0].confirmationText).toBe('Searching Amazon for "wireless headphones".')
})

test('search command while on GitHub searches GitHub', () => {
  const ghContext = { activeTabUrl: 'https://github.com/trending', activeTabTitle: 'GitHub Trending' }
  const intents = detectIntents('search for tailwind css', ghContext)
  expect(intents).toHaveLength(1)
  expect(intents[0].toolCall.function).toBe('openTab')
  expect(intents[0].toolCall.arguments.url).toContain('github.com/search?q=tailwind%20css')
  expect(intents[0].confirmationText).toBe('Searching GitHub for "tailwind css".')
})

test('explicit Google search while on YouTube honors explicit target', () => {
  const ytContext = { activeTabUrl: 'https://www.youtube.com', activeTabTitle: 'YouTube' }
  const intents = detectIntents('search for weather in Tokyo on Google', ytContext)
  expect(intents).toHaveLength(1)
  expect(intents[0].toolCall.function).toBe('openTab')
  expect(intents[0].toolCall.arguments.url).toContain('google.com/search?q=weather%20in%20Tokyo')
  expect(intents[0].confirmationText).toBe('Searching Google for "weather in Tokyo".')
})

test('search command on new tab defaults to Google search', () => {
  const intents = detectIntents('search for latest machine learning news', { activeTabUrl: 'chrome://newtab' })
  expect(intents).toHaveLength(1)
  expect(intents[0].toolCall.function).toBe('openTab')
  expect(intents[0].toolCall.arguments.url).toContain('google.com/search?q=latest%20machine%20learning%20news')
  expect(intents[0].confirmationText).toBe('Searching Google for "latest machine learning news".')
})

test('generic "play the songs" and "play the song" click the first song instead of searching literal "the songs"', () => {
  const intents = detectIntents('play the songs')
  expect(intents).toHaveLength(1)
  expect(intents[0].toolCall.function).toBe('clickElement')
  expect(intents[0].toolCall.arguments.query).toBe('first song')
  expect(intents[0].toolCall.arguments.ordinal).toBe(0)
  expect(intents[0].confirmationText).toBe('Playing the first song.')

  const singleIntent = detectIntents('play the song')
  expect(singleIntent).toHaveLength(1)
  expect(singleIntent[0].toolCall.function).toBe('clickElement')
  expect(singleIntent[0].toolCall.arguments.query).toBe('first song')
  expect(singleIntent[0].toolCall.arguments.ordinal).toBe(0)
  expect(singleIntent[0].confirmationText).toBe('Playing the first song.')

  const secondSong = detectIntents('play the second song')
  expect(secondSong).toHaveLength(1)
  expect(secondSong[0].toolCall.function).toBe('clickElement')
  expect(secondSong[0].toolCall.arguments.query).toBe('second song')
  expect(secondSong[0].toolCall.arguments.ordinal).toBe(1)
  expect(secondSong[0].confirmationText).toBe('Playing the second song.')
})

test('multilingual generic song play commands map to clicking first song', () => {
  const hindi = detectIntents('gaana chalao')
  expect(hindi).toHaveLength(1)
  expect(hindi[0].toolCall.function).toBe('clickElement')
  expect(hindi[0].toolCall.arguments.query).toBe('first song')

  const spanish = detectIntents('reproducir la canción')
  expect(spanish).toHaveLength(1)
  expect(spanish[0].toolCall.function).toBe('clickElement')
  expect(spanish[0].toolCall.arguments.query).toBe('first song')

  const french = detectIntents('jouer la chanson')
  expect(french).toHaveLength(1)
  expect(french[0].toolCall.function).toBe('clickElement')
  expect(french[0].toolCall.arguments.query).toBe('first song')

  const japanese = detectIntents('曲を再生')
  expect(japanese).toHaveLength(1)
  expect(japanese[0].toolCall.function).toBe('clickElement')
  expect(japanese[0].toolCall.arguments.query).toBe('first song')
})

test('distinguishes "play song" with autoPlay from explicit "search for" on YouTube', () => {
  // ASR mishearing: "When YouTube and play sweater weather song" -> corrected to "open youtube and play sweater weather song"
  const playIntent = detectIntents('When YouTube and play sweater weather song')
  expect(playIntent).toHaveLength(1)
  expect(playIntent[0].toolCall.function).toBe('openTab')
  expect(playIntent[0].toolCall.arguments.url).toContain('youtube.com/results?search_query=sweater%20weather%20song')
  expect(playIntent[0].toolCall.arguments.autoPlay).toBe(true)
  expect(playIntent[0].confirmationText).toBe('Playing "sweater weather song" on YouTube.')

  // Explicit Open YouTube and play
  const openAndPlay = detectIntents('open YouTube and play sweater weather song')
  expect(openAndPlay).toHaveLength(1)
  expect(openAndPlay[0].toolCall.function).toBe('openTab')
  expect(openAndPlay[0].toolCall.arguments.autoPlay).toBe(true)
  expect(openAndPlay[0].confirmationText).toBe('Playing "sweater weather song" on YouTube.')

  // Explicit Search (NOT play): autoPlay is not enabled and confirmation specifies searching
  const searchIntent = detectIntents('search for sweater weather on YouTube')
  expect(searchIntent).toHaveLength(1)
  expect(searchIntent[0].toolCall.function).toBe('openTab')
  expect(searchIntent[0].toolCall.arguments.autoPlay).toBeUndefined()
  expect(searchIntent[0].confirmationText).toBe('Opening YouTube and searching for "sweater weather".')
})

test('Border main YouTube page acoustic correction and same-site navigation', () => {
  // Acoustic correction: "Border main YouTube page" -> "open main YouTube page"
  expect(polishAcousticTranscript('Border main YouTube page')).toBe('open main YouTube page')

  // When active tab is already on YouTube: navigatePage in same tab
  const ytContext = { activeTabUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', activeTabTitle: 'Rick Astley - Never Gonna Give You Up' }
  const sameTabIntents = detectIntents('Border main YouTube page', ytContext)
  expect(sameTabIntents).toHaveLength(1)
  expect(sameTabIntents[0].toolCall.function).toBe('navigatePage')
  expect(sameTabIntents[0].toolCall.arguments.action).toBe('url')
  expect(sameTabIntents[0].toolCall.arguments.url).toBe('https://www.youtube.com')
  expect(sameTabIntents[0].confirmationText).toBe('Navigating to the main YouTube page.')

  // When active tab is on a different website (e.g. Wikipedia): opens YouTube in new tab
  const wikiContext = { activeTabUrl: 'https://en.wikipedia.org/wiki/Main_Page', activeTabTitle: 'Wikipedia' }
  const newTabIntents = detectIntents('Border main YouTube page', wikiContext)
  expect(newTabIntents).toHaveLength(1)
  expect(newTabIntents[0].toolCall.function).toBe('openTab')
  expect(newTabIntents[0].toolCall.arguments.url).toBe('https://www.youtube.com')
  expect(newTabIntents[0].confirmationText).toBe('Opening YouTube.')
})

test('smart same-site direct navigation reuses active tab when already on that site', () => {
  const ytContext = { activeTabUrl: 'https://www.youtube.com/watch?v=123', activeTabTitle: 'YouTube Video' }
  const intents = detectIntents('open youtube', ytContext)
  expect(intents).toHaveLength(1)
  expect(intents[0].toolCall.function).toBe('navigatePage')
  expect(intents[0].toolCall.arguments.action).toBe('url')
  expect(intents[0].toolCall.arguments.url).toBe('https://www.youtube.com')
  expect(intents[0].confirmationText).toBe('Navigating to YouTube.')

  // If on a different site, openTab is used
  const ghContext = { activeTabUrl: 'https://github.com/facebook/react', activeTabTitle: 'GitHub' }
  const ghIntents = detectIntents('open youtube', ghContext)
  expect(ghIntents).toHaveLength(1)
  expect(ghIntents[0].toolCall.function).toBe('openTab')
  expect(ghIntents[0].confirmationText).toBe('Opening YouTube.')
})

test('previous and next tab intents route to switchTab and never history.back', () => {
  const prev1 = detectIntents('go to previous tab')
  expect(prev1).toHaveLength(1)
  expect(prev1[0].toolCall.function).toBe('switchTab')
  expect(prev1[0].toolCall.arguments.action).toBe('previous')
  expect(prev1[0].confirmationText).toBe('Switching to the previous tab.')

  const prev2 = detectIntents('switch to previous tab')
  expect(prev2).toHaveLength(1)
  expect(prev2[0].toolCall.function).toBe('switchTab')
  expect(prev2[0].toolCall.arguments.action).toBe('previous')

  const prev3 = detectIntents('previous tab')
  expect(prev3).toHaveLength(1)
  expect(prev3[0].toolCall.function).toBe('switchTab')
  expect(prev3[0].toolCall.arguments.action).toBe('previous')

  const next1 = detectIntents('go to next tab')
  expect(next1).toHaveLength(1)
  expect(next1[0].toolCall.function).toBe('switchTab')
  expect(next1[0].toolCall.arguments.action).toBe('next')
  expect(next1[0].confirmationText).toBe('Switching to the next tab.')

  // Multilingual tab switching
  const hindi = detectIntents('pichla tab')
  expect(hindi).toHaveLength(1)
  expect(hindi[0].toolCall.function).toBe('switchTab')
  expect(hindi[0].toolCall.arguments.action).toBe('previous')

  const spanish = detectIntents('pestaña anterior')
  expect(spanish).toHaveLength(1)
  expect(spanish[0].toolCall.function).toBe('switchTab')
  expect(spanish[0].toolCall.arguments.action).toBe('previous')

  const french = detectIntents('onglet précédent')
  expect(french).toHaveLength(1)
  expect(french[0].toolCall.function).toBe('switchTab')
  expect(french[0].toolCall.arguments.action).toBe('previous')

  const german = detectIntents('vorheriger tab')
  expect(german).toHaveLength(1)
  expect(german[0].toolCall.function).toBe('switchTab')
  expect(german[0].toolCall.arguments.action).toBe('previous')
})

test('chained command "Close this tab and open YouTube in the previous tab"', () => {
  const intents = detectIntents('Close this tab and open YouTube in the previous tab')
  expect(intents).toHaveLength(2)
  expect(intents[0].toolCall.function).toBe('closeTab')
  expect(intents[0].toolCall.arguments.current).toBe(true)
  expect(intents[0].confirmationText).toBe('Closing the current tab.')

  expect(intents[1].toolCall.function).toBe('navigatePage')
  expect(intents[1].toolCall.arguments.action).toBe('url')
  expect(intents[1].toolCall.arguments.url).toBe('https://www.youtube.com')
  expect(intents[1].confirmationText).toBe('Opening YouTube in the previous tab.')
})

