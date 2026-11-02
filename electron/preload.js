// 预加载脚本：以受控方式把桌面能力暴露给页面
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  // 打开系统文件夹选择对话框，返回所选路径（取消返回 null）
  pickFolder: (title) => ipcRenderer.invoke('pick-folder', title),
  // 在资源管理器中定位文件/文件夹
  showInFolder: (targetPath) => ipcRenderer.invoke('show-in-folder', targetPath),
});
