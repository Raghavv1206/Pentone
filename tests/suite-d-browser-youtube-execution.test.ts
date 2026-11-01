import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseViewCountSnippet,
  extractViewCountFromText,
  selectHighestViewVideo,
  type VideoCandidate
} from '../lib/view-count-normalizer'

test('Suite D: YouTube Analysis & Browser Execution Suite', async (t) => {

  await t.test('1. Deterministic View Count Fixtures', () => {
    // 1.2M views
    const m = parseViewCountSnippet('1.2M views')
    assert.equal(m.numeric, 1_200_000)

    // 950K views
    const k = parseViewCountSnippet('950K views')
    assert.equal(k.numeric, 950_000)

    // 2.3B views
    const b = parseViewCountSnippet('2.3B views')
    assert.equal(b.numeric, 2_300_000_000)

    // Indian comma grouping: 1,25,000 views
    const indianComma = parseViewCountSnippet('1,25,000 views')
    assert.equal(indianComma.numeric, 125_000)

    // 1.2 lakh views
    const lakh = parseViewCountSnippet('1.2 lakh views')
    assert.equal(lakh.numeric, 120_000)

    // 3 crore views
    const crore = parseViewCountSnippet('3 crore views')
    assert.equal(crore.numeric, 30_000_000)

    // Missing view count
    const missing = parseViewCountSnippet('')
    assert.equal(missing.numeric, null)
    assert.equal(missing.confidence, 'none')

    // Live stream watching count
    const live = parseViewCountSnippet('12K watching')
    assert.equal(live.numeric, 12_000)
    assert.equal(live.isLiveStream, true)
  })

  await t.test('2. Disambiguates Upload Date & Duration from View Count', () => {
    // Date before view count
    const sample1 = 'React Tutorial by Code with Harry 1 year ago 450K views'
    const res1 = extractViewCountFromText(sample1)
    assert.equal(res1.numeric, 450_000)

    // Date and duration with comma separated views
    const sample2 = 'React in 100 Seconds by Fireship 3 years ago 2 minutes, 28 seconds 2,345,678 views'
    const res2 = extractViewCountFromText(sample2)
    assert.equal(res2.numeric, 2_345_678)

    // View count before date
    const sample3 = 'Next.js Crash Course 1.5M views • 2 months ago'
    const res3 = extractViewCountFromText(sample3)
    assert.equal(res3.numeric, 1_500_000)

    // Non-view snippet (e.g. only duration and date) must NOT produce false view count
    const nonView = extractViewCountFromText('React Tutorial 2 years ago 15 minutes')
    assert.equal(nonView.numeric, null)
  })

  await t.test('3. Selects Highest View Video (never first result by default)', () => {
    const candidates: VideoCandidate[] = [
      {
        index: 0,
        title: 'React for Beginners 2026',
        channel: 'NewDevs',
        viewCountRaw: '85K views',
        viewCountNumeric: 85_000,
        url: 'https://www.youtube.com/watch?v=first_video',
        confidence: 'high',
        visibility: true
      },
      {
        index: 1,
        title: 'Complete React Tutorial (Best)',
        channel: 'Fireship',
        viewCountRaw: '3.2M views',
        viewCountNumeric: 3_200_000,
        url: 'https://www.youtube.com/watch?v=highest_view_video',
        confidence: 'high',
        visibility: true
      },
      {
        index: 2,
        title: 'React Full Course',
        channel: 'FreeCodeCamp',
        viewCountRaw: '1.8M views',
        viewCountNumeric: 1_800_000,
        url: 'https://www.youtube.com/watch?v=second_highest',
        confidence: 'high',
        visibility: true
      },
      {
        index: 3,
        title: 'React Upcoming Features',
        channel: 'TechTalk',
        viewCountRaw: '',
        viewCountNumeric: undefined,
        url: 'https://www.youtube.com/watch?v=no_views',
        confidence: 'none',
        visibility: true
      }
    ]

    const selected = selectHighestViewVideo(candidates)
    assert.ok(selected)
    assert.equal(selected.index, 1, 'Must select index 1 (3.2M views), NOT index 0')
    assert.equal(selected.title, 'Complete React Tutorial (Best)')
    assert.equal(selected.viewCountNumeric, 3_200_000)
    assert.equal(selected.url, 'https://www.youtube.com/watch?v=highest_view_video')
  })

  await t.test('4. Handles Candidates with Unavailable Views Honestly', () => {
    const unavailableCandidates: VideoCandidate[] = [
      {
        index: 0,
        title: 'Upcoming Premier Video',
        viewCountRaw: '',
        viewCountNumeric: undefined,
        confidence: 'none',
        visibility: true
      }
    ]

    const selected = selectHighestViewVideo(unavailableCandidates)
    assert.equal(selected, null, 'Must return null when candidates lack verified view counts')
  })
})
