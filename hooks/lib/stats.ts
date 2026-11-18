import { LEVELS, LOG_CAP, LOW_EFFORT, NEW_SESSION, RANK, SUGGEST, rank, type Decision, type Rating } from './models.ts'

/** A decision's tier direction: 1 up, -1 down, 0 none; undefined for a change between names the mod cannot rank. */
export const direction = (d: Decision) => {
  // A switch is a change of tier where both ends rank ("use opus" on claude-opus-5-5 is none); unrankable names compare as text.
  const [a, b] = [rank(d.from), rank(d.to)]
  return a === undefined || b === undefined ? (d.to === d.from ? 0 : undefined) : Math.sign(b - a)
}
export const KINDS = ['switched', 'low effort', 'kept', 'hand-off'] as const
/** The class a decision's cost is averaged under; the raw `chose` names the model, which would split "kept" into many rows. */
export const kind = (d: Decision): (typeof KINDS)[number] =>
  d.chose === NEW_SESSION ? 'hand-off' : d.chose === LOW_EFFORT ? 'low effort' : direction(d) !== 0 ? 'switched' : 'kept'
/** Dollars at two places, or four under a cent so a cheap session does not read as $0.00. */
export const usd = (n: number) => `$${n.toFixed(n < 0.01 ? 4 : 2)}`

/**
 * The log as a markdown tally: for each rating, how many sessions it rated, how many of those switched model, and of the switches
 * how many went up to a pricier tier and how many down to a cheaper one (by RANK; a pair the mod cannot rank counts as neither).
 */
export function tally(list: Decision[], since?: string): string {
  if (!list.length)
    return since ? `No decisions logged since ${since}.` : 'No decisions logged yet. The mod logs one each time it rates a first prompt.'
  const rows = (Object.keys(SUGGEST) as Rating[]).map(rating => {
    const of = list.filter(d => d.rating === rating)
    const switched = of.filter(d => direction(d) !== 0)
    return `| ${rating} | ${of.length} | ${switched.length} | ${switched.filter(d => direction(d) === 1).length} | ${switched.filter(d => direction(d) === -1).length} |`
  })
  const counts = `${list.length} decision${list.length === 1 ? '' : 's'} logged${since ? ` since ${since}` : ''} (the newest ${LOG_CAP} are kept).\n\n| Rating | Rated | Switched model | Up (pricier) | Down (cheaper) |\n| --- | --- | --- | --- | --- |\n${rows.join('\n')}`
  const tables: string[] = []
  const costed = list.filter(d => typeof d.cost === 'number')
  if (costed.length) {
    const costs = (Object.keys(SUGGEST) as Rating[]).flatMap(rating =>
      KINDS.flatMap(k => {
        const of = costed.filter(d => d.rating === rating && kind(d) === k)
        return of.length ? [`| ${rating} | ${k} | ${of.length} | ${usd(of.reduce((sum, d) => sum + d.cost!, 0) / of.length)} |`] : []
      }),
    )
    tables.push(
      `Average cost of a session after its decision, in US dollars:\n\n| Rating | Choice | Sessions | Average cost |\n| --- | --- | --- | --- |\n${costs.join('\n')}`,
    )
  }
  // The article's method: plot the outcome against spend. Only an entry with both an effort and a cost can say what an effort level cost.
  const efforted = list.filter(d => typeof d.effort === 'string' && typeof d.cost === 'number')
  const levels = (Object.keys(SUGGEST) as Rating[]).flatMap(rating =>
    LEVELS.flatMap(level => {
      const of = efforted.filter(d => d.rating === rating && d.effort === level)
      return of.length ? [`| ${rating} | ${level} | ${of.length} | ${usd(of.reduce((sum, d) => sum + d.cost!, 0) / of.length)} |`] : []
    }),
  )
  if (levels.length) {
    tables.push(
      `Average cost of a session by the effort its latest request ran at, in US dollars:\n\n| Rating | Effort | Sessions | Average cost |\n| --- | --- | --- | --- |\n${levels.join('\n')}`,
    )
  }
  // Each average counts only the entries that have its figure, and the count beside it says how many that was.
  const mean = (of: Decision[], key: 'prompts' | 'ctx') => of.map(d => d[key]).filter((n): n is number => typeof n === 'number')
  const usage = (Object.keys(SUGGEST) as Rating[]).flatMap(rating => {
    const of = list.filter(d => d.rating === rating)
    const [prompts, ctx] = [mean(of, 'prompts'), mean(of, 'ctx')]
    const avg = (ns: number[], show: (n: number) => string) => (ns.length ? show(ns.reduce((a, b) => a + b, 0) / ns.length) : '-')
    return prompts.length || ctx.length
      ? [`| ${rating} | ${avg(prompts, n => n.toFixed(1))} | ${prompts.length} | ${avg(ctx, n => `${n.toFixed(0)}%`)} | ${ctx.length} |`]
      : []
  })
  if (usage.length) {
    tables.push(
      `Average prompts sent, and average share of the context window used, at the end of a session's latest turn:\n\n| Rating | Average prompts | Sessions | Average context used | Sessions |\n| --- | --- | --- | --- | --- |\n${usage.join('\n')}`,
    )
  }
  return tables.length ? `${counts}\n\n${tables.join('\n\n')}\n\nSessions differ in task, so this shows association, not cause.` : counts
}

/** The date `/triage-stats since` takes: a real calendar date in ISO form, so a misread one cannot print a confident, wrong comparison. */
export function isoDate(text: string): boolean {
  const date = new Date(`${text}T00:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text)
}
