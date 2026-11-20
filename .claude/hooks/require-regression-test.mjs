#!/usr/bin/env node
// PreToolUse hook for Bash. When the command runs `git commit` and the commit
// includes plugin or hook source code but no test file that is still present,
// exit 2 so the commit is blocked and Claude is asked for a regression test.
// Anything else exits 0. Plain Node, same as validate-plugin.mjs.
//
// Staging inside the same command runs after this hook, so the hook widens its
// view to cover what that command will stage: `git commit -a` commits every
// tracked change, and `git add` / `git rm` / `git mv` can stage anything. For
// those compound commands the test must already be staged, because a test added
// in the same command cannot be seen before it runs.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

// Windows resolves a bare program name in this process before a child starts, so
// the guard is set here too. git runs from the project directory, not the caller's.
if (process.platform === 'win32') process.env.NoDefaultCurrentDirectoryInExePath = '1';

const CODE_DIRS = ['plugins/', 'hooks/'];
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const SHELL_SEPARATORS = /&&|\|\||;|\||&|\n/;
// Any command that mentions both git and commit is checked, even when the parser cannot model it.
const MENTIONS_GIT_COMMIT = /\bgit\b[\s\S]*\bcommit\b/;
// Shell syntax the word splitter does not model: subshells, braces, command substitution, backticks.
const UNMODELLED_SYNTAX = /[(){}`$]/;
const STAGING_SUBCOMMANDS = new Set(['add', 'stage', 'rm', 'mv']);
// Git global options that take a separate value argument.
const GLOBAL_OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env']);
const SHELLS = new Set(['sh', 'bash', 'zsh']);
// Programs that run another program. When one of these sits in a segment that names git and commit, the segment fails closed.
const WRAPPERS = new Set(['env', 'command', 'builtin', 'exec', 'nohup', 'nice', 'time', 'sudo', 'xargs']);
// Shell keywords that may precede a command.
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', 'time']);

function realpath(path) {
  try {
    return realpathSync(resolve(path));
  } catch {
    return null;
  }
}

// Split one shell segment into words, honouring single quotes, double quotes and backslashes.
function tokenize(segment) {
  const words = [];
  let current = null;
  let quote = null;
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (quote === '"' && ch === '\\' && i + 1 < segment.length) current += segment[(i += 1)];
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current = current ?? '';
      continue;
    }
    if (ch === '\\' && i + 1 < segment.length) {
      current = (current ?? '') + segment[(i += 1)];
      continue;
    }
    if (/\s/.test(ch)) {
      if (current !== null) words.push(current);
      current = null;
      continue;
    }
    current = (current ?? '') + ch;
  }
  if (current !== null) words.push(current);
  return words;
}

// Return the git subcommand and its arguments when the words are a git invocation.
function gitInvocation(words) {
  let i = 0;
  while (
    i < words.length &&
    (KEYWORDS.has(words[i]) ||
      WRAPPERS.has(words[i]) ||
      /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) ||
      (i > 0 && words[i].startsWith('-')))
  ) {
    i += 1;
  }
  // Accept an absolute or relative path to git, such as /usr/bin/git.
  if (i >= words.length || words[i].split(/[\\/]/).pop() !== 'git') return null;
  i += 1;
  while (i < words.length && words[i].startsWith('-')) {
    i += GLOBAL_OPTIONS_WITH_VALUE.has(words[i]) ? 2 : 1;
  }
  if (i >= words.length) return null;
  return { subcommand: words[i], args: words.slice(i + 1) };
}

// `-a`, `--all`, and combined short flags such as `-am` all make commit stage tracked changes.
function commitStagesTracked(args) {
  return args.some((a) => a === '--all' || (/^-[A-Za-z]+$/.test(a) && a.includes('a')));
}

// Find every git commit in the command, including inside `sh -c` and `eval`.
function analyze(command, flags = { commit: false, all: false, add: false }) {
  // Fail closed: a command that names git and commit alongside syntax this parser does not model is treated as a full commit.
  if (MENTIONS_GIT_COMMIT.test(command) && UNMODELLED_SYNTAX.test(command)) {
    return Object.assign(flags, { commit: true, all: true, add: true });
  }
  for (const segment of command.split(SHELL_SEPARATORS)) {
    const words = tokenize(segment);
    if (words.some((w) => WRAPPERS.has(w)) && words.includes('git') && words.includes('commit')) {
      return Object.assign(flags, { commit: true, all: true, add: true });
    }
    const inv = gitInvocation(words);
    if (inv && inv.subcommand === 'commit') {
      flags.commit = true;
      if (commitStagesTracked(inv.args)) flags.all = true;
    } else if (inv && STAGING_SUBCOMMANDS.has(inv.subcommand)) {
      flags.add = true;
    }
    const first = words.findIndex((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
    if (first >= 0 && SHELLS.has(words[first]) && words[first + 1] === '-c' && words[first + 2] !== undefined) {
      analyze(words[first + 2], flags);
    } else if (first >= 0 && words[first] === 'eval' && words.length > first + 1) {
      analyze(words.slice(first + 1).join(' '), flags);
    }
  }
  return flags;
}

function git(args, project) {
  try {
    return execFileSync('git', args, {
      cwd: project,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

// Parse `git ... --name-status -z` output. Renames and copies carry two paths.
function parseNameStatus(out) {
  const parts = out.split('\0').filter((p) => p !== '');
  const changes = [];
  for (let i = 0; i < parts.length; ) {
    const status = parts[i][0];
    i += 1;
    if (status === 'R' || status === 'C') {
      changes.push({ status, path: parts[i + 1] });
      i += 2;
    } else {
      changes.push({ status, path: parts[i] });
      i += 1;
    }
  }
  return changes;
}

// Return the code and test paths that the commit will include, given what it stages.
function changesFor(flags, project) {
  const staged = parseNameStatus(git(['diff', '--cached', '--name-status', '-z'], project));
  const unstaged = flags.all || flags.add
    ? parseNameStatus(git(['diff', '--name-status', '-z'], project))
    : [];
  const untracked = flags.add
    ? git(['ls-files', '--others', '--exclude-standard', '-z'], project)
        .split('\0')
        .filter(Boolean)
        .map((path) => ({ status: 'A', path }))
    : [];
  const code = [...staged, ...unstaged, ...untracked];
  const tests = [...staged, ...(flags.all ? unstaged : [])];
  return { code, tests };
}

const isLive = (change) => change.status !== 'D';
const isCode = (path) => CODE_EXT.test(path) && !TEST_FILE.test(path) && CODE_DIRS.some((d) => path.startsWith(d));

// Returns the code files that lack a test in the commit, or an empty list when the commit passes.
function findUntestedCode({ code, tests }) {
  const hasTest = tests.some((c) => isLive(c) && TEST_FILE.test(c.path));
  if (hasTest) return [];
  return code.filter((c) => isLive(c) && isCode(c.path)).map((c) => c.path);
}

function main(input, project) {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    return 0;
  }
  const command = payload?.tool_input?.command ?? '';
  const flags = analyze(command);
  if (!flags.commit) return 0;

  const untested = findUntestedCode(changesFor(flags, project));
  if (untested.length === 0) return 0;

  process.stderr.write(
    'Commit blocked: staged code has no regression test.\n' +
      [...new Set(untested)].map((f) => `  ${f}`).join('\n') +
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
