# publish.ps1 — 把 dsh-shell 一键发布到 GitHub
# 自动完成:建仓库 → 打 dsh-plugin 主题标签 → 推代码 → 发 Release 并上传 zip
#
# 用法(推荐,Token 不进入命令历史):
#   pwsh -File publish.ps1
# 或显式传参:
#   pwsh -File publish.ps1 -Token ghp_xxx -RepoName dsh-shell
#
# Token 获取:github.com → Settings → Developer settings → Personal access tokens
#   → Tokens (classic) → Generate new token (classic)
#   勾选 repo 权限,有效期建议 7 天。发布完成后建议立即删除该 Token。
param(
  [string]$Token,
  [string]$RepoName = 'dsh-shell',
  [string]$Description = 'DSH 桌面壳:把 DeepSeek Harness Web UI 装进原生窗口;轻量、不改官方 UI、不影响 UI 插件',
  [string]$Tag = 'v0.1.0',
  [string]$ZipPath = 'release\DSH-Desktop-0.1.0-win-x64.zip'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if (-not $Token) {
  $secure = Read-Host -Prompt '粘贴 GitHub Personal Access Token(输入内容不会显示)' -AsSecureString
  $Token = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}
if (-not $Token) { throw '未提供 Token' }
if (-not (Test-Path $ZipPath)) { throw "找不到 zip: $ZipPath(请先构建并生成发布 zip)" }
if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) { throw '需要 curl.exe(Windows 10+ 自带)' }

$headers = @{
  Authorization = "Bearer $Token"
  'User-Agent'  = 'dsh-shell-publish'
  Accept        = 'application/vnd.github+json'
}

function ApiError([string]$Stage, $Err) {
  $status = [int]$Err.Exception.Response.StatusCode
  $detail = $Err.ErrorDetails.Message
  if ($status -eq 401) { throw 'Token 无效或已过期(401),请重新生成一个' }
  throw "失败于 [$Stage]: HTTP $status $detail"
}

# 1. 确认账号
try {
  $me = Invoke-RestMethod -Uri 'https://api.github.com/user' -Headers $headers
} catch { ApiError '读取账号' $_ }
$owner = $me.login
Write-Host "账号: $owner" -ForegroundColor Cyan

# 2. 建仓库(已存在则复用)
try {
  $body = @{ name = $RepoName; description = $Description; private = $false } | ConvertTo-Json
  Invoke-RestMethod -Method Post -Uri 'https://api.github.com/user/repos' `
    -Headers $headers -ContentType 'application/json' -Body $body | Out-Null
  Write-Host "已创建仓库: $RepoName" -ForegroundColor Green
} catch {
  if ([int]$_.Exception.Response.StatusCode -eq 422) {
    Write-Host "仓库 $RepoName 已存在,直接复用" -ForegroundColor Yellow
  } else { ApiError '创建仓库' $_ }
}

# 3. 打 dsh-plugin 主题标签(仓库会出现在 github.com/topics/dsh-plugin)
try {
  $body = @{ names = @('dsh-plugin') } | ConvertTo-Json
  Invoke-RestMethod -Method Put -Uri "https://api.github.com/repos/$owner/$RepoName/topics" `
    -Headers $headers -ContentType 'application/json' -Body $body | Out-Null
  Write-Host '已添加主题标签: dsh-plugin' -ForegroundColor Green
} catch { ApiError '设置主题' $_ }

# 4. 推送代码(推送 URL 里使用一次性 Token,推完立刻从 remote 配置中擦除)
git remote remove origin 2>$null
git remote add origin "https://x-access-token:$Token@github.com/$owner/$RepoName.git"
git branch -M main
git push -u origin main
if ($LASTEXITCODE -ne 0) { throw 'git push 失败(网络或认证问题),可重试本脚本' }
git remote set-url origin "https://github.com/$owner/$RepoName.git"
Write-Host '代码已推送' -ForegroundColor Green

# 5. 创建 Release 并上传 zip
$zip = (Resolve-Path $ZipPath).Path
$releaseBody = @{
  tag_name = $Tag
  name     = "DSH Desktop $Tag"
  body     = '免安装绿色版:解压后双击 DSH Desktop.exe 即可。DSH 目录自动探测,找不到时编辑 config.json 或设置环境变量 DSH_CHECKOUT。'
} | ConvertTo-Json
try {
  $release = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$owner/$RepoName/releases" `
    -Headers $headers -ContentType 'application/json' -Body $releaseBody
} catch {
  if ([int]$_.Exception.Response.StatusCode -eq 422) {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$RepoName/releases/tags/$Tag" -Headers $headers
    Write-Host "Release $Tag 已存在,复用" -ForegroundColor Yellow
  } else { ApiError '创建 Release' $_ }
}
$assetName = Split-Path $zip -Leaf
$uploadUrl = ($release.upload_url -replace '\{[^}]*\}$', '') + '?name=' + [uri]::EscapeDataString($assetName)
# --ssl-no-revoke:Windows 自带 curl 的 schannel 证书吊销检查偶尔误报(exit 35),跳过不影响安全性
& curl.exe -sS --ssl-no-revoke -X POST -H "Authorization: Bearer $Token" -H 'Content-Type: application/zip' `
  --data-binary "@$zip" $uploadUrl | Out-Null
if ($LASTEXITCODE -ne 0) { throw "zip 上传失败(curl exit $LASTEXITCODE),网络问题可直接重试本脚本" }

Write-Host 'Release + zip 上传完成' -ForegroundColor Green
Write-Host "仓库地址: https://github.com/$owner/$RepoName" -ForegroundColor Cyan
Write-Host '收尾提醒:去 GitHub Settings → Developer settings 删除或停用刚才的 Token' -ForegroundColor DarkGray
