#!/usr/bin/env node
// PostToolUse hook for Write and Edit. When the edited file is in a worktree of
// the same repository as CLAUDE_PROJECT_DIR and that worktree is a plugin, run
// `claude plugin validate .` there. A validation failure exits 2 so the
// validator output reaches Claude. Anything else exits 0 without output.
// Plain Node, so it runs the same under PowerShell on Windows and under POSIX shells.
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const isWindows = process.platform === 'win32';

// Run a command and return its trimmed stdout, or null when it fails.
function capture(cmd, args, cwd) {
  try {
    return execFileSync(cmd, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: isWindows,
    }).trim();
  } catch {
    return null;
  }
}

function realpath(path) {
  try {
    return realpathSync(resolve(path));
  } catch {
    return null;
  }
}

function gitValue(args, cwd) {
  return capture('git', args, cwd);
}

async function readStdin() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

function main(input) {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    return 0;
  }
  const file = payload?.tool_input?.file_path ?? payload?.tool_response?.filePath;
  if (!file) return 0;

  const fileAbs = realpath(file);
  if (!fileAbs) return 0;

  // Only validate when claude is on PATH. Without it there is nothing to run.
  if (capture(isWindows ? 'where' : 'which', ['claude'], undefined) === null) return 0;

  const project = realpath(process.env.CLAUDE_PROJECT_DIR || '.');
  if (!project) return 0;

  const top = gitValue(['rev-parse', '--show-toplevel'], dirname(fileAbs));
  if (!top) return 0;

  const common = gitValue(['rev-parse', '--path-format=absolute', '--git-common-dir'], top);
  const projectCommon = gitValue(['rev-parse', '--path-format=absolute', '--git-common-dir'], project);
  if (!common || common !== projectCommon) return 0;

  if (!existsSync(join(top, '.claude-plugin', 'plugin.json'))) return 0;

  try {
    execFileSync('claude', ['plugin', 'validate', '.'], {
      cwd: top,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isWindows,
    });
  } catch (error) {
    process.stderr.write(`${error.stdout ?? ''}${error.stderr ?? ''}`.trim() || String(error.message));
    process.stderr.write('\n');
    return 2;
  }
  return 0;
}

const code = main(await readStdin());
process.exitCode = code;
