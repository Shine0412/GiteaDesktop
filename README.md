# Gitea Desktop

一个本地运行的可视化 Git 仓库管理桌面工具，界面风格参考 GitHub，适合搭配自建 Gitea 使用。

![Logo](assets/logo-src.png)

## 功能

- **仓库管理**：扫描本地目录自动发现 Git 仓库、克隆 SSH/HTTPS 仓库、打开已有仓库
- **改动视图**：文件状态标识（修改/新增/删除）、勾选暂存、彩色 diff 对比
- **提交**：提交说明 + 详细描述，一键提交
- **同步**：Fetch / Pull / Push，显示 ahead / behind 数量，首次推送自动建立上游分支
- **分支**：切换分支、新建分支
- **历史**：提交记录列表（作者、时间、短哈希）

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
