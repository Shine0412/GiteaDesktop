// Gitea Desktop —— Electron 主进程
const { app, BrowserWindow, shell } = require('electron');
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
  // 端口传 0：让系统分配空闲端口，避免冲突
  server = expressApp.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    console.log('GITEA_DESKTOP_PORT=' + port);
    createWindow(port);
  });

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
