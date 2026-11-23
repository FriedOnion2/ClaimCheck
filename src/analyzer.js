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

const REQUIREMENT_STOPWORDS = new Set('the and for with from that this into your you are was were will would should must have has had can could able make implement support ensure include use using build create update modify add remove delete fix test tests all any each when where what user requirement requirements feature functionality'.split(' '));
const CJK_FILLER = new Set('用户 要求 需要 希望 请帮 帮我 完成 实现 进行 支持 相关 功能 这个 那个 项目 代码 文件 能够 可以 必须 以及 并且 其中 之后 之前'.split(' '));

export function splitRequirements(request) {
  const chunks = request
    .split(/\r?\n+/)
    .flatMap((line) => line.replace(/^\s*(?:(?:[-*•]+)|(?:\d+[.)、]))\s*/, '').split(/(?<=[。！？；!?])\s*/))
    .map((item) => item.trim().replace(/^\s*[-*•]+\s*/, ''))
    .filter((item) => item.length >= 5);
  return [...new Set(chunks)].slice(0, 80).map((text, index) => ({ id: index + 1, text }));
}

function requirementTerms(text) {
  const latin = [...text.toLowerCase().matchAll(/[a-z][a-z0-9_+#.-]{2,}/g)]
    .map(([word]) => word)
    .filter((word) => !REQUIREMENT_STOPWORDS.has(word));
  const cjk = [];
  for (const run of text.matchAll(/[\u3400-\u9fff]{2,}/g)) {
    const value = run[0];
    if (value.length <= 5 && !CJK_FILLER.has(value)) cjk.push(value);
    for (let i = 0; i < value.length - 1; i += 1) {
      const term = value.slice(i, i + 2);
      if (!CJK_FILLER.has(term)) cjk.push(term);
    }
  }
  return [...new Set([...latin, ...cjk])];
}

function buildRepairPrompt(request, transcript, requirements, claims, hasProjectSnapshot) {
  const requirementLines = requirements.map((item) => `- ${item.status === 'mentioned' ? '最终回复中有文字提及（尚未证明完成）' : '最终回复中未明显提及（需重点检查）'}：${item.text}`);
  const claimLines = claims.map((item) => `- [${item.status}] ${item.action} ${item.path}：${item.evidence}`);
  return [
    '请在当前项目中继续处理下面的任务。先检查真实项目文件，不要只根据这份核验报告或上一条回复推断任务已经完成。',
    '', '【用户原始要求】', request.trim(),
    '', '【AI 最终回复】', transcript.trim(),
    '', '【项目证据范围】', hasProjectSnapshot ? '已检查用户选择的目标项目快照；这只能证明扫描时的文件状态。' : '未提供目标项目快照；目前无法核对 AI 输出是否进入实际项目。',
    '', '【核验发现（文本线索，不是自动完成判决）】',
    ...(requirementLines.length ? requirementLines : ['- 未能拆分出明确要求；请直接逐条阅读用户原始要求。']),
    ...(claimLines.length ? ['', '【文件证据】', ...claimLines] : ['', '【文件证据】', '- 没有从最终回复中识别出明确文件路径声明。']),
    '', '请逐条对照用户原始要求检查实际代码和文件：',
    '1. 修复所有确实未完成、未落盘或与要求不符的部分；不要为了让报告变绿而修改无关文件。',
    '2. 对无法判断或需要运行环境的要求，明确说明限制，不要声称已完成。',
    '3. 运行相关测试/构建；只有实际运行成功后才报告通过，并注明运行的命令。',
    '4. 最后逐条列出要求、实现位置、验证证据和仍未完成项。不要把报告中的“提及”当作完成证明。',
  ].join('\n');
}

export function verify({ request = '', transcript, artifacts = [], projectFiles = null, gitChanges = null, gitBase = null }) {
  const claims = extractClaims(transcript);
  const requirements = splitRequirements(request).map((requirement) => {
    const terms = requirementTerms(requirement.text);
    const matched = terms.filter((term) => transcript.toLowerCase().includes(term.toLowerCase()));
    const threshold = Math.max(1, Math.ceil(terms.length * 0.34));
    const status = terms.length > 0 && matched.length >= threshold ? 'mentioned' : 'not-mentioned';
    return { ...requirement, status, evidence: status === 'mentioned'
      ? `最终回复出现 ${matched.length}/${terms.length} 个文本线索；这不证明要求已实现。`
      : '未在最终回复中找到足够文本线索；可能是未完成，也可能是表达不同，请人工复核。' };
  });
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
  const fileSummary = !claims.length
    ? '未识别到带明确文件路径的修改声明'
    : projectFiles !== null
      ? `内容一致 ${counts['persisted-exact']} 项；仅有 Git 变更证据 ${counts.verified} 项；内容不符 ${counts['content-differs']} 项；目标缺失 ${counts.missing} 项（共 ${claims.length} 项）`
      : `${counts['artifact-present']}/${claims.length} 项声明在所提供的输出文件中匹配；这不证明目标项目落盘`;
  const requirementSummary = `要求文本线索：回复提及 ${requirements.filter((item) => item.status === 'mentioned').length} 项，未明显提及 ${requirements.filter((item) => item.status === 'not-mentioned').length} 项；均不代表完成判定。`;
  const summary = `${requirementSummary} ${fileSummary}`;
  const repairPrompt = buildRepairPrompt(request, transcript, requirements, results, projectFiles !== null);
  return { claims: results, requirements, repairPrompt, counts, summary, gitBase, limitations: ['需求条目按换行和句末标点启发式拆分；“回复提及”只表示文本线索，不代表完成。', '无法仅凭聊天和文件快照证明功能语义、测试成功或 AI 执行者身份；请查看报告中的修复指令，让 AI 在真实项目中逐项复核并运行验证。', '哈希一致证明采集时目标项目文件与输出文件逐字节一致；Git 基准只能佐证文件发生过变更或删除。'] };
}
