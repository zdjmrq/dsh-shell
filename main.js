'use strict'

const { app, BrowserWindow, Menu, shell, ipcMain, nativeImage } = require('electron')
const { spawn, execFile } = require('child_process')
const net = require('net')
const path = require('path')
const fs = require('fs')

const APP_TITLE = 'DeepSeek Harness'
const START_TIMEOUT_MS = 120000
const POLL_INTERVAL_MS = 700

// ---------- 配置 ----------
// 打包版:读取 exe 旁边的 config.json(方便用户改);
// 开发模式(npm start):退回项目根目录。
function configPath() {
  const besideExe = path.join(path.dirname(process.execPath), 'config.json')
  if (app.isPackaged && fs.existsSync(besideExe)) return besideExe
  return path.join(__dirname, 'config.json')
}

function isDshCheckout(dir) {
  try {
    return fs.existsSync(path.join(dir, 'package.json'))
  } catch {
    return false
  }
}

/**
 * 解析 DSH checkout 目录,按优先级:
 * 1. config.json 里写死的绝对路径(或相对 config 所在目录的路径);
 * 2. 环境变量 DSH_CHECKOUT;
 * 3. 自动探测 config 所在目录附近常见的布局
 *    (deepseek-harness 与 dsh-shell 并排,开发态 / win-unpacked / 安装目录都能命中)。
 * 全部落空返回 null,由 boot 弹错误页引导用户编辑 config.json。
 */
function resolveStartCwd(rawCwd) {
  const base = path.dirname(configPath())
  if (rawCwd && String(rawCwd).trim()) {
    const trimmed = String(rawCwd).trim()
    return path.isAbsolute(trimmed) ? trimmed : path.resolve(base, trimmed)
  }
  const fromEnv = process.env.DSH_CHECKOUT
  if (fromEnv && isDshCheckout(fromEnv)) return fromEnv
  for (const rel of ['deepseek-harness', '../deepseek-harness', '../../deepseek-harness', '../../../deepseek-harness']) {
    const candidate = path.resolve(base, rel)
    if (isDshCheckout(candidate)) return candidate
  }
  return null
}

function loadConfig() {
  let cfg = { port: 3080, start: null }
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(), 'utf8'))
    cfg = Object.assign(cfg, parsed)
  } catch (err) {
    // 配置损坏时用默认值,并在日志里记录
    log('无法读取配置,使用默认值: ' + err.message)
  }
  if (!cfg.start || !cfg.start.command) {
    cfg.start = { cwd: '', command: 'pnpm dsh web' }
  }
  cfg.port = Number(cfg.port) || 3080
  cfg.start.cwd = resolveStartCwd(cfg.start.cwd || '')
  cfg.window = Object.assign({
    overlay: true,
    overlayHeight: 36,
  }, cfg.window || {})
  return cfg
}

const cfg = loadConfig()
const BASE_URL = `http://127.0.0.1:${cfg.port}`

// ---------- 日志 ----------
function logPath() {
  const besideExe = path.join(path.dirname(process.execPath), 'dsh-shell.log')
  if (app.isPackaged && fs.existsSync(path.dirname(besideExe))) return besideExe
  return path.join(__dirname, 'dsh-shell.log')
}

function log(line) {
  try {
    fs.appendFileSync(logPath(), `[${new Date().toISOString()}] ${line}\n`)
  } catch (err) {
    /* 忽略日志写入失败 */
  }
}

// ---------- 服务探测与启动 ----------
function portInUse() {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port: cfg.port })
    sock.setTimeout(600, () => { sock.destroy(); resolve(false) })
    sock.once('connect', () => { sock.destroy(); resolve(true) })
    sock.once('error', () => resolve(false))
  })
}

function waitForServer(getServerExited) {
  const deadline = Date.now() + START_TIMEOUT_MS
  return new Promise((resolve) => {
    const tick = async () => {
      if (await portInUse()) return resolve('ready')
      if (getServerExited && getServerExited()) return resolve('exited')
      if (Date.now() > deadline) return resolve('timeout')
      setTimeout(tick, POLL_INTERVAL_MS)
    }
    tick()
  })
}

let spawnedProc = null
let stopping = false

function startServer(onExit) {
  return new Promise((resolve, reject) => {
    log(`启动服务: ${cfg.start.command} (cwd: ${cfg.start.cwd})`)
    const child = spawn('cmd.exe', ['/d', '/s', '/c', cfg.start.command], {
      cwd: cfg.start.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env),
    })
    spawnedProc = child

    const attach = (stream, tag) => {
      let buf = ''
      stream.on('data', (chunk) => {
        buf += chunk.toString()
        let idx
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).replace(/\r$/, '')
          buf = buf.slice(idx + 1)
          if (line.trim()) log(`${tag} ${line}`)
        }
      })
      stream.on('end', () => {
        if (buf.trim()) log(`${tag} ${buf.trim()}`)
      })
    }
    attach(child.stdout, '[out]')
    attach(child.stderr, '[err]')

    child.once('error', (err) => {
      spawnedProc = null
      log('服务进程启动失败: ' + err.message)
      reject(err)
    })
    child.once('exit', (code) => {
      spawnedProc = null
      log(`服务进程已退出 (code ${code})`)
      if (onExit) onExit(code)
    })
    resolve(child)
  })
}

function stopServer() {
  if (!spawnedProc || !spawnedProc.pid || stopping) return
  stopping = true
  const pid = spawnedProc.pid
  log(`关闭窗口,停止服务进程树 (pid ${pid})`)
  execFile('taskkill', ['/pid', String(pid), '/T', '/F'], (err) => {
    if (err) log('taskkill 失败: ' + err.message)
    stopping = false
  })
  spawnedProc = null
}

// ---------- 页面 ----------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}

function pageHtml(body) {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
<html><head><meta charset="utf-8"><title>${APP_TITLE}</title>
<style>
  body{font-family:"Segoe UI",system-ui,sans-serif;background:#101418;color:#e6edf3;
       display:flex;align-items:center;justify-content:center;height:100vh;margin:0;
       flex-direction:column;gap:14px}
  .spin{width:34px;height:34px;border:3px solid #2b3945;border-top-color:#4d8dff;
        border-radius:50%;animation:s 1s linear infinite}
  @keyframes s{to{transform:rotate(360deg)}}
  h1{font-size:19px;font-weight:600;margin:0}
  .sub{color:#8b98a5;font-size:13px}
  pre{white-space:pre-wrap;max-width:680px;color:#8b98a5;font-size:13px;line-height:1.5;
      background:#161b22;padding:14px 18px;border-radius:8px}
  .err h1{color:#ff7b72}
  .pg-close{position:fixed;top:8px;right:8px;width:36px;height:36px;border:none;border-radius:6px;
            background:transparent;color:#8b98a5;font-size:15px;line-height:1;cursor:pointer}
  .pg-close:hover{background:rgba(139,152,165,.15);color:#e6edf3}
</style></head>
<body>${body}<button class="pg-close" title="关闭" onclick="window.close()">✕</button></body></html>`)
}

function showError(message) {
  if (!win || win.isDestroyed()) return
  win.loadURL(pageHtml(`<div class="err"><h1>启动失败</h1></div><pre>${escapeHtml(message)}</pre>
    <div class="sub">请关闭窗口重试;启动日志: ${escapeHtml(logPath())}</div>`))
}

// ---------- 主流程 ----------
let win = null

async function boot() {
  const alreadyUp = await portInUse()
  if (!alreadyUp) {
    if (!cfg.start.cwd) {
      showError(`找不到 DeepSeek Harness checkout(自动探测失败)。\n\n` +
        `请编辑 exe 旁边的 config.json,把 start.cwd 设为你的 DSH 目录绝对路径;` +
        `或设置环境变量 DSH_CHECKOUT 指向它。\n\n配置文件位置: ${configPath()}`)
      return
    }
    let serverExited = false
    try {
      await startServer((code) => { serverExited = code })
    } catch (err) {
      showError(`无法启动服务命令:\n${cfg.start.command}\n工作目录:${cfg.start.cwd}\n\n${err.message}`)
      return
    }
    const ready = await waitForServer(() => serverExited !== false)
    if (!win || win.isDestroyed()) return
    if (ready === 'exited') {
      log('启动失败: 服务进程提前退出')
      showError(`服务进程启动后立即退出 (exit code ${serverExited})。\n\n` +
        `请检查启动命令:\ncd "${cfg.start.cwd}"\n${cfg.start.command}\n\n日志文件: ${logPath()}`)
      return
    }
    if (ready === 'timeout') {
      stopServer()
      showError(`等待服务就绪超时(${START_TIMEOUT_MS / 1000} 秒):\n${BASE_URL}\n\n` +
        `请检查启动命令是否可用:\ncd "${cfg.start.cwd}"\n${cfg.start.command}`)
      return
    }
  }
  log(`打开 ${BASE_URL}`)
  await win.loadURL(BASE_URL)
}

// ---------- 自定义顶栏(注入 DSH 页面) ----------
// 颜色全部使用 DSH 的 CSS 变量:换皮肤、切深浅色时按钮自动跟随页面变色。
const OVERLAY_CSS = `
#dsh-shell-bar {
  position: fixed; top: 0; left: 0; right: 0; height: 36px; z-index: 2147483000;
  display: flex; justify-content: flex-end; align-items: stretch;
  -webkit-app-region: drag; user-select: none;
}
#dsh-shell-bar .dsb-btns { display: flex; height: 100%; -webkit-app-region: no-drag; }
#dsh-shell-bar .dsb-btn {
  width: 46px; height: 100%; border: none; background: transparent; cursor: default;
  color: var(--dsw-alias-label-secondary, #8b98a5);
  display: flex; align-items: center; justify-content: center;
  transition: background-color .15s ease, color .15s ease, transform .12s ease;
  -webkit-app-region: no-drag;
}
#dsh-shell-bar .dsb-btn:hover { background-color: color-mix(in srgb, currentColor 12%, transparent); }
#dsh-shell-bar .dsb-btn:active { transform: scale(1.15); }
#dsh-shell-bar .dsb-close:hover { background-color: #c42b1c; color: #ffffff; }
#dsh-shell-bar .dsb-btn svg { display: block; }
/* 全屏:内容顶到屏幕最顶,按钮组淡出;鼠标靠近顶部时柔和淡入 */
body.dsh-fs { padding-top: 0 !important; }
body.dsh-fs #dsh-shell-bar { opacity: 0; pointer-events: none; transition: opacity .25s ease; }
body.dsh-fs #dsh-shell-bar.dsb-shown { opacity: 1; pointer-events: auto; }
`

// 注入的 DOM 与行为:一个全屏切换键(四角方框图标)+ 最小化/最大化/关闭。
const OVERLAY_JS = `(() => {
  if (document.getElementById('dsh-shell-bar')) return
  const api = window.dshShell
  if (!api) return
  const icons = {
    fsEnter: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 5.5V2.5h3"/><path d="M13.5 5.5V2.5h-3"/><path d="M2.5 10.5v3h3"/><path d="M13.5 10.5v3h-3"/></svg>',
    fsExit: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M5.5 2.5v3h-3"/><path d="M10.5 2.5v3h3"/><path d="M5.5 13.5v-3h-3"/><path d="M10.5 13.5v-3h3"/></svg>',
    min: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 8h11"/></svg>',
    max: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="10" height="10" rx="1"/></svg>',
    restore: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="8" height="8" rx="1"/><path d="M6.5 5V3.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5H11"/></svg>',
    close: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 4l8 8"/><path d="M12 4l-8 8"/></svg>',
  }
  const bar = document.createElement('div')
  bar.id = 'dsh-shell-bar'
  bar.innerHTML = '<div class="dsb-btns">'
    + '<button class="dsb-btn" id="dsb-fs" title="全屏纯享" aria-label="全屏纯享"></button>'
    + '<button class="dsb-btn" id="dsb-min" title="最小化" aria-label="最小化"></button>'
    + '<button class="dsb-btn" id="dsb-max" title="最大化" aria-label="最大化"></button>'
    + '<button class="dsb-btn dsb-close" id="dsb-close" title="关闭" aria-label="关闭"></button>'
    + '</div>'
  document.body.appendChild(bar)
  const fs = document.getElementById('dsb-fs')
  const mn = document.getElementById('dsb-min')
  const mx = document.getElementById('dsb-max')
  const cl = document.getElementById('dsb-close')
  fs.innerHTML = icons.fsEnter
  mn.innerHTML = icons.min
  mx.innerHTML = icons.max
  cl.innerHTML = icons.close
  fs.addEventListener('click', () => api.toggleFullscreen())
  mn.addEventListener('click', () => api.minimize())
  mx.addEventListener('click', () => api.toggleMaximize())
  cl.addEventListener('click', () => api.close())
  let isFullscreen = false
  let hideTimer = null
  function showBar() {
    bar.classList.add('dsb-shown')
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
  }
  function scheduleHide() {
    if (hideTimer) return
    hideTimer = setTimeout(() => { bar.classList.remove('dsb-shown'); hideTimer = null }, 450)
  }
  api.onFullscreenChange((value) => {
    isFullscreen = value
    document.body.classList.toggle('dsh-fs', value)
    bar.classList.remove('dsb-shown')
    fs.innerHTML = value ? icons.fsExit : icons.fsEnter
    fs.title = value ? '退出全屏' : '全屏纯享'
    fs.setAttribute('aria-label', fs.title)
  })
  api.onMaximizeChange((value) => {
    mx.innerHTML = value ? icons.restore : icons.max
    mx.title = value ? '还原' : '最大化'
  })
  // ---- 注意力提醒:轮询 /dsh-attention + 活动检测,把状态上报壳 ----
  // 需要提醒 = 介入(审批/提问挂起)或未确认的完成事件;
  // "你不在" = 窗口失焦/最小化,或聚焦但超过 attnIdleMs 无任何操作。
  // 任一交互(鼠标移动/点击/滚轮/键盘/触摸)或窗口重新聚焦 = 回到对话。
  let attnKind = 'none'
  let attnFocused = true
  let attnBaseline = false
  let attnLastCompletedId = null
  let attnPendingCompletion = null
  let attnAckedCompletion = null
  let attnLastActivity = Date.now()
  const attnIdleMs = 8000
  if (api.onFocusChange) {
    api.onFocusChange((value) => {
      attnFocused = !!value
      if (value) attnLastActivity = Date.now()
    })
  }
  const markActivity = () => { attnLastActivity = Date.now() }
  for (const ev of ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart']) {
    document.addEventListener(ev, markActivity, { passive: true })
  }
  function setAttn(kind) {
    if (kind === attnKind) return
    attnKind = kind
    if (api.setAttention) api.setAttention({ kind })
  }
  function pollAttention() {
    fetch('/dsh-attention', { cache: 'no-store' }).then((res) => {
      if (!res.ok) return null
      return res.json()
    }).then((state) => {
      if (!state || typeof state !== 'object') return
      if (!attnBaseline) { attnBaseline = true; attnLastCompletedId = state.completedId; return }
      const away = !attnFocused || (Date.now() - attnLastActivity > attnIdleMs)
      if (state.intervention) {
        if (away) setAttn('intervention')
        else setAttn('none')
        return
      }
      if (state.completedId !== attnLastCompletedId) {
        attnLastCompletedId = state.completedId
        attnPendingCompletion = { id: state.completedId, at: state.completedAt }
      }
      if (attnPendingCompletion) {
        if (state.running) {
          attnPendingCompletion = null
        } else {
          const age = Date.now() - attnPendingCompletion.at
          if (age >= 2500) {
            if (!away) {
              // 你一直在看:视为已看到,不闪
              attnAckedCompletion = attnPendingCompletion.id
              attnPendingCompletion = null
            } else if (attnAckedCompletion !== attnPendingCompletion.id) {
              setAttn('done')
              attnAckedCompletion = attnPendingCompletion.id
              attnPendingCompletion = null
            }
          }
        }
      }
      if ((attnKind === 'intervention' || attnKind === 'done') && !away) {
        setAttn('none')
      }
    }).catch(() => {})
  }
  if (api.setAttention) {
    setInterval(pollAttention, 1000)
    pollAttention()
  }
  document.addEventListener('mousemove', (event) => {
    if (!isFullscreen) return
    if (event.clientY <= 60) showBar()
    else scheduleHide()
  })
})()`

function createWindow() {
  const options = {
    width: 1320,
    height: 860,
    minWidth: 940,
    minHeight: 620,
    title: APP_TITLE,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#101418',
    show: false,
  }
  // 自定义无边框窗口:标题条消失,拖动与按钮由注入的顶栏提供,
  // 按钮颜色跟随 DSH 主题变化。overlay:false 可回退传统原生标题栏。
  if (cfg.window.overlay) {
    options.frame = false
    options.webPreferences = {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 最小化/遮挡时页面定时器不节流:注意力轮询必须照常跑,闪烁不延迟
      backgroundThrottling: false,
    }
  }
  win = new BrowserWindow(options)
  Menu.setApplicationMenu(null)

  // 注入顶栏(拖动条 + 全屏/最小化/最大化/关闭)+ 页面顶部让位。
  // DSH 根布局是 html/body/#root{height:100%},border-box + padding 不会裁内容。
  win.webContents.on('dom-ready', () => {
    if (!cfg.window.overlay || win.isDestroyed()) return
    if (!win.webContents.getURL().startsWith(BASE_URL)) return
    win.webContents.insertCSS(
      `body { box-sizing: border-box; padding-top: ${cfg.window.overlayHeight}px !important; }`
      + OVERLAY_CSS,
    ).catch(() => {})
    win.webContents.executeJavaScript(OVERLAY_JS, true).catch(() => {})
  })

  // 渲染进程窗口控制请求(经由 preload 暴露的最小接口)
  ipcMain.on('dsh:minimize', () => { if (win && !win.isDestroyed()) win.minimize() })
  ipcMain.on('dsh:toggle-maximize', () => {
    if (!win || win.isDestroyed()) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on('dsh:close', () => { if (win && !win.isDestroyed()) win.close() })
  ipcMain.on('dsh:toggle-fullscreen', () => {
    if (win && !win.isDestroyed()) win.setFullScreen(!win.isFullScreen())
  })
  win.on('enter-full-screen', () => win.webContents.send('dsh:fullscreen-changed', true))
  win.on('leave-full-screen', () => win.webContents.send('dsh:fullscreen-changed', false))
  win.on('maximize', () => win.webContents.send('dsh:maximized-changed', true))
  win.on('unmaximize', () => win.webContents.send('dsh:maximized-changed', false))

  // ---------- 注意力提醒:有限闪烁 → 常驻淡红(微信式) ----------
  // DSH 页面内插件经 preload 桥上报状态,主进程只做窗口层呈现。
  // 介入与完成同款:页面判定"你不在"(失焦/最小化/聚焦但闲置 8 秒)后上报,
  // 主进程用 flashFrame 触发任务栏闪烁;Electron 的 flashFrame 是有限次数
  // 闪烁(闪几轮后按钮停留高亮态,即微信"常驻淡红"),直到收到 none(用户
  // 回到对话:聚焦或窗口内有操作)或窗口激活才恢复。
  let attention = { kind: 'none' }

  function stopAttentionFx() {
    if (win && !win.isDestroyed()) {
      win.flashFrame(false)
      win.setOverlayIcon(null, '')
    }
  }

  function renderAttention() {
    // 完全信任页面的"你不在"判定(失焦/最小化/闲置 8 秒),不再按窗口聚焦
    // 自行拦截 —— 旧拦截会把"聚焦发呆"场景吞掉。
    stopAttentionFx()
    if (attention.kind === 'none') return
    log(`attention: ${attention.kind}`)
    win.flashFrame(true)
  }

  ipcMain.on('dsh:attention', (_event, state) => {
    const kind = state && typeof state.kind === 'string' ? state.kind : 'none'
    if (kind !== 'none' && kind !== 'intervention' && kind !== 'done') return
    attention.kind = kind
    renderAttention()
  })

  // 窗口聚焦状态推给页面(插件据此决定是否提醒);聚焦即清呈现
  win.on('focus', () => {
    win.webContents.send('dsh:focus-changed', true)
    if (attention.kind !== 'none') renderAttention()
  })
  win.on('blur', () => win.webContents.send('dsh:focus-changed', false))

  // F11 完全全屏(隐藏任务栏),Esc 退出全屏。
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || win.isDestroyed()) return
    if (input.key === 'F11') {
      event.preventDefault()
      win.setFullScreen(!win.isFullScreen())
    } else if (input.key === 'Escape' && win.isFullScreen()) {
      event.preventDefault()
      win.setFullScreen(false)
    }
  })

  // 启动画面(占位,服务就绪后加载真实页面)
  win.loadURL(pageHtml(`<div class="spin"></div><h1>${APP_TITLE}</h1>
    <div class="sub">正在启动 DeepSeek Harness…</div>
    <div class="sub">F11 完全全屏 · Esc 退出全屏</div>`))
  win.once('ready-to-show', () => win.show())

  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('data:')) return
    if (!url.startsWith(BASE_URL)) {
      event.preventDefault()
      if (/^https?:/.test(url)) shell.openExternal(url)
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(BASE_URL)) return { action: 'allow' }
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('did-fail-load', (event, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return
    showError(`页面加载失败: ${desc} (${code})\n${url}`)
  })
  win.on('closed', () => {
    stopAttentionFx()
    win = null
  })

  boot().catch((err) => {
    log('启动流程异常: ' + (err && err.stack ? err.stack : err))
    showError(`启动流程异常:\n${err && err.message ? err.message : err}`)
  })
}

// ---------- 应用生命周期 ----------
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  app.setAppUserModelId('local.dsh.shell')

  app.whenReady().then(createWindow)

  app.on('window-all-closed', () => {
    stopServer()
    app.quit()
  })

  app.on('before-quit', () => {
    stopServer()
  })
}
