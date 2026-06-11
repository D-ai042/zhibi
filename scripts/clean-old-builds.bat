@echo off
cd /d F:\Projects\ai-novel-writer\src-tauri\target\release\bundle\nsis
if exist "zhibi-writer_0.1.0_x64-setup.exe" (
    del "zhibi-writer_0.1.0_x64-setup.exe"
    echo 已删除旧版 nsis 安装包
)
cd /d F:\Projects\ai-novel-writer\src-tauri\target\release\bundle\msi
if exist "zhibi-writer_0.1.0_x64_en-US.msi" (
    del "zhibi-writer_0.1.0_x64_en-US.msi"
    echo 已删除旧版 msi 安装包
)
echo 清理完成
pause
