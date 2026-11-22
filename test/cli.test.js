import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, unlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'claimcheck.js');
const gitAvailable = spawnSync('git', ['--version']).status === 0;

test('CLI verifies actual added, modified, and deleted Git paths', { skip: !gitAvailable }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'claimcheck-'));
  try {
    const project = path.join(temp, 'project');
    const artifacts = path.join(temp, 'artifacts');
    await mkdir(path.join(project, 'src'), { recursive: true });
    await mkdir(artifacts);
    const source = path.join(project, 'src', 'app.js');
    await writeFile(source, 'const initial = true;');
    const git = (...args) => {
      const result = spawnSync('git', ['-C', project, ...args], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    };
    git('init', '-q'); git('config', 'user.email', 'claimcheck@example.invalid'); git('config', 'user.name', 'ClaimCheck Test');
    git('add', '.'); git('commit', '-qm', 'baseline');

    await writeFile(source, 'const changed = true;');
    await writeFile(path.join(project, 'src', 'new.js'), 'export {};');
    await writeFile(path.join(project, 'src', 'space name.js'), 'export const named = true;');
    await writeFile(path.join(artifacts, 'result.js'), 'const changed = true;');
    const chatPath = path.join(temp, 'chat.md');
    await writeFile(chatPath, '已修改 `src/app.js`，并新增 `src/new.js` 和 `src/space name.js`');
    const run = () => spawnSync(process.execPath, [cli, '--chat', chatPath, '--artifacts', artifacts, '--project', project, '--base', 'HEAD', '--json'], { encoding: 'utf8' });
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).claims.map((item) => item.status), ['verified', 'verified', 'verified']);

    await writeFile(chatPath, '已删除 `src/app.js`');
    await unlink(source);
    result = run();
    assert.equal(result.status, 0, result.stderr);
    const statuses = JSON.parse(result.stdout).claims.map((item) => item.status);
    assert.deepEqual(statuses, ['verified']);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
