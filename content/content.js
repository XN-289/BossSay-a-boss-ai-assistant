/**
 * BossSay - Content Script v3
 * 精简版：只保留岗位信息提取和消息填入
 *
 * 功能：
 * 1. 三级降级 JD 提取（XPath → CSS → 关键词搜索）
 * 2. 响应 popup 的 EXTRACT_JOB_INFO 请求
 * 3. 响应 popup 的 FILL_MESSAGE 请求（填入聊天输入框）
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

  // ==================== JD 提取（通用策略，不依赖固定 class） ====================

  /**
   * 策略1：通过关键词定位 JD 容器
   * 找到包含"职位描述/岗位职责/工作内容/任职要求"等标题的元素，
   * 然后收集其后续兄弟或父容器的文本
   */
  function extractByKeyword() {
    const keywords = ['职位描述', '岗位职责', '工作内容', '岗位要求', '任职要求', '职责描述', '工作职责', '职位要求', '岗位信息'];
    const allElements = document.querySelectorAll('*');

    for (const el of allElements) {
      // 跳过太深嵌套的元素和非内容元素
      if (['SCRIPT', 'STYLE', 'SVG', 'PATH'].includes(el.tagName)) continue;
      if (el.children.length > 20) continue;

      const directText = Array.from(el.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent.trim())
        .join('');

      if (directText && keywords.some(kw => directText.includes(kw))) {
        // 找到标题元素，收集父容器的完整文本
        const parent = el.parentElement;
        if (parent) {
          const fullText = parent.textContent?.trim();
          if (fullText && fullText.length > 50) {
            return fullText;
          }
        }
        // 降级：收集后续兄弟
        const contents = [];
        let sibling = el.nextElementSibling;
        while (sibling && contents.length < 30) {
          const tag = sibling.tagName.toLowerCase();
          if (['h1', 'h2', 'h3'].includes(tag)) break;
          const st = safeGetText(sibling);
          if (st) contents.push(st);
          sibling = sibling.nextElementSibling;
        }
        if (contents.length > 0) return contents.join('\n');
      }
    }
    return '';
  }

  /**
   * 策略2：找到页面中最大的文本块（排除导航、侧边栏等）
   * Boss直聘的 JD 通常是页面中最大的连续文本区域
   */
  function extractLargestTextBlock() {
    const candidates = document.querySelectorAll('div, section, article');
    let best = '';
    let bestScore = 0;

    for (const el of candidates) {
      // 排除明显不是内容的元素
      if (['SCRIPT', 'STYLE', 'NAV', 'HEADER', 'FOOTER'].includes(el.tagName)) continue;
      if (el.querySelector('nav, header, footer')) continue;
      if (el.id === 'boss-say-api-result') continue;

      const text = el.textContent?.trim() || '';
      // 只看中文内容较多的块
      const chineseChars = (text.match(/[一-鿿]/g) || []).length;
      if (chineseChars < 30) continue;

      // 评分：中文字符数 × 文本密度（文本/HTML比）
      const htmlLen = el.innerHTML?.length || 1;
      const density = text.length / htmlLen;
      const score = chineseChars * density;

      if (score > bestScore) {
        bestScore = score;
        best = text;
      }
    }

    // 清理：去掉太长的（可能是整个页面）
    if (best.length > 5000) {
      best = best.substring(0, 5000);
    }
    return best;
  }

  /**
   * 策略3：匹配 Boss直聘常见页面结构
   */
  function extractByStructure() {
    // Boss直聘 2024-2026 版本常见结构
    const candidates = [
      // 新版结构
      document.querySelector('.job-detail-section'),
      document.querySelector('.job-detail'),
      document.querySelector('.detail-content'),
      document.querySelector('.job-sec-text'),
      // 宽泛匹配
      document.querySelector('[class*="job-detail"]'),
      document.querySelector('[class*="job-desc"]'),
      document.querySelector('[class*="job-detail"] [class*="content"]'),
      document.querySelector('[class*="detail"] [class*="text"]'),
    ];

    for (const el of candidates) {
      if (!el) continue;
      const text = el.textContent?.trim();
      if (text && text.length > 50 && text.length < 5000) {
        return text;
      }
    }
    return '';
  }

  function extractJDContent() {
    // 优先用关键词策略（最可靠，不依赖 class 名）
    const keyword = extractByKeyword();
    if (keyword && keyword.length > 50) return keyword;

    // 降级：匹配已知结构
    const structure = extractByStructure();
    if (structure && structure.length > 50) return structure;

    // 最后：取页面最大文本块
    return extractLargestTextBlock();
  }

  // ==================== 元信息提取 ====================

  /**
   * 提取岗位基本信息 — 使用多种选择器降级
   */
  function extractJobInfo() {
    const jdContent = extractJDContent();

    // 职位名称
    const title = extractField([
      '.job-name', '[class*="job-name"]', 'h1[class*="name"]',
      '.job-title', '[class*="job-title"]',
    ]);

    // 薪资
    const salary = extractField([
      '.salary', '[class*="salary"]', '.job-salary',
      '[class*="pay"]', '[class*="wage"]',
    ]);

    // 地点
    const location = extractField([
      '.job-area', '[class*="job-area"]', '.job-address',
      '[class*="location"]', '[class*="area"]',
    ]);

    // 公司
    const company = extractField([
      '.company-name', '[class*="company-name"]',
      '.info-company .name', '[class*="company"] .name',
    ]);

    // 公司标签
    const companyInfo = extractField([
      '.company-tag-list', '[class*="company-tag"]',
      '.company-tags', '[class*="tag-list"]',
    ]);

    // Boss 信息
    const bossName = extractField([
      '.info-primary .name', '[class*="info-primary"] .name',
      '.boss-name', '[class*="boss"] .name',
    ]);

    const bossTitle = extractField([
      '.info-primary .boss-title', '[class*="boss-title"]',
      '.boss-title', '[class*="boss"] [class*="title"]',
    ]);

    // 岗位标签
    const requirementEls = document.querySelectorAll('.job-tags li, .tag-list li, [class*="tag"] li');
    const requirements = Array.from(requirementEls).map(el => el.textContent?.trim()).filter(Boolean);

    // Job ID
    const jobEl = document.querySelector('[data-jobid], [data-jid]');
    const jobId = jobEl?.getAttribute('data-jobid') || jobEl?.getAttribute('data-jid') || '';

    return {
      id: jobId || hashStr(window.location.href),
      title: cleanText(title),
      salary: cleanText(salary),
      location: cleanText(location),
      company: cleanText(company),
      bossName: cleanText(bossName),
      bossTitle: cleanText(bossTitle),
      jd: cleanText(jdContent),
      requirements,
      companyInfo: cleanText(companyInfo),
      url: window.location.href,
      jdHash: hashStr(jdContent),
    };
  }

  /**
   * 通用字段提取：按选择器优先级逐个尝试
   */
  function extractField(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent?.trim();
        if (text && text.length > 0 && text.length < 500) return text;
      }
    }
    return '';
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
        return true;
      } else {
        safeResponse(sendResponse, { success: false, error: '消息内容为空' });
      }
    }

    return true;
  });

})();
