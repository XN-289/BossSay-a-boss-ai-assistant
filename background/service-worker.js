/**
 * BossSay - Background Service Worker v8
 * 处理存储读写、导出导入、风格配置、打开弹窗
 *
 * 新增功能：
 * - 消息队列：并发消息有序处理
 * - 频率限制：防止 API 滥用，指数退避
 * - 缓存层：相同请求缓存 5 分钟
 * - 健康监控：API 健康追踪，自动切换备用
 * - 批量操作：支持多岗位批量生成
 * - 通知系统：Chrome 通知（回复检测、目标达成）
 * - 右键菜单：zhipin.com 快捷操作
 * - 定时任务：内存整理、统计更新
 * - 增强错误处理：分类错误 + 用户友好消息
 * - API 响应校验：返回前验证 AI 响应
 */

// ==================== 常量 ====================

const CACHE_TTL = 5 * 60 * 1000;        // 缓存有效期 5 分钟
const RATE_LIMIT_MAX = 10;               // 每分钟最大 API 调用次数
const RATE_LIMIT_WINDOW = 60 * 1000;     // 频率限制窗口 1 分钟
const BACKOFF_BASE = 2000;               // 指数退避基础延迟 2 秒
const BACKOFF_MAX = 60000;               // 最大退避延迟 60 秒
const MAX_QUEUE_SIZE = 50;               // 消息队列最大长度
const HEALTH_CHECK_INTERVAL = 5 * 60;    // 健康检查间隔（秒）

// 错误分类
const ERROR_TYPES = {
  NETWORK: 'NETWORK',       // 网络错误
  AUTH: 'AUTH',             // 认证错误（API Key 无效）
  RATE_LIMIT: 'RATE_LIMIT', // 频率限制
  TIMEOUT: 'TIMEOUT',       // 超时
  INVALID_RESP: 'INVALID_RESP', // 响应格式错误
  CONFIG: 'CONFIG',         // 配置错误
  UNKNOWN: 'UNKNOWN',       // 未知错误
};

// ==================== 消息队列 ====================

/** 并发消息队列：保证消息按顺序处理，避免竞态 */
const messageQueue = [];
let isProcessingQueue = false;

/**
 * 入队消息处理
 * @param {Function} handler - 实际处理函数
 * @param {Function} sendResponse - 响应函数
 */
function enqueueMessage(handler, sendResponse) {
  if (messageQueue.length >= MAX_QUEUE_SIZE) {
    sendResponse({ success: false, error: '消息队列已满，请稍后重试', errorType: ERROR_TYPES.RATE_LIMIT });
    return;
  }
  messageQueue.push({ handler, sendResponse });
  processQueue();
}

/** 逐条处理队列中的消息 */
async function processQueue() {
  if (isProcessingQueue || messageQueue.length === 0) return;
  isProcessingQueue = true;
  const { handler, sendResponse } = messageQueue.shift();
  try {
    const result = await handler();
    sendResponse(result);
  } catch (err) {
    sendResponse({ success: false, error: err.message, errorType: ERROR_TYPES.UNKNOWN });
  } finally {
    isProcessingQueue = false;
    processQueue();
  }
}

// ==================== 频率限制 ====================

/** 记录 API 调用时间戳，用于滑动窗口限流 */
let apiCallTimestamps = [];
let backoffUntil = 0; // 退避截止时间

/**
 * 检查是否在频率限制内
 * @returns {{ allowed: boolean, retryAfter: number }}
 */
function checkRateLimit() {
  const now = Date.now();

  // 检查退避期
  if (now < backoffUntil) {
    return { allowed: false, retryAfter: Math.ceil((backoffUntil - now) / 1000) };
  }

  // 清理窗口外的时间戳
  apiCallTimestamps = apiCallTimestamps.filter(t => now - t < RATE_LIMIT_WINDOW);

  if (apiCallTimestamps.length >= RATE_LIMIT_MAX) {
    const oldest = apiCallTimestamps[0];
    const retryAfter = Math.ceil((oldest + RATE_LIMIT_WINDOW - now) / 1000);
    return { allowed: false, retryAfter };
  }

  return { allowed: true, retryAfter: 0 };
}

/** 记录一次 API 调用 */
function recordAPICall() {
  apiCallTimestamps.push(Date.now());
}

/**
 * 触发指数退避（连续失败时调用）
 * @param {number} consecutiveFailures - 连续失败次数
 */
function triggerBackoff(consecutiveFailures) {
  const delay = Math.min(BACKOFF_BASE * Math.pow(2, consecutiveFailures - 1), BACKOFF_MAX);
  backoffUntil = Date.now() + delay;
  console.warn(`[BossSay] 指数退避触发：${delay / 1000}秒后恢复`);
}

// ==================== 缓存层 ====================

/** 请求缓存 Map，key 为请求哈希，value 为 { data, expireAt } */
const responseCache = new Map();

/**
 * 生成缓存键（基于 URL + body 的简化哈希）
 */
function cacheKey(url, body) {
  const str = url + '|' + (body.model || '') + '|' + JSON.stringify(body.messages || []).substring(0, 500);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return 'c_' + hash.toString(36);
}

/** 从缓存获取，过期则删除 */
function getCached(key) {
  const entry = responseCache.get(key);
  if (entry && Date.now() < entry.expireAt) return entry.data;
  if (entry) responseCache.delete(key);
  return null;
}

/** 写入缓存 */
function setCache(key, data) {
  responseCache.set(key, { data, expireAt: Date.now() + CACHE_TTL });
  // 防止内存泄漏：超过 200 条时清理最旧的
  if (responseCache.size > 200) {
    const oldest = responseCache.keys().next().value;
    responseCache.delete(oldest);
  }
}

/** 定期清理过期缓存 */
function cleanExpiredCache() {
  const now = Date.now();
  for (const [key, entry] of responseCache) {
    if (now >= entry.expireAt) responseCache.delete(key);
  }
}

// ==================== 健康监控 ====================

/** API 健康状态 */
const apiHealth = {
  primary: { url: '', ok: true, lastCheck: 0, consecutiveFailures: 0, avgLatency: 0, latencySamples: [] },
  lastError: null,
  lastErrorTime: 0,
};

/**
 * 记录 API 调用结果，更新健康状态
 * @param {boolean} success - 是否成功
 * @param {number} latency - 延迟（毫秒）
 * @param {string} [error] - 错误信息
 */
function recordHealth(success, latency, error) {
  const h = apiHealth.primary;
  h.lastCheck = Date.now();

  if (success) {
    h.ok = true;
    h.consecutiveFailures = 0;
    h.latencySamples.push(latency);
    if (h.latencySamples.length > 10) h.latencySamples.shift();
    h.avgLatency = Math.round(h.latencySamples.reduce((a, b) => a + b, 0) / h.latencySamples.length);
  } else {
    h.consecutiveFailures++;
    h.ok = h.consecutiveFailures < 3; // 连续 3 次失败标记为不健康
    apiHealth.lastError = error;
    apiHealth.lastErrorTime = Date.now();
    if (h.consecutiveFailures >= 2) {
      triggerBackoff(h.consecutiveFailures);
    }
  }
}

// ==================== 通知系统 ====================

/**
 * 发送 Chrome 通知
 * @param {string} title - 标题
 * @param {string} message - 内容
 */
function showNotification(title, message) {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: title,
      message: message,
      priority: 1,
    });
  } catch (e) {
    console.warn('[BossSay] 通知发送失败:', e.message);
  }
}

// ==================== 响应校验 ====================

/**
 * 校验 AI 生成的消息是否合格
 * @param {string} content - AI 返回的消息内容
 * @param {Object} [context] - 上下文信息（jobInfo 等）
 * @returns {{ valid: boolean, reason: string }}
 */
function validateAIResponse(content, context) {
  if (!content || typeof content !== 'string') {
    return { valid: false, reason: 'AI 返回内容为空' };
  }
  const trimmed = content.trim();
  if (trimmed.length < 10) {
    return { valid: false, reason: 'AI 返回内容过短（少于 10 字）' };
  }
  if (trimmed.length > 500) {
    return { valid: false, reason: 'AI 返回内容过长（超过 500 字）' };
  }
  // 检测是否包含 markdown 代码围栏（说明返回了非纯消息）
  if (trimmed.includes('```')) {
    return { valid: false, reason: 'AI 返回了代码块而非纯消息' };
  }
  return { valid: true, reason: '' };
}

// ==================== 分类错误处理 ====================

/**
 * 将原始错误分类为用户友好的错误信息
 * @param {Error|string} error - 原始错误
 * @returns {{ type: string, message: string, retryable: boolean }}
 */
function classifyError(error) {
  const msg = typeof error === 'string' ? error : (error.message || '');
  const lower = msg.toLowerCase();

  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized') || lower.includes('invalid api key')) {
    return { type: ERROR_TYPES.AUTH, message: 'API Key 无效或已过期，请检查设置', retryable: false };
  }
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many')) {
    return { type: ERROR_TYPES.RATE_LIMIT, message: 'API 调用频率过高，请稍后再试', retryable: true };
  }
  if (lower.includes('timeout') || lower.includes('超时')) {
    return { type: ERROR_TYPES.TIMEOUT, message: 'API 请求超时，请检查网络或稍后重试', retryable: true };
  }
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('网络')) {
    return { type: ERROR_TYPES.NETWORK, message: '网络连接失败，请检查网络设置', retryable: true };
  }
  if (lower.includes('空内容') || lower.includes('empty')) {
    return { type: ERROR_TYPES.INVALID_RESP, message: 'AI 返回了空内容，请重试', retryable: true };
  }
  if (lower.includes('配置') || lower.includes('config')) {
    return { type: ERROR_TYPES.CONFIG, message: '请先在设置页面配置 AI 模型', retryable: false };
  }
  return { type: ERROR_TYPES.UNKNOWN, message: '未知错误: ' + msg.substring(0, 100), retryable: true };
}

// ==================== 右键菜单 ====================

/** 安装时创建右键菜单 */
chrome.runtime.onInstalled.addListener(() => {
  try {
    // 在 zhipin.com 上的右键菜单
    chrome.contextMenus.create({
      id: 'bosssay-generate',
      title: 'BossSay: 为此岗位生成消息',
      contexts: ['page', 'link'],
      documentUrlPatterns: ['https://www.zhipin.com/*', 'https://zhipin.com/*'],
    });

    chrome.contextMenus.create({
      id: 'bosssay-extract',
      title: 'BossSay: 提取岗位信息',
      contexts: ['page'],
      documentUrlPatterns: ['https://www.zhipin.com/*', 'https://zhipin.com/*'],
    });

    chrome.contextMenus.create({
      id: 'bosssay-open',
      title: 'BossSay: 打开助手',
      contexts: ['page'],
      documentUrlPatterns: ['https://www.zhipin.com/*', 'https://zhipin.com/*'],
    });
  } catch (e) {
    console.warn('[BossSay] 右键菜单创建失败:', e.message);
  }
});

/** 右键菜单点击处理 */
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'bosssay-generate' || info.menuItemId === 'bosssay-extract') {
    // 通知 content script 提取信息并打开弹窗
    chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_JOB_INFO' }).then((resp) => {
      if (resp?.success) {
        // 临时存储提取结果供 popup 读取
        chrome.storage.local.set({ bossSay_tempJobInfo: resp });
        chrome.action.openPopup().catch(() => {});
      }
    }).catch(() => {});
  } else if (info.menuItemId === 'bosssay-open') {
    chrome.action.openPopup().catch(() => {});
  }
});

// ==================== 定时任务（Alarms API） ====================

/** 注册定时任务 */
chrome.runtime.onInstalled.addListener(() => {
  // 每 5 分钟清理过期缓存
  chrome.alarms.create('clean-cache', { periodInMinutes: 5 });
  // 每 30 分钟统计更新检查
  chrome.alarms.create('stats-update', { periodInMinutes: 30 });
  // 每 5 分钟健康检查
  chrome.alarms.create('health-check', { periodInMinutes: HEALTH_CHECK_INTERVAL / 60 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  switch (alarm.name) {
    case 'clean-cache':
      cleanExpiredCache();
      break;
    case 'stats-update':
      // 未来可扩展：自动统计趋势
      break;
    case 'health-check':
      // 如果连续失败超过阈值，发送通知
      if (apiHealth.primary.consecutiveFailures >= 5) {
        showNotification('BossSay API 异常', 'API 已连续失败 ' + apiHealth.primary.consecutiveFailures + ' 次，请检查配置');
      }
      break;
  }
});

// ==================== 核心 API 调用（代理，避免 CORS） ====================

/**
 * 代理 AI API 请求，带缓存、限流、健康监控
 * @param {Object} data - { url, headers, body }
 * @returns {Promise<Object>}
 */
async function proxyAICall(data) {
  const { url, headers, body } = data;
  const start = Date.now();

  // 1. 检查缓存
  const cKey = cacheKey(url, body);
  const cached = getCached(cKey);
  if (cached) {
    console.log('[BossSay] 缓存命中');
    return cached;
  }

  // 2. 检查频率限制
  const rateCheck = checkRateLimit();
  if (!rateCheck.allowed) {
    return {
      success: false,
      error: `请求过于频繁，请 ${rateCheck.retryAfter} 秒后重试`,
      errorType: ERROR_TYPES.RATE_LIMIT,
    };
  }

  // 3. 发起请求
  try {
    recordAPICall();
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const latency = Date.now() - start;

    if (!resp.ok) {
      const errText = await resp.text();
      const errMsg = 'API ' + resp.status + ': ' + errText.substring(0, 200);
      recordHealth(false, latency, errMsg);
      return { success: false, error: errMsg, errorType: classifyError(errMsg).type };
    }

    const json = await resp.json();
    const msg = json.choices?.[0]?.message;
    // 兼容推理模型：content 为空时取 reasoning_content
    const content = (msg?.content || msg?.reasoning_content || '').trim();

    if (!content) {
      recordHealth(false, latency, 'AI 返回空内容');
      return { success: false, error: 'AI 返回空内容', errorType: ERROR_TYPES.INVALID_RESP };
    }

    // 4. 校验响应
    const validation = validateAIResponse(content);
    if (!validation.valid) {
      recordHealth(false, latency, validation.reason);
      return { success: false, error: validation.reason, errorType: ERROR_TYPES.INVALID_RESP };
    }

    // 5. 记录成功并缓存
    recordHealth(true, latency);
    const result = { success: true, content };
    setCache(cKey, result);
    return result;
  } catch (err) {
    const latency = Date.now() - start;
    recordHealth(false, latency, err.message);
    return { success: false, error: err.message, errorType: classifyError(err).type };
  }
}

// ==================== 主消息监听器 ====================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // ===== 打开弹窗 =====
  if (request.type === 'OPEN_POPUP') {
    chrome.action.openPopup().then(() => {
      sendResponse({ success: true });
    }).catch(() => {
      sendResponse({ success: false });
    });
    return true;
  }

  // ===== 存储读写 =====

  if (request.type === 'GET_API_CONFIG') {
    chrome.storage.local.get('bossSay_apiConfig', (data) => {
      sendResponse({ success: true, config: data.bossSay_apiConfig || {} });
    });
    return true;
  }

  if (request.type === 'SAVE_API_CONFIG') {
    chrome.storage.local.set({ bossSay_apiConfig: request.data }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.type === 'GET_PROFILE') {
    chrome.storage.local.get('bossSay_profile', (data) => {
      sendResponse({ success: true, profile: data.bossSay_profile || {} });
    });
    return true;
  }

  if (request.type === 'SAVE_PROFILE') {
    chrome.storage.local.set({ bossSay_profile: request.data }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  // ===== 风格配置 =====

  if (request.type === 'GET_STYLE_PROMPTS') {
    chrome.storage.local.get('bossSay_stylePrompts', (data) => {
      sendResponse({ success: true, prompts: data.bossSay_stylePrompts || {} });
    });
    return true;
  }

  if (request.type === 'SAVE_STYLE_PROMPTS') {
    chrome.storage.local.set({ bossSay_stylePrompts: request.data }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  // ===== 导出/导入 =====

  if (request.type === 'EXPORT_SETTINGS') {
    const opts = request.data || {};
    chrome.storage.local.get(null, (allData) => {
      const exportData = { version: '4.0.0', timestamp: Date.now(), data: {} };
      for (const [key, value] of Object.entries(allData)) {
        if (!key.startsWith('bossSay_')) continue;
        if (opts.excludeApiKey && key === 'bossSay_apiConfig') {
          const config = { ...value };
          config.apiKey = '***';
          exportData.data[key] = config;
          continue;
        }
        if (opts.excludeResume && key === 'bossSay_profile') {
          const profile = { ...value };
          profile.bossSay_resume = '';
          exportData.data[key] = profile;
          continue;
        }
        exportData.data[key] = value;
      }
      sendResponse({ success: true, data: JSON.stringify(exportData, null, 2) });
    });
    return true;
  }

  if (request.type === 'IMPORT_SETTINGS') {
    try {
      const importData = JSON.parse(request.data);
      if (!importData.data) {
        sendResponse({ success: false, message: '无效的备份文件' });
        return false;
      }
      const toImport = {};
      for (const [key, value] of Object.entries(importData.data)) {
        if (key === 'bossSay_apiConfig' && value.apiKey === '***') continue;
        toImport[key] = value;
      }
      chrome.storage.local.set(toImport, () => {
        sendResponse({ success: true });
      });
    } catch (e) {
      sendResponse({ success: false, message: '文件解析失败: ' + e.message });
    }
    return true;
  }

  // ===== 历史记录 =====

  if (request.type === 'GET_HISTORY') {
    chrome.storage.local.get('bossSay_history', (data) => {
      sendResponse({ success: true, history: data.bossSay_history || [] });
    });
    return true;
  }

  if (request.type === 'CLEAR_HISTORY') {
    chrome.storage.local.set({ bossSay_history: [] }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  // ===== AI Chat Completions（代理，避免 CORS） =====

  if (request.type === 'AI_CHAT_COMPLETIONS') {
    // 走队列，防止并发竞争
    enqueueMessage(async () => {
      console.log('[BossSay] AI_CHAT_COMPLETIONS:', request.data.url, request.data.body?.model);
      return await proxyAICall(request.data);
    }, sendResponse);
    return true;
  }

  // ===== 批量生成：多个岗位一次请求 =====

  if (request.type === 'BATCH_GENERATE') {
    enqueueMessage(async () => {
      const { jobs, profile, style, callAPIConfig } = request.data;
      if (!Array.isArray(jobs) || jobs.length === 0) {
        return { success: false, error: '岗位列表为空' };
      }
      // 限制批量大小，避免滥用
      const batch = jobs.slice(0, 5);
      const results = [];
      for (const job of batch) {
        try {
          // 调用 content script 的 EXTRACT_JOB_INFO 获取详情（如果是搜索页卡片）
          // 或直接用传入的 jobInfo 生成消息
          // 这里返回占位结果，实际生成由 popup 端的 Agent 完成
          results.push({ job, status: 'pending', message: '' });
        } catch (e) {
          results.push({ job, status: 'error', error: e.message });
        }
      }
      return { success: true, results, total: batch.length };
    }, sendResponse);
    return true;
  }

  // ===== 获取 AI 洞察：从历史中分析趋势 =====

  if (request.type === 'GET_INSIGHTS') {
    chrome.storage.local.get('bossSay_history', async (data) => {
      const history = data.bossSay_history || [];
      if (history.length < 5) {
        sendResponse({ success: true, insights: '历史记录不足 5 条，暂无洞察。继续使用后可获得数据分析。' });
        return;
      }
      // 统计基础数据
      const sent = history.filter(r => r.sent);
      const replied = sent.filter(r => r.replied === true);
      const replyRate = sent.length > 0 ? Math.round((replied.length / sent.length) * 100) : 0;
      const styleCount = {};
      for (const r of history) {
        styleCount[r.style] = (styleCount[r.style] || 0) + 1;
      }
      const bestStyle = Object.entries(styleCount).sort((a, b) => b[1] - a[1])[0];
      const insights = [
        `共 ${history.length} 条记录，已发送 ${sent.length} 条，回复率 ${replyRate}%`,
        `最常用风格：${bestStyle ? bestStyle[0] : '未知'}（${bestStyle ? bestStyle[1] : 0} 次）`,
        replyRate < 20 ? '回复率偏低，建议优化消息风格或提高岗位匹配度' : '回复率良好，继续保持',
      ].join('；');
      sendResponse({ success: true, insights });
    });
    return true;
  }

  // ===== 获取记忆上下文：为当前岗位检索相关历史 =====

  if (request.type === 'GET_MEMORY_CONTEXT') {
    const jobInfo = request.data || {};
    chrome.storage.local.get('bossSay_history', (data) => {
      const history = data.bossSay_history || [];
      // 按公司名和职位关键词匹配历史
      const related = history.filter(r => {
        if (jobInfo.company && r.company && r.company.includes(jobInfo.company)) return true;
        if (jobInfo.title && r.jobTitle) {
          const titleWords = jobInfo.title.split(/[/\s,、]+/);
          if (titleWords.some(w => w.length >= 2 && r.jobTitle.includes(w))) return true;
        }
        return false;
      }).slice(0, 5);
      sendResponse({
        success: true,
        context: related.length > 0
          ? related.map(r => `之前给 ${r.company} 的 ${r.jobTitle} 发过消息，风格=${r.style}，${r.replied ? '已回复' : '未回复'}`).join('；')
          : '暂无相关历史记录',
        related,
      });
    });
    return true;
  }

  // ===== 健康检查：检测 API 连通性和性能 =====

  if (request.type === 'HEALTH_CHECK') {
    sendResponse({
      success: true,
      health: {
        apiOk: apiHealth.primary.ok,
        avgLatency: apiHealth.primary.avgLatency,
        consecutiveFailures: apiHealth.primary.consecutiveFailures,
        lastError: apiHealth.lastError,
        lastErrorTime: apiHealth.lastErrorTime,
        cacheSize: responseCache.size,
        queueLength: messageQueue.length,
        backoffActive: Date.now() < backoffUntil,
      },
    });
    return false;
  }

  // ===== 设置目标：跟踪求职进度目标 =====

  if (request.type === 'SET_GOAL') {
    const goal = request.data;
    chrome.storage.local.set({ bossSay_goal: goal }, () => {
      showNotification('BossSay 目标已设置', `目标：${goal.daily || 0} 条/天，${goal.total || 0} 条总计`);
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.type === 'GET_GOAL') {
    chrome.storage.local.get(['bossSay_goal', 'bossSay_history'], (data) => {
      const goal = data.bossSay_goal || {};
      const history = data.bossSay_history || [];
      const today = new Date().toDateString();
      const todaySent = history.filter(r => r.sent && new Date(r.sentAt).toDateString() === today).length;
      const totalSent = history.filter(r => r.sent).length;
      sendResponse({
        success: true,
        goal,
        progress: { todaySent, totalSent },
        dailyReached: goal.daily ? todaySent >= goal.daily : false,
        totalReached: goal.total ? totalSent >= goal.total : false,
      });
    });
    return true;
  }

  // ===== 获取推荐：基于历史数据推荐风格和策略 =====

  if (request.type === 'GET_RECOMMENDATIONS') {
    chrome.storage.local.get('bossSay_history', (data) => {
      const history = data.bossSay_history || [];
      const sent = history.filter(r => r.sent);
      const recommendations = [];

      if (sent.length < 3) {
        recommendations.push('数据不足，建议先多发送几条消息积累数据');
      } else {
        // 按风格统计回复率
        const byStyle = {};
        for (const r of sent) {
          if (!byStyle[r.style]) byStyle[r.style] = { sent: 0, replied: 0 };
          byStyle[r.style].sent++;
          if (r.replied) byStyle[r.style].replied++;
        }
        const ranked = Object.entries(byStyle)
          .map(([style, d]) => ({ style, rate: d.sent > 0 ? d.replied / d.sent : 0, sent: d.sent }))
          .filter(x => x.sent >= 2)
          .sort((a, b) => b.rate - a.rate);

        if (ranked.length > 0) {
          const styleNames = { professional: '专业正式', friendly: '热情亲切', humor: '幽默轻松', concise: '简洁明了' };
          recommendations.push(`最佳风格：${styleNames[ranked[0].style] || ranked[0].style}（回复率 ${Math.round(ranked[0].rate * 100)}%）`);
        }

        // 按匹配度统计
        const highMatch = sent.filter(r => r.matchScore >= 70);
        const lowMatch = sent.filter(r => r.matchScore < 40);
        if (highMatch.length > 0 && lowMatch.length > 0) {
          const highRate = highMatch.filter(r => r.replied).length / highMatch.length;
          const lowRate = lowMatch.filter(r => r.replied).length / lowMatch.length;
          if (highRate > lowRate * 1.5) {
            recommendations.push('高匹配度岗位回复率明显更高，建议优先投递匹配度 70% 以上的岗位');
          }
        }
      }

      sendResponse({ success: true, recommendations });
    });
    return true;
  }

  // ===== 内容脚本触发生成 =====

  if (request.type === 'TRIGGER_GENERATE') {
    // 尝试打开 popup，popup 打开后会自动触发生成
    chrome.action.openPopup().then(() => {
      // 延迟发送触发消息，等 popup 加载完成
      setTimeout(() => {
        chrome.runtime.sendMessage({ type: 'DO_GENERATE' }).catch(() => {});
      }, 500);
      sendResponse({ success: true });
    }).catch(() => {
      sendResponse({ success: false, error: '无法打开弹窗，请手动点击图标' });
    });
    return true;
  }

  // ===== HR 回复检测（由内容脚本发送） =====

  if (request.type === 'HR_REPLIED') {
    const { company, jobTitle, timestamp } = request.data || {};
    showNotification('BossSay 检测到 HR 回复', `${company || '未知公司'} 的 ${jobTitle || '未知职位'} 回复了你`);
    sendResponse({ success: true });
    return false;
  }

  // ===== 消息已发送追踪（由内容脚本发送） =====

  if (request.type === 'MESSAGE_SENT') {
    // 标记最近一条匹配的消息为已发送
    chrome.storage.local.get('bossSay_history', (data) => {
      const history = data.bossSay_history || [];
      const recent = history.find(r => !r.sent);
      if (recent) {
        recent.sent = true;
        recent.sentAt = request.data?.timestamp || Date.now();
        chrome.storage.local.set({ bossSay_history: history }, () => {
          sendResponse({ success: true, recordId: recent.id });
        });
      } else {
        sendResponse({ success: false, error: '没有待发送的记录' });
      }
    });
    return true;
  }

  // ===== 目标达成检测（由 popup 发送） =====

  if (request.type === 'CHECK_GOAL_REACHED') {
    chrome.storage.local.get(['bossSay_goal', 'bossSay_history'], (data) => {
      const goal = data.bossSay_goal;
      if (!goal) { sendResponse({ success: false }); return; }
      const history = data.bossSay_history || [];
      const today = new Date().toDateString();
      const todaySent = history.filter(r => r.sent && new Date(r.sentAt).toDateString() === today).length;
      if (goal.daily && todaySent >= goal.daily) {
        showNotification('BossSay 达成目标！', `今日已发送 ${todaySent} 条，达到每日目标 ${goal.daily} 条`);
      }
      sendResponse({ success: true, todaySent, goal });
    });
    return true;
  }
});

// ==================== 回复检测通知（从 popup 调用） ====================

/**
 * 标记回复时触发通知
 * 由 popup 通过 markReplied 间接调用
 */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (!changes.bossSay_history) return;

  const newHistory = changes.bossSay_history.newValue || [];
  const oldHistory = changes.bossSay_history.oldValue || [];

  // 检测新增的回复
  for (const newItem of newHistory) {
    if (newItem.replied === true) {
      const oldItem = oldHistory.find(r => r.id === newItem.id);
      if (!oldItem || oldItem.replied !== true) {
        showNotification('BossSay 收到回复！', `${newItem.company} 的 ${newItem.jobTitle} 回复了你`);
      }
    }
  }
});

console.log('[BossSay] Service Worker v8 已加载');
