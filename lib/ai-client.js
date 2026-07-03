/**
 * BossSay - AI 客户端模块 v2
 * 从 HR 视角优化打招呼消息生成
 */

const STYLE_PROMPTS = {
  professional: {
    name: '专业正式',
    description: '突出技能匹配、项目经验、技术深度',
    instruction: '语气专业、简洁、自信。重点突出你的技术能力和项目经验与岗位的匹配度。用数据和具体成果说话。',
  },
  friendly: {
    name: '热情亲切',
    description: '突出对岗位/公司的兴趣、个人热情',
    instruction: '语气热情、真诚、有温度。表达你对这个岗位和公司的真诚兴趣，同时展示你的能力和价值。',
  },
  humor: {
    name: '幽默轻松',
    description: '用轻松的语气展示实力，有记忆点',
    instruction: '语气轻松、幽默、有个性。用有趣的方式展示你的实力，让HR对你产生印象。但不要过度玩梗，保持专业底线。',
  },
  concise: {
    name: '简洁明了',
    description: '消息不超过150字，信息密度最高',
    instruction: '消息不超过150字，信息密度最高。直接说明你的核心优势和匹配点，不废话。每句话都要有信息量。',
  },
  custom: {
    name: '自定义',
    description: '用户自定义风格',
    instruction: '', // 用户自定义
  },
};

/**
 * 构造系统提示词 — 从 HR 视角出发
 * HR 每天看几百条消息，他们在意什么？
 * 1. 这人能不能干活？→ 匹配度要高
 * 2. 有没有真本事？→ 具体经历/数据，不要空话
 * 3. 什么时候能来？→ 到岗时间、实习时长
 * 4. 想不想长久干？→ 求职类型、转正意愿
 * 5. 一眼能看完？→ 简短，150字以内
 */
function buildSystemPrompt(params) {
  const { style, customPrompt } = params;

  if (style === 'custom' && customPrompt) {
    return customPrompt;
  }

  const styleConfig = STYLE_PROMPTS[style] || STYLE_PROMPTS.professional;

  return `你是一个资深HR顾问。你的任务是帮求职者写一条让HR愿意回复的Boss直聘打招呼消息。

核心原则（从HR视角出发）：
- HR每天看几百条消息，前3秒决定要不要回复
- 最有效的内容：我能做什么 + 我能什么时候来 + 我为什么合适
- 最没用的内容："我对贵公司很感兴趣"、"我是一个勤奋好学的人"

生成规则：
1. 长度 80-150 字，不要超过 150 字。HR不会读长消息
2. 开头直接说匹配点，不要寒暄。比如"我做过XX，和你们要的YY很匹配"
3. 必须提及至少一个与 JD 要求匹配的具体技能或项目经历，最好带数据
4. 如果有到岗时间/实习时长信息，自然地带出来，这是HR最关心的筛选条件
5. 如果是实习岗位，提一下转正意愿（如果有的话）
6. ${styleConfig.instruction}
7. 用"你"不用"您"，保持平等对话感
8. 可以在结尾提一个跟岗位相关的具体问题，展示你认真看过JD
9. 直接输出消息内容，不要加前缀、引号、说明文字

反面教材（绝对不要写）：
- "你好，我对这个岗位很感兴趣"
- "我是一个学习能力强的人"
- "希望有机会和你聊聊"
- 大段自我介绍`;
}

/**
 * 构造用户提示词 — 包含所有求职信息
 */
function buildUserPrompt(params) {
  const { profile, jobInfo } = params;

  // ===== 求职者背景 =====
  let background = '【求职者背景】\n';

  if (profile.education) background += `学校/学历：${profile.education}\n`;
  if (profile.resume) background += `简历摘要：${profile.resume}\n`;
  if (profile.experience) background += `工作/项目经历：${profile.experience}\n`;
  if (profile.skills) background += `技能：${profile.skills}\n`;

  // 求职关键信息（HR最关心的）
  const keyInfo = [];
  if (profile.jobType) keyInfo.push(`求职类型：${profile.jobType}`);
  if (profile.availableDate) keyInfo.push(`到岗时间：${profile.availableDate}`);
  if (profile.internshipDuration) keyInfo.push(`可实习时长：${profile.internshipDuration}`);
  if (profile.wantFulltime) keyInfo.push(`转正意愿：${profile.wantFulltime}`);
  if (keyInfo.length > 0) {
    background += `\n【求职状态】\n${keyInfo.join('，')}\n`;
  }

  if (profile.github) background += `GitHub：${profile.github}\n`;
  if (profile.portfolio) background += `作品集：${profile.portfolio}\n`;
  if (profile.selfIntro) background += `自我介绍：${profile.selfIntro}\n`;

  // ===== 目标岗位 =====
  let job = '\n【目标岗位】\n';
  if (jobInfo.title) job += `职位：${jobInfo.title}\n`;
  if (jobInfo.company) job += `公司：${jobInfo.company}\n`;
  if (jobInfo.salary) job += `薪资：${jobInfo.salary}\n`;
  if (jobInfo.location) job += `地点：${jobInfo.location}\n`;
  if (jobInfo.bossName) job += `HR：${jobInfo.bossName}\n`;
  if (jobInfo.bossTitle) job += `职位：${jobInfo.bossTitle}\n`;
  if (jobInfo.jd) job += `\n岗位要求：\n${jobInfo.jd}\n`;
  if (jobInfo.requirements && jobInfo.requirements.length > 0) {
    job += `标签：${jobInfo.requirements.join('，')}\n`;
  }
  if (jobInfo.companyInfo) job += `公司信息：${jobInfo.companyInfo}\n`;

  return background + '\n' + job;
}

/**
 * 调用 AI API 生成消息
 */
async function generateMessage(params) {
  const { apiConfig, profile, jobInfo, style, customPrompt } = params;

  if (!apiConfig.apiKey) {
    throw new Error('请先配置 API Key');
  }

  const systemPrompt = buildSystemPrompt({ style, customPrompt });
  const userPrompt = buildUserPrompt({ profile, jobInfo });

  let baseUrl = apiConfig.baseUrl.trim();
  if (!baseUrl.endsWith('/')) baseUrl += '/';

  const url = `${baseUrl}chat/completions`;

  const requestBody = {
    model: apiConfig.modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 500,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiConfig.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMsg = errorData.error?.message || `HTTP ${response.status}`;
      throw new Error(`API 调用失败: ${errorMsg}`);
    }

    const data = await response.json();

    if (!data.choices || data.choices.length === 0) {
      throw new Error('API 返回结果为空');
    }

    const message = data.choices[0].message?.content?.trim();
    if (!message) {
      throw new Error('AI 未能生成有效消息');
    }

    return message;
  } catch (error) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('网络请求失败，请检查 API 地址是否正确');
    }
    throw error;
  }
}
