// Work done while the learner writes: when an attempt starts ("Bắt đầu"), the chart is read and the model essay's
// vocabulary is picked in the background, so grading 25 minutes later finds both in the store and only has to score.
// Both are shared with a review that starts before they finish (no second agent call).
import { writingReviewEngineAvailable, writingReviewModel } from '../writing-review/llm.ts'
import { chartReading } from '../writing-review/task1.ts'
import { modelVocabFor } from '../writing-review/task1-model.ts'
import { checkPromptId, promptText, savedModelEssay, type Task1Context } from './store.ts'

/** Starts the chart reading and the model-essay vocabulary of a question in the background. */
export async function prepareTask1(ctx: Task1Context, value: unknown): Promise<{ started: boolean }> {
  const id = await checkPromptId(ctx, value)
  if (!writingReviewEngineAvailable()) return { started: false }
  const llm = writingReviewModel()
  const prompt = await promptText(ctx, id)
  void chartReading(ctx, llm, id, prompt).catch((error: Error) => console.warn(`[writing-task1] ${id}: chart reading failed: ${error.message}`))
  const model = await savedModelEssay(ctx, id)
  if (model?.text.trim()) {
    void modelVocabFor(ctx, llm, { promptId: id, model: model.text, prompt }).catch((error: Error) =>
      console.warn(`[writing-task1] ${id}: model vocabulary failed: ${error.message}`),
    )
  }
  return { started: true }
}
