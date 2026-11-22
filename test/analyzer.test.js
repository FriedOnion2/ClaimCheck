import test from 'node:test';
import assert from 'node:assert/strict';
import { extractClaims, verify, normalizePath } from '../src/analyzer.js';

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
test('reports missing output files', () => assert.equal(verify({ transcript: 'Created `src/new.js`' }).claims[0].status, 'missing'));
test('only verifies a deletion when Git reports it', () => {
  const input = { transcript: 'Deleted `src/old.js`', projectFiles: [] };
  assert.equal(verify(input).claims[0].status, 'unverified');
  assert.equal(verify({ ...input, gitChanges: [{ status: 'D', path: 'src/old.js' }] }).claims[0].status, 'verified');
});
test('detects contradictory claims when a deleted path still exists', () => {
  const report = verify({ transcript: '删除 `src/old.js`', projectFiles: [{ path: 'src/old.js', exists: true }] });
  assert.equal(report.claims[0].status, 'contradicted');
});
test('reports basename ambiguity rather than guessing', () => {
  const report = verify({ transcript: 'Updated `src/app.js`', artifacts: [{ path: 'one/app.js' }, { path: 'two/app.js' }] });
  assert.equal(report.claims[0].status, 'ambiguous');
});
test('normalizes Windows separators', () => assert.equal(normalizePath('src\\a.js'), 'src/a.js'));
