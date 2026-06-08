# VoiceInput - 语音输入小助手

> 一个轻量的桌面语音输入工具，点击说话，自动转文字填入任意文本框。

---

## 1. 产品概述

### 核心功能
- 点击悬浮按钮开始录音
- 录音结束后自动发送到百度语音识别 API
- 识别结果自动填入当前聚焦的文本框
- 支持 Windows 桌面

### 使用场景
- 所有需要文字输入的场景（聊天工具、AI 对话框、文档编辑等）
- 双手忙碌时用语音快速输入文字

---

## 2. 技术架构

### 技术选型
| 层级 | 技术 | 说明 |
|------|------|------|
| 桌面框架 | PyQt5 | Python 桌面 GUI，简单轻量 |
| 录音 | pyaudio | 跨平台音频录制 |
| 语音识别 | 百度语音 API | 长音频转文字 |
| 自动输入 | pyperclip + pynput | 模拟键盘输入 |

### 工作流程

```
用户点击录音按钮
       ↓
麦克风录制音频
       ↓
录音结束，保存为 .wav 文件
       ↓
调用百度语音识别 API（长音频模式）
       ↓
获取识别结果（文字）
       ↓
自动填入当前聚焦的文本框
```

---

## 3. 目录结构

```
voice-input/
├── docs/
│   └── PROJECT.md          # 项目文档（本文件）
├── src/
│   ├── __init__.py
│   ├── main.py             # 入口文件，GUI 主程序
│   ├── recorder.py         # 录音模块
│   ├── baidu_stt.py        # 百度语音识别 API 调用
│   ├── auto_type.py        # 自动填入文本框
│   └── config.py           # 配置文件（API 密钥等）
├── assets/
│   └── icon.ico            # 程序图标
├── requirements.txt        # Python 依赖
├── build.spec             # PyInstaller 打包配置
└── README.md              # 使用说明
```

---

## 4. 依赖清单

### Python 包

```
PyQt5>=5.15.0      # 桌面 GUI
pyaudio>=0.2.13   # 录音
requests>=2.28.0   # HTTP 请求（调用百度 API）
pyperclip>=1.8.0   # 剪贴板操作
pynput>=1.7.0      # 模拟键盘输入
```

### 系统依赖

```
# Windows
需要安装 PortAudio（pyaudio 依赖）
通常 pyaudio 安装时会自动处理，或使用 whl 文件手动安装

# macOS
brew install portaudio

# Linux
sudo apt-get install portaudio19-dev
```

---

## 5. 百度语音 API 配置

### 5.1 获取 API 密钥

1. 访问 [百度智能云控制台](https://console.bce.baidu.com/)
2. 搜索"语音技术"
3. 创建应用，获取以下信息：
   - **App ID**
   - **API Key**
   - **Secret Key**

### 5.2 配置信息

在 `src/config.py` 中填入：

```python
BAIDU_APP_ID = "你的AppID"
BAIDU_API_KEY = "你的APIKey"
BAIDU_SECRET_KEY = "你的SecretKey"
```

---

## 6. 模块说明

### 6.1 recorder.py - 录音模块

**功能**：录制麦克风音频并保存为 WAV 文件

**接口**：
```python
def record_audio(filename: str, max_duration: int = 60) -> str:
    """
    录制音频
    :param filename: 保存的文件路径
    :param max_duration: 最大录制时长（秒）
    :return: 录制的文件路径
    """
```

**示例**：
```python
filepath = record_audio("test.wav")
# 录制完成，文件保存在 test.wav
```

### 6.2 baidu_stt.py - 百度语音识别

**功能**：调用百度语音识别 API 将音频转为文字

**接口**：
```python
def recognize_speech(audio_path: str) -> str:
    """
    识别语音
    :param audio_path: 音频文件路径（支持 pcm/wav/amr 格式）
    :return: 识别出的文字
    """
```

**示例**：
```python
text = recognize_speech("test.wav")
print(text)  # 输出识别结果
```

### 6.3 auto_type.py - 自动填入

**功能**：将文字自动填入当前聚焦的文本框

**接口**：
```python
def type_text(text: str):
    """
    自动输入文字
    :param text: 要输入的文字
    """
```

**实现方式**：
1. 将文字复制到剪贴板
2. 模拟 Ctrl+V 粘贴到当前焦点窗口

### 6.4 main.py - 主程序

**功能**：PyQt5 GUI 主程序

**界面元素**：
- 一个悬浮按钮（带麦克风图标）
- 状态指示（录音中/识别中/完成）
- 设置按钮（配置 API 密钥）

**交互逻辑**：
```
点击按钮 → 开始录音 → 再次点击/超时停止 → 发送识别 → 自动填入
```

---

## 7. 界面设计

### 7.1 主界面

```
┌─────────────────────────────┐
│                             │
│      🎤（麦克风图标）        │
│                             │
│    点击说话，说完再点       │
│                             │
└─────────────────────────────┘

窗口特性：
- 圆角窗口，无边框
- 半透明背景
- 始终置顶
- 可拖拽
- 最小化到系统托盘
```

### 7.2 状态变化

| 状态 | 界面显示 |
|------|----------|
| 待机 | 灰色麦克风图标 |
| 录音中 | 红色麦克风图标 + 呼吸动画 |
| 识别中 | 黄色加载动画 |
| 识别成功 | 绿色对勾（1秒后恢复） |
| 识别失败 | 红色感叹号（2秒后恢复） |

---

## 8. 使用说明

### 8.1 首次运行

1. 双击 `VoiceInput.exe` 启动
2. 弹出设置窗口，填入百度 API 密钥
3. 点击保存

### 8.2 日常使用

1. 启动程序，悬浮球出现在桌面
2. 将光标放在任意文本框
3. 点击悬浮球开始录音
4. 再次点击或停止说话结束录音
5. 识别结果自动填入文本框

### 8.3 快捷操作

| 操作 | 说明 |
|------|------|
| 单击 | 开始/结束录音 |
| 右键 | 菜单（设置、退出） |
| 拖拽 | 移动窗口位置 |

---

## 9. 打包发布

### 9.1 使用 PyInstaller

```bash
# 安装 PyInstaller
pip install pyinstaller

# 打包
pyinstaller build.spec
```

### 9.2 build.spec 配置

```python
# build.spec
a = Analysis(
    ['src/main.py'],
    ...
)
pyz = PYZ(a.pure_a)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    name='VoiceInput',
    icon='assets/icon.ico',
    ...
)
```

### 9.3 打包后文件

```
dist/
└── VoiceInput.exe   # 可执行文件
```

---

## 10. 常见问题

### Q1: 提示 "PortAudio not found"
**解决方案**：安装 pyaudio 的 wheel 文件
```bash
pip install pip install pip install PyAudio‑0.2.14‑cp311‑win_amd64.whl
```
（版本号根据你的 Python 版本选择）

### Q2: 百度 API 调用失败
**检查**：
1. API 密钥是否正确
2. 网络是否正常
3. 百度云账户是否欠费

### Q3: 文字没有填入文本框
**检查**：
1. 是否有其他程序占用了剪贴板
2. 目标文本框是否获得焦点

---

## 11. 后续扩展（可选）

- [ ] 添加快捷键触发录音
- [ ] 支持实时语音流识别
- [ ] 添加识别历史记录
- [ ] 支持多种语音引擎（讯飞、Google）
- [ ] 添加语音合成（文字转语音）

---

## 12. 变更记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-05-28 | 初稿规划 |
