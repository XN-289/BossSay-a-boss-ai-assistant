/**
 * BossSay - 存储模块 v2
 * 升级：gzip 压缩、设置备份/恢复
 */

const STORAGE_KEYS = {
  RESUME: 'bossSay_resume',
  EXPERIENCE: 'bossSay_experience',
  SKILLS: 'bossSay_skills',
  GITHUB: 'bossSay_github',
  PORTFOLIO: 'bossSay_portfolio',
  SELF_INTRO: 'bossSay_selfIntro',
  API_CONFIG: 'bossSay_apiConfig',
  STYLE_PROMPT: 'bossSay_stylePrompt',
  STYLE_PREFERENCE: 'bossSay_stylePreference',
  SEND_MODE: 'bossSay_sendMode',
  HISTORY: 'bossSay_history',
  RESUME_COMPRESSED: 'bossSay_resume_compressed',
};

const DEFAULT_STYLE_PROMPTS = {
  professional: {
    name: '💼 专业正式',
    prompt: '语气专业、简洁、自信。重点突出你的技术能力和项目经验与岗位的匹配度。用数据和具体成果说话。',
  },
  friendly: {
    name: '🤝 热情亲切',
    prompt: '语气热情、真诚、有温度。表达你对这个岗位和公司的真诚兴趣，同时展示你的能力和价值。',
  },
  humor: {
    name: '😄 幽默轻松',
    prompt: '语气轻松、幽默、有个性。用有趣的方式展示你的实力，让HR对你产生印象。但不要过度玩梗，保持专业底线。',
  },
  concise: {
    name: '📌 简洁明了',
    prompt: '消息不超过150字，信息密度最高。直接说明你的核心优势和匹配点，不废话。',
  },
};

const DEFAULT_VALUES = {
  [STORAGE_KEYS.RESUME]: '',
  [STORAGE_KEYS.EXPERIENCE]: '',
  [STORAGE_KEYS.SKILLS]: '',
  [STORAGE_KEYS.GITHUB]: '',
  [STORAGE_KEYS.PORTFOLIO]: '',
  [STORAGE_KEYS.SELF_INTRO]: '',
  [STORAGE_KEYS.API_CONFIG]: {
    baseUrl: '',
    apiKey: '',
    modelName: '',
  },
  [STORAGE_KEYS.STYLE_PROMPT]: DEFAULT_STYLE_PROMPTS,
  [STORAGE_KEYS.STYLE_PREFERENCE]: 'professional',
  [STORAGE_KEYS.SEND_MODE]: 'manual',
  [STORAGE_KEYS.HISTORY]: [],
  [STORAGE_KEYS.RESUME_COMPRESSED]: false,
};

// ==================== 基础读写 ====================

async function getStorageData(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => resolve(result));
  });
}

async function setStorageData(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, () => resolve());
  });
}

// ==================== 压缩/解压 ====================

/**
 * 使用 CompressionStream (gzip) 压缩文本
 */
async function compressText(text) {
  if (!text) return '';
  try {
    const encoder = new TextEncoder();
    const stream = new Blob([encoder.encode(text)]).stream();
    const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
    const compressedBlob = await new Response(compressedStream).blob();
    const buffer = await compressedBlob.arrayBuffer();
    // 转为 Base64
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
  } catch (e) {
    console.warn('压缩失败，使用原始文本:', e);
    return text;
  }
}

/**
 * 解压 gzip Base64 文本
 */
async function decompressText(compressed) {
  if (!compressed) return '';
  try {
    // 检测是否是 Base64
    if (!/^[A-Za-z0-9+/=]+$/.test(compressed.substring(0, 100))) {
      return compressed; // 未压缩的原始文本
    }
    const binaryStr = atob(compressed);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const stream = new Blob([bytes]).stream();
    const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'));
    return await new Response(decompressedStream).text();
  } catch (e) {
    console.warn('解压失败，返回原始内容:', e);
    return compressed;
  }
}

// ==================== 用户资料 ====================

async function getUserProfile() {
  const keys = Object.values(STORAGE_KEYS);
  const data = await getStorageData(keys);
  const profile = {};

  for (const [key, defaultVal] of Object.entries(DEFAULT_VALUES)) {
    profile[key] = data[key] ?? defaultVal;
  }

  // 如果简历是压缩的，解压
  if (profile[STORAGE_KEYS.RESUME_COMPRESSED] && profile[STORAGE_KEYS.RESUME]) {
    profile[STORAGE_KEYS.RESUME] = await decompressText(profile[STORAGE_KEYS.RESUME]);
  }

  return profile;
}

async function saveUserProfile(profile) {
  // 压缩简历文本（如果超过 1KB）
  const resume = profile[STORAGE_KEYS.RESUME];
  if (resume && resume.length > 1024) {
    profile[STORAGE_KEYS.RESUME] = await compressText(resume);
    profile[STORAGE_KEYS.RESUME_COMPRESSED] = true;
  } else {
    profile[STORAGE_KEYS.RESUME_COMPRESSED] = false;
  }

  await setStorageData(profile);
}

async function getApiConfig() {
  const data = await getStorageData(STORAGE_KEYS.API_CONFIG);
  return data[STORAGE_KEYS.API_CONFIG] || DEFAULT_VALUES[STORAGE_KEYS.API_CONFIG];
}

async function saveApiConfig(config) {
  await setStorageData({ [STORAGE_KEYS.API_CONFIG]: config });
}

async function getStylePreference() {
  const data = await getStorageData(STORAGE_KEYS.STYLE_PREFERENCE);
  return data[STORAGE_KEYS.STYLE_PREFERENCE] || DEFAULT_VALUES[STORAGE_KEYS.STYLE_PREFERENCE];
}

async function saveStylePreference(style) {
  await setStorageData({ [STORAGE_KEYS.STYLE_PREFERENCE]: style });
}

async function getStylePrompts() {
  const data = await getStorageData(STORAGE_KEYS.STYLE_PROMPT);
  return data[STORAGE_KEYS.STYLE_PROMPT] || DEFAULT_STYLE_PROMPTS;
}

async function saveStylePrompts(prompts) {
  await setStorageData({ [STORAGE_KEYS.STYLE_PROMPT]: prompts });
}

async function getSendMode() {
  const data = await getStorageData(STORAGE_KEYS.SEND_MODE);
  return data[STORAGE_KEYS.SEND_MODE] || DEFAULT_VALUES[STORAGE_KEYS.SEND_MODE];
}

async function saveSendMode(mode) {
  await setStorageData({ [STORAGE_KEYS.SEND_MODE]: mode });
}

// ==================== 历史记录 ====================

async function addHistory(record) {
  const data = await getStorageData(STORAGE_KEYS.HISTORY);
  const history = data[STORAGE_KEYS.HISTORY] || [];
  history.unshift({
    ...record,
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
  });
  if (history.length > 200) history.length = 200;
  await setStorageData({ [STORAGE_KEYS.HISTORY]: history });
}

async function getHistory() {
  const data = await getStorageData(STORAGE_KEYS.HISTORY);
  return data[STORAGE_KEYS.HISTORY] || [];
}

async function clearHistory() {
  await setStorageData({ [STORAGE_KEYS.HISTORY]: [] });
}

// ==================== 配置检查 ====================

async function isConfigured() {
  const profile = await getUserProfile();
  const hasResume = (profile[STORAGE_KEYS.RESUME]?.trim().length > 0) ||
    (profile[STORAGE_KEYS.EXPERIENCE]?.trim().length > 0);
  const apiConfig = await getApiConfig();
  const hasApi = apiConfig.apiKey?.trim().length > 0;
  return hasResume && hasApi;
}

// ==================== 备份/恢复 ====================

/**
 * 导出所有设置为 JSON
 * @param {Object} options - { excludeApiKey: boolean, excludeResume: boolean }
 */
async function exportSettings(options = {}) {
  const profile = await getUserProfile();
  const exportData = {
    version: '1.0.0',
    exportDate: new Date().toISOString(),
    data: {},
  };

  // 复制数据
  for (const [key, value] of Object.entries(profile)) {
    exportData.data[key] = value;
  }

  // 排除敏感数据
  if (options.excludeApiKey && exportData.data[STORAGE_KEYS.API_CONFIG]) {
    exportData.data[STORAGE_KEYS.API_CONFIG] = {
      ...exportData.data[STORAGE_KEYS.API_CONFIG],
      apiKey: '',
    };
  }

  if (options.excludeResume) {
    exportData.data[STORAGE_KEYS.RESUME] = '';
    exportData.data[STORAGE_KEYS.RESUME_COMPRESSED] = false;
  }

  return JSON.stringify(exportData, null, 2);
}

/**
 * 从 JSON 导入设置
 */
async function importSettings(jsonString) {
  try {
    const importData = JSON.parse(jsonString);
    if (!importData.version || !importData.data) {
      throw new Error('无效的备份文件格式');
    }

    const dataToSave = {};
    for (const [key, value] of Object.entries(importData.data)) {
      if (Object.values(STORAGE_KEYS).includes(key)) {
        dataToSave[key] = value;
      }
    }

    await setStorageData(dataToSave);
    return { success: true, message: '导入成功' };
  } catch (error) {
    return { success: false, message: '导入失败: ' + error.message };
  }
}

/**
 * 清除所有数据
 */
async function clearAllData() {
  await chrome.storage.local.clear();
}

// ==================== 导出 ====================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    STORAGE_KEYS,
    DEFAULT_VALUES,
    DEFAULT_STYLE_PROMPTS,
    getStorageData,
    setStorageData,
    getUserProfile,
    saveUserProfile,
    getApiConfig,
    saveApiConfig,
    getStylePreference,
    saveStylePreference,
    getStylePrompts,
    saveStylePrompts,
    getSendMode,
    saveSendMode,
    addHistory,
    getHistory,
    clearHistory,
    isConfigured,
    exportSettings,
    importSettings,
    clearAllData,
    compressText,
    decompressText,
  };
}
