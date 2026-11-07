import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { writeJsonFile } from '../../server/files.ts'
import { listTalkReviews, parseSource } from '../../server/speaking-review/review.ts'
import { listSuggestions } from '../../server/speaking/suggest.ts'
import { hasModelAnswer, modelAnswerText } from '../../src/features/practice/speaking-ideas/answerText.ts'
import { resolveAnswer } from '../../src/features/practice/speaking-ideas/resolveAnswer.ts'
import { groupByTopic } from '../../src/features/practice/speaking-ideas/topicGroups.ts'
import { practiceKey, practiceStats } from '../../src/features/practice/speaking-review/practiceStats.ts'
import type { SpeakingAnswer, SpeakingHistoryItem, SpeakingResult } from '../../src/types/speaking.ts'
import type { TalkHistoryItem } from '../../src/types/speakingReview.ts'

test('groupByTopic merges same topic (case/punctuation insensitive) and part, flags duplicates, and filters', () => {
  const items: SpeakingHistoryItem[] = [
    {
      id: 'run-old',
      createdAt: '2026-11-01T10:00:00.000Z',
      topic: 'hometown!',
      part: 1,
      questions: ['Where do you live?', 'Do you like your hometown?'],
      answered: [true, false],
    },
    {
      id: 'run-new',
      createdAt: '2026-11-02T10:00:00.000Z',
      topic: 'Hometown',
      part: 1,
      questions: ['where do you live', 'What is famous there?'],
      answered: [true, true],
    },
    {
      id: 'run-p3',
      createdAt: '2026-11-03T10:00:00.000Z',
      topic: 'Hometown',
      part: 3,
      questions: ['Why do people move to big cities?'],
    },
  ]

  const groups = groupByTopic(items)
  assert.equal(groups.length, 2)
  // Sorted by latestCreatedAt descending: Part 3 first, then Part 1
  assert.equal(groups[0]!.part, 3)
  assert.equal(groups[0]!.questions[0]!.answered, true) // default true when `answered` omitted

  const p1 = groups[1]!
  assert.equal(p1.part, 1)
  assert.equal(p1.topic, 'Hometown')
  assert.equal(p1.sessions.length, 2)
  assert.equal(p1.questions.length, 4)
  // First two come from run-new
  assert.equal(p1.questions[0]!.id, 'run-new')
  assert.equal(p1.questions[0]!.isDuplicate, false)
  assert.equal(p1.questions[1]!.id, 'run-new')
  assert.equal(p1.questions[1]!.isDuplicate, false)
  // Third is duplicate of first
  assert.equal(p1.questions[2]!.id, 'run-old')
  assert.equal(p1.questions[2]!.isDuplicate, true)
  // Fourth is unique and unanswered
  assert.equal(p1.questions[3]!.id, 'run-old')
  assert.equal(p1.questions[3]!.isDuplicate, false)
  assert.equal(p1.questions[3]!.answered, false)

  // Part filter
  const onlyP1 = groupByTopic(items, { part: 1 })
  assert.equal(onlyP1.length, 1)
  assert.equal(onlyP1[0]!.part, 1)

  // Search filter
  const searched = groupByTopic(items, { search: 'big cities' })
  assert.equal(searched.length, 1)
  assert.equal(searched[0]!.part, 3)
})

test('modelAnswerText formats sentences, userEdited paragraphs, plain segments, and empty answers', () => {
  const withSentences: SpeakingAnswer = {
    question: 'Do you like reading?',
    answer: [{ text: 'Yes, I love reading. It relaxes me.' }],
    sentences: [
      { tool: 'answer', segments: [{ text: 'Yes, I love reading.' }] },
      { tool: 'effect', segments: [{ text: 'It relaxes me.' }] },
    ],
    structures: [],
    picks: [],
    wording: [],
    extras: [],
  }
  assert.equal(hasModelAnswer(withSentences), true)
  assert.equal(modelAnswerText(withSentences, 1), 'Yes, I love reading. It relaxes me.')

  const withUserEdited: SpeakingAnswer = {
    question: 'Describe a book',
    answer: [{ text: 'First sentence here. Second sentence in next paragraph.' }],
    userEdited: 'First sentence here.\n\nSecond sentence in next paragraph.',
    sentences: [
      { tool: 'answer', segments: [{ text: 'First sentence here.' }] },
      { tool: 'description', segments: [{ text: 'Second sentence in next paragraph.' }] },
    ],
    structures: [],
    picks: [],
    wording: [],
    extras: [],
  }
  assert.equal(modelAnswerText(withUserEdited, 2), 'First sentence here.\n\nSecond sentence in next paragraph.')

  const onlySegments: SpeakingAnswer = {
    question: 'What is your job?',
    answer: [{ text: 'I work as ' }, { text: 'a software engineer.', mark: 'library' }],
    structures: [],
    picks: [],
    wording: [],
    extras: [],
  }
  assert.equal(modelAnswerText(onlySegments, 1), 'I work as a software engineer.')

  const phrasesOnly: SpeakingAnswer = {
    question: 'Why do people travel?',
    answer: [],
    structures: [],
    picks: [],
    wording: [],
    extras: [],
  }
  assert.equal(hasModelAnswer(phrasesOnly), false)
  assert.equal(modelAnswerText(phrasesOnly, 3), '')
})

test('resolveAnswer handles matching index, shifted index after deletion, and deleted question', () => {
  const makeAnswer = (question: string): SpeakingAnswer => ({
    question,
    answer: [{ text: 'Sample answer.' }],
    structures: [],
    picks: [],
    wording: [],
    extras: [],
  })
  const result: SpeakingResult = {
    id: 'abc12345',
    createdAt: '2026-11-01T00:00:00.000Z',
    durationMs: 100,
    topic: 'Cities',
    part: 3,
    answers: [makeAnswer('Question B?'), makeAnswer('Question C?')],
    candidates: 0,
    usage: { model: 'test', input: 0, output: 0, thinking: 0 },
  }

  // Exact index without question
  const r1 = resolveAnswer(result, 0)
  assert.equal(r1?.index, 0)
  assert.equal(r1?.answer.question, 'Question B?')

  // Shifted index: originally at index 2 (after Question A was deleted, Question C is at index 1)
  const r2 = resolveAnswer(result, 2, 'question c')
  assert.equal(r2?.index, 1)
  assert.equal(r2?.answer.question, 'Question C?')

  // Question was deleted
  const r3 = resolveAnswer(result, 0, 'Question A?')
  assert.equal(r3, null)
})

test('practiceStats aggregates count, best band, and lastAt for items with source', () => {
  const base: Omit<TalkHistoryItem, 'id' | 'createdAt' | 'overall' | 'source'> = {
    part: 3,
    question: 'Why do people move?',
    duration: 45,
    words: 90,
    bands: { fc: 6, lr: 6, gra: 6, pron: 6 },
    speech: 40,
    wpm: 135,
    pausesPerMin: 1,
    fillersPerMin: 1,
    unclearPct: 2,
    fixes: 1,
    script: true,
  }
  const items: TalkHistoryItem[] = [
    { ...base, id: '1', createdAt: '2026-11-01T10:00:00.000Z', overall: 6.0 },
    {
      ...base,
      id: '2',
      createdAt: '2026-11-01T11:00:00.000Z',
      overall: 6.0,
      source: { suggestionId: 'sid-123', answerIndex: 0, question: 'Why do people move?' },
    },
    {
      ...base,
      id: '3',
      createdAt: '2026-11-02T09:00:00.000Z',
      overall: 6.5,
      source: { suggestionId: 'sid-123', answerIndex: 0, question: 'why do people move' },
    },
  ]

  const stats = practiceStats(items)
  assert.equal(stats.size, 1)
  const stat = stats.get(practiceKey('sid-123', 'Why do people move?'))
  assert.deepEqual(stat, {
    count: 2,
    best: 6.5,
    lastAt: '2026-11-02T09:00:00.000Z',
  })
})

test('parseSource accepts valid source and ignores invalid input without throwing', () => {
  assert.deepEqual(
    parseSource({
      suggestionId: 'mabc1234-9f0a',
      answerIndex: 2,
      question: '  Why do people travel? ',
      withModel: true,
    }),
    {
      suggestionId: 'mabc1234-9f0a',
      answerIndex: 2,
      question: 'Why do people travel?',
      withModel: true,
    },
  )
  assert.equal(parseSource(null), undefined)
  assert.equal(parseSource({ suggestionId: 'BAD_ID!', answerIndex: 0, question: 'Q', withModel: true }), undefined)
  assert.equal(parseSource({ suggestionId: 'mabc1234-9f0a', answerIndex: 99, question: 'Q', withModel: true }), undefined)
  assert.equal(parseSource({ suggestionId: 'mabc1234-9f0a', answerIndex: 0, question: '   ', withModel: true }), undefined)
})

test('listSuggestions populates answered and listTalkReviews returns 3-field source', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'speaking-link-'))
  try {
    await writeJsonFile(path.join(rootDir, 'progress', 'speaking', 'sid-test1.json'), {
      id: 'sid-test1',
      createdAt: '2026-11-05T10:00:00.000Z',
      durationMs: 1000,
      topic: 'Cities',
      part: 3,
      mode: 'answer',
      answers: [
        { question: 'Q1?', answer: [{ text: 'Model answer.' }], structures: [], picks: [], wording: [], extras: [] },
        { question: 'Q2?', answer: [], structures: [], picks: [], wording: [], extras: [] },
      ],
      candidates: 5,
      usage: { model: 'claude', input: 10, output: 10, thinking: 0 },
    } satisfies SpeakingResult)

    const ctx = { rootDir, contentDir: rootDir, onContentChange: () => {} }
    const suggestions = await listSuggestions(ctx)
    assert.equal(suggestions.length, 1)
    assert.deepEqual(suggestions[0]!.questions, ['Q1?', 'Q2?'])
    assert.deepEqual(suggestions[0]!.answered, [true, false])

    await writeJsonFile(path.join(rootDir, 'progress', 'speaking-reviews', 'rev-test1.json'), {
      id: 'rev-test1',
      createdAt: '2026-11-06T10:00:00.000Z',
      durationMs: 500,
      part: 3,
      question: 'Q1?',
      topic: 'Cities',
      script: 'Model answer.',
      source: { suggestionId: 'sid-test1', answerIndex: 0, question: 'Q1?', withModel: true },
      audio: true,
      transcript: 'Model answer.',
      words: [],
      sentences: ['Model answer.'],
      correctedSentences: ['Model answer.'],
      corrected: 'Model answer.',
      fixes: [],
      warnings: [],
      fluency: {
        duration: 10,
        speech: 9,
        words: 20,
        wpm: 133,
        pauses: 0,
        longestPause: 0,
        fillerCount: 0,
        fillers: [],
        unclear: 0,
        sentenceLengths: [20],
      },
      criteria: {
        fc: { band: 6.5, summary: 'Good.', good: [], improve: [] },
        lr: { band: 6.5, summary: 'Good.', good: [], improve: [] },
        gra: { band: 6.5, summary: 'Good.', good: [], improve: [] },
        pron: { band: 6.5, summary: 'Good.', good: [], improve: [] },
      },
      overall: 6.5,
      reviewer: 'test',
    })

    const reviews = await listTalkReviews(ctx)
    assert.equal(reviews.length, 1)
    assert.deepEqual(reviews[0]!.source, {
      suggestionId: 'sid-test1',
      answerIndex: 0,
      question: 'Q1?',
    })
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})

