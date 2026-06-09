# 执笔（zhibi）项目记录

## 项目概述
AI 辅助长篇小说写作桌面应用，Tauri v2 + React + TypeScript + Rust 构建。

## 仓库地址
https://github.com/D-ai042/zhibi

## 本次修改（2026-06-09）：导出对话框修复 + 多平台构建 + 构建修复

### 第一轮：导出对话框修复
- **导出 DOCX 时弹出文件选择对话框**：`src/lib/export-doc.ts` 的 `downloadDoc` 函数重写，
  改用 `@tauri-apps/plugin-dialog` 的 `save()` 弹出原生保存对话框，绕过 mock 后端直接调 Rust `invoke("save_export_file")`
- **数据备份 JSON 导出也弹出对话框**：`src/components/settings/SettingsModal.tsx` 同样加入 Tauri 对话框
- **ZIP 导出支持自定义路径**：`src-tauri/src/commands/export.rs` 新增 `file_path` 可选参数
- **mock 后端补充**：`src/lib/mock-backend.ts` 补充 `save_export_file` 分支
- **bundle identifier 修复**：`com.zhibi.app` → `com.zhibi.writer`（避免 Mac 打包冲突）

### 第二轮：GitHub Actions 构建修复
- **Mac 构建失败**：缺 `icon.icns` 文件，用 PowerShell 脚本从 `icon.png` 生成
- **Win/Linux 构建失败**：`build.yml` 缺 `permissions: contents: write`，tauri-action 无法创建 Release
- **Node.js 20 弃用警告**：加 `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true`
- **新增文件**：`scripts/gen-icns.py`（Python 版 icns 生成脚本）

### 修改的文件
| 文件 | 说明 |
|---|---|
| `src/lib/export-doc.ts` | DOCX 导出对话框 |
| `src/components/settings/SettingsModal.tsx` | JSON 备份导出对话框 |
| `src-tauri/src/commands/export.rs` | ZIP 导出支持自选路径 |
| `src-tauri/tauri.conf.json` | Mac 打包目标 + identifier 修复 |
| `src-tauri/icons/icon.icns` | Mac 打包所需图标（新生成） |
| `src/lib/mock-backend.ts` | 补充 save_export_file mock |
| `.github/workflows/build.yml` | 多平台构建 + permissions + Node24 |
| `scripts/gen-icns.py` | ICNS 生成脚本 |

### GitHub Actions 自动构建
- 文件：`.github/workflows/build.yml`
- 触发：`git push --tags` 或手动在 Actions 页面触发
- 产出：Windows `.msi`、Mac Intel `.dmg`、Mac M 芯片 `.dmg`、Linux `.deb`
- 下载页：https://github.com/D-ai042/zhibi/releases

## 本地构建命令
```bash
# Windows 打包
npm run tauri:build
# 输出：src-tauri\target\release\bundle\nsis\执笔_0.1.0_x64-setup.exe
```

## 关键路径
| 用途 | 路径 |
|---|---|
| 项目根目录 | `F:\Projects\ai-novel-writer` |
| Rust 后端 | `src-tauri/` |
| 前端源码 | `src/` |
| 导出逻辑 | `src/lib/export-doc.ts` |
| API 层 | `src/lib/api.ts` |
| Mock 后端 | `src/lib/mock-backend.ts` |
| 设置页 | `src/components/settings/SettingsModal.tsx` |
| 主布局（含导出菜单） | `src/layouts/AppShell.tsx` |

## 技术栈
- 前端：React 18 + TypeScript + Vite + Tailwind CSS + Zustand
- 桌面壳：Tauri v2 (Rust)
- 文档导出：docx (npm 包)
- UI 组件：@xyflow/react (流程图), @tiptap/react (富文本), lucide-react (图标)

## GitHub 仓库信息（2026-06-09）
- **仓库地址**：https://github.com/D-ai042/zhibi （公开）
- **GitHub 账号**：D-ai042
- **用途**：代码备份 + GitHub Actions 免费云端打包 Mac/Win/Linux
- **自动构建**：推送 tag（如 `v0.1.0`）自动触发，也可在 Actions 页面手动触发
- **构建产物下载**：https://github.com/D-ai042/zhibi/releases
- **注意**：Actions 跑在 GitHub 云端，关机也不影响构建
- **每夜自动 git commit**：本机有 auto-git.cjs 守护进程，改代码后 5 秒自动提交到本地 git
- **第二夜发现红叉**：Linux 构建用了 `ext: deb` 但实际产出 `.AppImage`，已改为 `ext: AppImage`

## 下次继续时你需要知道的
1. 打开项目：`F:\Projects\ai-novel-writer`
2. 读这个文档：`F:\Projects\ai-novel-writer\SESSION-NOTES.md`
3. 启动开发服务器：`npm run dev`（或运行 VS Code task `dev-server`）
4. 如果想手动推送到 GitHub：`git add . && git commit -m "描述" && git push`
5. 如果想触发新版本构建：`git tag -f v0.1.1 && git push -f origin v0.1.1`
6. 用户之前提到了用户规则，记得每次回复第一句是规则 title
