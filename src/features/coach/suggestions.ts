// The empty chat's suggestions, by the page that is open (Phase 3). Pure (tested).
const GENERAL = ['What mistakes do I make most often?', 'Which collocations in my last essay were unnatural?', 'What is left on my plan today?', 'Quiz me on 3 due flashcards']

/** Suggestions for the page that is open (Phase 3): the open review first, then the page's own topic. */
export function suggestionsFor(pathname: string, search: string): string[] {
  const id = new URLSearchParams(search).get('id')
  if (pathname === '/practice/writing-review' && id)
    return ['What are the biggest mistakes in this essay?', 'Which wording in this essay is unnatural?', 'What should I fix to get a higher band?', 'Add this essay’s mistakes to my reviews']
  if (pathname === '/practice/speaking-review' && id)
    return ['Which words did I mispronounce here?', 'What grammar mistakes did I make in this recording?', 'How can I raise my Speaking band?', 'Add this recording’s mistakes to my reviews']
  if (pathname.startsWith('/planner'))
    return ['What is left on my plan today?', 'Plan 3 Speaking practice tasks for next week', 'Move my overdue tasks to tomorrow', 'How much did I study this week?']
  if (pathname.startsWith('/review')) return ['Quiz me on 5 due flashcards', 'Which cards do I forget most?', 'How many cards are due this week?', GENERAL[0]]
  if (pathname.startsWith('/practice/mistakes')) return [GENERAL[0], 'Which mistakes do I repeat?', 'Make review cards from my repeated mistakes', 'What should I practise this week?']
  return GENERAL
}
