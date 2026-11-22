const FILE_PATH = /(?:^|[\s`"'([{])((?:\.\.?[/\\])?(?:[\w@.+-]+[/\\])*[\w@.+-]+\.(?:[a-zA-Z0-9]{1,12}))(?=$|[\s`"')\]},:;])/g;
const ACTION = /修改|改动|编辑|新增|新建|创建|删除|移除|更新|修复|写入|保存|重命名|移动|添加|替换|重构|更改|已改|已建|已删|已修|修改了|新增了|创建了|更新了|移除了|删除了|修复了|changed|change|modified|modify|edited|edit|created|create|added|add|deleted|delete|removed|remove|updated|update|fixed|fix|refactored|refactor|rewrote|rewrite|renamed|rename|moved|move|saved|save|wrote|write|implemented|implement|修补/i;
const DELETE = /删除|移除|已删|已删除|deleted|delete|removed|remove|renamed|rename/i;
const CREATE = /新增|新建|创建|添加|已建|created|create|added|add|wrote|write|implemented|implement/i;
const EXTENSIONS = new Set('js jsx ts tsx mjs cjs py go rs java c h cc cpp cs php rb vue svelte html htm css scss sass json jsonc yaml yml toml md mdx txt sh bash zsh ps1 bat cmd sql xml svg env ini cfg conf lock gradle properties swift kt dart'.split(' '));

export function normalizePath(value) {
  return value.replaceAll('\\', '/').replace(/^(?:\.\/)+/, '').replace(/\/+$/, '');
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
    const key = `${candidate.path}|${action}`;
    if (seen.has(key)) continue;
    seen.add(key);
    claims.push({ path: candidate.path, action, quote: context.trim().replace(/\s+/g, ' ').slice(0, 240) });
  }
  return claims;
}

function findArtifact(target, artifacts) {
  const exact = artifacts.filter((item) => normalizePath(item.path) === target);
  if (exact.length === 1) return { item: exact[0], match: 'exact' };
  if (exact.length > 1) return { ambiguous: exact.map((item) => item.path) };
  const basename = target.split('/').at(-1);
  const matches = artifacts.filter((item) => normalizePath(item.path).split('/').at(-1) === basename);
  if (matches.length === 1) return { item: matches[0], match: 'basename' };
  if (matches.length > 1) return { ambiguous: matches.map((item) => item.path) };
  return null;
}

export const MAX_HASH_BYTES = 50 * 1024 * 1024;

export function verify({ transcript, artifacts = [], projectFiles = null, gitChanges = null, gitBase = null }) {
  const claims = extractClaims(transcript);
  const results = claims.map((claim) => {
    if (/^(?:\/|[a-z]:)/i.test(claim.path) || claim.path.split('/').includes('..')) {
      return { ...claim, status: 'unverified', evidence: '请使用相对于所选项目根目录的文件路径' };
    }
    const artifact = findArtifact(claim.path, artifacts);
    const projectFile = projectFiles?.find((item) => normalizePath(item.path) === claim.path);
    const change = gitChanges?.find((item) => normalizePath(item.path) === claim.path);
    const row = { ...claim, artifactPath: artifact?.item?.path ?? null, projectPath: projectFile?.path ?? null, gitStatus: change?.status ?? null };
    const result = (status, evidence, extra) => ({ ...row, status, evidence, ...extra });
    if (claim.action === 'delete') {
      if (projectFile) return result('contradicted', '目标项目中该路径仍有文件');
      if (change?.status === 'D') return result('verified', `Git 基准差异显示文件已删除: ${change.path}`);
      return result('unverified', '缺少可确认删除的 Git 差异或项目基准');
    }
    if (projectFiles && !projectFile) return result('missing', '目标项目快照中没有声明路径的文件');
    if (artifact?.match === 'exact' && projectFile?.sha256 && artifact.item.sha256) {
      const hashes = { projectSha256: projectFile.sha256, artifactSha256: artifact.item.sha256 };
      if (hashes.projectSha256 === hashes.artifactSha256) return result('persisted-exact', '项目当前文件与同路径输出逐字节一致（SHA-256）', hashes);
      return result('content-differs', '项目当前文件与同路径 AI 输出的 SHA-256 不一致', hashes);
    }
    if (projectFile && (claim.action === 'create' ? change?.status === 'A' : /^(M|T)$/.test(change?.status ?? ''))) {
      return result('verified', `相对于 Git 基准检测到 ${change.status} 变更: ${change.path}；未证实输出内容一致`);
    }
    if (artifact?.ambiguous) return result('ambiguous', `存在多个可能匹配的产物: ${artifact.ambiguous.join(', ')}`);
    if (projectFile) {
      const reason = artifact?.match === 'basename' ? '仅找到同名产物，路径不一致' : artifact ? '未取得可比对的文件哈希' : '缺少同路径输出文件';
      return result('present-not-proven-changed', `目标路径存在；${reason}`);
    }
    if (artifact) {
      return result('artifact-present', `在所提供的 AI 输出文件中找到${artifact.match === 'basename' ? '（仅文件名匹配）' : ''}: ${artifact.item.path}`);
    }
    return result('missing', '未在所提供的输出文件中找到该路径');
  });
  const statusNames = ['persisted-exact', 'content-differs', 'verified', 'artifact-present', 'present-not-proven-changed', 'missing', 'contradicted', 'ambiguous', 'unverified'];
  const counts = Object.fromEntries(statusNames.map((key) => [key, results.filter((item) => item.status === key).length]));
  const summary = !claims.length
    ? '未识别到带明确文件路径的修改声明'
    : projectFiles !== null
      ? `内容一致 ${counts['persisted-exact']} 项；仅有 Git 变更证据 ${counts.verified} 项；内容不符 ${counts['content-differs']} 项；目标缺失 ${counts.missing} 项（共 ${claims.length} 项）`
      : `${counts['artifact-present']}/${claims.length} 项声明在所提供的输出文件中匹配；这不证明目标项目落盘`;
  return { claims: results, counts, summary, gitBase, limitations: ['只分析聊天中带明确文件路径的声明；自然语言解析可能漏报或误报。', '哈希一致证明采集时目标项目文件与输出文件逐字节一致，不证明是谁写入的。', '修改前的 Git 基准可以证明文件发生过变更或删除，但无法证明由哪个 AI 执行。', '不会判断代码逻辑正确性，也不会验证测试、构建或部署声明。'] };
}
