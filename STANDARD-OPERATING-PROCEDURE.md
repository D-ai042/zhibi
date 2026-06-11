# 执笔（zhibi-writer）标准操作流程

> **项目简介**：AI 辅助小说创作桌面应用（Tauri v2 + React + Rust）
> **仓库地址**：`https://github.com/D-ai042/zhibi`
> **最新版本**：v0.2.4

---

## 目录

1. [开发环境搭建](#1-开发环境搭建)
2. [目录结构](#2-目录结构)
3. [本地开发](#3-本地开发)
4. [构建 EXE 安装包](#4-构建-exe-安装包)
5. [发布流程（推送到 GitHub）](#5-发布流程推送到-github)
6. [CI/CD 自动构建](#6-cicd-自动构建)
7. [常见问题](#7-常见问题)

---

## 1. 开发环境搭建

### 前置依赖

| 工具 | 版本要求 | 用途 |
|------|---------|------|
| Node.js | ≥ 20 | 前端构建 |
| Rust | ≥ 1.77 | Tauri 后端编译 |
| Visual Studio Build Tools | 2022 | Windows 原生编译 (MSVC) |
| WiX Toolset | ≥ 3.11 | MSI 安装包生成 |

### 初始化步骤

```bash
# 1. 安装前端依赖
cd F:\Projects\ai-novel-writer
npm install

# 2. 安装 Tauri CLI（如未全局安装）
npm install -g @tauri-apps/cli

# 3. 检查 Rust 环境
rustc --version        # 应 ≥ 1.77
cargo --version

# 4. 检查 WiX（MSI 构建需要）
candle --version       # 应 ≥ 3.11
```

---

## 2. 目录结构

```
F:\Projects\ai-novel-writer/
├── src/                          # 前端 React 源码
│   ├── App.tsx                   # 根组件
│   ├── main.tsx                  # 入口
│   ├── components/               # 通用组件
│   ├── hooks/                    # 自定义 Hooks
│   ├── layouts/                  # 布局组件（AppShell、AI 对话、右侧面板）
│   ├── lib/                      # 核心库（API、存储、AI 引擎等）
│   ├── modules/                  # 业务模块（写作台、大纲、人物等）
│   ├── stores/                   # Zustand 状态管理
│   └── types/                    # TypeScript 类型定义
├── src-tauri/                    # Tauri Rust 后端
│   ├── src/
│   │   ├── main.rs               # 入口
│   │   ├── lib.rs                # 插件注册
│   │   ├── models.rs             # 数据模型
│   │   └── commands/             # Tauri 命令（AI、数据库、导出）
│   ├── tauri.conf.json           # Tauri 配置
│   └── Cargo.toml                # Rust 依赖
├── .github/workflows/build.yml   # CI/CD 构建配置
├── package.json                  # 前端依赖
└── STANDARD-OPERATING-PROCEDURE.md  # 本文档
```

---

## 3. 本地开发

### 启动浏览器开发模式

```bash
npm run dev
# 默认 http://localhost:1420
# 数据存储在浏览器 localStorage
```

### 启动 Tauri 桌面开发模式

```bash
npm run tauri:dev
# 会打开原生窗口，数据存储在 SQLite
```

### 构建验证

```bash
npm run build
# 输出在 dist/ 目录
# 检查是否有编译错误
```

---

## 4. 构建 EXE 安装包

### 构建命令

```bash
npm run tauri build
```

### 产物位置

| 格式 | 路径 |
|------|------|
| NSIS 安装包 | `src-tauri/target/release/bundle/nsis/zhibi-writer_<version>_x64-setup.exe` |
| MSI 安装包 | `src-tauri/target/release/bundle/msi/zhibi-writer_<version>_x64_en-US.msi` |
| 绿色版 EXE | `src-tauri/target/release/zhibi.exe` |

### 版本号修改

版本管理在以下 3 个文件中，必须同步修改：

```bash
# package.json    → "version": "x.y.z"
# Cargo.toml      → version = "x.y.z"
# tauri.conf.json → "version": "x.y.z"
```

---

## 5. 发布流程（推送到 GitHub）

### 完整发布步骤

```bash
# 第一步：提交所有更改
git add .
git commit -m "描述本次更改"

# 第二步：更新版本号（在 package.json / Cargo.toml / tauri.conf.json 中）
# 改完后提交
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
git commit -m "chore: bump version to vx.y.z"

# 第三步：打标签
git tag vx.y.z

# 第四步：推送到 GitHub（触发 CI 自动构建）
# 由于网络限制，使用 ghfast.top 代理推送
git remote set-url origin https://<USERNAME>@ghfast.top/https://github.com/D-ai042/zhibi.git
git push origin main --tags

# 第五步：推送完成后，切回不带用户名地址
git remote set-url origin https://ghfast.top/https://github.com/D-ai042/zhibi.git
```

### 关于 Token

推送时需要 **GitHub Personal Access Token (classic)**：

1. 访问 https://github.com/settings/tokens
2. 点击 **Generate new token (classic)**
3. 名称：`zhibi-writer-push`
4. 过期：根据需求选（推荐 30 天或 No expiration）
5. 权限：勾选 **repo** 和 **workflow**
6. 生成后复制 Token
7. 使用方式（二选一）：
   - **方式 A**：推送到 `https://<USERNAME>:<TOKEN>@ghfast.top/https://github.com/D-ai042/zhibi.git`（一次性）
   - **方式 B**：运行 `git credential approve` 配置凭据缓存

---

## 6. CI/CD 自动构建

### 触发条件

打 `v*` 标签推送到 GitHub 后，自动触发 `.github/workflows/build.yml`。

### 构建矩阵

| 操作系统 | 目标架构 | 产物格式 |
|---------|---------|---------|
| Windows | x86_64 | NSIS (.exe) + MSI (.msi) |
| macOS (Intel) | x86_64 | DMG (.dmg) |
| macOS (Apple Silicon) | aarch64 | DMG (.dmg) |

### 产物发布

CI 构建完成后自动将安装包上传到对应版本的 GitHub Release 页面：

```
https://github.com/D-ai042/zhibi/releases/tag/vx.y.z
```

### 检查 CI 状态

1. 打开仓库页面：https://github.com/D-ai042/zhibi
2. 点击 **Actions** 标签
3. 查看最新运行中的 Workflow
4. 绿色 ✅ = 成功，红色 ❌ = 失败

### 更新机制（自动更新）

应用内置自动更新功能，配置在 `tauri.conf.json` 的 `plugins.updater` 中：

```json
{
  "endpoints": [
    "https://ghfast.top/github.com/D-ai042/zhibi/releases/latest/download/latest.json"
  ]
}
```

发布新版本后，用户打开旧版时会自动提示更新。

---

## 7. 常见问题

### Q: 构建时提示 `candle` 或 `light` 找不到

**原因**：缺少 WiX Toolset。
**解决**：从 https://wixtoolset.org/docs/wix3/ 下载安装，并将安装目录加入 PATH。

### Q: `git push` 时报 `Connection was reset`

**原因**：直连 GitHub 被网络屏蔽。
**解决**：使用 `ghfast.top` 代理推送（参见第 5 节）。

### Q: 前端白屏 / 500 错误

**原因**：React.lazy() 动态导入在同步渲染中挂起。
**解决**：不要使用 `React.lazy()`，改为静态 import。所有模块已在 `App.tsx` 中静态导入。

### Q: 开发服务器端口被占用

```bash
# 指定其他端口
npx vite --host --port 1431
```

### Q: 构建时提示 `MSVCRT` 链接错误

**原因**：缺少 Visual Studio C++ 构建工具。
**解决**：安装 "Visual Studio Build Tools 2022"，确保勾选 "C++ 生成工具" 工作负载。

### Q: macOS 构建需要什么？

**需要**：Xcode Command Line Tools
```bash
xcode-select --install
```

### Q: 如何查看 EXE 的 SQLite 数据？

EXE 的数据存储在：
```
%APPDATA%/com.zhibi.writer/data/projects/<project-uuid>/project.db
%APPDATA%/com.zhibi.writer/data/projects/settings.db
```
可以用 SQLite Browser（https://sqlitebrowser.org）打开查看。

---

> **最后更新**：2026-06-10
> **维护者**：@D-ai042
