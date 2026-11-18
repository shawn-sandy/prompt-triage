import type { ModelEffort, TurnStepInput } from 'claude-code'
import { FLOOR, LEVELS, LOW_EFFORT, chosen, familyOf, keep, pickedModel, type Decision, type Rating } from './models.ts'

/**
 * The main loop's model and effort override, and the status line that names it. Changed only by the functions below.
 * `model` is the model the person picked; undefined leaves the session's own. `from` is the session's model the switch left, and
 * `sendAs` the picked model's full id, read once off the first main-loop request that named it, for retarget(). `effort` is the least effort the
 * main loop runs at, or with `exact` the effort it runs at; undefined leaves the session's own. `running` and `raised` are the status
 * line's parts: the model override, and the effort once a request was changed.
 */
export type Override = {
  model?: string
  from?: string
  sendAs?: string
  running?: string
  effort?: ModelEffort
  exact: boolean
  raised: boolean
}

/** The status line the override shows, or undefined when it shows none. */
export const overrideLine = (o: Override) =>
  [o.running, o.raised && o.effort && `effort ${o.exact ? 'lowered' : 'raised'} to ${o.effort}`].filter(Boolean).join(', ') || undefined

/** The main-loop model as the log names it: the override, or the session's own. */
export const onModel = (o: Override, current: string) => o.model ?? current

/**
 * Applies the person's answer to a model dialog: the effort the rating sets (or exactly low) and the model the answer names.
 * Returns the decision to log, and whether the status line changed and needs showing.
 */
export function decide(o: Override, rating: Rating, current: string, answer: string | undefined): { entry: Decision; status: boolean } {
  const chose = answer === undefined ? 'none asked' : chosen(answer, current)
  const from = onModel(o, current)
  // A prompt rated again (the improved one, say) replaces the minimum, so the status is shown afresh.
  o.exact = answer === LOW_EFFORT
  o.effort = o.exact ? 'low' : FLOOR[rating]
  let status = o.raised
  o.raised = false
  // The keep label names the session's model, so it is never read as free text naming one to switch to.
  const picked = answer === keep(current) ? undefined : pickedModel(answer)
  if (picked) {
    o.model = picked
    o.from = current
    o.sendAs = undefined
    // The app already prefixes the plugin's name; name the session's model too, since its picker still shows it.
    o.running = `running ${picked}, not ${current}`
    status = true
  }
  return { entry: { rating, from, to: onModel(o, current), chose }, status }
}

/**
 * Whether a main-loop request's effort is changed: below the minimum, or, with `exact`, any other level. Marks the line raised
 * the first time; `show` says the status line changed. ponytail: only named levels are compared; an integer budget, or a model
 * without effort, is left alone
 */
export function stepEffort(o: Override, level: TurnStepInput['effort']): { change: boolean; show: boolean } {
  const change =
    o.effort !== undefined && typeof level === 'string' && (o.exact ? level !== o.effort : LEVELS.indexOf(level) < LEVELS.indexOf(o.effort))
  const show = change && !o.raised
  if (show) o.raised = true
  return { change, show }
}

/** The person's own /model: the model override ends, any effort override stays. */
export function dropModel(o: Override): void {
  o.model = o.running = o.from = o.sendAs = undefined
}

/** The person's own /effort: the effort override ends, any model override stays. */
export function dropEffort(o: Override): void {
  o.effort = undefined
  o.exact = o.raised = false
}

/** Ends the whole override, as a /clear does; true when a status line was showing and now needs clearing. */
export function endOverride(o: Override): boolean {
  const showing = overrideLine(o) !== undefined
  dropModel(o)
  dropEffort(o)
  return showing
}

/**
 * The body to send an engine model request with instead, or undefined to send it as built. Claude Code builds its background
 * requests (compaction, /recap, prompt suggestions) on the session's own model and turn.step never sees them, so after a switch they
 * would cache the whole conversation again on the model the person left. A request on the left model's family is moved to the picked
 * model's full id, which the main loop's first request already carries (turn.step moved it); one on any other family is left alone.
 * This also moves a subagent that inherits the session's model, as a real /model would; Explore keeps its haiku (agent.spawn).
 * ponytail: matched by family, so an agent pinned to the left model's family moves too; a per-request origin would tell them apart.
 * ponytail: a session on haiku is never rewritten, since the engine runs its own small helper requests on haiku and the family cannot
 * tell them from background ones; those re-cache at haiku's price, the cheapest, so a switch up leaves them.
 */
export function retarget(o: Override, body: unknown): string | undefined {
  if (o.model === undefined || o.from === undefined || typeof body !== 'string') return undefined
  let request: { model?: unknown; tools?: unknown }
  try {
    request = JSON.parse(body)
  } catch {
    return undefined
  }
  const { model } = request
  if (typeof model !== 'string') return undefined
  const family = familyOf(model)
  if (family !== undefined && family === familyOf(o.model)) {
    // The first main-loop request names the id, and it stays: a later request in that family (an engine helper on an older id, a
    // subagent pinned to one) must not redirect background requests. Helpers carry no tools; the main loop always does.
    // ponytail: a main loop run with no tools never names one, so its background requests stay on the left model
    if (o.sendAs === undefined && Array.isArray(request.tools) && request.tools.length > 0) o.sendAs = model
    return undefined
  }
  const left = familyOf(o.from)
  if (o.sendAs === undefined || left === undefined || left === 'haiku' || family !== left) return undefined
  return JSON.stringify({ ...request, model: o.sendAs })
}
