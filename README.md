> [!WARNING]
> **本仓库已废弃** —— 相关能力已随 dsh 正式版本内置发布，无需再安装本插件；仓库仅作历史存档，不再维护。

# DSH Desktop(轻量一键桌面壳)

把 DeepSeek Harness 的 Web UI 包进一个原生桌面窗口,双击即用。

## 定位:轻量壳,不碰官方 UI

- **只做基本的打包**:壳仅仅把 DSH Web UI 装进一个原生窗口,页面内容与浏览器
  打开 `http://127.0.0.1:3080` 看到的**完全一致**,完全遵循官方 UI;
- **不影响任何 UI 插件**:皮肤、侧边栏、会话插件等全部照常工作;壳只注入
  窗口边框层(顶部拖动条与窗口按钮),不修改 DSH 的任何页面结构或 UI 面板;
- **仅加入窗口层按键**:全屏、最小化、最大化、关闭都属于窗口边框层,
  不进入 DSH 的页面 UI。

## 工作原理

1. 启动时探测 `http://127.0.0.1:3080`(端口可在 `config.json` 改):
   - **已有服务在跑**(比如你手动启动的)→ 直接以窗口打开,关闭窗口**不会**影响原服务;
   - **没有服务** → 按 `config.json` 里的命令自动启动 DSH 服务,就绪后打开窗口;
     **关闭窗口时只杀掉自己启动的服务**,不留后台进程。
2. 单实例:重复双击只会把已有窗口带到前台。
3. 所有启动/停止细节记录在 exe 旁边的 `dsh-shell.log`,排查问题看它。

## 窗口与快捷键

- 无边框窗口:顶部有一条自绘顶栏,可**拖动窗口**;右上角依次是
  **全屏 / 最小化 / 最大化 / 关闭** 四个按钮。
- 按钮颜色**跟随 DSH 主题**:换皮肤、切深浅色时自动变色。
- **全屏按钮**(四角方框图标):长悬停显示「全屏纯享」,点击进入完全全屏;
  全屏后按钮组淡出隐藏,**鼠标靠近屏幕顶部时柔和淡入**(可点按钮退出,
  全屏时点击也可关闭窗口)。
- 退出全屏:再点全屏按钮、按 **Esc** 或 **F11** 均可;F11 也可进入全屏。
- 不想用无边框:把 exe 旁 `config.json` 的 `window.overlay` 改为 `false`,
  回到传统原生标题栏(此时 F11/Esc 全屏仍可用)。

## 任务栏提醒(需 DSH 侧提醒插件配合,推荐配套 [dsh-attention-notifier](https://github.com/zdjmrq/dsh-attention-notifier))

任务栏提醒需要 DSH 侧提醒插件配合,**推荐配套使用
[dsh-attention-notifier](https://github.com/zdjmrq/dsh-attention-notifier)**
(宿主层持久化插件,只做判定、不碰 UI、自带 `stats` 自诊断),按其 README
装好后把状态挂在 `GET /dsh-attention`(审批/提问挂起、一轮工作完成)。壳注入
的页面轮询器读取它,经桥(`window.dshShell.setAttention`)上报,主进程在
Windows 任务栏用系统级按钮闪烁(微信新消息同款机制,按钮整体明暗呼吸)给出
提醒,**介入与完成同款**:

- **需要介入**(审批/提问等待处理)或**一轮工作完成**后,只要"你没在关注"
  —— 窗口失焦/最小化,或聚焦但超过 8 秒没有任何操作 —— 任务栏按钮就闪烁
  (闪几轮后常驻淡红,微信同款);
- **回到对话**(窗口聚焦,或窗口内任意鼠标移动/点击/滚轮/键盘操作)立即熄灭;
- 完成事件若发生在你正活跃地看着窗口时,视为已看到,不闪。

壳只消费 `GET /dsh-attention` 这一个契约(字段定义见
dsh-attention-notifier 的 README),**任何实现同一契约的提醒插件都能配合
使用**,不绑定具体实现;没装这类插件时壳不探测 DSH 页面状态、任务栏也不
闪烁 —— 与"轻量壳、不碰官方 UI"的定位一致。

### 配合安装(一次性)

1. 按 [dsh-attention-notifier](https://github.com/zdjmrq/dsh-attention-notifier)
   的 README 把插件装进 DSH(宿主层即可,所有预设、所有会话自动生效);
2. 重启 DSH(直接关掉壳重开即可)后验证:
   `Invoke-WebRequest http://127.0.0.1:3080/dsh-attention` 返回 JSON 即就绪;
3. 之后正常使用,无需其他配置。

## 使用

### 打包成免安装版(推荐日常使用)

```powershell
npm install
npm run dist:dir
```

产物在 `release\win-unpacked\DSH Desktop.exe`,双击即可运行
(绿色版不含安装器,不会自动创建快捷方式)。

**创建桌面快捷方式(手动,一步)**:

1. 右键 `DSH Desktop.exe`;
2. Windows 11:点「显示更多选项」→「发送到」→「桌面快捷方式」
   (Windows 10 直接有「发送到」);
3. 桌面出现「DSH Desktop - 快捷方式」,双击即用,图标自动使用壳的图标。

**注意:移动项目文件夹后,快捷方式需要重新创建。**

### 开发模式(改了代码想快速试)

```powershell
npm start
```

## 更新 DSH / 配置

壳不包含任何 DSH 代码,DSH 更新照常进行(在 checkout 里 `git pull` 等)。
启动配置在 exe 旁边的 `config.json`:

```json
{
  "port": 3080,
  "start": {
    "cwd": "",
    "command": "pnpm dsh web"
  },
  "window": {
    "overlay": true,
    "overlayHeight": 36
  }
}
```

- `port`:DSH web 端口(默认 3080)
- `start.cwd`:DSH checkout 目录。**留空则自动探测**:
  1. 环境变量 `DSH_CHECKOUT`;
  2. config 附近常见的并排布局(如 `../deepseek-harness`)。
  自动探测失败时启动页会给出提示;也可以直接填绝对路径(如
  `D:\\Deepseek Harness\\deepseek-harness`)或相对 config 所在目录的路径。
- `start.command`:启动命令(要求 `pnpm` 在 PATH 中)
- `window.overlay`:`false` 时回到传统原生标题栏
- `window.overlayHeight`:顶栏(拖动条 + 按钮)高度,默认 36px

## 安装包(自动创建桌面快捷方式)

```powershell
npm run dist
```

同时产出两种形态,都在 `release\`:

- `win-unpacked\DSH Desktop.exe` — 免安装绿色版;
- `DSH Desktop Setup <版本>.exe` — NSIS 安装器,安装时**自动创建桌面和开始菜单快捷方式**,
  免管理员权限(装到当前用户目录),带卸载程序。

未签名安装包首次运行时 Windows SmartScreen 会提示,选「更多信息 → 仍要运行」即可。

## 注意事项

- 不要同时手动跑 DSH 又期望壳再开一个:壳发现端口被占会直接复用,这是特性。
- 想让壳"自己启动服务",需要先停掉所有占用 3080 的 DSH 实例。
- 快捷方式图标默认取自打包配置里的 `assets/icon.png`。
- 任务栏提醒需要 DSH 侧装提醒插件(推荐
  [dsh-attention-notifier](https://github.com/zdjmrq/dsh-attention-notifier)),
  没装时任务栏不会闪烁。

## 📖 文字开源描述

本壳在「文字开源」枢纽仓库 [dsh-text-open-source](https://github.com/zdjmrq/dsh-text-open-source) 中配有完整描述（功能 / 技术路线 / 结构 / 关键实现 / 复刻提示词，不依赖代码即可复刻、便于理解与微调）：[plugins/dsh-shell.md](https://github.com/zdjmrq/dsh-text-open-source/blob/main/plugins/dsh-shell.md)。

## License

[MIT](./LICENSE)
