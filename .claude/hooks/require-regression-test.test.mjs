// Tests for require-regression-test.mjs. Each case builds a throwaway git repo
// under the system temp dir, stages files, and runs the hook with the same JSON
// payload Claude Code sends to a PreToolUse Bash hook.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = resolve(dirname(fileURLToPath(import.meta.url)), 'require-regression-test.mjs');
const created = [];

after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

function makeRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'regtest-'));
  created.push(dir);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  if (Object.keys(files).length > 0) {
    execFileSync('git', ['add', '--', ...Object.keys(files)], { cwd: dir });
  }
  return dir;
}

function runHook({ repo, command }) {
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
  return spawnSync(process.execPath, [HOOK], {
    input: payload,
    cwd: repo,
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
    encoding: 'utf8',
  });
}

const COMMIT = 'git commit -m "change"';

test('blocks a commit that stages code with no test', () => {
  const repo = makeRepo({ 'plugins/app/index.ts': 'export const x = 1;\n' });
  const result = runHook({ repo, command: COMMIT });
  assert.equal(result.status, 2);
  assert.notEqual(result.stderr.trim(), '');
});

test('allows a commit that stages code together with a test', () => {
  const repo = makeRepo({
    'plugins/app/index.ts': 'export const x = 1;\n',
    'plugins/app/index.test.ts': 'import "./index";\n',
  });
  const result = runHook({ repo, command: COMMIT });
  assert.equal(result.status, 0);
});

test('allows a docs-only commit', () => {
  const repo = makeRepo({ 'README.md': '# readme\n', 'docs/guide.md': 'guide\n' });
  const result = runHook({ repo, command: COMMIT });
  assert.equal(result.status, 0);
});

test('allows a tests-only commit', () => {
  const repo = makeRepo({ 'plugins/app/index.test.ts': 'import "./index";\n' });
  const result = runHook({ repo, command: COMMIT });
  assert.equal(result.status, 0);
});

test('blocks code staged under a path with spaces when no test is staged', () => {
  const repo = makeRepo({ 'plugins/my plugin/index.ts': 'export const y = 2;\n' });
  const result = runHook({ repo, command: COMMIT });
  assert.equal(result.status, 2);
});

test('ignores bash commands that are not git commit', () => {
  const repo = makeRepo({ 'plugins/app/index.ts': 'export const x = 1;\n' });
  const result = runHook({ repo, command: 'git status' });
  assert.equal(result.status, 0);
});

test('allows a commit with nothing staged', () => {
  const repo = makeRepo({});
  const result = runHook({ repo, command: COMMIT });
  assert.equal(result.status, 0);
});

function writeFiles(dir, files) {
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

function commitBaseline(dir, files) {
  writeFiles(dir, files);
  execFileSync('git', ['add', '--', ...Object.keys(files)], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'baseline'], { cwd: dir });
}

test('does not block a non-commit command that only mentions git commit', () => {
  const repo = makeRepo({ 'plugins/app/index.ts': 'export const x = 1;\n' });
  const result = runHook({ repo, command: 'echo git commit' });
  assert.equal(result.status, 0);
});

test('blocks a commit invoked with global git options', () => {
  const repo = makeRepo({ 'plugins/app/index.ts': 'export const x = 1;\n' });
  const result = runHook({ repo, command: 'git -C . commit -m change' });
  assert.equal(result.status, 2);
});

test('blocks a compound command that stages untested code before committing', () => {
  const repo = makeRepo({});
  writeFiles(repo, { 'plugins/app/index.ts': 'export const x = 1;\n' });
  const result = runHook({ repo, command: 'git add plugins/app/index.ts && git commit -m change' });
  assert.equal(result.status, 2);
});

test('blocks commit -am of modified tracked code without a test', () => {
  const repo = makeRepo({});
  commitBaseline(repo, { 'plugins/app/index.ts': 'export const x = 1;\n' });
  writeFiles(repo, { 'plugins/app/index.ts': 'export const x = 2;\n' });
  const result = runHook({ repo, command: 'git commit -am change' });
  assert.equal(result.status, 2);
});

test('does not count a deleted test as a regression test', () => {
  const repo = makeRepo({});
  commitBaseline(repo, {
    'plugins/app/index.ts': 'export const x = 1;\n',
    'plugins/app/index.test.ts': 'import "./index";\n',
  });
  writeFiles(repo, { 'plugins/app/index.ts': 'export const x = 2;\n' });
  execFileSync('git', ['add', '--', 'plugins/app/index.ts'], { cwd: repo });
  execFileSync('git', ['rm', '-q', '--', 'plugins/app/index.test.ts'], { cwd: repo });
  const result = runHook({ repo, command: COMMIT });
  assert.equal(result.status, 2);
});

test('blocks a commit inside a subshell', () => {
  const repo = makeRepo({ 'plugins/app/index.ts': 'export const x = 1;\n' });
  assert.equal(runHook({ repo, command: '(git commit -m x)' }).status, 2);
});

test('blocks a commit inside braces', () => {
  const repo = makeRepo({ 'plugins/app/index.ts': 'export const x = 1;\n' });
  assert.equal(runHook({ repo, command: '{ git commit -m x; }' }).status, 2);
});

test('blocks a commit inside command substitution', () => {
  const repo = makeRepo({ 'plugins/app/index.ts': 'export const x = 1;\n' });
  assert.equal(runHook({ repo, command: 'echo $(git commit -m x)' }).status, 2);
});

test('blocks a background staging command followed by a commit', () => {
  const repo = makeRepo({});
  writeFiles(repo, { 'plugins/app/index.ts': 'export const x = 1;\n' });
  const result = runHook({ repo, command: 'git add plugins/app/index.ts & git commit -m x' });
  assert.equal(result.status, 2);
});

test('blocks a commit run through env', () => {
  const repo = makeRepo({ 'plugins/app/index.ts': 'export const x = 1;\n' });
  assert.equal(runHook({ repo, command: 'env git commit -m x' }).status, 2);
});

test('blocks a commit run through an absolute git path', () => {
  const repo = makeRepo({ 'plugins/app/index.ts': 'export const x = 1;\n' });
  assert.equal(runHook({ repo, command: '/usr/bin/git commit -m x' }).status, 2);
});

test('blocks a commit after a shell keyword', () => {
  const repo = makeRepo({ 'plugins/app/index.ts': 'export const x = 1;\n' });
  assert.equal(runHook({ repo, command: 'if true; then git commit -m x; fi' }).status, 2);
});

test('blocks a commit passed through xargs', () => {
  const repo = makeRepo({ 'plugins/app/index.ts': 'export const x = 1;\n' });
  assert.equal(runHook({ repo, command: 'echo -- | xargs git commit -m x' }).status, 2);
});

test('allows code staged together with a modified existing test', () => {
  const repo = makeRepo({});
  commitBaseline(repo, {
    'plugins/app/index.ts': 'export const x = 1;\n',
    'plugins/app/index.test.ts': 'import "./index";\n',
  });
  writeFiles(repo, {
    'plugins/app/index.ts': 'export const x = 2;\n',
    'plugins/app/index.test.ts': 'import "./index"; // updated\n',
  });
  execFileSync('git', ['add', '--', 'plugins/app'], { cwd: repo });
  const result = runHook({ repo, command: COMMIT });
  assert.equal(result.status, 0);
});
