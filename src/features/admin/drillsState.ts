const DRILL_FIELDS = ['use_prompts', 'dictation', 'paraphrase'] as const

/** True when the entry still waits for the nightly drills (a drill field is absent; see server/admin/drills-nightly.ts). */
export const lacksDrills = (entry: Record<string, unknown> | undefined) => Boolean(entry) && DRILL_FIELDS.some((f) => !Array.isArray(entry![f]))
