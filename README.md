# BossSay - Boss直聘AI智能打招呼助手

基于 AI 的 Boss直聘智能打招呼 Chrome 扩展。扫描岗位信息，结合你的简历，一键生成让 HR 愿意回复的打招呼消息。

## 功能

- **岗位扫描** — 从搜索结果页自动提取职位、公司、薪资、地点、经验、学历
- **AI 消息生成** — 从 HR 视角生成三段式打招呼消息（能力匹配 → 到岗信息 → 收尾提问）
- **PDF 简历上传** — 上传 PDF 自动提取简历信息（支持文字版和扫描件 OCR）
- **多种风格** — 专业正式 / 热情亲切 / 幽默轻松 / 简洁明了
- **一键填入** — 生成的消息直接填入 Boss直聘聊天输入框
- **快捷操作** — 页面右下角 BossSay 浮动按钮 + 浏览器扩展快捷键
- **数据管理** — 备份/恢复设置，历史记录

## 安装

1. 下载本仓库代码（Code → Download ZIP）并解压
2. 打开 Chrome/Edge → `chrome://extensions/` 或 `edge://extensions/`
3. 打开「开发者模式」
4. 点「加载已解压的扩展程序」，选择解压后的文件夹

## 配置

1. 点击工具栏的 BossSay 图标（或按扩展快捷键）
2. 切换到 **⚙️ 设置** 页签
3. 填写 API 配置（支持 DeepSeek、OpenAI、Claude 等 OpenAI 兼容 API）
4. 点「💾 保存」并「🔗 测试连接」
5. 切换到 **👤 资料** 页签，上传 PDF 简历或手动填写

## 使用

1. 打开 Boss直聘搜索页（`zhipin.com/geek/jobs`）
2. 点击页面右下角的 **BossSay** 按钮，或点击工具栏图标
3. 点「🔍 扫描当前页面岗位」
4. （可选）从岗位详情页复制 JD 粘贴到输入框
5. 选择消息风格，点「✨ AI 生成打招呼消息」
6. 点「📝 填入输入框」将消息填入聊天窗口

## 技术架构

```text
popup/popup.html          弹窗界面（生成、资料、设置、更多）
popup/popup.js            弹窗逻辑
popup/popup.css           弹窗样式
content/content.js        内容脚本（岗位提取、消息填入、浮动按钮）
background/service-worker.js  后台服务（存储、API 代理、导出导入）
lib/ai-client.js          AI 客户端（prompt 构造 + 消息生成）
lib/pdf-extractor.js      PDF 文本提取（pdf.js + fallback）
options/options.html      设置页面
```

## 项目结构

```text
├── manifest.json              扩展配置
├── popup/
│   ├── popup.html             弹窗 HTML
│   ├── popup.js               弹窗逻辑（扫描、生成、PDF上传、设置）
│   └── popup.css              弹窗样式（新海诚蓝色主题）
├── content/
│   ├── content.js             内容脚本（搜索页卡片提取、详情页元信息提取）
│   └── content.css            内容脚本样式
├── background/
│   └── service-worker.js      后台服务（存储读写、AI API 代理、导出导入）
├── lib/
│   ├── ai-client.js           AI 消息生成（HR 视角 prompt、四风格、API 调用）
│   ├── pdf-extractor.js       PDF 提取（pdf.js 文字 + 渲染为图片 OCR）
│   ├── pdf.min.js             pdf.js 库
│   └── pdf.worker.min.js      pdf.js Worker
├── icons/                     扩展图标
└── options/
    └── options.html           设置页面
```

## AI Prompt 设计

消息采用三段式结构，从 HR 视角出发：

1. **能力匹配** — 用真实技能和经历匹配 JD 要求（禁止编造）
2. **到岗信息** — 到岗时间、实习时长、转正意愿
3. **收尾提问** — 跟岗位相关的具体问题

## 支持的模型

任何兼容 OpenAI Chat Completions API 的模型均可使用：

|提供商|推荐模型|API 地址|
|---|---|---|
|DeepSeek|deepseek-chat|`https://api.deepseek.com/v1`|
|OpenAI|gpt-4o / gpt-4o-mini|`https://api.openai.com/v1`|
|通义千问|qwen-plus|`https://dashscope.aliyuncs.com/compatible-mode/v1`|

> 扫描件 PDF 的 OCR 功能需要支持图片输入的视觉模型（如 GPT-4o、Claude Sonnet）

## License

MIT
