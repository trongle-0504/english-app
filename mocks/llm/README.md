# Agent answer fixtures (unit tests)

Recorded-style answers of the Writing Task 1 agent calls, used by the unit tests with a fake `LlmProvider`
(`scripts/tests/writing-task1-score.test.ts`, `scripts/tests/writing-task1-model.test.ts`). The app never reads them.

| File | Call (label) | Schema |
|---|---|---|
| `writing-review-task1-chart.json` | `task1 chart` | `ChartReadSchema` (`server/writing-review/task1.ts`) |
| `writing-review-task1-score.json` | `task1 score` | `Task1ScoreSchema` (`server/writing-review/task1.ts`) |
| `writing-review-task1-compare.json` | `task1 compare` | `CompareSchema` (`server/writing-review/task1-model.ts`) |
| `writing-review-task1-vocab.json` | `task1 vocab` | `ModelVocabSchema` (`server/writing-review/task1-model.ts`) |

They are written for the sample in `mocks/samples/task1/README.md` (question `bar-001`, its chart, model essay and
answer): every quote in them is copied from those texts, sentence numbers follow the answer's sentences. If you change a
schema or the sample, update these files so the tests' "fixtures match their schemas" checks still pass.
