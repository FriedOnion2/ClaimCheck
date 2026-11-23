#!/usr/bin/env node
import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractClaims, MAX_HASH_BYTES, verify } from '../src/analyzer.js';

const usage = `用法: claimcheck --request <用户原始要求.txt|md> --chat <最终聊天.txt|md> --artifacts <AI输出目录> [选项]
  --project <项目目录>   对比实际项目文件内容，核验当前快照是否落盘
  --base <Git基准>       对比该基准验证文件改动（需 --project）
  --json                 输出 JSON 报告
  -h, --help             显示帮助`;

function optionsFrom(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--json') options.json = true;
    else if (['--request', '--chat', '--artifacts', '--project', '--base'].includes(key)) {
      if (!argv[i + 1]) throw new Error(`${key} 缺少参数`);
      options[key.slice(2)] = argv[++i];
    } else if (key === '--help' || key === '-h') options.help = true;
    else throw new Error(`未知参数: ${key}`);
  }
  if (!options.help && (!options.request || !options.chat || !options.artifacts)) throw new Error('必须指定 --request、--chat 和 --artifacts');
  if (options.base && !options.project) throw new Error('--base 需要同时指定 --project');
  return options;
}

async function listFiles(root, hashPaths, prefix = '') {
  const results = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const rel = path.posix.join(prefix.replaceAll('\\', '/'), entry.name);
    if (entry.isDirectory()) {
      for (const file of await listFiles(root, hashPaths, rel)) results.push(file);
    }
    else if (entry.isFile()) {
      if (!hashPaths.has(rel)) { results.push({ path: rel }); continue; }
      const absolute = path.join(root, rel);
      const size = (await stat(absolute)).size;
      const sha256 = size <= MAX_HASH_BYTES ? createHash('sha256').update(await readFile(absolute)).digest('hex') : null;
      results.push({ path: rel, sha256, size });
    }
  }
  return results;
}

function gitChanges(project, base) {
  const run = (args) => {
    const output = spawnSync('git', ['-C', project, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    if (output.error) throw output.error;
    return output;
  };
  const resolved = run(['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]);
  if (resolved.status !== 0) throw new Error(`Git 基准不可用: ${base}`);
  const gitBase = resolved.stdout.trim();
  const diff = run(['diff', '--name-status', '--no-renames', '--no-ext-diff', '--relative', '-z', gitBase, '--', '.']);
  if (diff.status !== 0) throw new Error(`Git diff 失败: ${diff.stderr.trim()}`);
  const fields = diff.stdout.split('\0');
  const changes = [];
  for (let i = 0; fields[i]; i += 2) {
    if (!fields[i + 1]) throw new Error('Git diff 返回了无法识别的路径记录');
    changes.push({ status: fields[i][0], path: fields[i + 1] });
  }
  const untracked = run(['ls-files', '--others', '--exclude-standard', '-z', '--', '.']);
  if (untracked.status !== 0) throw new Error(`读取 Git 未跟踪文件失败: ${untracked.stderr.trim()}`);
  for (const file of untracked.stdout.split('\0').filter(Boolean)) changes.push({ status: 'A', path: file });
  return { gitBase, gitChanges: changes };
}

async function run() {
  let options;
  try { options = optionsFrom(process.argv.slice(2)); }
  catch (error) { console.error(`${error.message}\n${usage}`); process.exitCode = 2; return; }
  if (options.help) { console.log(usage); return; }
  try {
    const request = await readFile(options.request, 'utf8');
    const transcript = await readFile(options.chat, 'utf8');
    const project = options.project ? path.resolve(options.project) : null;
    const hashPaths = new Set(project ? extractClaims(transcript).filter(({ action }) => action !== 'delete').map(({ path }) => path) : []);
    const artifacts = await listFiles(path.resolve(options.artifacts), hashPaths);
    const projectFiles = project ? await listFiles(project, hashPaths) : null;
    const gitEvidence = options.base ? gitChanges(project, options.base) : {};
    const report = verify({ request, transcript, artifacts, projectFiles, ...gitEvidence });
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`ClaimCheck | ${report.summary}\n`);
      if (!report.claims.length) console.log('未识别到明确文件修改声明。可检查聊天内容是否包含具体路径。');
      for (const item of report.claims) console.log(`${item.status.padEnd(30)} ${item.action.padEnd(7)} ${item.path}\n  ${item.evidence}`);
      console.log('\n需求对照（文字提及不等于实现）:\n' + report.requirements.map((item) => `[${item.status}] ${item.text}`).join('\n'));
      console.log('\n可直接交给 AI 的修复指令:\n' + report.repairPrompt);
      console.log('\n说明:\n- ' + report.limitations.join('\n- '));
    }
    process.exitCode = report.claims.some((item) => ['missing', 'contradicted', 'content-differs'].includes(item.status)) ? 1 : 0;
  } catch (error) { console.error(`核验失败: ${error.message}`); process.exitCode = 2; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
