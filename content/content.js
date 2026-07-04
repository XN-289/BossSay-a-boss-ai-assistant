/**
 * BossSay - Content Script v8
 * 从搜索结果页卡片提取岗位信息（不在详情页爬 JD，避开 CSS 反爬）
 *
 * 搜索页（/geek/jobs）：从卡片提取职位/公司/薪资/地点/经验/学历
 * 详情页（/job_detail/）：从 DOM 提取元信息，JD 需用户手动复制
 * 聊天页（/chat）：支持消息填入
 */

(function () {
  'use strict';

  // ==================== 工具函数 ====================

  function cleanText(text) {
    if (!text) return '';
    return text.replace(/[​-‏﻿]/g, '').replace(/\s+/g, ' ').trim();
  }

  function hashStr(str) {
    var hash = 5381;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
    }
    return hash.toString(36);
  }

  function safeResponse(sendResponse, data) {
    try { sendResponse(data); } catch (e) {}
  }

  function pick(root, sels) {
    for (var i = 0; i < sels.length; i++) {
      var el = root.querySelector(sels[i]);
      if (el) { var t = cleanText(el.textContent); if (t) return t; }
    }
    return '';
  }

  function isCSS(text) {
    if (!text) return true;
    return text.includes('display:') || text.includes('font-size:') || (text.includes('{') && text.includes('}'));
  }

  // ==================== 判断页面类型 ====================

  function getPageType() {
    var url = location.href;
    if (url.indexOf('/geek/jobs') >= 0) return 'search';
    if (url.indexOf('/job_detail/') >= 0) return 'detail';
    if (url.indexOf('/web/geek/job') >= 0) return 'detail';
    if (url.indexOf('/chat') >= 0) return 'chat';
    return 'other';
  }

  // ==================== 搜索结果页提取 ====================

  function extractFromSearchPage() {
    var cards = document.querySelectorAll('li.job-card-box');
    if (!cards.length) cards = document.querySelectorAll('.job-card-box');
    if (!cards.length) return null;

    var jobs = [];
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var txt = c.textContent || '';

      // 跳过已沟通过的
      if (txt.indexOf('已沟通') >= 0) continue;

      var jb = pick(c, ['.job-name', '.job-title .job-name', '.job-title', '[class*="job-name"]']) || '';
      if (!jb) continue;

      var sal = pick(c, ['.salary', '[class*="salary"]']) || '';
      var loc = pick(c, ['.job-area', '.job-address-desc', '.job-area-wrapper', '[class*="job-area"]']) || '';

      // 公司名
      var footer = c.querySelector('.job-card-footer, .job-card-bottom, .card-footer, .job-card-right, .company-info');
      var co = pick(footer || c, [
        '.company-name', '.company-info .company-name',
        '.job-card-right .company-name', '.company-info h3',
        'h3.company-name', 'a.company-name'
      ]);

      // 经验/学历标签
      var tags = c.querySelectorAll('.tag-list li, .tag-list span, [class*="tag"] li');
      var exp = '', edu = '';
      for (var t = 0; t < tags.length; t++) {
        var tagText = cleanText(tags[t].textContent);
        if (/经验|年|应届|在校|不限/.test(tagText)) exp = tagText;
        if (/本科|大专|硕士|博士|学历|中专|高中/.test(tagText)) edu = tagText;
      }

      jobs.push({
        id: hashStr(co + jb),
        title: jb,
        company: co || '未知',
        salary: sal,
        location: loc,
        experience: exp,
        education: edu,
        jd: '',
        url: location.href,
        source: 'search-card',
      });
    }

    return jobs;
  }

  // ==================== 详情页提取（降级，可能被 CSS 混淆） ====================

  function extractFromDetailPage() {
    var title = pick(document, ['.job-name', '[class*="job-name"]', 'h1']);
    var salary = pick(document, ['.salary', '[class*="salary"]']);
    var location = pick(document, ['.job-area', '[class*="job-area"]']);
    var company = pick(document, ['.company-name', '[class*="company-name"]']);

    // 尝试提取 JD（大概率是 CSS 混淆，但试一下）
    var jd = '';
    var allEls = document.querySelectorAll('div, section, p, li');
    for (var i = 0; i < allEls.length; i++) {
      var text = allEls[i].textContent?.trim() || '';
      if (text.length > 50 && text.length < 3000 && !isCSS(text)) {
        if (/岗位职责|工作内容|任职要求|岗位要求|职位描述|工作职责/.test(text)) {
          jd = text;
          break;
        }
      }
    }

    return {
      id: hashStr(window.location.href),
      title: cleanText(title),
      company: cleanText(company),
      salary: cleanText(salary),
      location: cleanText(location),
      experience: '',
      education: '',
      jd: cleanText(jd),
      url: window.location.href,
      source: jd ? 'detail-dom' : 'detail-no-jd',
    };
  }

  // ==================== 输入框注入 ====================

  async function injectMessageToInput(message, retries, interval) {
    retries = retries || 10;
    interval = interval || 500;
    var inputSelectors = [
      '#chat-input',
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

    for (var attempt = 0; attempt < retries; attempt++) {
      for (var s = 0; s < inputSelectors.length; s++) {
        var input = document.querySelector(inputSelectors[s]);
        if (input) {
          if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
            var setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
            if (setter) setter.call(input, message);
            else input.value = message;
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
      await new Promise(function (r) { setTimeout(r, interval); });
    }
    return false;
  }

  // ==================== BossSay 按钮 ====================

  function injectBossSayButton() {
    if (document.getElementById('boss-say-open-btn')) return;
    var btn = document.createElement('button');
    btn.id = 'boss-say-open-btn';
    btn.textContent = 'BossSay';
    btn.title = '打开 BossSay';
    btn.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:999999;padding:10px 18px;background:linear-gradient(135deg,#4FACFE,#00F2FE);color:#fff;border:none;border-radius:24px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 4px 15px rgba(79,172,254,0.4);font-family:sans-serif;';
    btn.addEventListener('click', function () {
      chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(function () {});
    });
    document.body.appendChild(btn);
  }

  // ==================== 监听消息 ====================

  chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {

    if (request.type === 'EXTRACT_JOB_INFO') {
      var pageType = getPageType();

      if (pageType === 'search') {
        // 搜索页：提取所有卡片
        var jobs = extractFromSearchPage();
        safeResponse(sendResponse, {
          success: true,
          pageType: 'search',
          jobs: jobs || [],
          jobInfo: jobs && jobs.length > 0 ? jobs[0] : null,
        });
      } else if (pageType === 'detail') {
        // 详情页：提取元信息（JD 可能为空）
        var jobInfo = extractFromDetailPage();
        safeResponse(sendResponse, {
          success: true,
          pageType: 'detail',
          jobInfo: jobInfo,
        });
      } else {
        safeResponse(sendResponse, {
          success: false,
          pageType: pageType,
          error: '请在 Boss直聘的搜索页或岗位详情页使用',
        });
      }
      return false;
    }

    if (request.type === 'FILL_MESSAGE') {
      var message = request.data?.message;
      if (message) {
        injectMessageToInput(message).then(function (filled) {
          safeResponse(sendResponse, { success: filled });
        });
        return true;
      }
      safeResponse(sendResponse, { success: false, error: '消息内容为空' });
      return false;
    }

    return false;
  });

  // ==================== 初始化 ====================

  function init() {
    // 只在搜索页和详情页注入按钮
    var pageType = getPageType();
    if (pageType === 'search' || pageType === 'detail') {
      injectBossSayButton();
    }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    window.addEventListener('load', init);
  }

  var lastUrl = location.href;
  new MutationObserver(function () {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(init, 1000);
    }
  }).observe(document.body, { childList: true, subtree: true });

})();
