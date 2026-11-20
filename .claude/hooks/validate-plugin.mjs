#!/usr/bin/env node
// PostToolUse hook for Write and Edit. When the edited file is in a worktree of
// the same repository as CLAUDE_PROJECT_DIR and that worktree is a plugin, run
// `claude plugin validate .` there. A validation failure exits 2 so the
// validator output reaches Claude. Anything else exits 0 without output.
// Plain Node, so it runs the same under PowerShell on Windows and under POSIX shells.
//
// Every lookup runs with the trusted project directory as its working directory,
// never the edited file's folder, so a planted git or claude in that folder is not
// picked up. The validator runs by absolute path in the target worktree.
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const isWindows = process.platform === 'win32';
// NoDefaultCurrentDirectoryInExePath stops Windows from resolving a bare program
// name (node, git, claude) from the working directory, which is the edited worktree.
const CHILD_ENV = { ...process.env, NoDefaultCurrentDirectoryInExePath: '1' };
const CAPTURE = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: CHILD_ENV };

// Run a command with no shell and return its trimmed stdout, or null on failure.
function capture(cmd, args, cwd) {
  try {
    return execFileSync(cmd, args, { ...CAPTURE, cwd }).trim();
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

// Find the absolute path of claude, searched from the trusted project directory.
// A path with cmd metacharacters is refused, so it never reaches the shell below.
function findClaude(project) {
  const found = capture(isWindows ? 'where' : 'which', ['claude'], project);
  const path = found ? found.split(/\r?\n/)[0].trim() : null;
  return path && !/["&|<>^%!]/.test(path) ? path : null;
}

// Run `claude plugin validate .` in `top` by absolute path. Windows .cmd shims
// need the shell, so the path is quoted; no bare name is resolved from `top`.
function validate(claudePath, top) {
  const options = { cwd: top, ...CAPTURE, stdio: ['ignore', 'pipe', 'pipe'] };
  if (isWindows && /\.(cmd|bat)$/i.test(claudePath)) {
    execSync(`"${claudePath}" plugin validate .`, options);
  } else {
    execFileSync(claudePath, ['plugin', 'validate', '.'], options);
  }
}

async function readStdin() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

function main(input, project) {
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

  const claudePath = findClaude(project);
  if (!claudePath) return 0;

  const top = capture('git', ['-C', dirname(fileAbs), 'rev-parse', '--show-toplevel'], project);
  if (!top) return 0;

  const common = capture('git', ['-C', top, 'rev-parse', '--path-format=absolute', '--git-common-dir'], project);
  const projectCommon = capture('git', ['-C', project, 'rev-parse', '--path-format=absolute', '--git-common-dir'], project);
  if (!common || common !== projectCommon) return 0;

  if (!existsSync(join(top, '.claude-plugin', 'plugin.json'))) return 0;

  try {
    validate(claudePath, top);
  } catch (error) {
    process.stderr.write(`${error.stdout ?? ''}${error.stderr ?? ''}`.trim() || String(error.message));
    process.stderr.write('\n');
    return 2;
  }
  return 0;
}

const project = realpath(process.env.CLAUDE_PROJECT_DIR || '.');
process.exitCode = project ? main(await readStdin(), project) : 0;
