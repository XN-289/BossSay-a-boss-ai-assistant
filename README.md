# BossSay v3.0

**Boss直聘 AI 智能打招呼助手**

基于 AI Agent 多步推理链，分析 JD 匹配简历，生成个性化打招呼消息。

---

## 功能

| 功能 | 说明 |
|------|------|
| 🔍 岗位扫描 | 搜索页自动提取职位/公司/薪资/地点，全字段可编辑 |
| 🤖 AI Agent | 3 步推理链：分析匹配 → 生成审查 → 自动修正 |
| 📊 匹配度 | AI 分析简历和 JD 匹配度，决定消息策略 |
| 🧠 推理链 | 可展开查看 AI 每步分析过程 |
| 📈 评估反馈 | 记录消息效果，按风格统计回复率 |
| 📄 PDF 简历 | 上传 PDF 自动提取，支持扫描件 OCR |
| 🎨 四种风格 | 专业 / 热情 / 幽默 / 简洁 |
| ✏️ 全字段可编辑 | 扫描后可手动修正任何字段 |
| 📝 一键填入 | 消息直接填入聊天输入框 |
| 💾 备份恢复 | 导出/导入 JSON |

---

## 安装

1. 下载本仓库（Code → Download ZIP）并解压
2. 打开 `chrome://extensions/` 或 `edge://extensions/`
3. 开启「开发者模式」→「加载已解压的扩展程序」

## 配置

1. 点 BossSay 图标 → ⚙️ 设置
2. 填 API 配置（推荐 DeepSeek V4 Flash）
3. 💾 保存 → 🔗 测试连接

## 使用

1. 打开 Boss直聘搜索页
2. 点右下角 **BossSay** 按钮
3. 🔍 扫描 → 修正字段 → ✨ 生成 → 📝 填入

---

## AI 架构

```text
Step 1: 分析 JD + 匹配简历（1 次 API 调用）
  → 提取核心要求、关键技能
  → 匹配简历中的相关经历
  → 计算匹配度分数

Step 2: 生成消息 + 自我审查（1 次 API 调用）
  → 基于匹配度决定策略
  → 按三段式结构生成初稿
  → 检查编造、长度、空洞表达

Step 3: 修正（如审查发现问题，1 次 API 调用）
  → 根据审查意见修正
```

每步 30 秒超时，推理链全程追踪，进度实时反馈。

---

## 项目结构

```text
BossSay/
├── manifest.json              v3.0 配置
├── popup/
│   ├── popup.html             四页签界面
│   ├── popup.js               主逻辑（扫描/生成/Agent调用/统计）
│   └── popup.css              蓝色主题样式
├── content/
│   └── content.js             搜索页提取、消息填入、浮动按钮
├── background/
│   └── service-worker.js      存储、API 代理、导出导入
├── lib/
│   ├── agent.js               AI Agent（3步推理链 + 超时 + 进度）
│   ├── evaluate.js            评估反馈（记录/追踪/统计）
│   ├── pdf-extractor.js       PDF 提取 + OCR
│   ├── pdf.min.js             pdf.js 库
│   └── pdf.worker.min.js      pdf.js Worker
├── icons/                     扩展图标
└── docs/
    └── PROJECT.md             项目全景文档
```

---

## 更新日志

### v3.0.0

- AI Agent 多步推理链（分析匹配 → 生成审查 → 自动修正）
- 评估反馈闭环（记录/追踪/统计回复率/推荐最优风格）
- 搜索页岗位扫描 + 全字段可编辑
- 推理链可视化
- 匹配度计算
- 每步进度显示
- API URL 自动补全 /v1
- 推理模型兼容（reasoning_content）
- DeepSeek V4 Flash / V4 Pro 预设
- 清理死代码，精简项目结构

### v2.1.0

- PDF 简历上传 + 扫描件 OCR
- 新增求职信息字段（到岗时间/实习时长/转正意愿）
- HR 视角 prompt 优化

### v2.0.0

- 新海诚蓝色 UI
- 多模型支持
- 备份/恢复

---

## License

MIT
