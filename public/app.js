/* Gitea Desktop 前端逻辑 */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const isDesktop = !!(window.desktop && window.desktop.isDesktop);

const state = {
  repos: JSON.parse(localStorage.getItem('gd-repos') || '[]'),
  current: null,
  status: null,
  selectedFile: null,
  selectedStaged: false,
  checked: new Set(),
  selectedCommit: null,
  cfg: { global: { name: '', email: '' }, local: { name: '', email: '' } },
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
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- 主题 ---------- */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('gd-theme', theme);
  $('#btn-theme').textContent = theme === 'dark' ? '☀' : '🌙';
}
$('#btn-theme').addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});
applyTheme(localStorage.getItem('gd-theme') || 'light');

/* ---------- 侧栏仓库列表（含操作菜单） ---------- */
function renderRepoList() {
  const list = $('#repo-list');
  if (!state.repos.length) {
    list.innerHTML = '<div class="empty-hint">点击「+ 添加」扫描目录、克隆或新建仓库</div>';
    return;
  }
  list.innerHTML = state.repos.map((r, i) => `
    <div class="repo-item ${r.path === state.current ? 'active' : ''}" data-path="${esc(r.path)}">
      <div class="repo-row">
        <div class="repo-text">
          <div class="name">${esc(r.name)}</div>
          <div class="meta">${esc(r.path)}</div>
        </div>
        <button class="repo-menu-btn" data-idx="${i}" title="更多操作">⋯</button>
      </div>
    </div>
  `).join('');

  $$('.repo-item').forEach((el) =>
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('repo-menu-btn')) return;
      openRepo(el.dataset.path);
    })
  );

  $$('.repo-menu-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenus();
      const menu = document.createElement('div');
      menu.className = 'dropdown context-menu';
      const idx = Number(btn.dataset.idx);
      const repo = state.repos[idx];
      menu.innerHTML = `
        <div class="menu-item" data-act="explorer">在资源管理器中显示</div>
        <div class="menu-item" data-act="remove">从列表中移除</div>
        <div class="menu-item menu-danger" data-act="delete">从磁盘删除…</div>
      `;
      menu.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const act = ev.target.dataset.act;
        closeMenus();
        if (!act) return;
        if (act === 'explorer') {
          if (isDesktop) window.desktop.showInFolder(repo.path);
          else toast('网页版不支持此操作', 'error');
        } else if (act === 'remove') {
          state.repos.splice(idx, 1);
          if (state.current === repo.path) showWelcome();
          saveRepos();
          renderRepoList();
          toast('已从列表移除', 'success');
        } else if (act === 'delete') {
          openDeleteModal(repo);
        }
      });
      const rect = btn.getBoundingClientRect();
      menu.style.position = 'fixed';
      menu.style.left = Math.min(rect.left, window.innerWidth - 220) + 'px';
      menu.style.top = rect.bottom + 4 + 'px';
      menu.style.zIndex = 300;
      document.body.appendChild(menu);
    });
  });
}

function closeMenus() {
  $$('.context-menu').forEach((m) => m.remove());
}
document.addEventListener('click', closeMenus);

function showWelcome() {
  state.current = null;
  state.status = null;
  $('#main-repo').classList.add('hidden');
  $('#main-empty').classList.remove('hidden');
  $('#repo-controls').classList.add('hidden');
  $('#btn-refresh').classList.add('hidden');
}

/* ---------- 删除仓库确认 ---------- */
let deleteTarget = null;
function openDeleteModal(repo) {
  deleteTarget = repo;
  $('#delete-expect').textContent = repo.name;
  $('#delete-confirm').value = '';
  $('#btn-confirm-delete').disabled = true;
  $('#modal-delete').classList.remove('hidden');
  $('#delete-confirm').focus();
}
$('#delete-confirm').addEventListener('input', (e) => {
  $('#btn-confirm-delete').disabled = !deleteTarget || e.target.value.trim() !== deleteTarget.name;
});
$('#btn-confirm-delete').addEventListener('click', async () => {
  if (!deleteTarget) return;
  try {
    await api('/api/delete-repo', { body: { repo: deleteTarget.path, confirm: $('#delete-confirm').value.trim() } });
    state.repos = state.repos.filter((r) => r.path !== deleteTarget.path);
    if (state.current === deleteTarget.path) showWelcome();
    saveRepos();
    renderRepoList();
    $('#modal-delete').classList.add('hidden');
    toast('仓库已从磁盘删除', 'success');
  } catch (e) { toast(e.message, 'error'); }
});

/* ---------- 打开仓库 ---------- */
async function openRepo(repoPath) {
  try {
    const status = await api('/api/status?repo=' + encodeURIComponent(repoPath));
    state.current = repoPath;
    state.status = status;
    state.checked = new Set();
    state.selectedFile = null;
    state.selectedCommit = null;
    $('#main-empty').classList.add('hidden');
    $('#main-repo').classList.remove('hidden');
    $('#repo-controls').classList.remove('hidden');
    $('#btn-refresh').classList.remove('hidden');
    $('#commit-branch').textContent = status.current;
    renderRepoList();
    renderStatus();
    loadConfig();
    loadStashCount();
    const activeTab = document.querySelector('.panel-mid .tabs .tab.active')?.dataset.tab;
    if (activeTab === 'history') loadHistory();
    if (activeTab === 'stashes') loadStashes();
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

$('#btn-refresh').addEventListener('click', async () => {
  await refreshStatus();
  loadStashCount();
  toast('已刷新', 'success');
});

/* ---------- 状态渲染 ---------- */
function classify(f) {
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

  // 智能同步按钮：behind>0 → 拉取；ahead>0 → 推送；否则抓取
  const syncBtn = $('#btn-sync'), syncLabel = $('#sync-label'), syncBadge = $('#sync-badge');
  if (st.behind > 0) {
    syncLabel.textContent = '拉取 origin';
    syncBadge.textContent = '↓' + st.behind;
    syncBadge.classList.remove('hidden');
  } else if (st.ahead > 0) {
    syncLabel.textContent = '推送 origin';
    syncBadge.textContent = '↑' + st.ahead;
    syncBadge.classList.remove('hidden');
  } else {
    syncLabel.textContent = '获取远程更新';
    syncBadge.classList.add('hidden');
  }

  $('#branch-name').textContent = st.current || '(未命名)';

  // 撤销按钮：工作区干净且本地有领先提交时显示
  $('#btn-undo').classList.toggle('hidden', !((st.files || []).length === 0 && st.ahead > 0));

  // 提交人信息
  const cfg = state.cfg;
  const name = cfg.local.name || cfg.global.name || '(未配置)';
  const email = cfg.local.email || cfg.global.email || '';
  $('#commit-by').textContent = `以 ${name}${email ? ' <' + email + '>' : ''} 的身份提交`;

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
        <button class="discard-btn" data-path="${esc(f.path)}" title="放弃此文件的更改">✕</button>
      </div>`;
  };

  $('#file-list').innerHTML =
    (staged.length ? staged.map((f) => renderItem(f, true)).join('') : '') +
    (unstaged.length ? unstaged.map((f) => renderItem(f, false)).join('') : '') ||
    '<div class="empty-hint">工作区干净，没有改动 🎉</div>';

  $$('.file-item').forEach((el) => {
    el.addEventListener('click', (ev) => {
      if (ev.target.classList.contains('file-check') || ev.target.classList.contains('discard-btn')) return;
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
  $$('.discard-btn').forEach((el) => {
    el.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const p = el.dataset.path;
      if (!confirm(`确定放弃「${p}」的所有更改吗？此操作无法撤销。`)) return;
      try {
        await api('/api/discard', { body: { repo: state.current, file: p } });
        state.checked.delete(p);
        if (state.selectedFile === p) {
          state.selectedFile = null;
          $('#diff-view').innerHTML = '<span class="diff-hint">点击左侧文件查看具体改动</span>';
          $('#diff-title').textContent = '选择一个文件查看差异';
        }
        toast('已放弃更改', 'success');
        await refreshStatus();
      } catch (e) { toast(e.message, 'error'); }
    });
  });

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

/* ---------- Diff 渲染 ---------- */
function renderDiffText(diff) {
  if (!diff.trim()) {
    return '<span class="diff-hint">无可显示的文本差异（可能是新文件或二进制文件）</span>';
  }
  return diff.split('\n').map((line) => {
    let cls = 'diff-line';
    if (line.startsWith('+') && !line.startsWith('+++')) cls += ' diff-add';
    else if (line.startsWith('-') && !line.startsWith('---')) cls += ' diff-del';
    else if (line.startsWith('@@')) cls += ' diff-hunk';
    return `<span class="${cls}">${esc(line)}</span>`;
  }).join('');
}

async function loadDiff() {
  const view = $('#diff-view');
  if (!state.selectedFile) return;
  $('#diff-title').textContent = state.selectedFile;
  try {
    const { diff } = await api(
      `/api/diff?repo=${encodeURIComponent(state.current)}&file=${encodeURIComponent(state.selectedFile)}&staged=${state.selectedStaged ? 1 : 0}`
    );
    view.innerHTML = renderDiffText(diff);
  } catch (e) {
    view.innerHTML = `<span class="diff-hint">加载失败: ${esc(e.message)}</span>`;
  }
}

/* ---------- 提交 / 撤销 ---------- */
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

$('#btn-undo').addEventListener('click', async () => {
  if (!confirm('撤销最近一次提交？提交内容会回到工作区（不丢失代码），仅当该提交尚未推送时建议这样做。')) return;
  try {
    await api('/api/undo-commit', { body: { repo: state.current } });
    toast('已撤销最近一次提交', 'success');
    await refreshStatus();
  } catch (e) { toast(e.message, 'error'); }
});

/* ---------- 智能同步按钮 ---------- */
$('#btn-sync').addEventListener('click', async () => {
  if (!state.status) return;
  const st = state.status;
  const action = st.behind > 0 ? 'pull' : st.ahead > 0 ? 'push' : 'fetch';
  const btn = $('#btn-sync');
  btn.disabled = true;
  const oldLabel = $('#sync-label').textContent;
  $('#sync-label').textContent = { pull: '拉取中…', push: '推送中…', fetch: '获取中…' }[action];
  try {
    await api('/api/' + action, { body: { repo: state.current } });
    toast({ push: '推送成功', pull: '拉取成功', fetch: '已是最新' }[action], 'success');
    await refreshStatus();
  } catch (e) {
    toast(e.message, 'error');
    $('#sync-label').textContent = oldLabel;
  } finally {
    btn.disabled = false;
  }
});

/* ---------- 历史（中栏列表 + 右栏详情） ---------- */
async function loadHistory() {
  if (!state.current) return;
  try {
    const { commits } = await api('/api/log?repo=' + encodeURIComponent(state.current));
    $('#commit-list').innerHTML = commits.length
      ? commits.map((c) => `
        <div class="commit-item ${state.selectedCommit === c.hash ? 'selected' : ''}" data-hash="${c.hash}">
          <span class="commit-dot">●</span>
          <div class="commit-info">
            <div class="commit-msg">${esc(c.message.split('\n')[0])}</div>
            <div class="commit-meta">${esc(c.author_name)} · ${new Date(c.date).toLocaleString('zh-CN')}</div>
          </div>
          <span class="commit-hash">${c.hash.slice(0, 7)}</span>
        </div>`).join('')
      : '<div class="empty-hint">还没有提交记录</div>';

    $$('.commit-item').forEach((el) => {
      el.addEventListener('click', () => showCommitDetail(el.dataset.hash));
    });
  } catch (e) { toast(e.message, 'error'); }
}

async function showCommitDetail(hash) {
  state.selectedCommit = hash;
  $$('.commit-item').forEach((el) => el.classList.toggle('selected', el.dataset.hash === hash));
  $('#commit-detail-title').textContent = '提交 ' + hash.slice(0, 7);
  $('#commit-detail').innerHTML = '<div class="empty-hint">加载中…</div>';
  try {
    const c = await api(`/api/commit?repo=${encodeURIComponent(state.current)}&hash=${hash}`);
    $('#commit-detail').innerHTML = `
      <div class="commit-detail-head">
        <div class="commit-msg">${esc(c.message.split('\n')[0])}</div>
        ${c.message.includes('\n') ? `<pre class="commit-body">${esc(c.message.split('\n').slice(1).join('\n').trim())}</pre>` : ''}
        <div class="commit-meta">${esc(c.author)} &lt;${esc(c.email)}&gt; · ${new Date(c.date).toLocaleString('zh-CN')}</div>
      </div>
      <div class="commit-detail-files">
        ${c.files.map((f) => {
          const [txt, cls] = badgeOf(f.status[0]);
          return `<div class="file-item commit-file" data-hash="${hash}" data-path="${esc(f.path)}">
            <span class="fname">${esc(f.path)}</span>
            <span class="badge ${cls}">${txt}</span>
          </div>`;
        }).join('') || '<div class="empty-hint">无文件变更</div>'}
      </div>
      <pre id="commit-diff-view" class="diff-view"><span class="diff-hint">点击上方文件查看该次提交的差异</span></pre>
    `;
    $$('.commit-file').forEach((el) => {
      el.addEventListener('click', async () => {
        $$('.commit-file').forEach((x) => x.classList.remove('selected'));
        el.classList.add('selected');
        const view = $('#commit-diff-view');
        view.innerHTML = '<span class="diff-hint">加载中…</span>';
        try {
          const { diff } = await api(`/api/commit-diff?repo=${encodeURIComponent(state.current)}&hash=${el.dataset.hash}&file=${encodeURIComponent(el.dataset.path)}`);
          view.innerHTML = renderDiffText(diff);
        } catch (e) {
          view.innerHTML = `<span class="diff-hint">加载失败: ${esc(e.message)}</span>`;
        }
      });
    });
  } catch (e) { toast(e.message, 'error'); }
}

/* ---------- 贮藏 ---------- */
async function loadStashCount() {
  if (!state.current) return;
  try {
    const { stashes } = await api('/api/stashes?repo=' + encodeURIComponent(state.current));
    const sc = $('#stash-count');
    sc.textContent = stashes.length;
    sc.classList.toggle('hidden', !stashes.length);
  } catch { /* 忽略 */ }
}

async function loadStashes() {
  if (!state.current) return;
  try {
    const { stashes } = await api('/api/stashes?repo=' + encodeURIComponent(state.current));
    $('#stash-list').innerHTML = stashes.length
      ? stashes.map((s) => `
        <div class="commit-item">
          <span class="commit-dot">📦</span>
          <div class="commit-info">
            <div class="commit-msg">${esc(s.message || '(无描述)')}</div>
            <div class="commit-meta">${esc(s.ref)}</div>
          </div>
          <button class="btn btn-sm stash-pop" data-ref="${esc(s.ref)}">恢复</button>
        </div>`).join('')
      : '<div class="empty-hint">没有贮藏的改动</div>';
    $$('.stash-pop').forEach((el) => {
      el.addEventListener('click', async () => {
        try {
          await api('/api/stash', { body: { repo: state.current, action: 'pop' } });
          toast('已恢复最近贮藏', 'success');
          await refreshStatus();
          loadStashes();
        } catch (e) { toast(e.message, 'error'); }
      });
    });
  } catch (e) { toast(e.message, 'error'); }
}

async function stashPush() {
  if (!state.current) return;
  const msg = prompt('贮藏描述（可留空）：') ?? '';
  try {
    await api('/api/stash', { body: { repo: state.current, action: 'push', message: msg || undefined } });
    toast('已贮藏当前改动', 'success');
    await refreshStatus();
    loadStashCount();
    if (!$('#tab-stashes').classList.contains('hidden')) loadStashes();
  } catch (e) { toast(e.message, 'error'); }
}

$('#btn-stash').addEventListener('click', stashPush);
$('#btn-stash-push').addEventListener('click', stashPush);

/* ---------- 标签页（同时切换右侧面板） ---------- */
$$('.panel-mid .tabs .tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.panel-mid .tabs .tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const name = tab.dataset.tab;
    $('#tab-changes').classList.toggle('hidden', name !== 'changes');
    $('#tab-history').classList.toggle('hidden', name !== 'history');
    $('#tab-stashes').classList.toggle('hidden', name !== 'stashes');
    $('#right-changes').classList.toggle('hidden', name !== 'changes');
    $('#right-history').classList.toggle('hidden', name !== 'history');
    $('#right-stashes').classList.toggle('hidden', name !== 'stashes');
    if (name === 'history') loadHistory();
    if (name === 'stashes') loadStashes();
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
          <span class="branch-check">${b === current ? '✓' : ''}</span>
          <span class="branch-label">${esc(b)}</span>
          ${b !== current ? `<button class="branch-del" data-branch="${esc(b)}" title="删除分支">✕</button>` : ''}
        </div>`).join('');
    $$('.branch-item').forEach((el) =>
      el.addEventListener('click', async (ev) => {
        if (ev.target.classList.contains('branch-del')) return;
        dd.classList.add('hidden');
        if (el.dataset.branch === current) return;
        try {
          await api('/api/checkout', { body: { repo: state.current, branch: el.dataset.branch } });
          toast('已切换到 ' + el.dataset.branch, 'success');
          await openRepo(state.current);
        } catch (err) { toast(err.message, 'error'); }
      })
    );
    $$('.branch-del').forEach((el) =>
      el.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (!confirm(`确定删除分支「${el.dataset.branch}」吗？`)) return;
        try {
          await api('/api/branch/delete', { body: { repo: state.current, name: el.dataset.branch } });
          toast('分支已删除', 'success');
          dd.classList.add('hidden');
          $('#btn-branch').click();
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

/* ---------- Git 身份设置 ---------- */
async function loadConfig() {
  try {
    const cfg = await api('/api/config' + (state.current ? '?repo=' + encodeURIComponent(state.current) : ''));
    state.cfg = cfg;
    $('#cfg-global-name').value = cfg.global.name;
    $('#cfg-global-email').value = cfg.global.email;
    $('#cfg-local-name').value = cfg.local.name;
    $('#cfg-local-email').value = cfg.local.email;
    $('#local-config-section').style.display = state.current ? '' : 'none';
    renderStatus();
  } catch { /* 忽略 */ }
}

$('#btn-settings').addEventListener('click', async () => {
  await loadConfig();
  $('#modal-settings').classList.remove('hidden');
});

$('#btn-save-global').addEventListener('click', async () => {
  try {
    await api('/api/config', { body: {
      scope: 'global',
      name: $('#cfg-global-name').value.trim(),
      email: $('#cfg-global-email').value.trim(),
    } });
    toast('全局身份已保存', 'success');
    await loadConfig();
  } catch (e) { toast(e.message, 'error'); }
});

$('#btn-save-local').addEventListener('click', async () => {
  if (!state.current) return toast('请先打开一个仓库', 'error');
  try {
    await api('/api/config', { body: {
      repo: state.current, scope: 'local',
      name: $('#cfg-local-name').value.trim(),
      email: $('#cfg-local-email').value.trim(),
    } });
    toast('仓库身份已保存', 'success');
    await loadConfig();
  } catch (e) { toast(e.message, 'error'); }
});

/* ---------- 使用指南 ---------- */
$('#btn-help').addEventListener('click', () => $('#modal-help').classList.remove('hidden'));
$('#btn-welcome-help').addEventListener('click', () => $('#modal-help').classList.remove('hidden'));
$('#btn-welcome-add').addEventListener('click', () => $('#modal-add').classList.remove('hidden'));

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
    ['scan', 'clone', 'open', 'init'].forEach((n) =>
      $('#mtab-' + n).classList.toggle('hidden', n !== name));
  });
});

// 原生文件夹选择（桌面版）/ 提示手动输入（网页版）
$$('.browse-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    if (!isDesktop) return toast('网页版请手动输入路径', 'error');
    const picked = await window.desktop.pickFolder('选择文件夹');
    if (picked) $('#' + btn.dataset.target).value = picked;
  });
});

$('#btn-scan').addEventListener('click', async () => {
  const dir = $('#scan-dir').value.trim();
  if (!dir) return toast('请输入或选择目录', 'error');
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
  if (!dir) return toast('请输入或选择仓库路径', 'error');
  try {
    await api('/api/status?repo=' + encodeURIComponent(dir));
    if (!state.repos.some((x) => x.path === dir)) {
      state.repos.push({ path: dir, name: dir.replace(/\\/g, '/').split('/').pop() });
      saveRepos();
    }
    renderRepoList();
    $('#modal-add').classList.add('hidden');
    openRepo(dir);
  } catch (e) { toast(e.message, 'error'); }
});

$('#btn-init').addEventListener('click', async () => {
  const name = $('#init-name').value.trim();
  const dir = $('#init-dir').value.trim();
  if (!name || !dir) return toast('请填写仓库名称和创建位置', 'error');
  try {
    const r = await api('/api/init', { body: { parentDir: dir, name } });
    state.repos.push({ path: r.path, name: r.path.replace(/\\/g, '/').split('/').pop() });
    saveRepos();
    renderRepoList();
    $('#modal-add').classList.add('hidden');
    toast('仓库已创建', 'success');
    openRepo(r.path);
  } catch (e) { toast(e.message, 'error'); }
});

/* ---------- 定时刷新 ---------- */
setInterval(async () => {
  if (state.current && document.visibilityState === 'visible') {
    try { await refreshStatus(); } catch { /* 仓库可能被移动/删除 */ }
  }
}, 30000);

/* ---------- 启动 ---------- */
renderRepoList();
