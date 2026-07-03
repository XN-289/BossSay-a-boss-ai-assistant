/**
 * BossSay - Content Script v4
 * 通过拦截 Boss直聘 API 获取岗位信息（绕过 CSS 反爬）
 *
 * 功能：
 * 1. 拦截 fetch/XHR 响应，捕获岗位数据
 * 2. 响应 popup 的 EXTRACT_JOB_INFO 请求
 * 3. 响应 popup 的 FILL_MESSAGE 请求
 * 4. 右下角 BossSay 浮动按钮
 */

(function () {
  'use strict';

  // ==================== 存储捕获的岗位数据 ====================

  let capturedJobInfo = null;

  // ==================== 拦截 fetch 响应 ====================

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      // Boss直聘岗位详情 API
      if (url.includes('/job/detail') || url.includes('/jobDetail') || url.includes('/geek/job')) {
        const clone = response.clone();
        clone.json().then(data => {
          parseJobFromAPI(data);
        }).catch(() => {});
      }
    } catch (e) {}
    return response;
  };

  // ==================== 拦截 XMLHttpRequest ====================

  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._bossSayUrl = url;
    return originalXHROpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      try {
        const url = this._bossSayUrl || '';
        if (url.includes('/job/detail') || url.includes('/jobDetail') || url.includes('/geek/job')) {
          const data = JSON.parse(this.responseText);
          parseJobFromAPI(data);
        }
      } catch (e) {}
    });
    return originalXHRSend.apply(this, args);
  };

  // ==================== 解析 API 响应中的岗位数据 ====================

  function parseJobFromAPI(data) {
    // Boss直聘 API 响应格式可能有多种，尝试常见的结构
    const jobData = data?.data || data?.zpData || data?.result || data;

    if (!jobData) return;

    // 提取岗位信息（兼容不同 API 格式）
    const jobName = jobData.jobName || jobData.title || jobData.positionName || '';
    const salary = jobData.salary || jobData.salaryDesc || jobData.payDesc || '';
    const city = jobData.cityName || jobData.city || jobData.location || '';
    const areaDistrict = jobData.areaDistrict || jobData.district || '';
    const location = [city, areaDistrict].filter(Boolean).join(' ');
    const company = jobData.brandName || jobData.companyName || jobData.company || '';
    const bossName = jobData.bossName || jobData.hrName || '';
    const bossTitle = jobData.bossTitle || jobData.hrTitle || '';

    // JD 内容 — 可能在不同字段
    const jd = jobData.postDescription || jobData.jobDesc || jobData.description ||
               jobData.content || jobData.detail || '';

    // 技能标签
    const skills = jobData.skills || jobData.labels || jobData.tags || [];
    const requirements = Array.isArray(skills) ? skills.map(s => typeof s === 'string' ? s : s.name || s.tag || '').filter(Boolean) : [];

    // 公司信息
    const companyInfo = jobData.brandScaleName || jobData.companySize || '';
    const industry = jobData.brandIndustry || jobData.industry || '';

    // Job ID
    const jobId = jobData.encryptJobId || jobData.jobId || jobData.id || '';

    if (jobName || jd) {
      capturedJobInfo = {
        id: jobId || hashStr(window.location.href),
        title: cleanText(jobName),
        salary: cleanText(salary),
        location: cleanText(location),
        company: cleanText(company),
        bossName: cleanText(bossName),
        bossTitle: cleanText(bossTitle),
        jd: cleanText(jd),
        requirements,
        companyInfo: cleanText([companyInfo, industry].filter(Boolean).join(' · ')),
        url: window.location.href,
        jdHash: hashStr(jd),
        source: 'api',
      };
      console.log('[BossSay] 从 API 捕获岗位信息:', capturedJobInfo.title);
    }
  }

  // ==================== 工具函数 ====================

  function cleanText(text) {
    if (!text) return '';
    // 去除 HTML 标签
    return text.replace(/<[^>]+>/g, '\n').replace(/\s+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
  }

  function hashStr(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
    }
    return hash.toString(36);
  }

  function safeResponse(sendResponse, data) {
    try { sendResponse(data); } catch (e) {}
  }

  // ==================== DOM 提取（降级方案） ====================

  function extractField(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent?.trim();
        if (text && text.length > 0 && text.length < 500 && !text.includes('{') && !text.includes('}')) {
          return text;
        }
      }
    }
    return '';
  }

  function extractFromDOM() {
    // 检查 textContent 是否包含 CSS 代码（反爬检测）
    function isCSSContent(text) {
      return text && (text.includes('{') && text.includes('}') || text.includes('display:') || text.includes('font-size'));
    }

    const title = extractField(['.job-name', '[class*="job-name"]', 'h1']);
    const salary = extractField(['.salary', '[class*="salary"]']);
    const location = extractField(['.job-area', '[class*="job-area"]']);
    const company = extractField(['.company-name', '[class*="company-name"]']);

    // JD 从 DOM 提取通常会被 CSS 混淆，所以标记为空
    let jd = '';
    const jdCandidates = document.querySelectorAll('[class*="job-detail"], [class*="detail"], [class*="desc"]');
    for (const el of jdCandidates) {
      const text = el.textContent?.trim();
      if (text && text.length > 50 && !isCSSContent(text)) {
        jd = text;
        break;
      }
    }

    return {
      id: hashStr(window.location.href),
      title: cleanText(title),
      salary: cleanText(salary),
      location: cleanText(location),
      company: cleanText(company),
      bossName: '',
      bossTitle: '',
      jd: cleanText(jd),
      requirements: [],
      companyInfo: '',
      url: window.location.href,
      jdHash: hashStr(jd),
      source: 'dom',
    };
  }

  // ==================== 输入框注入（带重试） ====================

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
            input.textContent = message;
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
          input.focus();
          return true;
        }
      }
      await new Promise(r => setTimeout(r, interval));
    }
    return false;
  }

  // ==================== BossSay 按钮 ====================

  const BOSS_SAY_BTN_ID = 'boss-say-open-btn';

  function injectBossSayButton() {
    if (document.getElementById(BOSS_SAY_BTN_ID)) return;

    const btn = document.createElement('button');
    btn.id = BOSS_SAY_BTN_ID;
    btn.textContent = 'BossSay';
    btn.title = '打开 BossSay';
    btn.style.cssText = [
      'position: fixed',
      'bottom: 24px',
      'right: 24px',
      'z-index: 999999',
      'padding: 10px 18px',
      'background: linear-gradient(135deg, #4FACFE 0%, #00F2FE 100%)',
      'color: #fff',
      'border: none',
      'border-radius: 24px',
      'font-size: 14px',
      'font-weight: 600',
      'cursor: pointer',
      'box-shadow: 0 4px 15px rgba(79, 172, 254, 0.4)',
      'transition: all 0.2s',
      'font-family: -apple-system, BlinkMacSystemFont, sans-serif',
      'letter-spacing: 0.5px',
    ].join(';');

    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'translateY(-2px)';
      btn.style.boxShadow = '0 6px 20px rgba(79, 172, 254, 0.5)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = '';
      btn.style.boxShadow = '0 4px 15px rgba(79, 172, 254, 0.4)';
    });

    btn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(() => {
        btn.textContent = '请点击扩展图标';
        setTimeout(() => { btn.textContent = 'BossSay'; }, 2000);
      });
    });

    document.body.appendChild(btn);
  }

  // ==================== 监听消息 ====================

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'EXTRACT_JOB_INFO') {
      // 优先用 API 捕获的数据，降级用 DOM 提取
      let jobInfo = capturedJobInfo;
      if (!jobInfo || !jobInfo.title) {
        jobInfo = extractFromDOM();
      }
      safeResponse(sendResponse, { success: true, jobInfo });
    }

    if (request.type === 'FILL_MESSAGE') {
      const message = request.data?.message;
      if (message) {
        injectMessageToInput(message).then(filled => {
          safeResponse(sendResponse, { success: filled });
        });
        return true;
      } else {
        safeResponse(sendResponse, { success: false, error: '消息内容为空' });
      }
    }

    return true;
  });

  // ==================== 初始化 ====================

  function init() {
    injectBossSayButton();
    console.log('[BossSay] Content Script v4 已加载，等待 API 数据...');
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 500);
  } else {
    window.addEventListener('load', () => setTimeout(init, 500));
  }

  // SPA 页面 URL 变化时重新注入按钮并清除旧数据
  let lastUrl = location.href;
  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      capturedJobInfo = null; // URL 变了，清除旧数据
      setTimeout(init, 1000);
    }
  });
  urlObserver.observe(document.body, { childList: true, subtree: true });

})();
