export interface WritingMockPrompt {
  id: number
  prompt: string
  type: string
  topics: string[]
}

export interface WritingMockTopics {
  types: string[]
  topics: string[]
}

/* ───────────── Writing Task 1 ───────────── */

/** One Task 1 question (content/practice/writing-mock/task1-prompts.json). It comes without a chart picture. */
export interface WritingTask1Prompt {
  /** "bar-001": the prefix does not always match the chart type (filter by `chart_type`). */
  id: string
  /** Source title, often with the exam date ("… ngày 04/01/2025 …"). */
  title: string
  prompt: string
  /** Bar Chart, Line, Pie Chart, Table, Mixed. */
  chart_type: string
  type_key: string
  /** Compare + Trend, Compare, Mix. */
  type_name: string
}

/** /data/practice/writing-mock/task1-prompts.json */
export interface WritingTask1Index {
  prompts: WritingTask1Prompt[]
  chartTypes: string[]
  typeNames: string[]
}

/** A chart picture the learner added to a question. */
export interface WritingTask1Image {
  /** Never reused within a question. */
  n: number
  url: string
  width: number
  height: number
  addedAt: string
}

/** What the learner added to a question: chart pictures and their own model essay. */
export interface WritingTask1Extras {
  promptId: string
  images: WritingTask1Image[]
  modelEssay?: { text: string; updatedAt: string }
}

/** Per question with something added: how many pictures, whether it has a model essay. */
export type WritingTask1ExtrasMap = Record<string, { images: number; hasModel: boolean }>

export const TASK1_PROMPT_ID = /^[a-z]+-\d{3}$/
export const TASK1_MAX_IMAGES = 4
export const TASK1_MAX_MODEL_CHARS = 6000
