// Gitea Desktop —— 本地可视化 Git 仓库管理工具后端
const express = require('express');
const path = require('path');
const fs = require('fs');
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

// 错误处理包装
const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    res.status(400).json({ error: err.message || String(err) });
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
  await simpleGit().clone(url, path.join(parentDir, repoNameFromUrl(url)));
  res.json({ ok: true, path: path.join(parentDir, repoNameFromUrl(url)) });
}));

function repoNameFromUrl(url) {
  const base = url.replace(/\.git$/, '').split('/').pop().split(':').pop();
  return base || 'repo';
}

// 仓库状态（分支、改动文件、与远程的差距）
app.get('/api/status', handle(async (req, res) => {
  const repo = req.query.repo;
  if (!validRepo(repo)) return res.status(400).json({ error: '不是有效的 git 仓库' });
  const g = git(repo);
  const status = await g.status();
  res.json({
    current: status.current,
    tracking: status.tracking,
    ahead: status.ahead,
    behind: status.behind,
    staged: status.staged,
    modified: status.modified,
    created: status.created,
    deleted: status.deleted,
    not_added: status.not_added,
    files: status.files,
  });
}));

// 提交历史
app.get('/api/log', handle(async (req, res) => {
  const repo = req.query.repo;
  if (!validRepo(repo)) return res.status(400).json({ error: '不是有效的 git 仓库' });
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const log = await git(repo).log({ maxCount: limit });
  res.json({ commits: log.all });
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

// ---------- 启动 ----------

// 解析命令行参数和 env（支持 npm run dev -- --port 7100 --host 0.0.0.0）
function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
const port = Number(argVal('--port') || process.env.PORT || 7100);
const host = argVal('--host') || process.env.HOST || '127.0.0.1';

// 直接运行（npm run dev）时自行监听；被 Electron 引入时只导出 app，由主进程决定端口
if (require.main === module) {
  app.listen(port, host, () => {
    console.log(`Gitea Desktop 已启动: http://${host}:${port}`);
  });
}

module.exports = app;
