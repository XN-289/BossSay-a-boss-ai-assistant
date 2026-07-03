<div align="center">

# 🎯 BossSay - Boss直聘AI智能打招呼助手

**读取岗位JD，结合你的简历，一键生成让HR愿意回复的打招呼消息**

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue.svg)](https://developer.chrome.com/docs/extensions/)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-green.svg)](https://developer.chrome.com/docs/extensions/mv3/)
[![Edge Compatible](https://img.shields.io/badge/Edge-Compatible-blue.svg)](https://www.microsoft.com/edge)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

## ✨ 功能特点

- 🤖 **AI 智能生成** — 读取 Boss直聘岗位 JD，结合你的简历，生成个性化打招呼消息
- 📄 **PDF 简历上传** — 上传 PDF 简历，AI 自动提取关键信息（支持文字版和扫描件）
- 🎨 **多种风格** — 专业正式 / 热情亲切 / 幽默轻松 / 简洁明了
- 📋 **一键填入** — 生成的消息一键填入 Boss直聘输入框
- 💾 **本地存储** — 所有数据保存在本地，不上传任何服务器
- 🌐 **多模型支持** — 兼容 DeepSeek、OpenAI、Claude 等 OpenAI 兼容 API

---

## 🚀 快速开始

### 安装

1. 下载本仓库代码（Code → Download ZIP）
2. 解压到本地目录
3. 打开 Chrome/Edge 浏览器，进入扩展管理页面：
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
4. 打开「开发者模式」
5. 点击「加载已解压的扩展程序」，选择项目文件夹

### 配置

1. 点击浏览器工具栏的 BossSay 图标
2. 切换到 **⚙️ 设置** 页签
3. 填写 API 配置：
   - **API 地址**: 如 `https://api.deepseek.com/v1`
   - **API Key**: 你的 API Key
   - **模型**: 如 `deepseek-v4-flash`
4. 点击「💾 保存」并「🔗 测试连接」

### 使用

1. 打开 Boss直聘岗位详情页
2. 点击 BossSay 图标 → **🚀 生成消息** 页签
3. 点击「🔍 扫描当前页面岗位」
4. 选择消息风格，点击「✨ AI 生成打招呼消息」
5. 满意后点击「📋 一键填入」

### 简历上传

1. 切换到 **📄 我的资料** 页签
2. 上传 PDF 简历（支持文字版和扫描件）
3. AI 自动提取简历摘要、经历、技能等信息
4. 也可手动填写/编辑各字段

---

## 📁 项目结构

```
BossSay/
├── manifest.json              # 扩展配置
├── popup/                     # 弹窗界面
│   ├── popup.html             # 弹窗 HTML
│   ├── popup.js               # 弹窗逻辑
│   └── popup.css              # 弹窗样式
├── background/
│   └── service-worker.js      # 后台服务（存储、导出导入）
├── content/                   # 注入 Boss直聘页面
│   ├── content.js             # 页面交互、岗位提取
│   ├── content.css            # 注入样式
│   └── api-caller.js          # API 调用桥接
├── lib/                       # 共享库
│   ├── ai-client.js           # AI 客户端（prompt 构造 + API 调用）
│   ├── storage.js             # 存储工具
│   ├── pdf-extractor.js       # PDF 文本提取
│   ├── pdf.min.js             # pdf.js 库
│   └── pdf.worker.min.js      # pdf.js Worker
├── icons/                     # 扩展图标
└── options/                   # 设置页面
    └── options.html
```

---

## 🏗️ 技术架构

```
┌─────────────────────────────────────────────┐
│                  Popup 弹窗                  │
│  ┌─────────┐  ┌─────────┐  ┌─────────────┐  │
│  │ 生成消息 │  │ 我的资料 │  │  ⚙️ 设置    │  │
│  └────┬────┘  └────┬────┘  └──────┬──────┘  │
│       │            │              │          │
│       ▼            ▼              ▼          │
│  ┌─────────────────────────────────────┐     │
│  │         ai-client.js                │     │
│  │  buildSystemPrompt (HR视角)         │     │
│  │  buildUserPrompt  (完整求职信息)    │     │
│  │  generateMessage  (API调用)         │     │
│  └─────────────────────────────────────┘     │
│       │                                      │
│       ▼                                      │
│  ┌──────────────┐  ┌────────────────────┐    │
│  │ pdf.js 文字   │  │ AI视觉识别 OCR     │    │
│  │ 提取(文字版)  │  │ (扫描件/图片PDF)   │    │
│  └──────────────┘  └────────────────────┘    │
└─────────────────────────────────────────────┘
         │
         ▼ chrome.runtime.sendMessage
┌─────────────────────────────────────────────┐
│           Service Worker (后台)              │
│  • 存储读写 (GET/SAVE_PROFILE, API_CONFIG)  │
│  • 导出/导入设置                             │
│  • 历史记录管理                              │
│  • API 连接测试                              │
└─────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│         Content Script (Boss直聘页面)        │
│  • 扫描岗位信息 (JD、薪资、公司)             │
│  • 一键填入消息到输入框                      │
│  • 快捷操作按钮                              │
└─────────────────────────────────────────────┘
```

---

## 🤖 AI Prompt 设计（HR 视角）

打招呼消息的生成从 **HR 的视角** 出发：

**HR 每天看几百条消息，前 3 秒决定要不要回复。**

有效的内容：
- ✅ 我能做什么 + 匹配度（具体技能/项目/数据）
- ✅ 我能什么时候来（到岗时间、实习时长）
- ✅ 我为什么合适（与 JD 要求的匹配点）

无效的内容：
- ❌ "我对贵公司很感兴趣"
- ❌ "我是一个勤奋好学的人"
- ❌ 大段自我介绍

消息限制 80-150 字，直接说匹配点，不寒暄。

---

## 🔧 支持的 AI 模型

任何兼容 OpenAI Chat Completions API 的模型都可以使用：

| 提供商 | 推荐模型 | API 地址 |
|--------|----------|----------|
| DeepSeek | deepseek-v4-flash | `https://api.deepseek.com/v1` |
| OpenAI | gpt-4o / gpt-4o-mini | `https://api.openai.com/v1` |
| Claude | claude-sonnet-4-20250514 | `https://api.anthropic.com/v1` |
| 通义千问 | qwen-plus | `https://dashscope.aliyuncs.com/compatible-mode/v1` |

> ⚠️ 扫描件 PDF 的 OCR 功能需要支持图片输入的视觉模型（如 GPT-4o、Claude Sonnet 等）

---

## 📝 更新日志

### v2.1.0 (最新)
- ✅ PDF 简历上传与 AI 智能解析
- ✅ 扫描件/图片 PDF 支持（AI 视觉识别 OCR）
- ✅ 新增求职信息字段：学校/学历、到岗时间、实习时长、求职类型、转正意愿
- ✅ HR 视角优化打招呼消息 prompt
- ✅ 重新接通消息生成流程（直接调用 ai-client.js）
- ✅ 修复 Edge 浏览器兼容性问题
- ✅ 修复 loading 动画旋转 bug
- ✅ 清理死代码、修复安全问题

### v2.0.0
- 🎨 全新 UI 设计（新海诚蓝色风格）
- 📄 PDF 简历上传功能
- 🔧 多模型支持（DeepSeek、OpenAI、Claude）
- 📋 一键填入消息
- 💾 本地存储，隐私安全

### v1.0.0
- 🚀 基础功能实现
- 🤖 AI 消息生成
- 📋 岗位信息扫描

---

## 📄 License

MIT License - 详见 [LICENSE](LICENSE)

---

<div align="center">

**如果觉得有用，请给个 ⭐ Star 支持一下！**

</div>
