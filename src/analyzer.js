const FILE_PATH = /(?:^|[\s`"'([{])((?:\.\.?[/\\])?(?:[\w@.+-]+[/\\])*[\w@.+-]+\.(?:[a-zA-Z0-9]{1,12}))(?=$|[\s`"')\]},:;])/g;
const ACTION = /修改|改动|编辑|新增|新建|创建|删除|移除|更新|修复|写入|保存|重命名|移动|添加|替换|重构|更改|已改|已建|已删|已修|修改了|新增了|创建了|更新了|移除了|删除了|修复了|changed|change|modified|modify|edited|edit|created|create|added|add|deleted|delete|removed|remove|updated|update|fixed|fix|refactored|refactor|rewrote|rewrite|renamed|rename|moved|move|saved|save|wrote|write|implemented|implement|修补/i;
const DELETE = /删除|移除|已删|已删除|deleted|delete|removed|remove|renamed|rename/i;
const CREATE = /新增|新建|创建|添加|已建|created|create|added|add|wrote|write|implemented|implement/i;
const EXTENSIONS = new Set('js jsx ts tsx mjs cjs py go rs java c h cc cpp cs php rb vue svelte html htm css scss sass json jsonc yaml yml toml md mdx txt sh bash zsh ps1 bat cmd sql xml svg env ini cfg conf lock gradle properties swift kt dart'.split(' '));

export function normalizePath(value) {
  return value.replaceAll('\\', '/').replace(/^(?:\.\/)+/, '').replace(/^\/+/, '').replace(/\/+$/, '');
}

function pathCandidates(text) {
  const found = [];
  for (const match of text.matchAll(/`([^`\r\n]+\.[a-zA-Z0-9]{1,12})`/g)) {
    const raw = match[1].trim();
    const ext = raw.split('.').at(-1)?.toLowerCase();
    if (ext && EXTENSIONS.has(ext)) found.push({ path: normalizePath(raw), index: match.index + 1 });
  }
  for (const match of text.matchAll(FILE_PATH)) {
    const raw = match[1].replace(/[.,;:!?]+$/, '');
    const ext = raw.split('.').at(-1)?.toLowerCase();
    const index = match.index + match[0].indexOf(match[1]);
    if (ext && EXTENSIONS.has(ext) && !/^https?:/i.test(raw) && !found.some((item) => index >= item.index && index < item.index + item.path.length)) found.push({ path: normalizePath(raw), index });
  }
  return found.sort((a, b) => a.index - b.index);
}

function classify(snippet, pathOffset) {
  const actionPattern = new RegExp(ACTION.source, 'gi');
  const actions = [...snippet.matchAll(actionPattern)];
  const nearest = actions.sort((a, b) => Math.abs(a.index - pathOffset) - Math.abs(b.index - pathOffset))[0]?.[0] ?? '';
  if (DELETE.test(nearest)) return 'delete';
  if (CREATE.test(nearest)) return 'create';
  return 'modify';
}

function hasNegationOrFuture(context, pathOffset) {
  const actions = [...context.matchAll(new RegExp(ACTION.source, 'gi'))];
  const nearest = actions.sort((a, b) => Math.abs(a.index - pathOffset) - Math.abs(b.index - pathOffset))[0];
  if (!nearest) return false;
  const prefix = context.slice(Math.max(0, nearest.index - 28), nearest.index);
  return /(?:未能|并未|没有|尚未|还没|不会|并没有|未)\s*$/.test(prefix)
    || /\b(?:not|never|didn't|hasn't|haven't|wasn't|weren't)(?:\s+\w+){0,2}\s*$/i.test(prefix)
    || /(?:将|会|计划|打算)\s*$/.test(prefix)
    || /\b(?:will|would|plan to|planned to|going to|intend to)\s*$/i.test(prefix);
}

export function extractClaims(transcript) {
  const claims = [];
  const seen = new Set();
  for (const candidate of pathCandidates(transcript)) {
    const context = transcript.slice(Math.max(0, candidate.index - 120), Math.min(transcript.length, candidate.index + candidate.path.length + 120));
    if (!ACTION.test(context)) continue;
    if (hasNegationOrFuture(context, candidate.index - Math.max(0, candidate.index - 120))) continue;
    const action = classify(context, candidate.index - Math.max(0, candidate.index - 120));
    const key = `${candidate.path.toLowerCase()}|${action}`;
    if (seen.has(key)) continue;
    seen.add(key);
    claims.push({ path: candidate.path, action, quote: context.trim().replace(/\s+/g, ' ').slice(0, 240) });
  }
  return claims;
}

function findArtifact(path, artifacts) {
  const target = normalizePath(path).toLowerCase();
  const exact = artifacts.find((item) => normalizePath(item.path).toLowerCase() === target);
  if (exact) return { item: exact, match: 'exact' };
  const basename = target.split('/').at(-1);
  const matches = artifacts.filter((item) => normalizePath(item.path).toLowerCase().split('/').at(-1) === basename);
  if (matches.length === 1) return { item: matches[0], match: 'basename' };
  if (matches.length > 1) return { ambiguous: matches.map((item) => item.path) };
  return null;
}

export function verify({ transcript, artifacts = [], projectFiles = null, gitChanges = null }) {
  const claims = extractClaims(transcript);
  const results = claims.map((claim) => {
    const artifact = findArtifact(claim.path, artifacts);
    const projectFile = projectFiles?.find((item) => normalizePath(item.path).toLowerCase() === claim.path.toLowerCase());
    const change = gitChanges?.find((item) => normalizePath(item.path).toLowerCase() === claim.path.toLowerCase());
    if (claim.action === 'delete') {
      if (change?.status === 'D') return { ...claim, status: 'verified', evidence: `Git 基准差异显示文件已删除: ${change.path}` };
      if (projectFile?.exists) return { ...claim, status: 'contradicted', evidence: '目标项目中该文件仍存在' };
      return { ...claim, status: 'unverified', evidence: '缺少可确认删除的 Git 差异或项目基准' };
    }
    if (change && /^(A|M|R|C|T)/.test(change.status)) return { ...claim, status: 'verified', evidence: `相对于 Git 基准检测到 ${change.status} 变更: ${change.path}` };
    if (artifact) {
      if (artifact.ambiguous) return { ...claim, status: 'ambiguous', evidence: `存在多个同名产物: ${artifact.ambiguous.join(', ')}` };
      return { ...claim, status: 'artifact-present', evidence: `在所提供的 AI 输出文件中找到${artifact.match === 'basename' ? '（仅文件名匹配）' : ''}: ${artifact.item.path}` };
    }
    if (projectFile?.exists) return { ...claim, status: 'present-not-proven-changed', evidence: '目标项目中存在该文件，但相对于所选 Git 基准未检测到变更' };
    return { ...claim, status: 'missing', evidence: '未在所提供的输出文件或项目中找到该路径' };
  });
  const statusNames = ['verified', 'artifact-present', 'present-not-proven-changed', 'missing', 'contradicted', 'ambiguous', 'unverified'];
  const counts = Object.fromEntries(statusNames.map((key) => [key, results.filter((item) => item.status === key).length]));
  const summary = !claims.length
    ? '未识别到带明确文件路径的修改声明'
    : gitChanges !== null
      ? `${counts.verified}/${claims.length} 项声明由 Git 差异直接核实`
      : `${counts['artifact-present']}/${claims.length} 项声明在所提供的输出文件中匹配；这不证明目标项目落盘`;
  return { claims: results, counts, summary, limitations: ['只分析聊天中带明确文件路径的声明；自然语言解析可能漏报或误报。', '输出文件匹配只能证明产物存在，不能单独证明已写入目标项目。', '未提供 Git 基准时，无法验证删除或区分旧文件与本次修改。', '不会判断代码逻辑正确性，也不会验证测试、构建或部署声明。'] };
}
