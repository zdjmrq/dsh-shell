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
  // 注意力提醒桥:DSH 页面内插件上报状态,主进程负责任务栏闪烁/红点。
  // kind: 'none' | 'intervention'(介入,慢闪) | 'done'(完成,短脉冲)
  setAttention: (state) => ipcRenderer.send('dsh:attention', state),
  onFocusChange: (cb) => {
    const listener = (_event, value) => cb(value)
    ipcRenderer.on('dsh:focus-changed', listener)
    return () => ipcRenderer.removeListener('dsh:focus-changed', listener)
  },
})
