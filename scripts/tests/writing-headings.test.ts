// Pasted essays: heading lines are left out of a review; the Vietnamese outline keeps years and bold headings whole.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isHeadingLine, stripHeadingLines } from '../../src/features/practice/writing-review/headings.ts'
import { normalizeVietnameseOutline } from '../../server/writing-review/service.ts'
import { splitParagraphs } from '../../server/writing-review/rewrite.ts'
import { countWords } from '../../server/writing-review/score.ts'

// The bar-027 answer as it was pasted.
const pasted =
  '**Introduction**\n\nThe bar chart illustrates the amount of carbon emissions produced by three kinds of fossil fuels in the United Kingdom between 1990 and 2010.\n\n**Overview**\n\nOverall, the carbon emissions of all three fuels remained relatively stable, except for a temporary fluctuation in 1995. Coal was always the biggest emission source.\n\n**Body Paragraph 1**\n\nIn 1990, coal produced approximately 320 million tons of carbon emissions.\n\n**Body Paragraph 2**\n\nIn 1995, gas emissions increased sharply to 280 million tons.'

test('heading lines are dropped, paragraphs kept', () => {
  const text = stripHeadingLines(pasted)
  assert.doesNotMatch(text, /Introduction|Overview\*|Body Paragraph/)
  const { sentences, paragraphStarts } = splitParagraphs(text)
  assert.equal(sentences[0], 'The bar chart illustrates the amount of carbon emissions produced by three kinds of fossil fuels in the United Kingdom between 1990 and 2010.')
  assert.equal(sentences.length, 5)
  assert.deepEqual(paragraphStarts, [1, 3, 4])
  // Introduction, Overview, Body Paragraph 1, Body Paragraph 2: 8 words that are not the essay's.
  assert.equal(countWords(text), countWords(pasted) - 8)
})

test('what counts as a heading line', () => {
  for (const h of ['**Introduction**', '## Overview', 'Body Paragraph 1:', '**Body 2**', 'Conclusion', '**Đoạn 1: Mở bài (Introduction)**', '*', '**Main features**'])
    assert.equal(isHeadingLine(h), true, h)
  for (const s of ['Overall, coal was the largest source.', '**Overall, coal was the largest source.**', 'In 2000, the figures were 220 and 270.', 'Introduction of new rules led to a fall in emissions.'])
    assert.equal(isHeadingLine(s), false, s)
})

test('the Vietnamese outline keeps a year at the end of a sentence and bold headings whole', () => {
  const raw = '**Đoạn 1: Mở bài (Introduction)**\nBiểu đồ cột từ năm 1990 đến năm 2010.\n**Đoạn 2: Tổng quan (Overview)**\nNhìn chung ổn định. 1. Than cao nhất 2. Dầu thứ hai\n- khí đốt thấp nhất'
  const out = normalizeVietnameseOutline(raw)!
  assert.match(out, /đến năm 2010\./)
  assert.match(out, /\*\*Đoạn 1: Mở bài \(Introduction\)\*\*/)
  assert.match(out, /\n\n1\. Than cao nhất\n\n2\. Dầu thứ hai\n\n- khí đốt/)
})
