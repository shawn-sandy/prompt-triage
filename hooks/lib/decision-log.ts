import type { EngineInterface } from 'claude-code'
import { LOG, LOG_CAP, type Decision, type Rating, type Spend, type Tracked } from './models.ts'

/** The decisions the store holds, oldest first; an empty list when there are none or the read failed. */
export async function decisions($: EngineInterface): Promise<Decision[]> {
  const stored = await $.store.get(LOG).catch(() => undefined)
  return Array.isArray(stored) ? (stored as Decision[]) : []
}

/**
 * Appends one decision to the log, dropping the oldest past the cap. Rejects when the store does; callers never let that hold a prompt.
 * The read is not the forgiving `decisions()`: a read that fails must reject here, or the write would replace the whole log with one entry.
 * ponytail: read-then-write with no lock, so two sessions rating in the same few milliseconds can lose one entry; the store API has no
 * atomic update and the log is a tally, so that is accepted. A key per session, merged by /triage-stats, is the upgrade if it ever matters.
 */
export async function log($: EngineInterface, entry: Decision): Promise<void> {
  const stored = await $.store.get(LOG)
  const list = Array.isArray(stored) ? (stored as Decision[]) : []
  await $.store.set(LOG, [...list, entry].slice(-LOG_CAP))
}

/**
 * Logs a decision under a fresh id and reads the cost so far as its baseline; `turns0` is the prompts sent so far, the baseline for its turns. Never rejects: a failed log or read only
 * means less is tracked. Undefined when there is no cost baseline, since a cost cannot then be told apart from earlier spend.
 */
export async function record($: EngineInterface, entry: Decision, turns0: number | undefined): Promise<Tracked | undefined> {
  const id = crypto.randomUUID()
  const base = (await $.session.usage().catch(() => undefined))?.cost?.usd
  // UTC, so one session's date is the same on every machine.
  await log($, { ...entry, id, at: new Date().toISOString().slice(0, 10) }).catch(() => undefined)
  // `sent` starts at zero cost and prompts, so a turn that spent nothing writes neither and the session stays out of those averages.
  return base === undefined ? undefined : { id, base, turns0, sent: { cost: 0, prompts: 0 } }
}

/**
 * Sets these figures on the entry with this id; a figure given as `undefined` is removed from it. Never appends: an entry the cap pushed
 * out stays out. Rejects when the store does, and, like `log()`, a failed read rejects rather than writing back a list that lost other
 * sessions' entries.
 */
export async function amend($: EngineInterface, id: string, fields: Spend): Promise<void> {
  const stored = await $.store.get(LOG)
  const list = Array.isArray(stored) ? (stored as Decision[]) : []
  if (!list.some(d => d.id === id)) return
  const apply = (d: Decision): Decision => {
    const next: Decision = { ...d, ...fields }
    // Removed explicitly, so the entry is right whatever the store does with an undefined value.
    for (const key of Object.keys(fields) as (keyof Spend)[]) if (fields[key] === undefined) delete next[key]
    return next
  }
  await $.store.set(
    LOG,
    list.map(d => (d.id === id ? apply(d) : d)),
  )
}
