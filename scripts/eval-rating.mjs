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
  const { stdout } = await run('claude', args, { maxBuffer: 16 * 1024 * 1024, timeout: 120_000 })
  const reply = JSON.parse(stdout.slice(stdout.indexOf('{'))).result ?? ''
  return { reply, label: parseRating(reply) }
}

// ponytail: a fixed pool of 4 concurrent CLI runs; raise it if the set grows
const results = new Array(cases.length)
let next = 0
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next < cases.length) {
      const i = next++
      results[i] = { ...cases[i], ...(await rate(cases[i].prompt)) }
    }
  }),
)

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : 'n/a')
console.log(baseline ? 'Baseline: bare labels' : 'Rubric: RATER from hooks/register.ts')
for (const label of LABELS) {
  const of = results.filter(r => r.expected === label)
  const right = of.filter(r => r.label === label).length
  console.log(`${label.padEnd(13)} ${right}/${of.length}  ${pct(right, of.length)}`)
}
const right = results.filter(r => r.label === r.expected).length
console.log(`${'overall'.padEnd(13)} ${right}/${results.length}  ${pct(right, results.length)}`)
console.log(`no label     ${results.filter(r => !r.label).length}`)

// Rows are the expected rating, columns what the rater said.
const cols = [...LABELS, 'none']
console.log(`\n${'expected \\ got'.padEnd(15)}${cols.map(c => c.padStart(13)).join('')}`)
for (const label of LABELS) {
  const row = cols.map(c => results.filter(r => r.expected === label && (r.label ?? 'none') === c).length)
  console.log(`${label.padEnd(15)}${row.map(n => String(n).padStart(13)).join('')}`)
}

const wrong = results.filter(r => r.label !== r.expected)
if (wrong.length) console.log(`\nMisses:\n${wrong.map(r => `- [${r.expected} -> ${r.label ?? `none: ${JSON.stringify(r.reply.slice(0, 60))}`}] ${r.prompt}`).join('\n')}`)
