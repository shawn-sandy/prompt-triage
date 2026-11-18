import type { ModelEffort } from 'claude-code'

// Each rating and the model alias it suggests.
export const SUGGEST = { simple: 'haiku', moderate: 'sonnet', complex: 'opus', 'long-running': 'fable' } as const
export type Rating = keyof typeof SUGGEST
// The least effort each rating runs at; simple leaves the session's own. Medium is at or below the defaults the model-selection post gives
// (Opus 5.5 medium; Fable 5.2 medium in Claude Code), so the minimum only catches effort the person lowered by hand.
export const FLOOR: Record<Rating, ModelEffort | undefined> = { simple: undefined, moderate: 'medium', complex: 'medium', 'long-running': 'medium' }
export const LEVELS: readonly ModelEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']
// The two ratings that want the strongest model, so one already at or above the suggestion fits.
export const STRONG: readonly Rating[] = ['complex', 'long-running']
// ponytail: long-running is the only rating whose suggestion sits two tiers above the next rating's, and the rater's
// measured misses over-rate complex as long-running, so it alone offers the tier below as a one-click correction.
// Upgrade path: if a later eval shows another rating over-rating, give that one a step down too.
export const STEP_DOWN: Partial<Record<Rating, string>> = { 'long-running': SUGGEST.complex }

export const ALIASES = ['haiku', 'sonnet', 'opus', 'fable'] as const
// Model families by strength; Mythos ranks with Fable.
export const RANK: Record<string, number> = { haiku: 0, sonnet: 1, opus: 2, fable: 3, mythos: 3 }
/** The model's rank, or undefined for a name that holds no known family, such as "Default (recommended)". */
export const rank = (model: string) => Object.entries(RANK).find(([family]) => model.toLowerCase().includes(family))?.[1]
/** The model's family, a RANK key, or undefined; unlike rank() it tells apart families that share a tier (Fable and Mythos). */
export const familyOf = (model: string) => Object.keys(RANK).find(family => model.toLowerCase().includes(family))
/** A tier gap in words, for the dialog; RANK spans 0 to 3, so a gap never passes three. */
export const COUNT = ['zero', 'one', 'two', 'three']

/** What each rating says it would take, said in the dialog beside the rating so the suggestion is read with its reason. */
export const SIZE: Record<Rating, string> = {
  simple: 'haiku or low effort would do',
  moderate: 'a sonnet-sized task',
  complex: 'an opus-sized task, and opus at medium effort is the recommended default for one',
  'long-running': 'a fable-sized job',
}
/** The dialog's keep option names the model it keeps, so the choice reads without translating "current". */
export const keep = (model: string) => `Keep ${model}`
/** The switch option's label; opus says its effort, since the mod holds a medium floor for it and keeps any higher level the session has. */
export const switchTo = (alias: string) => `Switch to ${alias}${alias === 'opus' ? ' (medium effort or higher)' : ''}`
export const LOW_EFFORT = 'Keep model, effort low'
export const NEW_SESSION = 'Open in a new session'
export const REFINE = 'Refine prompt'
export const HANDOFF =
  'The user chose to run this task in a new session. Start one with the start_session tool ' +
  '(initiation "user_asked", context "fresh"), using the prompt above as its brief plus a short written plan of the task ' +
  '(the files involved and the steps in order), so the new session starts from the plan and does not redo your reading. Do not do the task here.'

/**
 * One logged decision: the rating, the main-loop model before and after, and the option chosen. `id` is random and links to nothing
 * (not the session id, which names the transcript file); it lets a later turn find the entry. `cost` is US dollars spent since the decision,
 * `prompts` the prompts sent since it, `ctx` the context window's percent used at the latest turn's end, and `effort` the effort level
 * the latest main-loop request ran at. `at` is the UTC date (YYYY-MM-DD) the decision was logged, so /triage-stats can split a tally at a release.
 */
export type Decision = {
  rating: Rating
  from: string
  to: string
  chose: string
  id?: string
  cost?: number
  prompts?: number
  /** Transcript turns since the decision, slash commands' records included, as entries logged before `prompts` hold. Not tallied. */
  turns?: number
  ctx?: number
  effort?: ModelEffort
  at?: string
}
/** The figures a turn records on a decision's entry. */
export type Spend = Pick<Decision, 'cost' | 'prompts' | 'ctx' | 'effort'>
/**
 * The entry this session last logged, with the session's cost and turn count when it did, so a turn can record what followed.
 * `sent` holds what was last written to the entry; `turns0` is the session's prompt count when it was logged, absent when it could not be read.
 */
export type Tracked = { id: string; base: number; turns0?: number; sent: Spend }

/**
 * The answer as the log records it: an offered label as is, and free text under "Other" as `other`, with the model alias it named
 * when it named one. The text itself is never stored: it can carry anything the person typed. The keep label is matched exactly,
 * since a model name can hold spaces ("Default (recommended)") and typed text such as "Keep opus" switches to opus.
 */
export function chosen(answer: string, current: string): string {
  // The log keeps the label without its effort note, so entries from before the note still read the same.
  if (answer === switchTo('opus')) return 'Switch to opus'
  if ([LOW_EFFORT, NEW_SESSION, REFINE, keep(current)].includes(answer) || /^Switch to (?:haiku|sonnet|opus|fable)$/.test(answer)) return answer
  const picked = pickedModel(answer)
  return picked ? `other: ${picked}` : 'other'
}

/** The model alias an answer names, or undefined: the label chosen, or free text under "Other" such as "use sonnet". */
export function pickedModel(answer: string | undefined): string | undefined {
  // Text naming two models ("not haiku, use opus") is ambiguous, so it switches nothing.
  const said = answer?.toLowerCase() ?? ''
  const named = ALIASES.filter(alias => said.includes(alias))
  // ponytail: any no-word switches nothing, so "no, use opus" is missed too; /model covers that, and a wrong switch is worse
  const turnedDown = /\b(?:no|not|don't|dont|never|avoid|without)\b/.test(said)
  return named.length === 1 && !turnedDown ? named[0] : undefined
}
