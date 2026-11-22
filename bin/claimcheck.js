#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verify } from '../src/analyzer.js';

const usage = `用法: claimcheck --chat <最终聊天.txt|md> --artifacts <AI输出目录> [选项]
  --project <项目目录>   与实际项目目录做存在性核对
  --base <Git基准>       对比该基准验证文件改动（需 --project；默认 HEAD）
  --json                 输出 JSON 报告
  -h, --help             显示帮助`;

function optionsFrom(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--json') options.json = true;
    else if (['--chat', '--artifacts', '--project', '--base'].includes(key)) {
      if (!argv[i + 1]) throw new Error(`${key} 缺少参数`);
      options[key.slice(2)] = argv[++i];
    } else if (key === '--help' || key === '-h') options.help = true;
    else throw new Error(`未知参数: ${key}`);
  }
  if (!options.help && (!options.chat || !options.artifacts)) throw new Error('必须指定 --chat 和 --artifacts');
  if (options.base && !options.project) throw new Error('--base 需要同时指定 --project');
  return options;
}

async function listFiles(root, prefix = '') {
  const results = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const rel = path.posix.join(prefix.replaceAll('\\', '/'), entry.name);
    if (entry.isDirectory()) results.push(...await listFiles(root, rel));
    else if (entry.isFile()) results.push({ path: rel });
  }
  return results;
}

function gitChanges(project, base) {
  const run = (args) => spawnSync('git', ['-C', project, ...args], { encoding: 'utf8', windowsHide: true });
  if (base && run(['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]).status !== 0) throw new Error(`Git 基准不可用: ${base}`);
  const diff = run(['diff', '--name-status', '--find-renames', '-z', base || 'HEAD', '--']);
  if (diff.status !== 0) throw new Error(`Git diff 失败: ${diff.stderr.trim()}`);
  const fields = diff.stdout.split('\0');
  const changes = [];
  for (let i = 0; i < fields.length && fields[i];) {
    const status = fields[i++];
    const oldPath = fields[i++];
    const newPath = /^[RC]/.test(status) ? fields[i++] : oldPath;
    changes.push({ status: status[0], path: newPath });
  }
  const untracked = run(['ls-files', '--others', '--exclude-standard', '-z']);
  if (untracked.status !== 0) throw new Error(`读取 Git 未跟踪文件失败: ${untracked.stderr.trim()}`);
  for (const file of untracked.stdout.split('\0').filter(Boolean)) changes.push({ status: 'A', path: file });
  return changes;
}

async function run() {
  let options;
  try { options = optionsFrom(process.argv.slice(2)); }
  catch (error) { console.error(`${error.message}\n${usage}`); process.exitCode = 2; return; }
  if (options.help) { console.log(usage); return; }
  try {
    const transcript = await readFile(options.chat, 'utf8');
    const artifacts = await listFiles(path.resolve(options.artifacts));
    const projectFiles = options.project ? await listFiles(path.resolve(options.project)) : null;
    const changes = options.project ? gitChanges(path.resolve(options.project), options.base) : null;
    const report = verify({ transcript, artifacts, projectFiles, gitChanges: changes });
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`ClaimCheck | ${report.summary}\n`);
      if (!report.claims.length) console.log('未识别到明确文件修改声明。可检查聊天内容是否包含具体路径。');
      for (const item of report.claims) console.log(`${item.status.padEnd(30)} ${item.action.padEnd(7)} ${item.path}\n  ${item.evidence}`);
      console.log('\n说明:\n- ' + report.limitations.join('\n- '));
    }
    process.exitCode = report.claims.some((item) => ['missing', 'contradicted'].includes(item.status)) ? 1 : 0;
  } catch (error) { console.error(`核验失败: ${error.message}`); process.exitCode = 2; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
