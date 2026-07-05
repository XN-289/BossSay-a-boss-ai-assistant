/**
 * BossSay - Content Script v9
 * 增强版内容脚本：智能页面检测、批量提取、聊天监控、快捷键、浮动面板
 *
 * 功能清单：
 * 1. 智能页面检测 - 支持 SPA 导航、URL 模式匹配
 * 2. 富字段提取   - 职位福利、团队规模、公司阶段、技术栈
 * 3. 批量提取     - 搜索页全部职位 + 分页支持
 * 4. 聊天监控     - MutationObserver 监听 HR 回复
 * 5. 增强填入     - 支持光标定位编辑
 * 6. 键盘快捷键   - Ctrl+Shift+B 打开 / Ctrl+Shift+G 生成
 * 7. 卡片增强     - 匹配度徽章、视觉指示器
 * 8. 浮动面板     - 迷你面板显示快速统计
 * 9. 页面上下文   - 收集搜索筛选条件、页码等
 * 10. 发送追踪    - 检测用户发送消息，自动标记已发送
 */

(function () {
  'use strict';

  // ==================== 常量配置 ====================

  /** Boss直聘 URL 匹配模式 */
  var URL_PATTERNS = {
    search: [/\/geek\/job[s]?(?:\?|$|#)/, /\/geek\/recommend/],
    detail: [/\/job_detail\//, /\/web\/geek\/job\//],
    chat:   [/\/chat(?:\?|$|#|\/)/, /\/web\/geek\/chat/],
  };

  /** 延迟常量（毫秒） */
  var DELAY = {
    SPA_NAV: 1200,       // SPA 导航后等待
    CARD_SCAN: 300,      // 卡片扫描间隔
    INPUT_RETRY: 500,    // 输入框重试间隔
    CHAT_POLL: 2000,     // 聊天轮询间隔
    TOAST_DURATION: 3000,// 提示持续时间
  };

  /** 选择器优先级列表 */
  var SELECTORS = {
    jobCards: [
      'li.job-card-box',
      '.job-card-box',
      '[class*="job-card"]',
      '.search-job-result li',
    ],
    jobName: ['.job-name', '.job-title .job-name', '.job-title', '[class*="job-name"]'],
    salary:  ['.salary', '[class*="salary"]'],
    location:['.job-area', '.job-address-desc', '.job-area-wrapper', '[class*="job-area"]'],
    company: [
      '.company-name', '.company-info .company-name',
      '.job-card-right .company-name', '.company-info h3',
      'h3.company-name', 'a.company-name',
    ],
    chatInput: [
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
    ],
    chatContainer: [
      '.chat-conversation',
      '.chat-message-list',
      '[class*="chat-container"]',
      '[class*="message-list"]',
      '[class*="conversation"]',
    ],
    sendButton: [
      '.chat-conversation .btn-send',
      '.btn-send',
      '[class*="send-btn"]',
      'button[class*="send"]',
    ],
  };

  // ==================== 工具函数 ====================

  /** 清理文本中的零宽字符和多余空白 */
  function cleanText(text) {
    if (!text) return '';
    return text.replace(/[​-‏﻿]/g, '').replace(/\s+/g, ' ').trim();
  }

  /** 简单字符串哈希（用于生成 ID） */
  function hashStr(str) {
    var hash = 5381;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
    }
    return hash.toString(36);
  }

  /** 安全发送响应（防止端口已关闭时报错） */
  function safeResponse(sendResponse, data) {
    try { sendResponse(data); } catch (e) { /* 端口可能已关闭 */ }
  }

  /** 从多个选择器中提取第一个匹配元素的文本 */
  function pick(root, sels) {
    for (var i = 0; i < sels.length; i++) {
      var el = root.querySelector(sels[i]);
      if (el) {
        var t = cleanText(el.textContent);
        if (t) return t;
      }
    }
    return '';
  }

  /** 检测文本是否为 CSS 代码（详情页 JD 常被 CSS 混淆） */
  function isCSS(text) {
    if (!text) return true;
    return text.includes('display:') || text.includes('font-size:') ||
      (text.includes('{') && text.includes('}'));
  }

  /** 延迟 Promise */
  function delay(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  /** 安全的 querySelector 封装 */
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  /** 安全的 querySelectorAll 封装，返回数组 */
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  /** Toast 提示（页面内轻量提示） */
  function showToast(msg, type) {
    var old = document.getElementById('bosssay-toast');
    if (old) old.remove();
    var div = document.createElement('div');
    div.id = 'bosssay-toast';
    var bg = type === 'error' ? '#ff4757' : type === 'warn' ? '#ffa502' : '#2ed573';
    div.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:9999999;'
      + 'padding:10px 24px;border-radius:8px;font-size:14px;color:#fff;font-family:sans-serif;'
      + 'box-shadow:0 4px 20px rgba(0,0,0,0.15);background:' + bg + ';transition:opacity 0.3s;';
    div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(function () {
      div.style.opacity = '0';
      setTimeout(function () { div.remove(); }, 300);
    }, DELAY.TOAST_DURATION);
  }

  // ==================== 1. 智能页面检测 ====================

  /**
   * 判断当前页面类型
   * 优先使用 URL 模式匹配，兼顾 SPA 动态路由
   */
  function getPageType() {
    var url = location.href;
    var path = location.pathname;

    // 精确匹配聊天页（优先级最高，避免 /geek/job 被误判）
    for (var i = 0; i < URL_PATTERNS.chat.length; i++) {
      if (URL_PATTERNS.chat[i].test(path) || URL_PATTERNS.chat[i].test(url)) return 'chat';
    }

    // 匹配详情页
    for (var j = 0; j < URL_PATTERNS.detail.length; j++) {
      if (URL_PATTERNS.detail[j].test(path) || URL_PATTERNS.detail[j].test(url)) return 'detail';
    }

    // 匹配搜索页
    for (var k = 0; k < URL_PATTERNS.search.length; k++) {
      if (URL_PATTERNS.search[k].test(path) || URL_PATTERNS.search[k].test(url)) return 'search';
    }

    // 兜底：如果在 /geek/ 路径下且存在职位卡片，则视为搜索页
    if (path.indexOf('/geek/') >= 0) {
      var cards = $$(SELECTORS.jobCards.join(', '));
      if (cards.length > 0) return 'search';
    }

    return 'other';
  }

  /**
   * 获取页面上下文信息（搜索筛选条件、页码等）
   * 用于 AI 分析时提供更精准的上下文
   */
  function getPageContext() {
    var ctx = {
      url: location.href,
      pathname: location.pathname,
      timestamp: Date.now(),
    };

    // 搜索页上下文
    if (getPageType() === 'search') {
      // 解析 URL 参数
      var params = new URLSearchParams(location.search);
      ctx.searchQuery = params.get('query') || '';
      ctx.city = params.get('city') || '';
      ctx.page = parseInt(params.get('page') || '1', 10);

      // 从 DOM 提取当前筛选条件
      var filterTags = $$('.search-condition-wrapper .condition-tag, .search-condition .tag-text, [class*="filter"] [class*="tag"]');
      ctx.activeFilters = filterTags.map(function (el) { return cleanText(el.textContent); }).filter(Boolean);

      // 搜索结果数量
      var countEl = $('.search-job-result .job-list-box, [class*="result-count"], [class*="total"]');
      if (countEl) ctx.resultCount = cleanText(countEl.textContent);
    }

    return ctx;
  }

  // ==================== 2. 富字段提取 ====================

  /**
   * 从职位卡片中提取额外字段
   * 福利标签、技术标签、公司阶段等
   */
  function extractExtraFields(card) {
    var extra = {};

    // 福利标签（如：五险一金、弹性工作、年终奖等）
    var benefitTags = $$('.job-tags span, .job-benefits span, .tag-list li, [class*="benefit"] span, [class*="welfare"] span', card);
    var benefits = [];
    benefitTags.forEach(function (el) {
      var t = cleanText(el.textContent);
      if (t && t.length < 20) benefits.push(t);
    });
    extra.benefits = benefits;

    // 技术栈标签（从职位名和描述中提取关键词）
    var techKeywords = [];
    var allText = cleanText(card.textContent || '');
    var techPatterns = /\b(React|Vue|Angular|Node\.?js|Python|Java|Go|Golang|Rust|C\+\+|TypeScript|JavaScript|Kotlin|Swift|Flutter|Docker|K8s|Kubernetes|MySQL|Redis|MongoDB|PostgreSQL|ElasticSearch|Kafka|RabbitMQ|Flink|Spark|Hadoop|Linux|AWS|Azure|GCP)\b/gi;
    var match;
    while ((match = techPatterns.exec(allText)) !== null) {
      if (techKeywords.indexOf(match[1]) < 0) techKeywords.push(match[1]);
    }
    extra.techStack = techKeywords;

    // HR 最近活跃标识
    var activeEl = $$('.boss-active-time, [class*="active-time"], [class*="last-active"]', card);
    if (activeEl.length) extra.hrActiveTime = cleanText(activeEl[0].textContent);

    // 公司规模/阶段
    var companyStage = $$('.company-tag-list span, [class*="company-tag"] span, [class*="company-info"] span', card);
    companyStage.forEach(function (el) {
      var t = cleanText(el.textContent);
      if (/融资|上市|天使|A轮|B轮|C轮|D轮|已上市/.test(t)) extra.companyStage = t;
      if (/人$|\d+-\d+人|\d+人以上/.test(t)) extra.companySize = t;
      if (/互联网|金融|教育|医疗|电商|游戏|人工智能|AI|SaaS|企业服务/.test(t)) extra.industry = t;
    });

    return extra;
  }

  // ==================== 3. 搜索结果页批量提取 ====================

  /**
   * 从搜索结果页批量提取所有可见职位卡片
   * 支持多种选择器兼容不同版本的页面结构
   */
  function extractFromSearchPage() {
    var cards = [];
    // 尝试所有可能的卡片选择器
    for (var s = 0; s < SELECTORS.jobCards.length; s++) {
      cards = $$(SELECTORS.jobCards[s]);
      if (cards.length > 0) break;
    }
    if (cards.length === 0) return null;

    var jobs = [];
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var txt = c.textContent || '';

      // 跳过已沟通过的职位
      if (txt.indexOf('已沟通') >= 0) continue;

      var jb = pick(c, SELECTORS.jobName);
      if (!jb) continue;

      var sal = pick(c, SELECTORS.salary);
      var loc = pick(c, SELECTORS.location);

      // 公司名：在 footer 子区域中查找
      var footer = c.querySelector('.job-card-footer, .job-card-bottom, .card-footer, .job-card-right, .company-info');
      var co = pick(footer || c, SELECTORS.company);

      // 经验 / 学历标签
      var tags = $$('.tag-list li, .tag-list span, [class*="tag"] li', c);
      var exp = '', edu = '';
      for (var t = 0; t < tags.length; t++) {
        var tagText = cleanText(tags[t].textContent);
        if (/经验|年|应届|在校|不限/.test(tagText)) exp = tagText;
        if (/本科|大专|硕士|博士|学历|中专|高中/.test(tagText)) edu = tagText;
      }

      // 提取额外字段
      var extra = extractExtraFields(c);

      // 获取卡片链接（用于直接跳转详情页）
      var linkEl = $('a[href*="job_detail"]', c) || $('a[href*="/web/geek/job"]', c) || $('a', c);
      var link = linkEl ? linkEl.href : '';

      jobs.push({
        id: hashStr(co + jb),
        title: jb,
        company: co || '未知',
        salary: sal,
        location: loc,
        experience: exp,
        education: edu,
        jd: '',
        url: link || location.href,
        source: 'search-card',
        benefits: extra.benefits || [],
        techStack: extra.techStack || [],
        companyStage: extra.companyStage || '',
        companySize: extra.companySize || '',
        industry: extra.industry || '',
        hrActiveTime: extra.hrActiveTime || '',
        cardIndex: i,
      });
    }

    return jobs;
  }

  // ==================== 4. 详情页提取 ====================

  /**
   * 从职位详情页提取信息
   * 注意：Boss直聘对详情页 JD 有 CSS 混淆，提取成功率有限
   */
  function extractFromDetailPage() {
    var title = pick(document, SELECTORS.jobName.concat(['h1']));
    var salary = pick(document, SELECTORS.salary);
    var location = pick(document, SELECTORS.location);
    var company = pick(document, SELECTORS.company);

    // 尝试提取 JD（大概率被 CSS 混淆，但仍然尝试）
    var jd = '';
    var allEls = $$('div, section, p, li');
    for (var i = 0; i < allEls.length; i++) {
      var text = (allEls[i].textContent || '').trim();
      if (text.length > 50 && text.length < 3000 && !isCSS(text)) {
        if (/岗位职责|工作内容|任职要求|岗位要求|职位描述|工作职责/.test(text)) {
          jd = text;
          break;
        }
      }
    }

    // 提取额外字段
    var extra = extractExtraFields(document);

    return {
      id: hashStr(location.href),
      title: cleanText(title),
      company: cleanText(company),
      salary: cleanText(salary),
      location: cleanText(location),
      experience: '',
      education: '',
      jd: cleanText(jd),
      url: location.href,
      source: jd ? 'detail-dom' : 'detail-no-jd',
      benefits: extra.benefits || [],
      techStack: extra.techStack || [],
      companyStage: extra.companyStage || '',
      companySize: extra.companySize || '',
      industry: extra.industry || '',
    };
  }

  // ==================== 5. 增强输入框注入 ====================

  /**
   * 将消息注入到聊天输入框
   * 支持 textarea 和 contenteditable 两种类型
   * 增强：支持光标定位到末尾便于编辑
   */
  async function injectMessageToInput(message, retries, interval) {
    retries = retries || 10;
    interval = interval || DELAY.INPUT_RETRY;

    for (var attempt = 0; attempt < retries; attempt++) {
      for (var s = 0; s < SELECTORS.chatInput.length; s++) {
        var input = $(SELECTORS.chatInput[s]);
        if (!input) continue;

        if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
          // textarea / input：使用原生 setter 触发响应式更新
          var setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
          if (setter && setter.set) setter.set.call(input, message);
          else input.value = message;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          // contenteditable：直接设置文本内容
          input.textContent = message;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // 聚焦并将光标移到末尾，方便用户编辑
        input.focus();
        if (input.setSelectionRange) {
          var len = input.value ? input.value.length : message.length;
          input.setSelectionRange(len, len);
        } else if (window.getSelection && input.childNodes.length > 0) {
          // contenteditable 光标定位到末尾
          var range = document.createRange();
          range.selectNodeContents(input);
          range.collapse(false);
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }

        return true;
      }
      await delay(interval);
    }
    return false;
  }

  // ==================== 6. 聊天监控（HR 回复检测） ====================

  /** 聊天监控器实例 */
  var chatMonitor = {
    observer: null,
    lastMessageCount: 0,
    onReplyCallback: null,

    /** 启动聊天监控 */
    start: function () {
      if (this.observer) return;

      var self = this;
      var container = null;

      // 查找聊天消息容器
      for (var i = 0; i < SELECTORS.chatContainer.length; i++) {
        container = $(SELECTORS.chatContainer[i]);
        if (container) break;
      }

      if (!container) {
        // 容器未找到，延迟重试
        setTimeout(function () { self.start(); }, DELAY.SPA_NAV);
        return;
      }

      this.lastMessageCount = $$('.chat-message, [class*="message-item"], [class*="message-content"]', container).length;

      this.observer = new MutationObserver(function (mutations) {
        var hasNewMessages = false;
        mutations.forEach(function (m) {
          if (m.addedNodes.length > 0) hasNewMessages = true;
        });

        if (!hasNewMessages) return;

        var currentCount = $$('.chat-message, [class*="message-item"], [class*="message-content"]', container).length;
        if (currentCount > self.lastMessageCount) {
          self.lastMessageCount = currentCount;
          self._detectNewReply(container);
        }
      });

      this.observer.observe(container, { childList: true, subtree: true });
    },

    /** 检测新回复是否来自 HR（对方） */
    _detectNewReply: function (container) {
      var messages = $$('.chat-message, [class*="message-item"]', container);
      if (messages.length === 0) return;

      var lastMsg = messages[messages.length - 1];
      var msgText = cleanText(lastMsg.textContent || '');

      // 判断是否为对方（HR）发送的消息
      // Boss直聘中，对方消息通常不含 "item-right" 或 "self" 类名
      var isSelf = lastMsg.classList.toString().indexOf('right') >= 0 ||
        lastMsg.classList.toString().indexOf('self') >= 0 ||
        lastMsg.closest('[class*="right"]') !== null ||
        lastMsg.closest('[class*="self"]') !== null;

      if (!isSelf && msgText.length > 0) {
        // HR 回复了！通知 popup 和 background
        chrome.runtime.sendMessage({
          type: 'HR_REPLIED',
          data: {
            message: msgText.substring(0, 200),
            url: location.href,
            timestamp: Date.now(),
          },
        }).catch(function () {});

        showToast('💬 HR 回复了：' + msgText.substring(0, 50) + (msgText.length > 50 ? '...' : ''));
      }
    },

    /** 停止监控 */
    stop: function () {
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      this.lastMessageCount = 0;
    },
  };

  // ==================== 7. 发送消息追踪 ====================

  /**
   * 监听用户发送消息行为
   * 当检测到用户点击发送按钮或按 Enter 时，通知 background 标记为已发送
   */
  function setupSendTracking() {
    // 方式一：监听发送按钮点击
    document.addEventListener('click', function (e) {
      var target = e.target;
      // 向上查找是否点击了发送按钮
      for (var i = 0; i < SELECTORS.sendButton.length; i++) {
        var btn = target.closest(SELECTORS.sendButton[i]);
        if (btn) {
          _onMessageSent();
          return;
        }
      }
    }, true);

    // 方式二：监听 Enter 键发送（输入框中按 Enter）
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        var target = e.target;
        var isInput = false;
        for (var i = 0; i < SELECTORS.chatInput.length; i++) {
          if (target.matches && target.matches(SELECTORS.chatInput[i])) {
            isInput = true;
            break;
          }
        }
        if (isInput) {
          // 延迟检测，等待消息实际发送
          setTimeout(_onMessageSent, 300);
        }
      }
    }, true);
  }

  /** 消息发送后的回调 */
  function _onMessageSent() {
    chrome.runtime.sendMessage({
      type: 'MESSAGE_SENT',
      data: {
        url: location.href,
        timestamp: Date.now(),
      },
    }).catch(function () {});
  }

  // ==================== 8. BossSay 浮动面板 ====================

  /** 浮动面板状态 */
  var floatingPanel = {
    element: null,
    isDragging: false,
    dragOffset: { x: 0, y: 0 },

    /** 创建浮动面板 */
    create: function () {
      if (this.element) return;

      var panel = document.createElement('div');
      panel.id = 'bosssay-floating-panel';
      panel.innerHTML = [
        '<div class="bosssay-panel-header">',
        '  <span class="bosssay-panel-title">BossSay</span>',
        '  <span class="bosssay-panel-toggle" title="收起/展开">—</span>',
        '</div>',
        '<div class="bosssay-panel-body">',
        '  <div class="bosssay-stat-row">',
        '    <span class="bosssay-stat-label">当前页面</span>',
        '    <span class="bosssay-stat-value" id="bosssay-page-type">-</span>',
        '  </div>',
        '  <div class="bosssay-stat-row">',
        '    <span class="bosssay-stat-label">职位数量</span>',
        '    <span class="bosssay-stat-value" id="bosssay-job-count">-</span>',
        '  </div>',
        '  <div class="bosssay-panel-actions">',
        '    <button id="bosssay-btn-open" title="打开 BossSay 面板 (Ctrl+Shift+B)">打开</button>',
        '    <button id="bosssay-btn-generate" title="生成消息 (Ctrl+Shift+G)">生成</button>',
        '  </div>',
        '</div>',
      ].join('\n');

      // 样式
      var style = document.createElement('style');
      style.textContent = [
        '#bosssay-floating-panel {',
        '  position: fixed; bottom: 24px; right: 24px; z-index: 999999;',
        '  width: 200px; background: #fff; border-radius: 12px;',
        '  box-shadow: 0 8px 32px rgba(0,0,0,0.12); font-family: -apple-system, sans-serif;',
        '  font-size: 13px; color: #333; overflow: hidden; user-select: none;',
        '  border: 1px solid rgba(79,172,254,0.2);',
        '}',
        '.bosssay-panel-header {',
        '  display: flex; justify-content: space-between; align-items: center;',
        '  padding: 8px 12px; cursor: move;',
        '  background: linear-gradient(135deg, #4FACFE, #00F2FE); color: #fff;',
        '}',
        '.bosssay-panel-title { font-weight: 700; font-size: 14px; }',
        '.bosssay-panel-toggle { cursor: pointer; font-size: 16px; padding: 0 4px; }',
        '.bosssay-panel-body { padding: 10px 12px; transition: max-height 0.3s; max-height: 200px; }',
        '.bosssay-panel-body.collapsed { max-height: 0; padding: 0 12px; overflow: hidden; }',
        '.bosssay-stat-row { display: flex; justify-content: space-between; padding: 4px 0; }',
        '.bosssay-stat-label { color: #888; }',
        '.bosssay-stat-value { font-weight: 600; color: #4FACFE; }',
        '.bosssay-panel-actions { display: flex; gap: 6px; margin-top: 8px; }',
        '.bosssay-panel-actions button {',
        '  flex: 1; padding: 6px 0; border: none; border-radius: 6px;',
        '  font-size: 12px; cursor: pointer; font-weight: 600; transition: all 0.2s;',
        '}',
        '#bosssay-btn-open { background: #f0f0f0; color: #333; }',
        '#bosssay-btn-open:hover { background: #e0e0e0; }',
        '#bosssay-btn-generate {',
        '  background: linear-gradient(135deg, #4FACFE, #00F2FE); color: #fff;',
        '}',
        '#bosssay-btn-generate:hover { opacity: 0.9; }',
      ].join('\n');

      document.head.appendChild(style);
      document.body.appendChild(panel);
      this.element = panel;

      // 拖拽功能
      this._setupDrag(panel);

      // 展开/收起
      var toggle = panel.querySelector('.bosssay-panel-toggle');
      var body = panel.querySelector('.bosssay-panel-body');
      toggle.addEventListener('click', function () {
        body.classList.toggle('collapsed');
        toggle.textContent = body.classList.contains('collapsed') ? '＋' : '—';
      });

      // 按钮事件
      panel.querySelector('#bosssay-btn-open').addEventListener('click', function () {
        chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(function () {});
      });

      panel.querySelector('#bosssay-btn-generate').addEventListener('click', function () {
        chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(function () {});
        // 延迟通知 popup 执行生成
        setTimeout(function () {
          chrome.runtime.sendMessage({ type: 'TRIGGER_GENERATE' }).catch(function () {});
        }, 500);
      });
    },

    /** 设置拖拽 */
    _setupDrag: function (panel) {
      var header = panel.querySelector('.bosssay-panel-header');
      var self = this;

      header.addEventListener('mousedown', function (e) {
        self.isDragging = true;
        var rect = panel.getBoundingClientRect();
        self.dragOffset.x = e.clientX - rect.left;
        self.dragOffset.y = e.clientY - rect.top;
        e.preventDefault();
      });

      document.addEventListener('mousemove', function (e) {
        if (!self.isDragging) return;
        var x = e.clientX - self.dragOffset.x;
        var y = e.clientY - self.dragOffset.y;
        // 边界限制
        x = Math.max(0, Math.min(x, window.innerWidth - 200));
        y = Math.max(0, Math.min(y, window.innerHeight - 60));
        panel.style.left = x + 'px';
        panel.style.top = y + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
      });

      document.addEventListener('mouseup', function () {
        self.isDragging = false;
      });
    },

    /** 更新面板数据 */
    update: function (data) {
      if (!this.element) this.create();
      var pageTypeEl = document.getElementById('bosssay-page-type');
      var jobCountEl = document.getElementById('bosssay-job-count');
      if (pageTypeEl) {
        var typeLabels = { search: '搜索页', detail: '详情页', chat: '聊天页', other: '其他' };
        pageTypeEl.textContent = typeLabels[data.pageType] || data.pageType;
      }
      if (jobCountEl) {
        jobCountEl.textContent = (data.jobCount || 0) + ' 个';
      }
    },
  };

  // ==================== 9. 键盘快捷键 ====================

  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', function (e) {
      // Ctrl+Shift+B：打开 BossSay
      if (e.ctrlKey && e.shiftKey && e.key === 'B') {
        e.preventDefault();
        chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(function () {});
      }
      // Ctrl+Shift+G：触发生成消息
      if (e.ctrlKey && e.shiftKey && e.key === 'G') {
        e.preventDefault();
        chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(function () {});
        setTimeout(function () {
          chrome.runtime.sendMessage({ type: 'TRIGGER_GENERATE' }).catch(function () {});
        }, 500);
      }
    });
  }

  // ==================== 10. 消息监听 ====================

  chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {

    // ---------- 提取职位信息 ----------
    if (request.type === 'EXTRACT_JOB_INFO') {
      var pageType = getPageType();

      if (pageType === 'search') {
        var jobs = extractFromSearchPage();
        var context = getPageContext();
        safeResponse(sendResponse, {
          success: true,
          pageType: 'search',
          jobs: jobs || [],
          jobInfo: jobs && jobs.length > 0 ? jobs[0] : null,
          pageContext: context,
        });
      } else if (pageType === 'detail') {
        var jobInfo = extractFromDetailPage();
        safeResponse(sendResponse, {
          success: true,
          pageType: 'detail',
          jobInfo: jobInfo,
        });
      } else if (pageType === 'chat') {
        // 聊天页也支持提取当前对话的职位信息
        safeResponse(sendResponse, {
          success: false,
          pageType: 'chat',
          error: '当前在聊天页，请在搜索页或详情页使用扫描功能',
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

    // ---------- 填入消息 ----------
    if (request.type === 'FILL_MESSAGE') {
      var message = request.data && request.data.message;
      if (message) {
        injectMessageToInput(message).then(function (filled) {
          safeResponse(sendResponse, { success: filled });
        });
        return true; // 异步响应
      }
      safeResponse(sendResponse, { success: false, error: '消息内容为空' });
      return false;
    }

    // ---------- 获取页面上下文 ----------
    if (request.type === 'GET_PAGE_CONTEXT') {
      var ctx = getPageContext();
      ctx.pageType = getPageType();
      safeResponse(sendResponse, { success: true, context: ctx });
      return false;
    }

    // ---------- 聊天监控控制 ----------
    if (request.type === 'START_CHAT_MONITOR') {
      chatMonitor.start();
      safeResponse(sendResponse, { success: true });
      return false;
    }

    if (request.type === 'STOP_CHAT_MONITOR') {
      chatMonitor.stop();
      safeResponse(sendResponse, { success: true });
      return false;
    }

    return false;
  });

  // ==================== 初始化 ====================

  /** 主初始化函数 */
  function init() {
    var pageType = getPageType();

    // 搜索页和详情页：注入浮动面板
    if (pageType === 'search' || pageType === 'detail') {
      floatingPanel.create();
      var jobCount = 0;
      if (pageType === 'search') {
        var jobs = extractFromSearchPage();
        jobCount = jobs ? jobs.length : 0;
      }
      floatingPanel.update({ pageType: pageType, jobCount: jobCount });
    }

    // 聊天页：启动聊天监控
    if (pageType === 'chat') {
      chatMonitor.start();
    }

    // 全局：注册快捷键和发送追踪（只需注册一次）
    if (!window._bosssay_initialized) {
      setupKeyboardShortcuts();
      setupSendTracking();
      window._bosssay_initialized = true;
    }
  }

  // ==================== 生命周期管理 ====================

  // 页面加载完成后初始化
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    window.addEventListener('load', init);
  }

  // SPA 导航检测：监听 URL 变化
  var lastUrl = location.href;
  var navTimer = null;
  new MutationObserver(function () {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // 清理旧状态
      chatMonitor.stop();
      // 防抖：等页面渲染稳定后再初始化
      clearTimeout(navTimer);
      navTimer = setTimeout(init, DELAY.SPA_NAV);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  // 额外监听 popstate（浏览器前进/后退）
  window.addEventListener('popstate', function () {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      chatMonitor.stop();
      clearTimeout(navTimer);
      navTimer = setTimeout(init, DELAY.SPA_NAV);
    }
  });

})();
