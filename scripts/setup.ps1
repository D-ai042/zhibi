# Novel Workbench 环境准备脚本
# 用途：检查 Node / Rust 是否可用，并尝试安装前端依赖

Write-Host "=== Novel Workbench 环境检查 ===" -ForegroundColor Cyan

# 1) 检查 npm（完整 Node.js 安装包自带 npm）
$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) {
    Write-Host "[缺少] 未找到 npm。请安装 Node.js LTS：" -ForegroundColor Yellow
    Write-Host "  winget install OpenJS.NodeJS.LTS" -ForegroundColor White
    Write-Host "  或从 https://nodejs.org 下载安装后重启终端。" -ForegroundColor White
} else {
    Write-Host "[OK] npm: $($npm.Source)" -ForegroundColor Green
    Set-Location (Split-Path $PSScriptRoot -Parent)
    Write-Host "正在执行 npm install（安装 package.json 中的依赖）..." -ForegroundColor Cyan
    npm install
}

# 2) 检查 Rust（打包 Tauri 桌面 exe 需要）
$cargo = Get-Command cargo -ErrorAction SilentlyContinue
if (-not $cargo) {
    Write-Host "[缺少] 未找到 Rust/cargo。打包 exe 需要：" -ForegroundColor Yellow
    Write-Host "  winget install Rustlang.Rustup" -ForegroundColor White
    Write-Host "  安装后执行: rustup default stable" -ForegroundColor White
} else {
    Write-Host "[OK] cargo: $($cargo.Source)" -ForegroundColor Green
}

Write-Host ""
Write-Host "开发命令：" -ForegroundColor Cyan
Write-Host "  npm run dev        # 仅 Web UI（localStorage 模拟数据库）"
Write-Host "  npm run tauri:dev  # 完整桌面应用（需 Rust）"
