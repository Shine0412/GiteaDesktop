// Gitea Desktop —— Electron 主进程
const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const expressApp = require('../server');

// 某些环境下 GPU 进程不稳定，禁用硬件加速保证窗口可靠渲染
app.disableHardwareAcceleration();

let server = null;
let mainWindow = null;

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

  // 优先使用固定端口（localStorage 等按源隔离的存储依赖端口稳定），冲突时递增
  function startServer(port) {
    const s = expressApp.listen(port, '127.0.0.1', () => {
      console.log('GITEA_DESKTOP_PORT=' + port);
      server = s;
      createWindow(port);
    });
    s.on('error', (e) => {
      if (e.code === 'EADDRINUSE') startServer(port + 1);
      else throw e;
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
