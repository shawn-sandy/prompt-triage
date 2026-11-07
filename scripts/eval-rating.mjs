#!/usr/bin/env node
/**
 * Scores the first-prompt rating against evals/rating-prompts.json, through `claude -p` so no API key is needed.
 *
 *   node scripts/eval-rating.mjs              the rubric the mod sends (RATER)
 *   node scripts/eval-rating.mjs --baseline   the bare labels, as the old classify call had them
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

// ponytail: a fixed pool of 6 concurrent CLI runs; 160 cases take a few minutes
// One call before the batch: a blocked or signed-out CLI then fails in 30 s with the cause, not after 160 timeouts.
try {
  await rate(cases[0].prompt)
} catch (e) {
  console.error(`Could not rate through claude -p: ${e.killed ? 'the call timed out after 30 s' : (e.stderr?.trim() || e.message)}`)
  console.error('A timeout usually means the sandbox blocked api.anthropic.com; allow that host (or run outside the sandbox) and try again.')
  process.exit(1)
}

const results = new Array(cases.length)
let next = 0
let done = 0
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (next < cases.length) {
      const i = next++
      // One call that fails or times out (a blocked network, say) is one miss with no label, not the end of the run.
      results[i] = { ...cases[i], ...(await rate(cases[i].prompt).catch(e => ({ reply: `error: ${e.killed ? 'timeout' : e.message}`, label: undefined }))) }
      // Progress on stderr, so a long run is visibly moving and the report on stdout stays clean to redirect.
      process.stderr.write(`\r${++done}/${cases.length} rated`)
    }
  }),
)
process.stderr.write('\n')

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : 'n/a')
/** The Wilson 95% interval for `k` of `n`, as "lo-hi%": where the true rate plausibly lies, so a score on few cases reads as the guess it is. */
function wilson(k, n, z = 1.96) {
  if (!n) return 'n/a'
  const p = k / n
  const d = 1 + (z * z) / n
  const centre = (p + (z * z) / (2 * n)) / d
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d
  return `${Math.round(100 * (centre - half))}-${Math.round(100 * (centre + half))}%`
}
console.log(baseline ? 'Baseline: bare labels' : 'Rubric: RATER from hooks/register.ts')
console.log(`${results.length} cases, ${LABELS.map(l => `${results.filter(r => r.expected === l).length} ${l}`).join(', ')}`)
for (const label of LABELS) {
  const of = results.filter(r => r.expected === label)
  const right = of.filter(r => r.label === label).length
  console.log(`${label.padEnd(13)} ${`${right}/${of.length}`.padEnd(7)} ${pct(right, of.length).padEnd(5)} 95% CI ${wilson(right, of.length)}`)
}
const right = results.filter(r => r.label === r.expected).length
console.log(`${'overall'.padEnd(13)} ${`${right}/${results.length}`.padEnd(7)} ${pct(right, results.length).padEnd(5)} 95% CI ${wilson(right, results.length)}`)
console.log(`no label     ${results.filter(r => !r.label).length}`)
const failed = results.filter(r => r.reply.startsWith('error:')).length
if (failed) console.log(`failed calls ${failed} (counted as no label; a timeout usually means the sandbox blocked api.anthropic.com)`)

// Rows are the expected rating, columns what the rater said.
const cols = [...LABELS, 'none']
console.log(`\n${'expected \\ got'.padEnd(15)}${cols.map(c => c.padStart(13)).join('')}`)
for (const label of LABELS) {
  const row = cols.map(c => results.filter(r => r.expected === label && (r.label ?? 'none') === c).length)
  console.log(`${label.padEnd(15)}${row.map(n => String(n).padStart(13)).join('')}`)
}

const wrong = results.filter(r => r.label !== r.expected)
if (wrong.length) console.log(`\nMisses:\n${wrong.map(r => `- [${r.expected} -> ${r.label ?? `none: ${JSON.stringify(r.reply.slice(0, 60))}`}] ${r.prompt}`).join('\n')}`)
