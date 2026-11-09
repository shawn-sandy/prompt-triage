#!/usr/bin/env node
/**
 * Scores the first-prompt rating against evals/rating-prompts.json, through `claude -p` so no API key is needed.
 *
 *   node scripts/eval-rating.mjs              the rubric the mod sends (RATER)
 *   node scripts/eval-rating.mjs --baseline   the bare labels, as the old classify call had them
 *   node scripts/eval-rating.mjs --runs 3     rate every case 3 times and report the mean, since one run varies by a few cases
 *
 * Imports RATER and parseRating from the mod itself (Node 24 strips the type-only imports), so it scores the exact
 * text the mod sends. The CLI adds its own identity block, so scores are close to the mod's call, not identical.
 * User settings, MCP servers and skills are turned off so an installed prompt-triage cannot rate the eval's own prompts.
 */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { RATER, parseRating } from '../hooks/register.ts'

const run = promisify(execFile)
const LABELS = ['simple', 'moderate', 'complex', 'long-running']
const BASELINE = `Classify the text into exactly one of these labels: ${LABELS.join(', ')}. Reply with the label only.`
const baseline = process.argv.includes('--baseline')
const system = baseline ? BASELINE : RATER
// Repeat runs average out the model's own variation: the same rubric has scored a class 34/40 on one run and 36/40 on the next.
// ponytail: capped at 20 runs (3,200 paid calls, about an hour); raise MAX_RUNS if a comparison ever needs more
const MAX_RUNS = 20
const at = process.argv.findIndex(a => a === '--runs' || a.startsWith('--runs='))
const raw = at === -1 ? '1' : process.argv[at].startsWith('--runs=') ? process.argv[at].slice('--runs='.length) : process.argv[at + 1]
// Plain digits only: Number() would also take 1e21, 0x2 and 5.0, and a value too large for an array crashes after a paid call.
if (!/^[1-9]\d*$/.test(raw ?? '') || Number(raw) > MAX_RUNS) {
  console.error(`--runs takes a whole number from 1 to ${MAX_RUNS}, such as --runs 3`)
  process.exit(1)
}
const runs = Number(raw)

const cases = JSON.parse(await readFile(new URL('../evals/rating-prompts.json', import.meta.url), 'utf8'))

/** One rating through the CLI, at the same model and effort as the mod's call; the label parsed from the reply, or undefined. */
async function rate(prompt) {
  const args = [
    '-p', '--model', 'haiku', '--effort', 'low', '--tools', '', '--no-session-persistence', '--output-format', 'json',
    '--setting-sources', 'project,local', '--strict-mcp-config', '--disable-slash-commands',
    '--system-prompt', system, `<user_prompt>\n${prompt}\n</user_prompt>`,
  ]
  // Telemetry, update checks and the like are off: in a sandbox that blocks their hosts each call otherwise waits on them
  // (measured 3.8 s a call against 1.1 s without), and the eval needs only the model reply.
  const env = { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' }
  // A real call takes 1-4 s; a blocked network hangs, and 30 s is long enough to tell the two apart.
  const { stdout } = await run('claude', args, { env, maxBuffer: 16 * 1024 * 1024, timeout: 30_000 })
  const reply = JSON.parse(stdout.slice(stdout.indexOf('{'))).result ?? ''
  return { reply, label: parseRating(reply) }
}

// ponytail: a fixed pool of 6 concurrent CLI runs; 160 cases take a few minutes per run
// One call before the batch: a blocked or signed-out CLI then fails in 30 s with the cause, not after 160 timeouts.
try {
  await rate(cases[0].prompt)
} catch (e) {
  console.error(`Could not rate through claude -p: ${e.killed ? 'the call timed out after 30 s' : (e.stderr?.trim() || e.message)}`)
  console.error('A timeout usually means the sandbox blocked api.anthropic.com; allow that host (or run outside the sandbox) and try again.')
  process.exit(1)
}

// results[run][i] is case i's rating on that run; every run rates the cases in the same order.
const results = Array.from({ length: runs }, () => new Array(cases.length))
const total = cases.length * runs
let next = 0
let done = 0
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (next < total) {
      const j = next++
      const run = Math.floor(j / cases.length)
      const i = j % cases.length
      // One call that fails or times out (a blocked network, say) is one miss with no label, not the end of the run.
      results[run][i] = { ...cases[i], ...(await rate(cases[i].prompt).catch(e => ({ reply: `error: ${e.killed ? 'timeout' : e.message}`, label: undefined }))) }
      // Progress on stderr, so a long run is visibly moving and the report on stdout stays clean to redirect.
      process.stderr.write(`\r${++done}/${total} rated`)
    }
  }),
)
process.stderr.write('\n')
const all = results.flat()

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : 'n/a')
/** A mean count, whole when it is whole and to one decimal otherwise, so a single run prints exactly as before. */
const num = n => (Number.isInteger(n) ? String(n) : n.toFixed(1))
/** The count right on each run, for the cases `pick` selects. */
const perRun = pick => results.map(run => run.filter(r => pick(r) && r.label === r.expected).length)
const mean = counts => counts.reduce((a, b) => a + b, 0) / counts.length
/** The Wilson 95% interval for `k` of `n`, as "lo-hi%": where the true rate plausibly lies, so a score on few cases reads as the guess it is. */
function wilson(k, n, z = 1.96) {
  if (!n) return 'n/a'
  const p = k / n
  const d = 1 + (z * z) / n
  const centre = (p + (z * z) / (2 * n)) / d
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d
  return `${Math.round(100 * (centre - half))}-${Math.round(100 * (centre + half))}%`
}
console.log(`${baseline ? 'Baseline: bare labels' : 'Rubric: RATER from hooks/register.ts'}${runs > 1 ? `, mean of ${runs} runs` : ''}`)
console.log(`${cases.length} cases, ${LABELS.map(l => `${cases.filter(c => c.expected === l).length} ${l}`).join(', ')}`)
/**
 * One summary line: the mean count right, its percentage, the Wilson interval and, over several runs, each run's count.
 * The interval is taken on the mean over `n` cases, not over n × runs calls: rating one prompt again is not a fresh
 * sample, so counting every call would make the interval look narrower than it is.
 */
function line(name, counts, n) {
  const k = mean(counts)
  const each = runs > 1 ? `  runs ${counts.join(', ')}` : ''
  console.log(`${name.padEnd(13)} ${`${num(k)}/${n}`.padEnd(7)} ${pct(k, n).padEnd(5)} 95% CI ${wilson(k, n)}${each}`)
}
for (const label of LABELS) line(label, perRun(r => r.expected === label), cases.filter(c => c.expected === label).length)
line('overall', perRun(() => true), cases.length)
const of = runs > 1 ? ` of ${total} calls` : ''
console.log(`no label     ${all.filter(r => !r.label).length}${of}`)
const failed = all.filter(r => r.reply.startsWith('error:')).length
if (failed) console.log(`failed calls ${failed}${of} (counted as no label; a timeout usually means the sandbox blocked api.anthropic.com)`)

// Rows are the expected rating, columns what the rater said, summed over every run.
const cols = [...LABELS, 'none']
console.log(`\n${'expected \\ got'.padEnd(15)}${cols.map(c => c.padStart(13)).join('')}${runs > 1 ? `  (summed over ${runs} runs)` : ''}`)
for (const label of LABELS) {
  const row = cols.map(c => all.filter(r => r.expected === label && (r.label ?? 'none') === c).length)
  console.log(`${label.padEnd(15)}${row.map(n => String(n).padStart(13)).join('')}`)
}

// One line per case missed on any run, with every wrong answer it got and, over several runs, how often it was missed.
const got = r => r.label ?? `none: ${JSON.stringify(r.reply.slice(0, 60))}`
const missed = cases
  .map((c, i) => ({ c, wrong: results.map(run => run[i]).filter(r => r.label !== r.expected) }))
  .filter(m => m.wrong.length)
if (missed.length) {
  const rows = missed.map(({ c, wrong }) => `- [${c.expected} -> ${[...new Set(wrong.map(got))].join(', ')}]${runs > 1 ? ` (${wrong.length}/${runs} runs)` : ''} ${c.prompt}`)
  console.log(`\nMisses:\n${rows.join('\n')}`)
}
