import test from 'node:test';
import assert from 'node:assert/strict';
import { extractClaims, verify, normalizePath, splitRequirements } from '../src/analyzer.js';

test('extracts English and Chinese file modification claims', () => {
  const claims = extractClaims('Modified `src/main.ts` and 新增 `tests/main.test.ts`。');
  assert.deepEqual(claims.map((item) => [item.path, item.action]), [['src/main.ts', 'modify'], ['tests/main.test.ts', 'create']]);
});
test('ignores file mentions without a nearby action', () => assert.deepEqual(extractClaims('See `src/main.ts` for details.'), []));
test('supports paths containing spaces in inline code', () => {
  assert.equal(extractClaims('Updated `src/my file.js`')[0].path, 'src/my file.js');
});
test('does not treat planned or negated work as a completed claim', () => {
  assert.deepEqual(extractClaims('Will update `src/main.ts` later.\nI did not modify `src/other.ts`.\n尚未修复 `src/bug.ts`。'), []);
});
test('matches exact artifact path and reports artifact-only evidence honestly', () => {
  const report = verify({ transcript: '已修改 `src/main.ts`', artifacts: [{ path: 'src/main.ts', size: 20 }] });
  assert.equal(report.claims[0].status, 'artifact-present');
  assert.match(report.summary, /不证明目标项目落盘/);
});
test('confirms current project persistence by matching file hashes', () => {
  const sha256 = 'a'.repeat(64);
  const report = verify({
    transcript: '已修改 `src/app.js`',
    artifacts: [{ path: 'src/app.js', sha256 }],
    projectFiles: [{ path: 'src/app.js', sha256 }],
  });
  assert.equal(report.claims[0].status, 'persisted-exact');
});
test('flags same-path project content that differs from the supplied output', () => {
  const report = verify({
    transcript: '已修改 `src/app.js`',
    artifacts: [{ path: 'src/app.js', sha256: 'a'.repeat(64) }],
    projectFiles: [{ path: 'src/app.js', sha256: 'b'.repeat(64) }],
  });
  assert.equal(report.claims[0].status, 'content-differs');
});
test('does not use basename or directory suffixes as proof of persistence', () => {
  const transcript = '已修改 `src/app.js`';
  const report = verify({
    transcript,
    artifacts: [{ path: 'archive/src/app.js', sha256: 'a'.repeat(64) }],
    projectFiles: [{ path: 'other/src/app.js', sha256: 'a'.repeat(64) }],
  });
  assert.equal(report.claims[0].status, 'missing');
  assert.notEqual(report.claims[0].status, 'persisted-exact');
});
test('exact project paths beat basename matches in nested directories', () => {
  const report = verify({
    transcript: '已修改 `src/app.js`',
    artifacts: [{ path: 'src/app.js', sha256: 'a'.repeat(64) }],
    projectFiles: [{ path: 'src/app.js', sha256: 'a'.repeat(64) }, { path: 'archive/app.js', sha256: 'b'.repeat(64) }],
  });
  assert.equal(report.claims[0].status, 'persisted-exact');
});
test('project snapshot proves absence even if a similarly named artifact exists', () => {
  const report = verify({
    transcript: '已修改 `src/app.js`',
    artifacts: [{ path: 'src/app.js', sha256: 'a'.repeat(64) }],
    projectFiles: [{ path: 'archive/src/app.js', sha256: 'a'.repeat(64) }],
  });
  assert.equal(report.claims[0].status, 'missing');
});
test('reports missing output files', () => assert.equal(verify({ transcript: 'Created `src/new.js`' }).claims[0].status, 'missing'));
test('only verifies a deletion when Git reports it', () => {
  const input = { transcript: 'Deleted `src/old.js`', projectFiles: [] };
  assert.equal(verify(input).claims[0].status, 'unverified');
  assert.equal(verify({ ...input, gitChanges: [{ status: 'D', path: 'src/old.js' }] }).claims[0].status, 'verified');
});
test('detects contradictory claims when a deleted path still exists', () => {
  const report = verify({ transcript: '删除 `src/old.js`', projectFiles: [{ path: 'src/old.js' }] });
  assert.equal(report.claims[0].status, 'contradicted');
});
test('reports basename ambiguity rather than guessing', () => {
  const report = verify({ transcript: 'Updated `src/app.js`', artifacts: [{ path: 'one/app.js' }, { path: 'two/app.js' }] });
  assert.equal(report.claims[0].status, 'ambiguous');
});
test('normalizes Windows separators', () => assert.equal(normalizePath('src\\a.js'), 'src/a.js'));

test('splits original requests into separate checklist items', () => {
  assert.deepEqual(splitRequirements('修复登录验证。\n- 新增单元测试\n2. 更新 README'), [
    { id: 1, text: '修复登录验证。' },
    { id: 2, text: '新增单元测试' },
    { id: 3, text: '更新 README' },
  ]);
});
test('requirement mention is only a text clue, never a completion verdict', () => {
  const report = verify({
    request: '修复登录验证。新增单元测试。',
    transcript: '已修复登录验证，新增单元测试。',
  });
  assert.equal(report.requirements.length, 2);
  assert.ok(report.requirements.every((item) => item.status === 'mentioned'));
  assert.ok(report.requirements.every((item) => /不证明要求已实现/.test(item.evidence)));
  assert.match(report.repairPrompt, /用户原始要求/);
  assert.match(report.repairPrompt, /运行相关测试/);
});
test('repair prompt flags an omitted requirement and includes missing file evidence', () => {
  const report = verify({
    request: '新增登录审计日志。\n更新 README 使用说明。',
    transcript: '新增 `src/audit.js`。',
    artifacts: [],
  });
  assert.equal(report.requirements[1].status, 'not-mentioned');
  assert.match(report.repairPrompt, /回复中未明显提及/);
  assert.ok(report.repairPrompt.includes('src/audit.js'));
  assert.match(report.repairPrompt, /更新 README 使用说明/);
});
