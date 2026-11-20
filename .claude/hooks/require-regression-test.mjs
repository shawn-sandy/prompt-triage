#!/usr/bin/env node
// PreToolUse hook for Bash. When the command is `git commit` and the staged
// changes include plugin or hook source code but no test file, exit 2 so the
// commit is blocked and Claude is asked for a regression test. Anything else
// exits 0. Plain Node, same as validate-plugin.mjs.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

// Windows resolves a bare program name in this process before a child starts, so
// the guard is set here too. git runs from the project directory, not the caller's.
if (process.platform === 'win32') process.env.NoDefaultCurrentDirectoryInExePath = '1';

const CODE_DIRS = ['plugins/', 'hooks/'];
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const GIT_COMMIT = /\bgit\s+commit\b/;

function realpath(path) {
  try {
    return realpathSync(resolve(path));
  } catch {
    return null;
  }
}

function stagedFiles(project) {
  try {
    const out = execFileSync('git', ['diff', '--cached', '--name-only', '-z'], {
      cwd: project,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\0').filter(Boolean);
  } catch {
    return [];
  }
}

// Returns the staged code files that lack a test, or an empty list when the commit passes.
function findUntestedCode(files) {
  const tests = files.filter((f) => TEST_FILE.test(f));
  const code = files.filter(
    (f) => CODE_EXT.test(f) && !TEST_FILE.test(f) && CODE_DIRS.some((d) => f.startsWith(d)),
  );
  return tests.length === 0 ? code : [];
}

function main(input, project) {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    return 0;
  }
  const command = payload?.tool_input?.command ?? '';
  if (!GIT_COMMIT.test(command)) return 0;

  const untested = findUntestedCode(stagedFiles(project));
  if (untested.length === 0) return 0;

  process.stderr.write(
    'Commit blocked: staged code has no regression test.\n' +
      untested.map((f) => `  ${f}`).join('\n') +
      '\nAdd a test that fails without the change and passes with it, stage it, then commit.\n',
  );
  return 2;
}

async function readStdin() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

const project = realpath(process.env.CLAUDE_PROJECT_DIR || '.');
process.exitCode = project ? main(await readStdin(), project) : 0;
