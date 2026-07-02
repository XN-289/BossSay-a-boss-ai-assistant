/**
 * BossSay - AI 客户端模块
 * 封装 OpenAI 兼容 API 的调用
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
  custom: {
    name: '自定义',
    description: '用户自定义风格',
    instruction: '', // 用户自定义
  },
};

/**
 * 构造系统提示词
 * @param {Object} params
 * @param {string} params.style - 消息风格
 * @param {string} params.customPrompt - 自定义提示词（仅 style=custom 时使用）
 * @returns {string}
 */
function buildSystemPrompt(params) {
  const { style, customPrompt } = params;

  if (style === 'custom' && customPrompt) {
    return customPrompt;
  }

  const styleConfig = STYLE_PROMPTS[style] || STYLE_PROMPTS.professional;

  return `你是一个专业的求职顾问。你的任务是根据求职者的背景和目标岗位的JD，生成一条精准、有诚意的Boss直聘打招呼消息。

规则：
1. 消息长度控制在 100-200 字
2. 不要使用"我对这个岗位很感兴趣"等空洞表达
3. 必须提及至少一个与 JD 要求匹配的具体经历/技能
4. ${styleConfig.instruction}
5. 不要用"您"，用"你"，保持平等对话感
6. 最后可以适当提一个跟岗位相关的问题，展示你的思考
7. 直接输出消息内容，不要加任何前缀说明
8. 不要使用引号包裹消息`;
}

/**
 * 构造用户提示词
 * @param {Object} params
 * @param {Object} params.profile - 用户资料
 * @param {Object} params.jobInfo - 岗位信息
 * @returns {string}
 */
function buildUserPrompt(params) {
  const { profile, jobInfo } = params;

  let background = '求职者背景：\n';
  if (profile.resume) background += `\n简历：\n${profile.resume}`;
  if (profile.experience) background += `\n\n经历：\n${profile.experience}`;
  if (profile.skills) background += `\n\n技能：\n${profile.skills}`;
  if (profile.github) background += `\n\nGitHub：\n${profile.github}`;
  if (profile.portfolio) background += `\n\n作品集：\n${profile.portfolio}`;
  if (profile.selfIntro) background += `\n\n自我介绍：\n${profile.selfIntro}`;

  let job = '\n\n目标岗位：\n';
  if (jobInfo.title) job += `职位名称：${jobInfo.title}\n`;
  if (jobInfo.salary) job += `薪资范围：${jobInfo.salary}\n`;
  if (jobInfo.location) job += `工作地点：${jobInfo.location}\n`;
  if (jobInfo.company) job += `公司名称：${jobInfo.company}\n`;
  if (jobInfo.bossName) job += `联系人：${jobInfo.bossName}\n`;
  if (jobInfo.jd) job += `\n岗位要求：\n${jobInfo.jd}`;

  return background + job;
}

/**
 * 调用 AI API 生成消息
 * @param {Object} params
 * @param {Object} params.apiConfig - { baseUrl, apiKey, modelName }
 * @param {Object} params.profile - 用户资料
 * @param {Object} params.jobInfo - 岗位信息
 * @param {string} params.style - 消息风格
 * @param {string} params.customPrompt - 自定义提示词
 * @returns {Promise<string>} 生成的消息
 */
async function generateMessage(params) {
  const { apiConfig, profile, jobInfo, style, customPrompt } = params;

  if (!apiConfig.apiKey) {
    throw new Error('请先配置 API Key');
  }

  const systemPrompt = buildSystemPrompt({ style, customPrompt });
  const userPrompt = buildUserPrompt({ profile, jobInfo });

  // 确保 baseUrl 以 / 结尾
  let baseUrl = apiConfig.baseUrl.trim();
  if (!baseUrl.endsWith('/')) {
    baseUrl += '/';
  }

  // 构造请求 URL（兼容 OpenAI 格式）
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

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    STYLE_PROMPTS,
    buildSystemPrompt,
    buildUserPrompt,
    generateMessage,
  };
}
