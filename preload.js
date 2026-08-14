'use strict'

const { contextBridge, ipcRenderer } = require('electron')

// 只暴露壳需要的窗口控制,不暴露任何 Node 能力
contextBridge.exposeInMainWorld('dshShell', {
  minimize: () => ipcRenderer.send('dsh:minimize'),
  toggleMaximize: () => ipcRenderer.send('dsh:toggle-maximize'),
  close: () => ipcRenderer.send('dsh:close'),
  toggleFullscreen: () => ipcRenderer.send('dsh:toggle-fullscreen'),
  onFullscreenChange: (cb) => ipcRenderer.on('dsh:fullscreen-changed', (_event, value) => cb(value)),
  onMaximizeChange: (cb) => ipcRenderer.on('dsh:maximized-changed', (_event, value) => cb(value)),
})
