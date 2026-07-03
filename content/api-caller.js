/**
 * BossSay - API Caller v3
 * Content script 通过 DOM 元素传递数据（不依赖消息通道）
 */

if (!window._bossSayApiCaller) {
  window._bossSayApiCaller = true;
  console.log('[BossSay] Content script v3 已加载');

  // 创建结果容器
  const resultDiv = document.createElement('div');
  resultDiv.id = 'boss-say-api-result';
  resultDiv.style.display = 'none';
  document.body.appendChild(resultDiv);

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type !== 'DO_AI_FETCH') return false;

    const { systemPrompt, userMessage, apiConfig } = request.data;
    console.log('[BossSay] 收到 AI 请求, model:', apiConfig.modelName);

    let url = apiConfig.baseUrl.trim();
    if (!url.endsWith('/')) url += '/';
    url += 'chat/completions';

    // 标记为处理中
    resultDiv.textContent = 'PENDING';

    // 直接 fetch
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiConfig.apiKey,
      },
      body: JSON.stringify({
        model: apiConfig.modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    })
    .then(response => {
      console.log('[BossSay] HTTP:', response.status);
      if (!response.ok) {
        return response.json().catch(() => ({})).then(err => {
          throw new Error('API (' + response.status + '): ' + (err.error?.message || '未知'));
        });
      }
      return response.json();
    })
    .then(data => {
      const msg = data.choices?.[0]?.message?.content?.trim();
      if (!msg) throw new Error('AI 返回空内容');
      console.log('[BossSay] 成功, 长度:', msg.length);
      // 把结果存在 DOM 元素里
      resultDiv.textContent = 'OK:' + msg;
    })
    .catch(err => {
      console.error('[BossSay] 失败:', err.message);
      resultDiv.textContent = 'ERR:' + err.message;
    });

    // 立即返回（不等 fetch）
    sendResponse({ accepted: true });
    return false;
  });

  console.log('[BossSay] Content script v3 就绪');
}
