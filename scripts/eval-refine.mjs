#!/usr/bin/env node
/**
 * Checks that the refine reviewer asks nothing the agent could find out itself, against evals/refine-prompts.json,
 * through `claude -p` so no API key is needed.
 *
 *   node scripts/eval-refine.mjs            each case 5 times
 *   node scripts/eval-refine.mjs --runs 10  each case 10 times, since one run varies: the unfixed reviewer asked the RELEASING.md
 *                                           case's forbidden question in 4 of 10 runs, so a few runs can all come back clean
 *
 * A case passes a run when no question's first line and no issue line matches its `forbid` pattern, and, if it has a
 * `require` pattern, at least one such line matches it. The rewrite is not read.
 * Imports REVIEWER from the mod, so it scores the exact text sent, with the pickers at their defaults.
 * ponytail: the patterns name questions seen in past runs, so a new phrasing of the same mistake slips past; add its pattern to the case.
 */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { REVIEWER } from '../hooks/register.ts'

const run = promisify(execFile)
const at = process.argv.indexOf('--runs')
const runs = at === -1 ? 5 : Number(process.argv[at + 1])
// Plain digits only, as in eval-rating.mjs: Number() would also take 1e21 or 0x2.
if (at !== -1 && !/^[1-9]\d?$/.test(process.argv[at + 1] ?? '')) {
  console.error('--runs takes a whole number from 1 to 99, such as --runs 3')
  process.exit(1)
}
const cases = JSON.parse(await readFile(new URL('../evals/refine-prompts.json', import.meta.url), 'utf8'))

/** One review through the CLI at the mod's model, from a folder with no repo, as the mod's call has none; the reply text. */
async function review(prompt) {
  const args = [
    '-p', '--model', 'haiku', '--tools', '', '--no-session-persistence', '--output-format', 'json',
    '--setting-sources', 'project,local', '--strict-mcp-config', '--disable-slash-commands',
    '--system-prompt', REVIEWER, `<user_prompt>\n${prompt}\n</user_prompt>`,
  ]
  const env = { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' }
  const { stdout } = await run('claude', args, { env, cwd: tmpdir(), maxBuffer: 16 * 1024 * 1024, timeout: 60_000 })
  const out = JSON.parse(stdout.slice(stdout.indexOf('{')))
  const reply = out.result ?? ''
  // An error payload or a reply with neither tag asked nothing, so it would pass vacuously; fail the script instead.
  if (out.is_error || !/<(issues|question)>/.test(reply)) throw new Error(`no review in the reply: ${reply.slice(0, 200)}`)
  return reply
}

/** What the reviewer puts to the person or lists as a problem: each question's first line and each issue line. */
function asked(reply) {
  const questions = [...reply.matchAll(/<question>\s*([^\n]*)/g)].map(m => m[1])
  const issues = (reply.match(/<issues>([\s\S]*?)<\/issues>/)?.[1] ?? '').split('\n').map(l => l.trim()).filter(Boolean)
  return [...questions, ...issues]
}

let failed = false
for (const { prompt, forbid, require } of cases) {
  const replies = await Promise.all(Array.from({ length: runs }, () => review(prompt)))
  // forbid: lines that must not appear. require: at least one line must match, so a reviewer gone silent fails.
  const hits = replies.map(r => {
    const lines = asked(r)
    const bad = forbid ? lines.filter(line => new RegExp(forbid, 'i').test(line)) : []
    if (require && !lines.some(line => new RegExp(require, 'i').test(line))) bad.push(`(nothing matched require /${require}/)`)
    return bad
  })
  const bad = hits.filter(h => h.length).length
  console.log(`${bad ? 'FAIL' : 'ok  '} ${runs - bad}/${runs} runs clean: ${prompt.slice(0, 70)}`)
  for (const line of hits.flat()) console.log(`       asked: ${line}`)
  if (bad) failed = true
}
process.exit(failed ? 1 : 0)
