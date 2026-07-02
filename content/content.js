/**
 * BossSay - Content Script v2
 * 升级版：吸收竞品优秀实现
 *
 * 核心改进：
 * 1. 三级降级 JD 提取（XPath → CSS → 关键词搜索）
 * 2. Hash 变化检测，自动感知 JD 切换
 * 3. 注入"一键打招呼"按钮到"立即沟通"旁边
 * 4. 消息缓存，按 Job ID 存储
 * 5. 安全的 sendResponse 封装
 * 6. 输入框注入重试机制
 */

(function () {
  'use strict';

  // ==================== 工具函数 ====================

  function safeGetText(element) {
    if (!element) return '';
    return element.textContent?.trim() || '';
  }

  function cleanText(text) {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
  }

  /**
   * 简单 hash 函数（DJB2），用于 JD 变化检测
   */
  function hashStr(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
    }
    return hash.toString(36);
  }

  /**
   * 安全的 sendResponse 包装，防止 "message port closed" 错误
   */
  function safeResponse(sendResponse, data) {
    try {
      sendResponse(data);
    } catch (e) {
      // port 已关闭，忽略
    }
  }

  // ==================== 三级降级 JD 提取 ====================

  /**
   * 从 XPath 表达式提取文本
   */
  function extractByXPath(xpath) {
    try {
      const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = 0; i < result.snapshotLength; i++) {
        const node = result.snapshotItem(i);
        const text = node.textContent?.trim();
        if (text && text.length > 50) return text;
      }
    } catch (e) {}
    return '';
  }

  /**
   * 从 CSS 选择器提取文本
   */
  function extractByCSS(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent?.trim();
        if (text && text.length > 50) return text;
      }
    }
    return '';
  }

  /**
   * 通过关键词搜索 JD 内容（最后的降级方案）
   */
  function extractByKeyword() {
    const keywords = ['职位描述', '岗位职责', '工作内容', '岗位要求', '任职要求', '职责描述', '工作职责', '职位要求'];
    const allElements = document.querySelectorAll('h3, h4, .title, .label, [class*="title"], [class*="label"]');

    for (const el of allElements) {
      const text = safeGetText(el);
      const matched = keywords.some(kw => text.includes(kw));
      if (matched) {
        // 找到关键词标题后，收集后续兄弟元素的内容
        const contents = [];
        let sibling = el.nextElementSibling;
        while (sibling && contents.length < 20) {
          // 遇到下一个标题类元素则停止
          const tag = sibling.tagName.toLowerCase();
          if (['h1', 'h2', 'h3', 'h4'].includes(tag)) break;
          const st = safeGetText(sibling);
          if (st) contents.push(st);
          sibling = sibling.nextElementSibling;
        }
        if (contents.length > 0) {
          return contents.join('\n');
        }
      }
    }
    return '';
  }

  /**
   * 提取 JD 正文（三级降级策略）
   */
  function extractJDContent() {
    // 第一级：XPath 选择器
    const xpaths = [
      "//*[@id='wrap']/div[2]/div[2]/div/div/div[2]/div/div[2]/p",
      "//div[contains(@class,'job-detail')]//div[contains(@class,'detail-content')]",
      "//div[contains(@class,'job-sec-text')]",
    ];
    for (const xpath of xpaths) {
      const text = extractByXPath(xpath);
      if (text) return text;
    }

    // 第二级：CSS 选择器
    const cssSelectors = [
      '.job-detail-section .job-sec-text',
      '.job-detail-section .text',
      '.job-sec-text',
      '.job-detail .text',
      '.detail-content',
      '.job-detail div[data-name="job"]',
      '.detail-box .job-detail',
      '[class*="job-detail"]',
      '[class*="job-desc"]',
    ];
    const cssResult = extractByCSS(cssSelectors);
    if (cssResult) return cssResult;

    // 第三级：关键词搜索
    return extractByKeyword();
  }

  /**
   * 提取岗位基本信息
   */
  function extractJobInfo() {
    const selectors = {
      jobTitle: '.job-name, [class*="job-name"]',
      salary: '.salary, [class*="salary"]',
      location: '.job-area, [class*="job-area"]',
      company: '.company-name, [class*="company-name"]',
      companyInfo: '.company-tag-list, [class*="company-tag"]',
      bossName: '.info-primary .name, [class*="info-primary"] .name',
      bossTitle: '.info-primary .boss-title, [class*="boss-title"]',
      requirements: '.job-tags li, .tag-list li, [class*="tag"] li',
      jobId: '[data-jobid], [data-jid]',
    };

    const jdContent = extractJDContent();

    // 尝试提取 Job ID（用于缓存）
    const jobEl = document.querySelector(selectors.jobId);
    const jobId = jobEl?.getAttribute('data-jobid') || jobEl?.getAttribute('data-jid') || '';

    return {
      id: jobId || hashStr(window.location.href),
      title: cleanText(safeGetText(document.querySelector(selectors.jobTitle))),
      salary: cleanText(safeGetText(document.querySelector(selectors.salary))),
      location: cleanText(safeGetText(document.querySelector(selectors.location))),
      company: cleanText(safeGetText(document.querySelector(selectors.company))),
      bossName: cleanText(safeGetText(document.querySelector(selectors.bossName))),
      bossTitle: cleanText(safeGetText(document.querySelector(selectors.bossTitle))),
      jd: cleanText(jdContent),
      requirements: Array.from(document.querySelectorAll(selectors.requirements))
        .map(el => el.textContent?.trim()).filter(Boolean),
      companyInfo: cleanText(safeGetText(document.querySelector(selectors.companyInfo))),
      url: window.location.href,
      jdHash: hashStr(jdContent),
    };
  }

  // ==================== JD 变化检测 ====================

  let currentJDHash = '';
  let jdCheckInterval = null;

  function startJDMonitoring() {
    // 每秒检查 JD 是否变化
    jdCheckInterval = setInterval(() => {
      const jobInfo = extractJobInfo();
      if (jobInfo.jdHash !== currentJDHash && jobInfo.jd) {
        currentJDHash = jobInfo.jdHash;
        // 通知 popup JD 已变化
        chrome.runtime.sendMessage({ type: 'JD_CHANGED', data: jobInfo }).catch(() => {});
      }
    }, 1000);
  }

  function stopJDMonitoring() {
    if (jdCheckInterval) {
      clearInterval(jdCheckInterval);
      jdCheckInterval = null;
    }
  }

  // ==================== 消息缓存 ====================

  const greetingCache = new Map();

  function getCachedGreeting(jobId) {
    return greetingCache.get(jobId);
  }

  function setCachedGreeting(jobId, greeting, jdHash) {
    greetingCache.set(jobId, { greeting, jdHash, timestamp: Date.now() });
  }

  function isGreetingStale(jobId, currentJDHash) {
    const cached = greetingCache.get(jobId);
    if (!cached) return true;
    return cached.jdHash !== currentJDHash;
  }

  // ==================== UI：注入按钮 ====================

  const QUICK_SEND_BTN_ID = 'boss-say-quick-send';

  /**
   * 注入"一键打招呼"按钮到"立即沟通"按钮旁边
   */
  function injectQuickSendButton() {
    if (document.getElementById(QUICK_SEND_BTN_ID)) return;

    // 尝试找到"立即沟通"按钮
    const chatBtnSelectors = [
      '.op-btn-chat',
      '.btn-startchat',
      '[class*="btn-startchat"]',
      '[class*="op-btn"]',
    ];

    // XPath 降级查找
    const xpathSelectors = [
      "//button[contains(text(),'立即沟通')]",
      "//a[contains(text(),'立即沟通')]",
      "//div[contains(@class,'btn') and contains(text(),'沟通')]",
    ];

    let chatBtn = null;
    for (const sel of chatBtnSelectors) {
      chatBtn = document.querySelector(sel);
      if (chatBtn) break;
    }

    if (!chatBtn) {
      for (const xpath of xpathSelectors) {
        try {
          const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          if (result.singleNodeValue) {
            chatBtn = result.singleNodeValue;
            break;
          }
        } catch (e) {}
      }
    }

    // 最后暴力搜索所有按钮
    if (!chatBtn) {
      const allBtns = document.querySelectorAll('button, a[role="button"]');
      for (const btn of allBtns) {
        if (btn.textContent?.includes('立即沟通') || btn.textContent?.includes('沟通')) {
          chatBtn = btn;
          break;
        }
      }
    }

    const btn = document.createElement('button');
    btn.id = QUICK_SEND_BTN_ID;
    btn.textContent = '🎯 AI 一键打招呼';
    btn.style.cssText = `
      margin-left: 8px;
      padding: 8px 16px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.3s;
    `;

    btn.addEventListener('click', handleQuickSend);

    if (chatBtn) {
      chatBtn.parentNode.insertBefore(btn, chatBtn.nextSibling);
    } else {
      // 固定在页面右侧
      btn.style.position = 'fixed';
      btn.style.top = '200px';
      btn.style.right = '20px';
      btn.style.zIndex = '99999';
      document.body.appendChild(btn);
    }
  }

  // ==================== UI：结果面板 ====================

  const PANEL_ID = 'boss-say-panel';

  function createPanel() {
    const existing = document.getElementById(PANEL_ID);
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="boss-say-panel-header">
        <h3>🎯 BossSay - AI 智能打招呼</h3>
        <button class="boss-say-close-btn" title="关闭">&times;</button>
      </div>
      <div class="boss-say-panel-body">
        <div class="boss-say-job-info">
          <div class="boss-say-job-title"></div>
          <div class="boss-say-job-meta"></div>
        </div>
        <div class="boss-say-style-selector">
          <label>消息风格：</label>
          <select id="boss-say-style">
            <option value="professional">💼 专业正式</option>
            <option value="friendly">🤝 热情亲切</option>
            <option value="humor">😄 幽默轻松</option>
          </select>
        </div>
        <div class="boss-say-actions">
          <button class="boss-say-gen-btn" id="boss-say-gen-btn">
            <span class="boss-say-btn-text">✨ 生成消息</span>
            <span class="boss-say-btn-loading" style="display:none">⏳ AI 思考中...</span>
          </button>
          <button class="boss-say-regen-btn" id="boss-say-regen-btn" style="display:none">🔄 重新生成</button>
        </div>
        <div class="boss-say-result" id="boss-say-result" style="display:none">
          <label>生成的消息（可编辑）：</label>
          <textarea id="boss-say-message" rows="6"></textarea>
          <div class="boss-say-result-actions">
            <button class="boss-say-fill-btn" id="boss-say-fill-btn">📝 填入输入框</button>
            <button class="boss-say-copy-btn" id="boss-say-copy-btn">📋 复制消息</button>
            <button class="boss-say-send-btn" id="boss-say-send-btn">🚀 直接发送</button>
          </div>
        </div>
        <div class="boss-say-error" id="boss-say-error" style="display:none"></div>
      </div>
    `;

    document.body.appendChild(panel);

    // 绑定事件
    panel.querySelector('.boss-say-close-btn').addEventListener('click', () => {
      panel.style.display = 'none';
    });

    document.getElementById('boss-say-gen-btn').addEventListener('click', () => doGenerate(false));
    document.getElementById('boss-say-regen-btn').addEventListener('click', () => doGenerate(true));
    document.getElementById('boss-say-fill-btn').addEventListener('click', fillMessage);
    document.getElementById('boss-say-copy-btn').addEventListener('click', copyMessage);
    document.getElementById('boss-say-send-btn').addEventListener('click', sendGreeting);

    makeDraggable(panel);
    return panel;
  }

  function makeDraggable(element) {
    const header = element.querySelector('.boss-say-panel-header');
    let isDragging = false;
    let offsetX, offsetY;

    header.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('boss-say-close-btn')) return;
      isDragging = true;
      offsetX = e.clientX - element.getBoundingClientRect().left;
      offsetY = e.clientY - element.getBoundingClientRect().top;
      element.style.transition = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      element.style.left = (e.clientX - offsetX) + 'px';
      element.style.top = (e.clientY - offsetY) + 'px';
      element.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
      element.style.transition = '';
    });
  }

  // ==================== 核心逻辑 ====================

  let currentJobInfo = null;

  /**
   * 处理快速发送按钮点击
   */
  async function handleQuickSend() {
    currentJobInfo = extractJobInfo();
    currentJDHash = currentJobInfo.jdHash;

    if (!currentJobInfo.title && !currentJobInfo.jd) {
      alert('BossSay: 未能从当前页面提取岗位信息');
      return;
    }

    // 检查缓存
    const cached = getCachedGreeting(currentJobInfo.id);
    if (cached && !isGreetingStale(currentJobInfo.id, currentJobInfo.jdHash)) {
      // 缓存有效，直接使用
      const message = cached.greeting;
      const confirmed = confirm(`BossSay 已为该岗位生成过消息，是否直接使用？\n\n"${message.substring(0, 80)}..."\n\n点"取消"重新生成`);
      if (confirmed) {
        await injectAndSend(message);
        return;
      }
    }

    // 显示面板
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = createPanel();
    }
    panel.style.display = 'block';

    // 显示岗位信息
    panel.querySelector('.boss-say-job-title').textContent = currentJobInfo.title || '未识别到职位名称';
    panel.querySelector('.boss-say-job-meta').textContent = [
      currentJobInfo.company,
      currentJobInfo.salary,
      currentJobInfo.location,
    ].filter(Boolean).join(' · ');

    document.getElementById('boss-say-result').style.display = 'none';
    document.getElementById('boss-say-error').style.display = 'none';
    document.getElementById('boss-say-regen-btn').style.display = 'none';

    // 自动开始生成
    await doGenerate(false);
  }

  /**
   * 执行生成消息
   */
  async function doGenerate(isRegenerate) {
    if (!currentJobInfo) {
      currentJobInfo = extractJobInfo();
    }

    const genBtn = document.getElementById('boss-say-gen-btn');
    const btnText = genBtn.querySelector('.boss-say-btn-text');
    const btnLoading = genBtn.querySelector('.boss-say-btn-loading');
    const style = document.getElementById('boss-say-style').value;

    genBtn.disabled = true;
    btnText.style.display = 'none';
    btnLoading.style.display = 'inline';
    hideError();

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GENERATE_MESSAGE',
        data: { jobInfo: currentJobInfo, style },
      });

      if (response.success) {
        document.getElementById('boss-say-message').value = response.message;
        document.getElementById('boss-say-result').style.display = 'block';
        document.getElementById('boss-say-regen-btn').style.display = 'inline-block';

        // 缓存生成的消息
        setCachedGreeting(currentJobInfo.id, response.message, currentJobInfo.jdHash);
      } else {
        showError(response.error || '生成失败，请重试');
      }
    } catch (error) {
      showError('请求失败：' + error.message);
    } finally {
      genBtn.disabled = false;
      btnText.style.display = 'inline';
      btnLoading.style.display = 'none';
    }
  }

  // ==================== 输入框注入（带重试） ====================

  /**
   * 将消息填入聊天输入框（带重试机制）
   */
  async function injectMessageToInput(message, retries = 10, interval = 500) {
    const inputSelectors = [
      '.edit-area .input-area',
      '.chat-conversation .input-area textarea',
      '.chat-conversation .input-area [contenteditable]',
      '.chat-input textarea',
      '[class*="chat-input"] textarea',
      '[class*="input-area"] textarea',
      '[class*="input-area"] [contenteditable]',
      'textarea[placeholder*="请简短描述"]',
      'textarea[placeholder*="聊"]',
      'textarea[placeholder*="输入"]',
      '[contenteditable="true"]',
    ];

    for (let attempt = 0; attempt < retries; attempt++) {
      for (const sel of inputSelectors) {
        const input = document.querySelector(sel);
        if (input) {
          if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
            // 使用 Object.getOwnPropertyDescriptor 设置 value，绕过 React/Vue 框架拦截
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
              window.HTMLTextAreaElement.prototype, 'value'
            )?.set;
            if (nativeInputValueSetter) {
              nativeInputValueSetter.call(input, message);
            } else {
              input.value = message;
            }
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            // contenteditable
            input.textContent = message;
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
          input.focus();
          return true;
        }
      }
      // 等待后重试
      await new Promise(r => setTimeout(r, interval));
    }
    return false;
  }

  /**
   * 查找并点击发送按钮
   */
  function clickSendButton() {
    const sendSelectors = [
      '.btn-send',
      '[class*="btn-send"]',
      'button[class*="send"]',
      '.chat-input .send-btn',
    ];

    for (const sel of sendSelectors) {
      const btn = document.querySelector(sel);
      if (btn) {
        btn.click();
        return true;
      }
    }

    // 降级：模拟 Enter 键
    const input = document.querySelector('.edit-area .input-area, textarea, [contenteditable]');
    if (input) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      return true;
    }

    return false;
  }

  /**
   * 注入消息并发送（一键发送流程）
   */
  async function injectAndSend(message) {
    // 先点击"立即沟通"打开聊天窗口
    const chatBtnSelectors = [
      '.op-btn-chat',
      '.btn-startchat',
      '[class*="btn-startchat"]',
    ];

    for (const sel of chatBtnSelectors) {
      const btn = document.querySelector(sel);
      if (btn) {
        btn.click();
        break;
      }
    }

    // 等待聊天窗口加载，然后注入消息
    const injected = await injectMessageToInput(message, 10, 500);
    if (injected) {
      showSuccess('消息已填入，请检查后手动发送（安全起见）');
    } else {
      showError('未找到聊天输入框，请确保已打开与HR的聊天窗口');
    }
  }

  // ==================== 面板操作 ====================

  function fillMessage() {
    const message = document.getElementById('boss-say-message').value;
    if (!message) {
      showError('没有可填入的消息');
      return;
    }
    injectMessageToInput(message).then(filled => {
      if (filled) {
        showSuccess('消息已填入输入框，请检查后发送');
      } else {
        showError('未找到聊天输入框，请确保已打开与HR的聊天窗口');
      }
    });
  }

  async function copyMessage() {
    const message = document.getElementById('boss-say-message').value;
    if (!message) {
      showError('没有可复制的消息');
      return;
    }
    try {
      await navigator.clipboard.writeText(message);
      showSuccess('消息已复制到剪贴板');
    } catch (error) {
      const textarea = document.createElement('textarea');
      textarea.value = message;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      showSuccess('消息已复制到剪贴板');
    }
  }

  function sendGreeting() {
    const message = document.getElementById('boss-say-message').value;
    if (!message) {
      showError('没有可发送的消息');
      return;
    }

    if (!confirm('确定要直接发送这条消息吗？')) return;

    injectAndSend(message);
  }

  // ==================== 消息提示 ====================

  function showError(msg) {
    const el = document.getElementById('boss-say-error');
    if (el) {
      el.textContent = '❌ ' + msg;
      el.style.display = 'block';
      el.style.color = '#ff4d4f';
      setTimeout(() => el.style.display = 'none', 5000);
    }
  }

  function showSuccess(msg) {
    const el = document.getElementById('boss-say-error');
    if (el) {
      el.textContent = '✅ ' + msg;
      el.style.display = 'block';
      el.style.color = '#52c41a';
      setTimeout(() => { el.style.display = 'none'; el.style.color = ''; }, 3000);
    }
  }

  function hideError() {
    const el = document.getElementById('boss-say-error');
    if (el) el.style.display = 'none';
  }

  // ==================== 监听消息 ====================

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'EXTRACT_JOB_INFO') {
      const jobInfo = extractJobInfo();
      safeResponse(sendResponse, { success: true, jobInfo });
    }

    if (request.type === 'FILL_MESSAGE') {
      const message = request.data?.message;
      if (message) {
        injectMessageToInput(message).then(filled => {
          safeResponse(sendResponse, { success: filled });
        });
        return true; // async
      } else {
        safeResponse(sendResponse, { success: false, error: '消息内容为空' });
      }
    }

    if (request.type === 'TRIGGER_QUICK_SEND') {
      handleQuickSend();
      safeResponse(sendResponse, { success: true });
    }

    return true;
  });

  // ==================== 初始化 ====================

  function init() {
    injectQuickSendButton();
    startJDMonitoring();
  }

  // 页面加载后初始化
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 1000);
  } else {
    window.addEventListener('load', () => setTimeout(init, 1000));
  }

  // SPA URL 变化时重新初始化
  let lastUrl = location.href;
  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      stopJDMonitoring();
      setTimeout(init, 1500);
    }
  });
  urlObserver.observe(document.body, { childList: true, subtree: true });

})();
