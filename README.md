<p align="center">
  <img src="icons/icon128.png" alt="BossSay Logo" width="100">
</p>

<h1 align="center">BossSay</h1>
<p align="center"><strong>Boss 直聘 AI 智能打招呼助手</strong></p>
<p align="center">让你的每一条消息都精准、有诚意，HR 看了就想回</p>

<p align="center">
  <img src="https://img.shields.io/badge/Chrome-Extension-blue?logo=googlechrome" alt="Chrome">
  <img src="https://img.shields.io/badge/Edge-Extension-blue?logo=microsoftedge" alt="Edge">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT">
  <img src="https://img.shields.io/badge/Version-2.0.0-orange" alt="Version">
  <img src="https://img.shields.io/badge/AI-OpenAI_Compatible-purple" alt="AI">
</p>

---

## 🎯 它能做什么？

在 Boss 直聘上找工作时，你是不是经常这样打招呼：

> ❌ "你好，我对这个岗位很感兴趣"

HR 收到 100 条这样的消息，凭什么回你？

**BossSay** 会读取当前岗位的 JD，结合你的简历和经历，用 AI 生成一条**有针对性**的打招呼消息：

> ✅ "你好！我看到你们在招前端工程师，要求 React 和性能优化。我之前在 XX 公司负责电商平台前端架构，首屏加载从 3s 优化到 1.2s，和你们的需求很匹配。方便聊聊吗？"

**一条有针对性的消息，回复率提升 3-5 倍。**

---

## ✨ 核心特性

<table>
<tr>
<td width="50%">

### 🤖 AI 智能生成
- 读取岗位 JD，自动匹配你的经历
- 4 种风格一键切换
- 支持编辑后再发送

</td>
<td width="50%">

### 🔒 隐私安全
- 所有数据存储在浏览器本地
- 不上传任何第三方服务器
- API Key 仅存在你的电脑上

</td>
</tr>
<tr>
<td>

### 🎯 精准提取
- 三级降级 JD 提取（XPath → CSS → 关键词）
- 自动感知岗位切换
- 消息缓存，避免重复生成

</td>
<td>

### 🔧 灵活配置
- 支持通义千问、智谱、DeepSeek、Moonshot
- 任何 OpenAI 兼容 API 都能用
- 风格 prompt 可自定义编辑

</td>
</tr>
</table>

---

## 🚀 3 分钟上手

### Step 1：安装插件

```
下载项目 → Chrome/Edge 扩展管理 → 开发者模式 → 加载已解压的扩展程序 → 选择项目文件夹
```

<details>
<summary>📸 详细安装步骤（点击展开）</summary>

1. 点击页面上方绿色 **Code** 按钮 → **Download ZIP**，解压到本地
2. 打开浏览器扩展管理页面：
   - **Chrome**：地址栏输入 `chrome://extensions/`
   - **Edge**：地址栏输入 `edge://extensions/`
3. 打开右上角的 **「开发者模式」** 开关
4. 点击 **「加载已解压的扩展程序」**
5. 选择解压后的文件夹（包含 `manifest.json` 的那个文件夹）
6. 完成！浏览器工具栏会出现 BossSay 图标 🎯

</details>

### Step 2：配置 AI 模型（1 分钟）

点击浏览器工具栏的 BossSay 图标 → **⚙️ 设置**：

| 推荐模型 | API 地址 | 模型名称 | 费用 |
|---------|---------|---------|------|
| 🟣 **DeepSeek** ⭐推荐 | `https://api.deepseek.com/v1` | `deepseek-chat` | 便宜量大，国内直连 |
| 🟢 **通义千问** | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-turbo` | 注册送免费额度 |
| 🔵 **智谱 GLM-4** | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` | 完全免费 |
| 🌙 **Moonshot** | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` | Kimi 背后的模型 |

> 💡 **推荐用 DeepSeek**，便宜量大，国内直连无需翻墙，中文效果好。[点击注册](https://platform.deepseek.com/)

填写 API Key 和模型名称后，点击 **🔗 测试连接** 验证是否配置成功。

### Step 3：填写你的资料（1 分钟）

切换到 **👤 资料** 标签，填写：

- **简历内容**（必填）：粘贴你的简历关键内容
- **个人经历**（必填）：工作经历、项目经历
- **技能标签**（必填）：如 `React, Vue, Node.js`
- GitHub / 作品集（选填）

### Step 4：开始使用！

1. 打开 [Boss 直聘](https://www.zhipin.com/)，进入某个岗位的详情页
2. 页面上会出现 **「🎯 AI 一键打招呼」** 按钮
3. 点击按钮 → 选择风格 → 自动生成消息
4. 编辑确认后，填入聊天输入框发送！

---

## 🎨 四种消息风格

| 风格 | 适合场景 | 示例效果 |
|------|---------|---------|
| 💼 **专业正式** | 大厂、技术岗 | "我在 XX 公司负责过类似项目，React 技术栈，性能优化经验丰富..." |
| 🤝 **热情亲切** | 创业公司、小团队 | "看到你们在做的事情特别感兴趣！我之前做过类似的..." |
| 😄 **幽默轻松** | 有个性的团队 | "看到 JD 里写的'能扛住双十一流量'，正好我之前就是干这个的..." |
| 📌 **简洁明了** | 海投、快速沟通 | "3 年前端，React 技术栈，负责过日活百万的项目，期望聊聊。" |

> 🛠️ 你还可以在设置中**自定义每种风格的 prompt**，让 AI 更符合你的个性。

---

## 📦 功能一览

- ✅ AI 生成个性化打招呼消息
- ✅ 4 种消息风格 + 自定义
- ✅ 三级降级 JD 提取（XPath → CSS → 关键词搜索）
- ✅ JD 变化自动检测
- ✅ 消息缓存，避免重复生成
- ✅ 一键注入聊天输入框
- ✅ 简历 gzip 压缩存储
- ✅ 设置备份/恢复（JSON 导出导入）
- ✅ API 连接测试
- ✅ 历史记录
- ✅ 支持所有 OpenAI 兼容 API

---

## ❓ 常见问题

<details>
<summary><b>Q: 扫描不到岗位信息怎么办？</b></summary>

Boss 直聘的页面结构可能更新。请尝试：
1. 确保已打开岗位**详情页**（不是列表页）
2. 刷新页面后重试
3. 如果仍然失败，请提 Issue 并附上页面截图
</details>

<details>
<summary><b>Q: API 调用失败怎么办？</b></summary>

1. 点击 **🔗 测试连接** 按钮验证配置
2. 检查 API 地址是否正确
3. 检查 API Key 是否有效
4. 检查模型名称是否正确
5. 检查网络是否能访问 API 服务
</details>

<details>
<summary><b>Q: 支持哪些 AI 模型？</b></summary>

支持所有 **OpenAI 兼容 API**，包括但不限于：
- 通义千问（qwen-turbo, qwen-plus）
- 智谱 GLM（glm-4-flash, glm-4）
- DeepSeek（deepseek-chat）
- Moonshot（moonshot-v1-8k）
- OpenAI（gpt-4o, gpt-3.5-turbo）
- 任何提供 OpenAI 兼容 API 的服务
</details>

<details>
<summary><b>Q: 数据安全吗？</b></summary>

所有数据（简历、API Key 等）都存储在浏览器本地 `chrome.storage.local`，**不会上传到任何第三方服务器**。

AI 生成消息时会将简历和 JD 内容发送到你配置的 AI API 服务，这是唯一的数据外发。
</details>

<details>
<summary><b>Q: 会封号吗？</b></summary>

BossSay **不会自动发送消息**，所有消息都需要你手动确认后才会发送。正常使用不会触发风控。
</details>

---

## 🛠️ 技术架构

```
BossSay/
├── manifest.json              # Manifest V3 配置
├── popup/                     # 插件弹窗 UI
│   ├── popup.html/css/js      # 主界面（生成 + 资料 + 设置 + 备份）
├── content/                   # 注入 Boss 直聘页面的脚本
│   ├── content.js             # JD 提取 + 按钮注入 + 消息填入
│   └── content.css            # 注入元素样式
├── background/                # 后台服务
│   └── service-worker.js      # AI API 调用 + 消息中转
├── lib/                       # 工具库
│   ├── storage.js             # 存储封装（gzip 压缩 + 备份恢复）
│   ├── ai-client.js           # AI API 封装
│   └── parser.js              # JD 解析
└── icons/                     # 插件图标
```

---

## 🤝 贡献

欢迎 Issue 和 PR！

1. Fork 本项目
2. 创建功能分支：`git checkout -b feature/xxx`
3. 提交更改：`git commit -m 'Add xxx'`
4. 推送分支：`git push origin feature/xxx`
5. 提交 Pull Request

---

## 📄 License

[MIT License](LICENSE)

---

<p align="center">
  <b>如果觉得有用，请给个 ⭐ Star 支持一下！</b>
</p>
