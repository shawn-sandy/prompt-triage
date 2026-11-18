import type { EngineInterface, PromptSubmitInput } from 'claude-code'

/** Origins of deliveries the person did not send: a background task, a schedule, another session or agent, a follow-up the app queued. */
export const DELIVERED: ReadonlySet<string> = new Set([
  'task-notification',
  'scheduled-trigger',
  'peer',
  'peer-send-message',
  'projects-relay',
  'coordinator',
  'observer',
  'observer-activity',
  'auto-continuation',
])

/**
 * Whether a submission is a prompt the person sent, for the status row and the first-prompt check: not a slash command, a hidden
 * prompt, a delivery, or a plugin's message in its own name. Their own words from any surface (a phone, Slack, the desktop) count.
 */
export const isSent = (e: PromptSubmitInput) =>
  !e.command && !e.isMeta && !DELIVERED.has(e.origin.kind) && !(e.origin.kind === 'plugin' && !e.origin.asUser)

/**
 * The transcript's user turns plus those compactions summarized away: the prompts sent so far, as a conversation's count is first read.
 * It also holds each slash command's record, so the mod reads it once and counts sends from there. Never rejects: undefined when the
 * read fails, so the count stays unknown and is read again, rather than kept as zero. Callers assign with `sent ??= n` after the await
 * and only while the same conversation is open, so a count another hook set meanwhile (a send, a /clear) wins and an ended one's is dropped.
 */
export function readPrompts($: EngineInterface, compacted: number): Promise<number | undefined> {
  return $.session.turns().then(
    n => n + compacted,
    () => undefined,
  )
}

/**
 * The prompts the person sent this conversation, for the status row and the first-prompt check. Changed only by the functions below.
 * `sent` is undefined until read; the transcript's user turns also hold each slash command's record, so it is seeded once and counted
 * from there. `compacted` is the user turns compactions summarized away, since turns() counts only those left in the transcript.
 * `era` counts conversations, so a count read that began in an ended conversation is not kept for the next.
 * `activeMs` is the run time of the main loop's turns since the conversation began, for the status row's active time.
 * ponytail: seeded once from turns() (startup, a reload, /resume), so a resumed conversation's earlier commands still count there
 * ponytail: `activeMs` is in memory only, so /resume and a mod reload restart it at zero; $.store is shared by every session, so it cannot hold it
 */
export type Count = { sent: number | undefined; compacted: number; era: number; activeMs: number }

/** A run time as the status row shows it: `42s`, `19m 38s`, `1h 5m`. */
export function duration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`
}

/** Reads the prompt count when it is unknown; a read that fails leaves it unknown, and one that outlived its conversation is dropped. */
export async function seedCount($: EngineInterface, c: Count): Promise<void> {
  if (c.sent !== undefined) return
  const at = c.era
  const n = await readPrompts($, c.compacted)
  // `??=`: a count another hook set meanwhile (a send, a /clear) wins.
  if (c.era === at) c.sent ??= n
}

/** Counts one prompt the person sent that entered the session, and redraws the row so it shows the new count now. */
export function countSent($: EngineInterface, c: Count): void {
  if (c.sent === undefined) return
  c.sent++
  $.ui.invalidate('ui.render')
}

/** Ends the conversation's count: /clear starts an empty one at zero; /resume and /branch move to one whose count is read afresh. */
export function endCount(c: Count, cleared: boolean): void {
  c.compacted = 0
  c.activeMs = 0
  c.sent = cleared ? 0 : undefined
  c.era++
}
