import { extractClaims, MAX_HASH_BYTES, verify } from '/src/analyzer.js';
const $ = (selector) => document.querySelector(selector);
const chat = $('#transcript');
const filesInput = $('#artifact-files');
const dropzone = $('#dropzone');
let artifacts = [];
let projectSnapshot = null;
let latestReport = null;

function renderFileList() {
  $('#file-count').textContent = artifacts.length ? `${artifacts.length} 个文件` : '未选择文件';
  const list = $('#selected-files');
  list.replaceChildren(...artifacts.slice(0, 8).map((file) => {
    const row = document.createElement('div'); row.className = 'file-row';
    const name = document.createElement('span'); name.textContent = file.path;
    const size = document.createElement('small'); size.textContent = `${Math.max(1, Math.round(file.size / 1024))} KB`;
    row.append(name, size); return row;
  }));
  if (artifacts.length > 8) { const more = document.createElement('div'); more.className = 'file-row more'; more.textContent = `以及其他 ${artifacts.length - 8} 个文件`; list.append(more); }
}
function selectedFiles(files) {
  return [...files].map((file) => ({ path: file.webkitRelativePath.split('/').slice(1).join('/') || file.name, size: file.size, file }));
}
function receiveFiles(files) { artifacts = selectedFiles(files); renderFileList(); }
filesInput.addEventListener('change', () => receiveFiles(filesInput.files));
$('#project-files').addEventListener('change', (event) => {
  projectSnapshot = selectedFiles(event.target.files);
  $('#project-count').textContent = `${projectSnapshot.length} 个项目文件`;
});
for (const event of ['dragenter', 'dragover']) dropzone.addEventListener(event, (e) => { e.preventDefault(); dropzone.classList.add('dragging'); });
for (const event of ['dragleave', 'drop']) dropzone.addEventListener(event, (e) => { e.preventDefault(); dropzone.classList.remove('dragging'); });
dropzone.addEventListener('drop', (e) => receiveFiles(e.dataTransfer.files));
$('#chat-file').addEventListener('change', async (e) => { if (e.target.files[0]) chat.value = await e.target.files[0].text(); });
$('#load-example').addEventListener('click', () => {
  chat.value = '已完成修改：\n- 修改 `src/server.js`：修复静态路径处理\n- 新增 `tests/server.test.js`：补充路径测试\n- 测试已通过';
  artifacts = [{ path: 'src/server.js', size: 2180 }, { path: 'README.md', size: 700 }]; renderFileList();
  projectSnapshot = null;
  $('#project-files').value = '';
  $('#project-count').textContent = '未选择项目（可选）';
});
const labels = { 'persisted-exact': ['已落盘且内容一致', 'good'], 'content-differs': ['项目内容不一致', 'bad'], verified: ['Git 变更已核实', 'good'], 'artifact-present': ['产物存在', 'neutral'], 'present-not-proven-changed': ['存在但未证实一致', 'warn'], missing: ['缺少文件', 'bad'], contradicted: ['证据矛盾', 'bad'], ambiguous: ['路径有歧义', 'warn'], unverified: ['无法核实', 'warn'] };

async function fingerprint(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function withHashes(list, paths) {
  const snapshot = [];
  for (const { path, size, file } of list) {
    const sha256 = paths.has(path) && file && size <= MAX_HASH_BYTES ? await fingerprint(file) : null;
    snapshot.push({ path, size, sha256 });
  }
  return snapshot;
}

$('#verify').addEventListener('click', async (event) => {
  const transcript = chat.value;
  if (!transcript.trim()) { chat.focus(); return; }
  const button = event.currentTarget;
  const inputs = { artifacts, projectSnapshot };
  const message = $('#verify-error');
  button.disabled = true;
  button.firstElementChild.textContent = '核验中…';
  message.hidden = true;
  $('#results').hidden = true;
  try {
    const paths = new Set(inputs.projectSnapshot ? extractClaims(transcript).filter(({ action }) => action !== 'delete').map(({ path }) => path) : []);
    const output = await withHashes(inputs.artifacts, paths);
    const projectFiles = inputs.projectSnapshot === null ? null : await withHashes(inputs.projectSnapshot, paths);
    if (chat.value !== transcript || artifacts !== inputs.artifacts || projectSnapshot !== inputs.projectSnapshot) {
      throw new Error('核验期间输入已改动，请重新核验。');
    }
    latestReport = verify({ transcript, artifacts: output, projectFiles });
  } catch (error) {
    message.textContent = `核验失败：${error.message}`;
    message.hidden = false;
    return;
  } finally {
    button.disabled = false;
    button.firstElementChild.textContent = '核验声明';
  }
  $('#summary').textContent = latestReport.summary;
  const tbody = $('#claim-rows'); tbody.replaceChildren();
  if (!latestReport.claims.length) { const row = document.createElement('tr'); const cell = document.createElement('td'); cell.colSpan = 4; cell.textContent = '未发现带明确文件路径的修改声明。'; row.append(cell); tbody.append(row); }
  for (const item of latestReport.claims) {
    const row = document.createElement('tr'); const [label, tone] = labels[item.status];
    const status = document.createElement('td'); const badge = document.createElement('span'); badge.className = `status ${tone}`; badge.textContent = label; status.append(badge);
    const action = document.createElement('td'); action.textContent = item.action === 'delete' ? '删除' : item.action === 'create' ? '新增' : '修改';
    const file = document.createElement('td'); const code = document.createElement('code'); code.textContent = item.path; file.append(code);
    const evidence = document.createElement('td'); evidence.textContent = item.evidence; row.append(status, action, file, evidence); tbody.append(row);
  }
  $('#limitation-list').replaceChildren(...latestReport.limitations.map((text) => { const li = document.createElement('li'); li.textContent = text; return li; }));
  $('#results').hidden = false; $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('#download-report').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(latestReport, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'claimcheck-report.json'; a.click(); URL.revokeObjectURL(url);
});
