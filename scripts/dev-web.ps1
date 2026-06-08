# 启动 Web 开发服务器
# 用途：在浏览器中调试 UI（使用 localStorage 模拟 SQLite，无需 Rust）

Set-Location (Split-Path $PSScriptRoot -Parent)

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Error "未找到 npm，请先运行 scripts\setup.ps1 或安装 Node.js LTS"
    exit 1
}

if (-not (Test-Path "node_modules")) {
    Write-Host "node_modules 不存在，先执行 npm install..." -ForegroundColor Yellow
    npm install
}

Write-Host "启动 Vite 开发服务器 http://localhost:1420" -ForegroundColor Cyan
npm run dev
