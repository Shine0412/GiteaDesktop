// Gitea Desktop —— Electron 主进程
const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const expressApp = require('../server');

// 某些环境下 GPU 进程不稳定，禁用硬件加速保证窗口可靠渲染
app.disableHardwareAcceleration();

let server = null;
let mainWindow = null;

// 单实例锁：避免多个实例各自起服务、并发写同一份状态文件
const singleInstance = app.requestSingleInstanceLock();
if (singleInstance) {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: 'Gitea Desktop',
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  // 外部链接交给系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  if (!singleInstance) return; // 非首个实例：直接退出
  // 原生文件夹选择对话框
  ipcMain.handle('pick-folder', async (_e, title) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: title || '选择文件夹',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  // 在资源管理器中定位
  ipcMain.handle('show-in-folder', (_e, targetPath) => {
    shell.showItemInFolder(targetPath);
  });

  // 优先使用固定端口，冲突时最多尝试 5 个，避免静默漂移导致本地存储错位
  function startServer(port, attempt = 0) {
    const s = expressApp.listen(port, '127.0.0.1', () => {
      console.log('GITEA_DESKTOP_PORT=' + port);
      server = s;
      createWindow(port);
    });
    s.on('error', (e) => {
      if (e.code === 'EADDRINUSE' && attempt < 4) startServer(port + 1, attempt + 1);
      else {
        console.error('无法启动本地服务，端口均被占用:', e.message);
        app.quit();
      }
    });
  }
  startServer(7100);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && server) {
      createWindow(server.address().port);
    }
  });
});

app.on('window-all-closed', () => {
  if (server) server.close();
  app.quit();
});
