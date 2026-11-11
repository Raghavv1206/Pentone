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
