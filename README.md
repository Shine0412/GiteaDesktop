# Gitea Desktop

一个本地运行的可视化 Git 仓库管理桌面工具，界面风格参考 GitHub，适合搭配自建 Gitea 使用。

![Logo](assets/logo-src.png)

## 功能

- **仓库管理**：原生文件夹选择器、扫描目录自动发现、克隆 SSH/HTTPS、打开已有仓库、新建仓库（git init + 首个提交）、从列表移除 / 从磁盘删除（需输入目录名确认）、在资源管理器中定位
- **改动视图**：文件状态标识（修改/新增/删除）、勾选暂存、彩色 diff、单文件放弃更改、撤销最近一次提交
- **提交**：按 Git 全局/仓库级身份配置提交，提交前显示当前身份
- **同步**：Fetch / Pull / Push，显示 ahead / behind 数量，首次推送自动建立上游分支
- **分支**：切换、新建、删除分支
- **历史**：提交列表 + 提交详情（涉及文件、单文件 diff）
- **贮藏**：贮藏当前改动（含未跟踪文件）、查看贮藏列表、恢复贮藏
- **设置**：查看和修改全局 / 仓库级 Git 身份（user.name、user.email）
- 状态每 30 秒自动刷新

## 技术栈

- **桌面壳**：Electron
- **后端**：Express + simple-git（所有 Git 操作通过本机 Git 完成，SSH 密钥沿用系统配置）
- **前端**：原生 HTML/CSS/JS，GitHub Primer 风格

## 开发

```bash
npm install
npm run dev     # 网页版: http://localhost:7100
npm start       # Electron 桌面版
```

国内网络环境如遇证书问题，可使用镜像源：

```bash
npm install --registry=https://registry.npmmirror.com
```

## 打包

发布版本位于 `dist/Gitea Desktop/`，双击 `Gitea Desktop.exe` 即可运行（绿色软件，免安装）。

## 许可证

MIT
