# Novel Workbench · 骨架写作台

Windows 桌面长篇小说创作工作台（Tauri 2 + React + SQLite + DeepSeek）。

## 功能（MVP）

- 总览仪表盘、剧情时间轴、明暗线泳道、分章节拍 Kanban、人物关系星图、章节富文本
- 框架锁定流程
- DeepSeek API（Key 存系统凭据库，Rust 侧调用）
- 浏览器开发模式：无 Rust 时用 localStorage 模拟后端

## 环境要求

| 工具 | 用途 |
|------|------|
| Node.js 18+ | 前端构建与 `npm run dev` |
| Rust + MSVC (Windows) | `npm run tauri:dev` / 打包 exe |
| Visual Studio Build Tools | Windows 上编译 Rust 依赖 |

## 快速开始（Windows）

在 PowerShell 中进入项目目录后：

```powershell
# 检查 Node/Rust 并自动 npm install（若已安装 Node）
.\scripts\setup.ps1

# 启动 Web 开发模式（浏览器访问 http://localhost:1420）
.\scripts\dev-web.ps1
```

若提示找不到 `npm`，请先安装 Node.js LTS：

```powershell
winget install OpenJS.NodeJS.LTS
```

安装后**重新打开终端**，再执行 `.\scripts\setup.ps1`。

## 命令说明

| 命令 | 用途 |
|------|------|
| `npm install` | 根据 package.json 安装前端依赖到 node_modules |
| `npm run dev` | 启动 Vite 开发服务器（Web 模式，localStorage 模拟库） |
| `npm run build` | 编译前端静态资源到 dist/ |
| `npm run tauri:dev` | 编译并启动 Tauri 桌面窗口（需 Rust） |
| `npm run tauri:build` | 打包 Windows exe 安装包（需 Rust + 图标） |

## 数据路径

- 正式版：`%APPDATA%/NovelWorkbench/projects/{project_id}/project.db`
- 开发 Web 版：`localStorage` 键 `novel-workbench-mock`

## 文档

完整产品规格见 [docs/PROJECT.md](docs/PROJECT.md)。

## 图标

打包前请在 `src-tauri/icons/` 放置 `icon.png`（1024×1024 推荐），或运行：

```bash
npm run tauri icon path/to/your-icon.png
```
