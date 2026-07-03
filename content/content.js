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

  // ==================== 三级降级 JD 提取 ====================

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

  function extractByKeyword() {
    const keywords = ['职位描述', '岗位职责', '工作内容', '岗位要求', '任职要求', '职责描述', '工作职责', '职位要求'];
    const allElements = document.querySelectorAll('h3, h4, .title, .label, [class*="title"], [class*="label"]');

    for (const el of allElements) {
      const text = safeGetText(el);
      if (keywords.some(kw => text.includes(kw))) {
        const contents = [];
        let sibling = el.nextElementSibling;
        while (sibling && contents.length < 20) {
          const tag = sibling.tagName.toLowerCase();
          if (['h1', 'h2', 'h3', 'h4'].includes(tag)) break;
          const st = safeGetText(sibling);
          if (st) contents.push(st);
          sibling = sibling.nextElementSibling;
        }
        if (contents.length > 0) return contents.join('\n');
      }
    }
    return '';
  }

  function extractJDContent() {
    const xpaths = [
      "//*[@id='wrap']/div[2]/div[2]/div/div/div[2]/div/div[2]/p",
      "//div[contains(@class,'job-detail')]//div[contains(@class,'detail-content')]",
      "//div[contains(@class,'job-sec-text')]",
    ];
    for (const xpath of xpaths) {
      const text = extractByXPath(xpath);
      if (text) return text;
    }

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

    return extractByKeyword();
  }

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
