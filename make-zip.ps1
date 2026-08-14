# make-zip.ps1 — 把 release\win-unpacked 打包成发布 zip(顶层文件夹 DSH-Desktop-<版本>)
# 用法: powershell -NoProfile -File make-zip.ps1 [-Version 0.1.0]
param([string]$Version = '0.1.0')

$ErrorActionPreference = 'Stop'
$unpacked = 'release\win-unpacked'
$stage = "release\DSH-Desktop-$Version"
$zipName = "DSH-Desktop-$Version-win-x64.zip"

if (-not (Test-Path $unpacked)) { throw "找不到 $unpacked,请先运行 npm run dist:dir" }
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item "$unpacked\*" -Destination $stage -Recurse -Force
Compress-Archive -Path $stage -DestinationPath "release\$zipName" -CompressionLevel Optimal -Force
Remove-Item $stage -Recurse -Force
Write-Host "已生成 release\$zipName"
