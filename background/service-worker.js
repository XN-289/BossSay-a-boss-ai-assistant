/**
 * BossSay - Background Service Worker v2
 * 升级：API 测试、风格配置、备份恢复、历史管理
 */

importScripts('../lib/storage.js');

// ==================== AI Prompt 构造 ====================

function buildSystemPrompt(style, customPrompt) {
  if (style === 'custom' && customPrompt) return customPrompt;

  const prompts = {
    professional: '语气专业、简洁、自信。重点突出你的技术能力和项目经验与岗位的匹配度。用数据和具体成果说话。',
    friendly: '语气热情、真诚、有温度。表达你对这个岗位和公司的真诚兴趣，同时展示你的能力和价值。',
    humor: '语气轻松、幽默、有个性。用有趣的方式展示你的实力，让HR对你产生印象。但不要过度玩梗，保持专业底线。',
    concise: '消息不超过150字，信息密度最高。直接说明你的核心优势和匹配点，不废话。',
  };

  const instruction = prompts[style] || prompts.professional;

  return `你是一个专业的求职顾问。你的任务是根据求职者的背景和目标岗位的JD，生成一条精准、有诚意的Boss直聘打招呼消息。

规则：
1. 消息长度控制在 100-200 字
2. 不要使用"我对这个岗位很感兴趣"等空洞表达
3. 必须提及至少一个与 JD 要求匹配的具体经历/技能
4. ${instruction}
5. 不要用"您"，用"你"，保持平等对话感
6. 最后可以适当提一个跟岗位相关的问题，展示你的思考
7. 直接输出消息内容，不要加任何前缀说明
8. 不要使用引号包裹消息`;
}

function buildUserPrompt(profile, jobInfo) {
  let bg = '求职者背景：\n';
  if (profile.resume) bg += `\n简历：\n${profile.resume}`;
  if (profile.experience) bg += `\n\n经历：\n${profile.experience}`;
  if (profile.skills) bg += `\n\n技能：\n${profile.skills}`;
  if (profile.github) bg += `\n\nGitHub：\n${profile.github}`;
  if (profile.portfolio) bg += `\n\n作品集：\n${profile.portfolio}`;
  if (profile.selfIntro) bg += `\n\n自我介绍：\n${profile.selfIntro}`;

  let job = '\n\n目标岗位：\n';
  if (jobInfo.title) job += `职位名称：${jobInfo.title}\n`;
  if (jobInfo.salary) job += `薪资范围：${jobInfo.salary}\n`;
  if (jobInfo.location) job += `工作地点：${jobInfo.location}\n`;
  if (jobInfo.company) job += `公司名称：${jobInfo.company}\n`;
  if (jobInfo.bossName) job += `联系人：${jobInfo.bossName}\n`;
  if (jobInfo.jd) job += `\n岗位要求：\n${jobInfo.jd}`;

  return bg + job;
}

// ==================== API 调用 ====================

async function callAI(apiConfig, systemPrompt, userPrompt) {
  if (!apiConfig.apiKey) throw new Error('请先配置 API Key');

  let baseUrl = apiConfig.baseUrl.trim();
  if (!baseUrl.endsWith('/')) baseUrl += '/';
  const url = `${baseUrl}chat/completions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: apiConfig.modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 800,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`API 调用失败: ${err.error?.message || response.status}`);
  }

  const data = await response.json();
  const msg = data.choices?.[0]?.message?.content?.trim();
  if (!msg) throw new Error('AI 未能生成有效消息');
  return msg;
}

// ==================== 消息监听 ====================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handlers = {
    'GENERATE_MESSAGE': () => handleGenerateMessage(request.data).then(sendResponse),
    'TEST_API': () => handleTestApi().then(sendResponse),
    'GET_PROFILE': () => getUserProfile().then(p => sendResponse({ success: true, profile: p })),
    'SAVE_PROFILE': () => saveUserProfile(request.data).then(() => sendResponse({ success: true })),
    'GET_API_CONFIG': () => getApiConfig().then(c => sendResponse({ success: true, config: c })),
    'SAVE_API_CONFIG': () => saveApiConfig(request.data).then(() => sendResponse({ success: true })),
    'GET_STYLE_PROMPTS': () => getStylePrompts().then(p => sendResponse({ success: true, prompts: p })),
    'SAVE_STYLE_PROMPTS': () => saveStylePrompts(request.data).then(() => sendResponse({ success: true })),
    'GET_HISTORY': () => getHistory().then(h => sendResponse({ success: true, history: h })),
    'CLEAR_HISTORY': () => clearHistory().then(() => sendResponse({ success: true })),
    'EXPORT_SETTINGS': () => exportSettings(request.data).then(d => sendResponse({ success: true, data: d })),
    'IMPORT_SETTINGS': () => importSettings(request.data).then(sendResponse),
    'CHECK_CONFIG': () => isConfigured().then(c => sendResponse({ success: true, configured: c })),
  };

  const handler = handlers[request.type];
  if (handler) {
    handler();
    return true;
  }
});

// ==================== 处理函数 ====================

async function handleGenerateMessage(data) {
  const { jobInfo, style, customPrompt } = data;

  const rawProfile = await getUserProfile();
  const apiConfig = await getApiConfig();

  if (!apiConfig.apiKey) {
    return { success: false, error: '请先在设置中配置 API Key' };
  }

  // 映射字段
  const profile = {
    resume: rawProfile.bossSay_resume || '',
    experience: rawProfile.bossSay_experience || '',
    skills: rawProfile.bossSay_skills || '',
    github: rawProfile.bossSay_github || '',
    portfolio: rawProfile.bossSay_portfolio || '',
    selfIntro: rawProfile.bossSay_selfIntro || '',
  };

  if (!profile.resume && !profile.experience) {
    return { success: false, error: '请先在资料页面填写简历或个人经历' };
  }

  const systemPrompt = buildSystemPrompt(style, customPrompt);
  const userPrompt = buildUserPrompt(profile, jobInfo);

  try {
    const message = await callAI(apiConfig, systemPrompt, userPrompt);
    await addHistory({
      jobTitle: jobInfo.title,
      company: jobInfo.company,
      message,
      style,
    });
    return { success: true, message };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function handleTestApi() {
  const apiConfig = await getApiConfig();

  if (!apiConfig.apiKey || !apiConfig.baseUrl || !apiConfig.modelName) {
    return { success: false, error: '请先填写完整的 API 配置' };
  }

  let baseUrl = apiConfig.baseUrl.trim();
  if (!baseUrl.endsWith('/')) baseUrl += '/';
  const url = `${baseUrl}chat/completions`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: apiConfig.modelName,
        messages: [{ role: 'user', content: '你好，请回复"连接成功"' }],
        max_tokens: 50,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return { success: false, error: `HTTP ${response.status}: ${err.error?.message || '未知错误'}` };
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim() || '无响应';
    return { success: true, reply };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ==================== 安装事件 ====================

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('BossSay 安装成功！');
  }
});
