/* Gitea Desktop 前端逻辑 */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const state = {
  repos: JSON.parse(localStorage.getItem('gd-repos') || '[]'), // [{path, name}]
  current: null,      // 当前仓库路径
  status: null,
  selectedFile: null,
  selectedStaged: false,
  checked: new Set(), // 勾选的待提交文件
};

function saveRepos() {
  localStorage.setItem('gd-repos', JSON.stringify(state.repos));
}

/* ---------- API ---------- */
async function api(path, opts = {}) {
  const res = await fetch(path, opts.body ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts.body),
  } : undefined);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

function toast(msg, type = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast ' + type;
  setTimeout(() => el.classList.add('hidden'), 3000);
  el.classList.remove('hidden');
}

/* ---------- 侧栏 ---------- */
function renderRepoList() {
  const list = $('#repo-list');
  if (!state.repos.length) {
    list.innerHTML = '<div class="empty-hint">点击「+ 添加」扫描目录或克隆仓库</div>';
    return;
  }
  list.innerHTML = state.repos.map((r) => `
    <div class="repo-item ${r.path === state.current ? 'active' : ''}" data-path="${esc(r.path)}">
      <div class="name">${esc(r.name)}</div>
      <div class="meta">${esc(r.path)}</div>
    </div>
  `).join('');
  $$('.repo-item').forEach((el) =>
    el.addEventListener('click', () => openRepo(el.dataset.path))
  );
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- 打开仓库 ---------- */
async function openRepo(repoPath) {
  try {
    const status = await api('/api/status?repo=' + encodeURIComponent(repoPath));
    state.current = repoPath;
    state.status = status;
    state.checked = new Set();
    state.selectedFile = null;
    $('#main-empty').classList.add('hidden');
    $('#main-repo').classList.remove('hidden');
    const name = repoPath.replace(/\\/g, '/').split('/').pop();
    $('#repo-name').textContent = name;
    $('#current-repo-label').textContent = repoPath;
    $('#commit-branch').textContent = status.current;
    renderRepoList();
    renderStatus();
    if (!$('#tab-history').classList.contains('hidden')) loadHistory();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function refreshStatus() {
  if (!state.current) return;
  state.status = await api('/api/status?repo=' + encodeURIComponent(state.current));
  $('#commit-branch').textContent = state.status.current;
  renderStatus();
}

/* ---------- 状态渲染 ---------- */
function classify(f) {
  // simple-git status.files: {path, index, working_dir}
  const staged = f.index !== ' ' && f.index !== '?';
  return { staged, code: staged ? f.index : f.working_dir };
}

function badgeOf(code) {
  if (code === '?' || code === 'A') return ['A', 'badge-A'];
  if (code === 'D') return ['D', 'badge-D'];
  if (code === 'U') return ['U', 'badge-U'];
  return ['M', 'badge-M'];
}

function renderStatus() {
  const st = state.status;
  if (!st) return;

  // ahead/behind 徽标
  const ab = $('#ahead-badge'), bb = $('#behind-badge');
  ab.textContent = '↑' + st.ahead; ab.classList.toggle('hidden', !st.ahead);
  bb.textContent = '↓' + st.behind; bb.classList.toggle('hidden', !st.behind);
  $('#branch-name').textContent = st.current || '(未命名)';

  const files = st.files || [];
  const unstaged = files.filter((f) => !classify(f).staged);
  const staged = files.filter((f) => classify(f).staged);

  $('#changes-title').textContent = `${files.length} 个更改的文件`;
  const cc = $('#changes-count');
  cc.textContent = files.length;
  cc.classList.toggle('hidden', !files.length);

  const renderItem = (f, isStaged) => {
    const { code } = classify(f);
    const [txt, cls] = badgeOf(code);
    const parts = f.path.split('/');
    const fname = parts.pop();
    const dir = parts.join('/');
    const checked = state.checked.has(f.path);
    return `
      <div class="file-item ${state.selectedFile === f.path ? 'selected' : ''}" data-path="${esc(f.path)}" data-staged="${isStaged ? 1 : 0}">
        <input type="checkbox" class="file-check" data-path="${esc(f.path)}" ${checked ? 'checked' : ''} />
        <span class="fname">${esc(fname)}</span>
        <span class="fpath">${esc(dir)}</span>
        ${isStaged ? '<span class="badge badge-staged">已暂存</span>' : `<span class="badge ${cls}">${txt}</span>`}
      </div>`;
  };

  $('#file-list').innerHTML =
    (staged.length ? staged.map((f) => renderItem(f, true)).join('') : '') +
    (unstaged.length ? unstaged.map((f) => renderItem(f, false)).join('') : '') ||
    '<div class="empty-hint">工作区干净，没有改动 🎉</div>';

  // 事件绑定
  $$('.file-item').forEach((el) => {
    el.addEventListener('click', (ev) => {
      if (ev.target.classList.contains('file-check')) return;
      state.selectedFile = el.dataset.path;
      state.selectedStaged = el.dataset.staged === '1';
      renderStatus();
      loadDiff();
    });
  });
  $$('.file-check').forEach((el) => {
    el.addEventListener('change', async () => {
      const p = el.dataset.path;
      try {
        if (el.checked) {
          await api('/api/stage', { body: { repo: state.current, files: [p] } });
          state.checked.add(p);
        } else {
          await api('/api/unstage', { body: { repo: state.current, files: [p] } });
          state.checked.delete(p);
        }
        await refreshStatus();
      } catch (e) { toast(e.message, 'error'); }
    });
  });

  // 全选框状态
  const all = $('#check-all');
  all.checked = files.length > 0 && state.checked.size === files.length;
}

$('#check-all').addEventListener('change', async (e) => {
  if (!state.status) return;
  const files = state.status.files || [];
  try {
    if (e.target.checked) {
      await api('/api/stage', { body: { repo: state.current, files: files.map((f) => f.path) } });
      state.checked = new Set(files.map((f) => f.path));
    } else {
      await api('/api/unstage', { body: { repo: state.current, files: files.map((f) => f.path) } });
      state.checked = new Set();
    }
    await refreshStatus();
  } catch (err) { toast(err.message, 'error'); }
});

/* ---------- Diff ---------- */
async function loadDiff() {
  const view = $('#diff-view');
  if (!state.selectedFile) return;
  $('#diff-title').textContent = state.selectedFile;
  try {
    const { diff } = await api(
      `/api/diff?repo=${encodeURIComponent(state.current)}&file=${encodeURIComponent(state.selectedFile)}&staged=${state.selectedStaged ? 1 : 0}`
    );
    if (!diff.trim()) {
      view.innerHTML = '<span class="diff-hint">该文件暂无可显示的文本差异（可能是新文件或二进制文件）</span>';
      return;
    }
    view.innerHTML = diff.split('\n').map((line) => {
      let cls = 'diff-line';
      if (line.startsWith('+') && !line.startsWith('+++')) cls += ' diff-add';
      else if (line.startsWith('-') && !line.startsWith('---')) cls += ' diff-del';
      else if (line.startsWith('@@')) cls += ' diff-hunk';
      return `<span class="${cls}">${esc(line)}</span>`;
    }).join('');
  } catch (e) {
    view.innerHTML = `<span class="diff-hint">加载失败: ${esc(e.message)}</span>`;
  }
}

/* ---------- 提交 ---------- */
$('#btn-commit').addEventListener('click', async () => {
  const summary = $('#commit-summary').value.trim();
  const body = $('#commit-body').value.trim();
  if (!summary) return toast('请填写提交说明', 'error');
  try {
    await api('/api/commit', {
      body: { repo: state.current, message: body ? summary + '\n\n' + body : summary },
    });
    $('#commit-summary').value = '';
    $('#commit-body').value = '';
    state.checked = new Set();
    toast('提交成功', 'success');
    await refreshStatus();
  } catch (e) { toast(e.message, 'error'); }
});

/* ---------- Push / Pull / Fetch ---------- */
for (const action of ['push', 'pull', 'fetch']) {
  $('#btn-' + action).addEventListener('click', async () => {
    const btn = $('#btn-' + action);
    btn.disabled = true;
    try {
      await api('/api/' + action, { body: { repo: state.current } });
      toast({ push: '推送成功', pull: '拉取成功', fetch: '抓取成功' }[action], 'success');
      await refreshStatus();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

/* ---------- 历史 ---------- */
async function loadHistory() {
  if (!state.current) return;
  try {
    const { commits } = await api('/api/log?repo=' + encodeURIComponent(state.current));
    $('#commit-list').innerHTML = commits.length
      ? commits.map((c) => `
        <div class="commit-item">
          <span class="commit-dot">●</span>
          <div class="commit-info">
            <div class="commit-msg">${esc(c.message.split('\n')[0])}</div>
            <div class="commit-meta">${esc(c.author_name)} 提交于 ${new Date(c.date).toLocaleString('zh-CN')}</div>
          </div>
          <span class="commit-hash">${c.hash.slice(0, 7)}</span>
        </div>`).join('')
      : '<div class="empty-hint">还没有提交记录</div>';
  } catch (e) { toast(e.message, 'error'); }
}

/* ---------- 标签页 ---------- */
$$('.tabs .tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.tabs .tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const name = tab.dataset.tab;
    $('#tab-changes').classList.toggle('hidden', name !== 'changes');
    $('#tab-history').classList.toggle('hidden', name !== 'history');
    if (name === 'history') loadHistory();
  });
});

/* ---------- 分支 ---------- */
$('#btn-branch').addEventListener('click', async (e) => {
  e.stopPropagation();
  const dd = $('#branch-dropdown');
  if (!dd.classList.contains('hidden')) return dd.classList.add('hidden');
  try {
    const { current, branches } = await api('/api/branches?repo=' + encodeURIComponent(state.current));
    $('#branch-list').innerHTML = branches
      .filter((b) => !b.startsWith('remotes/'))
      .map((b) => `
        <div class="branch-item ${b === current ? 'current' : ''}" data-branch="${esc(b)}">
          ${b === current ? '✓' : '&nbsp;&nbsp;'} ${esc(b)}
        </div>`).join('');
    $$('.branch-item').forEach((el) =>
      el.addEventListener('click', async () => {
        dd.classList.add('hidden');
        if (el.dataset.branch === current) return;
        try {
          await api('/api/checkout', { body: { repo: state.current, branch: el.dataset.branch } });
          toast('已切换到 ' + el.dataset.branch, 'success');
          await openRepo(state.current);
        } catch (err) { toast(err.message, 'error'); }
      })
    );
    dd.classList.remove('hidden');
  } catch (err) { toast(err.message, 'error'); }
});

document.addEventListener('click', () => $('#branch-dropdown').classList.add('hidden'));
$('#branch-dropdown').addEventListener('click', (e) => e.stopPropagation());

$('#btn-new-branch').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#branch-dropdown').classList.add('hidden');
  $('#modal-branch').classList.remove('hidden');
  $('#new-branch-name').focus();
});

$('#btn-create-branch').addEventListener('click', async () => {
  const name = $('#new-branch-name').value.trim();
  if (!name) return toast('请输入分支名', 'error');
  try {
    await api('/api/branch', { body: { repo: state.current, name } });
    $('#modal-branch').classList.add('hidden');
    $('#new-branch-name').value = '';
    toast('已创建并切换到 ' + name, 'success');
    await openRepo(state.current);
  } catch (e) { toast(e.message, 'error'); }
});

/* ---------- 添加仓库 ---------- */
$('#btn-add-repo').addEventListener('click', () => $('#modal-add').classList.remove('hidden'));

$$('.modal-close, .modal-overlay').forEach((el) => {
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target.dataset.close !== undefined) {
      el.closest('.modal-overlay').classList.add('hidden');
    }
  });
});

$$('.modal-tabs .tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.modal-tabs .tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const name = tab.dataset.mtab;
    ['scan', 'clone', 'open'].forEach((n) =>
      $('#mtab-' + n).classList.toggle('hidden', n !== name));
  });
});

$('#btn-scan').addEventListener('click', async () => {
  const dir = $('#scan-dir').value.trim();
  if (!dir) return toast('请输入目录路径', 'error');
  try {
    const { repos } = await api('/api/scan?dir=' + encodeURIComponent(dir));
    if (!repos.length) return toast('该目录下没有找到 git 仓库', 'error');
    let added = 0;
    for (const r of repos) {
      if (!state.repos.some((x) => x.path === r.path)) {
        state.repos.push({ path: r.path, name: r.name });
        added++;
      }
    }
    saveRepos();
    renderRepoList();
    $('#modal-add').classList.add('hidden');
    toast(`找到 ${repos.length} 个仓库，新增 ${added} 个`, 'success');
  } catch (e) { toast(e.message, 'error'); }
});

$('#btn-clone').addEventListener('click', async () => {
  const url = $('#clone-url').value.trim();
  const dir = $('#clone-dir').value.trim();
  if (!url || !dir) return toast('请填写仓库地址和目标目录', 'error');
  try {
    const r = await api('/api/clone', { body: { url, parentDir: dir } });
    state.repos.push({ path: r.path, name: r.path.replace(/\\/g, '/').split('/').pop() });
    saveRepos();
    renderRepoList();
    $('#modal-add').classList.add('hidden');
    toast('克隆成功', 'success');
    openRepo(r.path);
  } catch (e) { toast(e.message, 'error'); }
});

$('#btn-open').addEventListener('click', async () => {
  const dir = $('#open-dir').value.trim();
  if (!dir) return toast('请输入仓库路径', 'error');
  try {
    await api('/api/status?repo=' + encodeURIComponent(dir)); // 验证是仓库
    if (!state.repos.some((x) => x.path === dir)) {
      state.repos.push({ path: dir, name: dir.replace(/\\/g, '/').split('/').pop() });
      saveRepos();
    }
    renderRepoList();
    $('#modal-add').classList.add('hidden');
    openRepo(dir);
  } catch (e) { toast(e.message, 'error'); }
});

/* ---------- 启动 ---------- */
renderRepoList();
