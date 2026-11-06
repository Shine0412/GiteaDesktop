// Gitea Desktop —— 本地可视化 Git 仓库管理工具后端
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { simpleGit } = require('simple-git');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- 工具函数 ----------

/** 校验仓库路径存在且是 git 仓库 */
function validRepo(repoPath) {
  return (
    typeof repoPath === 'string' &&
    repoPath.length > 0 &&
    fs.existsSync(repoPath) &&
    fs.existsSync(path.join(repoPath, '.git'))
  );
}

function git(repoPath) {
  return simpleGit({ baseDir: repoPath });
}

/** 扫描目录，找出其中的 git 仓库（最多下钻两层） */
function scanRepos(dir, depth = 2) {
  const results = [];
  function walk(current, level) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.name === '.git')) {
      results.push(current);
      return; // 不深入仓库内部
    }
    if (level >= depth) return;
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
        walk(path.join(current, e.name), level + 1);
      }
    }
  }
  walk(dir, 0);
  return results;
}

// 错误处理包装：handler 内显式校验返回 400，git/内部异常返回 500
const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || String(err) });
  }
};

// ---------- API ----------

// 扫描目录下的 git 仓库
app.get('/api/scan', handle(async (req, res) => {
  const dir = req.query.dir;
  if (!dir || !fs.existsSync(dir)) {
    return res.status(400).json({ error: '目录不存在: ' + dir });
  }
  const repos = scanRepos(dir);
  const detailed = await Promise.all(
    repos.map(async (p) => {
      let branch = '?';
      let remote = '';
      try {
        const g = git(p);
        const st = await g.status();
        branch = st.current || '?';
        const remotes = await g.getRemotes(true);
        remote = (remotes.find((r) => r.name === 'origin') || remotes[0] || {}).refs?.fetch || '';
      } catch { /* 忽略单个仓库的错误 */ }
      return { path: p, name: path.basename(p), branch, remote };
    })
  );
  res.json({ repos: detailed });
}));

// 克隆仓库
app.post('/api/clone', handle(async (req, res) => {
  const { url, parentDir } = req.body;
  if (!url || !parentDir) return res.status(400).json({ error: '缺少 url 或 parentDir' });
  if (!fs.existsSync(parentDir)) return res.status(400).json({ error: '目标目录不存在' });
  const target = path.join(parentDir, repoNameFromUrl(url));
  await simpleGit().clone(url, target);
  res.json({ ok: true, path: target });
}));

function repoNameFromUrl(url) {
  const base = url.replace(/\.git$/, '').split('/').pop().split(':').pop();
  return base || 'repo';
}

// 仓库状态（分支、改动文件、与远程的差距、远程列表）
app.get('/api/status', handle(async (req, res) => {
  const repo = req.query.repo;
  if (!validRepo(repo)) return res.status(400).json({ error: '不是有效的 git 仓库' });
  const g = git(repo);
  const status = await g.status();
  const remoteList = await g.getRemotes(true);
  res.json({
    current: status.current,
    tracking: status.tracking,
    ahead: status.ahead,
    behind: status.behind,
    remotes: remoteList.map((r) => ({ name: r.name, url: r.refs?.fetch || '' })),
    staged: status.staged,
    modified: status.modified,
    created: status.created,
    deleted: status.deleted,
    not_added: status.not_added,
    files: status.files,
  });
}));

// 提交历史（skip 用于「显示更多」分页，date 用 Unix 时间戳避免时区/格式解析问题）
// 用 raw 命令 + NUL 分隔符解析，避免 simple-git log 不支持 skip 以及换行/制表符破坏解析
app.get('/api/log', handle(async (req, res) => {
  const repo = req.query.repo;
  if (!validRepo(repo)) return res.status(400).json({ error: '不是有效的 git 仓库' });
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const skip = Math.max(parseInt(req.query.skip) || 0, 0);
  const out = await git(repo).raw([
    'log',
    '--skip=' + skip,
    '--max-count=' + limit,
    '--format=%H%x00%at%x00%an%x00%s',
  ]);
  const commits = out.split('\n').filter(Boolean).map((l) => {
    const [hash, date, author_name, message] = l.split('\0');
    return { hash, date, author_name, message };
  });
  res.json({ commits, limit });
}));

// 分支列表
app.get('/api/branches', handle(async (req, res) => {
  const repo = req.query.repo;
  if (!validRepo(repo)) return res.status(400).json({ error: '不是有效的 git 仓库' });
  const branches = await git(repo).branch(['-a']);
  res.json({ current: branches.current, branches: branches.all });
}));

// 文件 diff
app.get('/api/diff', handle(async (req, res) => {
  const { repo, file, staged } = req.query;
  if (!validRepo(repo)) return res.status(400).json({ error: '不是有效的 git 仓库' });
  const g = git(repo);
  const args = staged === '1' ? ['--cached', '--', file] : ['--', file];
  const diff = await g.diff(args);
  res.json({ diff });
}));

// 暂存 / 取消暂存
app.post('/api/stage', handle(async (req, res) => {
  const { repo, files } = req.body;
  if (!validRepo(repo)) return res.status(400).json({ error: '不是有效的 git 仓库' });
  await git(repo).add(files);
  res.json({ ok: true });
}));

app.post('/api/unstage', handle(async (req, res) => {
  const { repo, files } = req.body;
  if (!validRepo(repo)) return res.status(400).json({ error: '不是有效的 git 仓库' });
  await git(repo).raw(['reset', '-q', 'HEAD', '--', ...files]);
  res.json({ ok: true });
}));

// 提交
app.post('/api/commit', handle(async (req, res) => {
  const { repo, message } = req.body;
  if (!validRepo(repo)) return res.status(400).json({ error: '不是有效的 git 仓库' });
  if (!message || !message.trim()) return res.status(400).json({ error: '提交信息不能为空' });
  const result = await git(repo).commit(message.trim());
  res.json({ ok: true, commit: result.commit });
}));

// 推送 / 拉取 / 抓取
app.post('/api/push', handle(async (req, res) => {
  const { repo } = req.body;
  if (!validRepo(repo)) return res.status(400).json({ error: '不是有效的 git 仓库' });
  const g = git(repo);
  const st = await g.status();
  if (!st.tracking) {
    // 首次推送，建立 upstream
    await g.push(['-u', 'origin', st.current]);
  } else {
    await g.push();
  }
  res.json({ ok: true });
}));

app.post('/api/pull', handle(async (req, res) => {
  const { repo } = req.body;
  if (!validRepo(repo)) return res.status(400).json({ error: '不是有效的 git 仓库' });
  await git(repo).pull();
  res.json({ ok: true });
}));

app.post('/api/fetch', handle(async (req, res) => {
  const { repo } = req.body;
  if (!validRepo(repo)) return res.status(400).json({ error: '不是有效的 git 仓库' });
  await git(repo).fetch();
  res.json({ ok: true });
}));

// 切换 / 新建分支
app.post('/api/checkout', handle(async (req, res) => {
  const { repo, branch } = req.body;
  if (!validRepo(repo)) return res.status(400).json({ error: '不是有效的 git 仓库' });
  await git(repo).checkout(branch);
  res.json({ ok: true });
}));

app.post('/api/branch', handle(async (req, res) => {
  const { repo, name } = req.body;
  if (!validRepo(repo)) return res.status(400).json({ error: '不是有效的 git 仓库' });
  if (!name || !name.trim()) return res.status(400).json({ error: '分支名不能为空' });
  await git(repo).checkoutLocalBranch(name.trim());
  res.json({ ok: true });
}));

// 删除分支
app.post('/api/branch/delete', handle(async (req, res) => {
  const { repo, name } = req.body;
  if (!validRepo(repo)) return res.status(400).json({ error: '不是有效的 git 仓库' });
  const st = await git(repo).status();
  if (st.current === name) return res.status(400).json({ error: '不能删除当前所在的分支' });
  await git(repo).deleteLocalBranch(name, true);
  res.json({ ok: true });
}));

// Git 身份配置（读取全局/仓库级 user.name、user.email）
app.get('/api/config', handle(async (req, res) => {
  const { repo } = req.query;
  const g = repo && validRepo(repo) ? git(repo) : simpleGit();
  const [globalName, globalEmail] = await Promise.all([
    g.raw(['config', '--global', 'user.name']).catch(() => ''),
    g.raw(['config', '--global', 'user.email']).catch(() => ''),
  ]);
  let localName = '', localEmail = '';
  if (repo && validRepo(repo)) {
    [localName, localEmail] = await Promise.all([
      g.raw(['config', '--local', 'user.name']).catch(() => ''),
      g.raw(['config', '--local', 'user.email']).catch(() => ''),
    ]);
  }
  res.json({
    global: { name: globalName.trim(), email: globalEmail.trim() },
    local: { name: localName.trim(), email: localEmail.trim() },
  });
}));

app.post('/api/config', handle(async (req, res) => {
  const { repo, scope, name, email } = req.body;
  const flag = scope === 'local' ? '--local' : '--global';
  const g = scope === 'local' && repo && validRepo(repo) ? git(repo) : simpleGit();
  if (scope === 'local' && !(repo && validRepo(repo))) {
    return res.status(400).json({ error: '仓库级配置需要有效的仓库路径' });
  }
  if (name !== undefined) await g.raw(['config', flag, 'user.name', name]);
  if (email !== undefined) await g.raw(['config', flag, 'user.email', email]);
  res.json({ ok: true });
}));

// 放弃某个文件的更改
app.post('/api/discard', handle(async (req, res) => {
  const { repo, file } = req.body;
  if (!validRepo(repo)) return res.status(400).json({ error: '不是有效的 git 仓库' });
  const g = git(repo);
  const st = await g.status();
  if (st.not_added.includes(file)) {
    // 未跟踪文件：直接删除。目标路径必须解析后仍位于仓库内，防止 ../ 穿越删除仓库外文件
    const repoReal = path.resolve(repo);
    const target = path.resolve(repoReal, file);
    if (target !== repoReal && !target.startsWith(repoReal + path.sep)) {
      return res.status(400).json({ error: '非法的文件路径' });
    }
    fs.rmSync(target, { recursive: true, force: true });
  } else {
    await g.checkout(['--', file]);
  }
  res.json({ ok: true });
}));

// 贮藏列表 / 贮藏 / 弹出
app.get('/api/stashes', handle(async (req, res) => {
  const repo = req.query.repo;
  if (!validRepo(repo)) return res.status(400).json({ error: '不是有效的 git 仓库' });
  const out = await git(repo).raw(['stash', 'list']);
  const stashes = out.split('\n').filter(Boolean).map((line) => {
    const m = line.match(/^(stash@\{\d+\}):\s*(.*)$/);
    return m ? { ref: m[1], message: m[2] } : { ref: line, message: '' };
  });
  res.json({ stashes });
}));

app.post('/api/stash', handle(async (req, res) => {
  const { repo, action, message } = req.body;
  if (!validRepo(repo)) return res.status(400).json({ error: '不是有效的 git 仓库' });
  const g = git(repo);
  if (action === 'push') {
    const args = ['stash', 'push', '-u'];
    if (message) args.push('-m', message);
    await g.raw(args);
  } else if (action === 'pop') {
    await g.raw(['stash', 'pop']);
  } else {
    return res.status(400).json({ error: '未知的 stash 操作' });
  }
  res.json({ ok: true });
}));

// 撤销最近一次提交（保留改动到工作区）
app.post('/api/undo-commit', handle(async (req, res) => {
  const { repo } = req.body;
  if (!validRepo(repo)) return res.status(400).json({ error: '不是有效的 git 仓库' });
  await git(repo).raw(['reset', '--mixed', 'HEAD~1']);
  res.json({ ok: true });
}));

// 提交详情（元信息 + 涉及文件）
app.get('/api/commit', handle(async (req, res) => {
  const { repo, hash } = req.query;
  if (!validRepo(repo)) return res.status(400).json({ error: '不是有效的 git 仓库' });
  const g = git(repo);
  const metaOut = await g.raw(['show', '-s', '--format=%H%n%an%n%ae%n%ad%n%B', hash]);
  const lines = metaOut.split('\n');
  const filesOut = await g.raw(['show', '--name-status', '--format=', hash]);
  const files = filesOut.split('\n').filter(Boolean).map((l) => {
    const [status, ...rest] = l.split('\t');
    return { status: status.trim(), path: rest.join('\t') };
  });
  res.json({
    hash: lines[0],
    author: lines[1],
    email: lines[2],
    date: lines[3],
    message: lines.slice(4).join('\n').trim(),
    files,
  });
}));

// 某个提交中单个文件的 diff
app.get('/api/commit-diff', handle(async (req, res) => {
  const { repo, hash, file } = req.query;
  if (!validRepo(repo)) return res.status(400).json({ error: '不是有效的 git 仓库' });
  const diff = await git(repo).raw(['show', '--format=', hash, '--', file]);
  res.json({ diff });
}));

// 新建本地仓库（git init + 首个提交）
app.post('/api/init', handle(async (req, res) => {
  const { parentDir, name } = req.body;
  if (!parentDir || !name || !name.trim()) return res.status(400).json({ error: '缺少目录或仓库名' });
  if (!fs.existsSync(parentDir)) return res.status(400).json({ error: '目标目录不存在' });
  const repoPath = path.join(parentDir, name.trim());
  if (fs.existsSync(repoPath)) return res.status(400).json({ error: '该目录已存在' });
  fs.mkdirSync(repoPath, { recursive: true });
  const g = git(repoPath);
  await g.raw(['init', '-b', 'main']);
  fs.writeFileSync(path.join(repoPath, 'README.md'), `# ${name.trim()}\n`);
  await g.add('README.md');
  await g.commit('Initial commit');
  res.json({ ok: true, path: repoPath });
}));

// 从磁盘删除仓库（需确认字段与目录名一致）
app.post('/api/delete-repo', handle(async (req, res) => {
  const { repo, confirm } = req.body;
  if (!validRepo(repo)) return res.status(400).json({ error: '不是有效的 git 仓库' });
  if (confirm !== path.basename(repo)) {
    return res.status(400).json({ error: '确认字段与仓库目录名不一致' });
  }
  fs.rmSync(repo, { recursive: true, force: true });
  res.json({ ok: true });
}));

// 发布到远程仓库：设置 origin 并首次推送
app.post('/api/publish', handle(async (req, res) => {
  const { repo, url } = req.body;
  if (!validRepo(repo)) return res.status(400).json({ error: '不是有效的 git 仓库' });
  if (!url || !url.trim()) return res.status(400).json({ error: '远程地址不能为空' });
  const g = git(repo);
  const remotes = await g.getRemotes();
  if (remotes.some((r) => r.name === 'origin')) {
    await g.remote(['set-url', 'origin', url.trim()]);
  } else {
    await g.addRemote('origin', url.trim());
  }
  const st = await g.status();
  await g.push(['-u', 'origin', st.current]);
  res.json({ ok: true });
}));

// ---------- 界面状态持久化（仓库列表、面板宽度、主题、上次打开的仓库） ----------
const STATE_DIR = path.join(os.homedir(), '.gitea-desktop');
const STATE_FILE = path.join(STATE_DIR, 'config.json');

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(patch) {
  const next = { ...loadState(), ...patch };
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
  return next;
}

app.get('/api/state', handle(async (req, res) => {
  res.json(loadState());
}));

app.post('/api/state', handle(async (req, res) => {
  res.json(saveState(req.body || {}));
}));

// ---------- 启动 ----------

// 解析命令行参数和 env（支持 npm run dev -- --port 7100）
function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
const port = Number(argVal('--port') || process.env.PORT || 7100);

// 直接运行（npm run dev）时自行监听；被 Electron 引入时只导出 app，由主进程决定端口。
// 始终只绑定 127.0.0.1：API 含删除仓库、放弃更改等破坏性操作，绝不能暴露到局域网
if (require.main === module) {
  app.listen(port, '127.0.0.1', () => {
    console.log(`Gitea Desktop 已启动: http://127.0.0.1:${port}`);
  });
}

module.exports = app;
