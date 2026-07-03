/**
 * BossSay - Background Service Worker v6
 * 处理存储读写、导出导入、历史记录、风格配置
 */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

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
      const exportData = { version: '2.0.0', timestamp: Date.now(), data: {} };

      // 导出所有 bossSay_ 开头的 key
      for (const [key, value] of Object.entries(allData)) {
        if (!key.startsWith('bossSay_')) continue;

        // 可选排除
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

      // 过滤掉 apiKey 被遮蔽的配置
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

  if (request.type === 'SAVE_HISTORY_ITEM') {
    chrome.storage.local.get('bossSay_history', (data) => {
      const history = data.bossSay_history || [];
      history.unshift(request.data); // 最新的在前面
      // 最多保留 50 条
      if (history.length > 50) history.length = 50;
      chrome.storage.local.set({ bossSay_history: history }, () => {
        sendResponse({ success: true });
      });
    });
    return true;
  }

  if (request.type === 'CLEAR_HISTORY') {
    chrome.storage.local.set({ bossSay_history: [] }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});
