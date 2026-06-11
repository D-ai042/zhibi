@echo off
cd /d F:\Projects\ai-novel-writer
echo ============================================
echo  zhibi-writer EXE 打包
echo ============================================
echo.
echo [1/2] 编译前端 vite build...
call npm run build
if %errorlevel% neq 0 (
    echo ❌ 前端编译失败！
    pause
    exit /b %errorlevel%
)
echo.
echo [2/2] 编译 Rust + 生成安装包 cargo build...
call npm run tauri:build
if %errorlevel% neq 0 (
    echo ❌ 打包失败！
    pause
    exit /b %errorlevel%
)
echo.
echo ============================================
echo ✅ 打包完成！
echo 安装包位置：
echo   src-tauri\target\release\bundle\nsis\
echo ============================================
pause
