/**
 * BossSay - Background Service Worker v5
 * 通过 content script 注入隐藏 iframe 来执行 API 调用
 */

console.log('[BossSay] Service Worker v5 启动!');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[BossSay] 收到:', request.type);

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

  // AI 请求：通过 content script 注入 iframe
  if (request.type === 'GENERATE_MESSAGE_DIRECT') {
    const { systemPrompt, userMessage, apiConfig } = request.data;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) {
        sendResponse({ success: false, error: '没有活动标签页' });
        return;
      }

      const tabId = tabs[0].id;
      console.log('[BossSay] 向 tab', tabId, '发送 AI 请求');

      chrome.tabs.sendMessage(tabId, {
        type: 'DO_AI_FETCH',
        data: { systemPrompt, userMessage, apiConfig },
      }).then((result) => {
        console.log('[BossSay] 收到结果:', result?.success);
        sendResponse(result || { success: false, error: 'content script 无响应' });
      }).catch((err) => {
        console.error('[BossSay] 通信失败:', err.message);
        sendResponse({ success: false, error: '通信失败: ' + err.message });
      });
    });
    return true;
  }

  if (request.type === 'GENERATE_MESSAGE') {
    sendResponse({ success: false, error: '请使用 PDF 上传功能' });
    return false;
  }

  if (request.type === 'TEST_API') {
    sendResponse({ success: false, error: '请使用 PDF 上传功能测试' });
    return false;
  }
});
