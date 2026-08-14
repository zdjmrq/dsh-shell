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

## 发布到 GitHub

1. 在 github.com 新建仓库(建议 Public),创建时或之后在
   **仓库 Settings → Topics** 添加主题标签 `dsh-plugin`
   (添加后该仓库会出现在 <https://github.com/topics/dsh-plugin>);
2. 本地推送:

```powershell
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git branch -M main
git push -u origin main
```

   推送时 GitHub 要求认证:用户名 + **Personal Access Token**(不是密码,
   在 GitHub Settings → Developer settings 生成,勾选 repo 权限);
   也可以直接用 GitHub Desktop 登录后点 Push,更省事;
3. 发版:把 `release\DSH-Desktop-0.1.0-win-x64.zip` 上传到仓库
   **Releases** 页面(tag 填 `v0.1.0`),并在说明里附上使用方式。

仓库不含任何机器私有路径(DSH 目录自动探测),clone 后:

```powershell
npm install
npm start          # 开发模式,直接跑
# 或
npm run dist:dir   # 出绿色版目录
npm run dist       # 绿色版目录 + 安装器
```

提交前确认 `config.json` 的 `start.cwd` 是空或相对路径,别把本机绝对路径提交上去。

## 注意事项

- 不要同时手动跑 DSH 又期望壳再开一个:壳发现端口被占会直接复用,这是特性。
- 想让壳"自己启动服务",需要先停掉所有占用 3080 的 DSH 实例。
- 快捷方式图标默认取自打包配置里的 `assets/icon.png`。
