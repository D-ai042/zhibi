# 执笔（zhibi-writer）自动更新配置

> 本文档说明如何配置和使用执笔的自动更新功能。
> 用户打开旧版执笔 → 自动检测新版本 → 弹窗提示 → 一键安装更新。

---

## 目录

1. [更新原理](#1-更新原理)
2. [密钥管理](#2-密钥管理)
3. [GitHub Secrets 配置](#3-github-secrets-配置)
4. [CI/CD 构建流程](#4-cicd-构建流程)
5. [发布新版步骤](#5-发布新版步骤)
6. [常见问题](#6-常见问题)

---

## 1. 更新原理

```
你推 tag 触发 GitHub Actions
    ↓
CI 编译 Rust → 签名 exe/dmg
    ↓
上传安装包到 GitHub Release
    ↓
上传 latest.json（更新清单）
    ↓
用户启动执笔 → Tauri updater 检查 ghfast.top 镜像
    ↓
发现新版本 → 弹更新对话框 → 点"更新"→ 下载安装包 → 自动安装
```

### 核心组件

| 组件 | 路径 | 说明 |
|------|------|------|
| 自动更新插件 | `src-tauri/Cargo.toml` → `tauri-plugin-updater = "2"` | Tauri 内置更新插件 |
| 更新配置 | `src-tauri/tauri.conf.json` → `plugins.updater` | 更新清单地址、公钥 |
| 签名密钥 | `src-tauri/tauri-key.txt`（私钥） / `.pub`（公钥） | 签名验证安装包完整性 |
| CI 构建 | `.github/workflows/build.yml` | 自动构建+签名+上传 latest.json |
| 更新清单 | `latest.json`（自动上传到 Release） | 版本号、下载链接、平台信息 |

### 国内加速

所有更新请求走 **ghfast.top** 镜像代理，不需要科学上网。

更新清单地址：
```
https://ghfast.top/github.com/D-ai042/zhibi/releases/latest/download/latest.json
```

安装包下载地址：
```
https://ghfast.top/github.com/D-ai042/zhibi/releases/download/v0.x.x/zhibi-v0.x.x-nsis.exe
```

---

## 2. 密钥管理

### 2.1 密钥文件位置

| 文件 | 用途 | 注意事项 |
|------|------|---------|
| `src-tauri/tauri-key.txt` | **私钥** — 签名用 | **绝不能提交到 Git！** 已加入 `.gitignore` |
| `src-tauri/tauri-key.txt.pub` | 公钥 — 嵌入 exe 验证用 | 安全，可公开 |

### 2.2 公钥

当前公钥已配置在 `tauri.conf.json` 中：

```json
"pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDFEMkEwMzU5RjREQTgzOTAKUldTUWc5cjBXUU1xSGFBeFRqNGsrR2VVcHBnUjhTcmc0LzdlUURhanNMZTlBYmJ2Z3RQakh5cUkK"
```

### 2.3 私钥密码

当前私钥密码：`zhibi-update-2026`

### 2.4 重新生成密钥（如果丢失）

```bash
cd src-tauri
cargo tauri signer generate -w tauri-key.txt -p "你的新密码" --ci
```

重新生成后需要：
1. 把新公钥复制到 `tauri.conf.json` → `plugins.updater.pubkey`
2. 把新私钥配置到 GitHub Secrets（见下节）
3. 重新构建 exe

> ⚠️ **私钥丢失 = 无法再发布签名更新！** 请务必备份 `tauri-key.txt` 到安全位置。

---

## 3. GitHub Secrets 配置

登录 https://github.com/D-ai042/zhibi/settings/secrets/actions

添加两个 Repository secrets：

| 密钥名 | 值 | 来源 |
|--------|---|------|
| `TAURI_PRIVATE_KEY` | `tauri-key.txt` 的**完整内容** | 用文本编辑器打开 `src-tauri/tauri-key.txt`，复制全部内容 |
| `TAURI_KEY_PASSWORD` | `zhibi-update-2026` | 生成密钥时设置的密码 |

### 配置步骤（图文）

1. 打开浏览器进入 https://github.com/D-ai042/zhibi/settings/secrets/actions
2. 点 **"New repository secret"**
3. Name 填 `TAURI_PRIVATE_KEY`
4. Secret 填 `tauri-key.txt` 的完整内容
5. 点 **"Add secret"**
6. 重复以上步骤添加 `TAURI_KEY_PASSWORD`

> 配置一次即可，以后所有 tag 推送都会自动用这个密钥签名。

---

## 4. CI/CD 构建流程

### 4.1 build.yml 做了什么事

```yaml
jobs:
  build:           # 多平台构建（Win/Mac Intel/Mac M芯片）
    - 签名编译（使用 TAURI_PRIVATE_KEY + TAURI_KEY_PASSWORD）
    - 上传安装包到 GitHub Release

  generate-update-json:   # 生成更新清单
    needs: build
    - 生成 latest.json
    - 上传到 GitHub Release
```

### 4.2 latest.json 格式

```json
{
  "version": "0.3.0",
  "notes": "执笔 v0.3.0 自动构建更新",
  "pub_date": "2026-06-11T19:25:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "",
      "url": "https://ghfast.top/github.com/D-ai042/zhibi/releases/download/v0.3.0/zhibi-v0.3.0-nsis.exe"
    },
    "darwin-x86_64": {
      "signature": "",
      "url": "https://ghfast.top/github.com/D-ai042/zhibi/releases/download/v0.3.0/zhibi-v0.3.0-dmg.dmg"
    },
    "darwin-aarch64": {
      "signature": "",
      "url": "https://ghfast.top/github.com/D-ai042/zhibi/releases/download/v0.3.0/zhibi-v0.3.0-dmg.dmg"
    }
  }
}
```

> 注意：当前 `signature` 字段留空，因为 macOS 签名需要苹果开发者证书，Windows 端不依赖此字段。Windows 的 NSIS 安装包更新不受影响。

### 4.3 触发条件

- 推送 `v*` 格式的 tag（如 `v0.3.0`）
- 或在 GitHub Actions 页面手动触发（workflow_dispatch）

---

## 5. 发布新版步骤

### 5.1 更新版本号

需要同步修改以下 3 个文件中的版本号：

| 文件 | 字段 |
|------|------|
| `package.json` | `"version": "0.3.0"` |
| `src-tauri/Cargo.toml` | `version = "0.3.0"` |
| `src-tauri/tauri.conf.json` | `"version": "0.3.0"` |

### 5.2 提交 + 推送

```bash
# 提交版本号变更
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
git commit -m "chore: bump version to v0.3.0"

# 打标签
git tag v0.3.0

# 推送（触发 CI 自动构建）
git push origin main --tags
```

### 5.3 等待构建完成

1. 打开 https://github.com/D-ai042/zhibi/actions 查看构建进度
2. 构建 + 上传大约需要 15-30 分钟
3. 完成后自动生成 Release：https://github.com/D-ai042/zhibi/releases/tag/v0.3.0

### 5.4 验证更新

1. 打开旧版执笔（或从之前的 Release 下载一个旧版本）
2. 等待几秒钟 → 底部状态栏出现橙色 **● 新版本** badge
3. 点击 badge 打开设置 → 点击 **"检查更新"**
4. 或等待 Tauri 内置 updater 自动检测（启动后延迟几秒检查）
5. 弹出更新对话框 → 点击 **"更新"** → 自动下载安装

---

## 6. 常见问题

### Q: 更新弹窗没出来？

可能原因：
1. **latest.json 未正确上传** → 检查 Release 页面是否有 `latest.json` 文件
2. **版本号没更新** → 确认 `tauri.conf.json` 中的 version 改为新版本
3. **网络问题** → ghfast.top 镜像偶尔不稳定，客户端会静默失败不影响使用
4. **签名不匹配** → `tauri-key.txt` 公钥与 CI 签名时用的私钥不匹配

### Q: GitHub Secrets 没配会怎样？

构建能成功，但产物未被签名。客户端检测到更新后，Tauri updater 会因签名验证失败拒绝安装。**必须配置 Secrets。**

### Q: 我想跳过某个版本不更新？

用户可以在更新对话框中点 **"忽略"**，该版本不再提示。

### Q: 自动更新会影响我当前在写的章节吗？

不会。更新只替换 exe 安装包，不会动你的项目数据。项目数据存储在 `%APPDATA%/com.zhibi.writer/projects/`，更新前后保留完好。

### Q: Git 提交了私钥怎么办？

立即联系 GitHub 支持或：
1. 重新生成密钥（见 [2.4 节](#24-重新生成密钥如果丢失)）
2. 将旧私钥从 Git 历史中彻底清除
3. 更新 GitHub Secrets 中的私钥

---

## 附录：相关文件

| 文件 | 说明 |
|------|------|
| `src-tauri/tauri.conf.json` | Tauri 配置（含 updater 公钥） |
| `src-tauri/tauri-key.txt` | **私钥（保密！** 已 gitignore） |
| `src-tauri/tauri-key.txt.pub` | 公钥（已嵌入配置） |
| `.github/workflows/build.yml` | CI 构建 + 签名 + 上传 latest.json |
| `src/lib/version-check.ts` | 前端手动版本检查（后备功能） |
| `src/components/settings/SettingsModal.tsx` | 设置页「关于」标签 |
| `src/layouts/AppShell.tsx` | 底部栏版本提示 + 新版本 badge |
