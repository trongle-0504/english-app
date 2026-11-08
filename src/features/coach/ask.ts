// "Ask Coach about this": any page can open the Coach with a question (CoachButton listens). Tiny on purpose: pages
// import it without loading the chat.
export const COACH_ASK_EVENT = 'coach:ask'

export interface CoachAsk {
  text: string
  /** Send at once (default) or only put the text in the box. */
  send?: boolean
}

export function askCoach(text: string, send = true): void {
  window.dispatchEvent(new CustomEvent<CoachAsk>(COACH_ASK_EVENT, { detail: { text, send } }))
}
