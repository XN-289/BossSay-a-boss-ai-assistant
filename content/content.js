/**
 * BossSay - Content Script v7
 * 安全版：不调任何 Boss直聘 API，只从页面内嵌数据提取
 *
 * 方案：
 * 1. 从页面 script 标签中查找内嵌的 JSON 数据（SSR/Next.js/Nuxt 数据）
 * 2. 从 URL 提取 Job ID
 * 3. 从 DOM 提取元信息（过滤 CSS 混淆）
 */

(function () {
  'use strict';

  // ==================== 工具函数 ====================

  function cleanText(text) {
    if (!text) return '';
    return text.replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
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

  // ==================== 从 URL 提取 Job ID ====================

  function getJobIdFromURL() {
    const url = window.location.href;
    const m1 = url.match(/job_detail\/([a-zA-Z0-9_-]+)\.html/);
    if (m1) return m1[1];
    const m2 = url.match(/[?&]jobId=([^&]+)/);
    if (m2) return m2[1];
    const m3 = url.match(/geek\/job\/([a-zA-Z0-9_-]+)/);
    if (m3) return m3[1];
    return '';
  }

  // ==================== 从页面 script 标签提取 SSR 数据 ====================

  function extractFromScripts() {
    const scripts = document.querySelectorAll('script:not([src])');
    for (const script of scripts) {
      const text = script.textContent || '';
      if (text.length < 50) continue;

      // 匹含岗位相关关键词的 script
      if (!text.includes('jobName') && !text.includes('postDescription') &&
          !text.includes('jobDesc') && !text.includes('positionName')) {
        continue;
      }

      // 尝试提取 JSON 对象
      const strategies = [
        // window.__INITIAL_STATE__ = {...}
        () => {
          const m = text.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});?\s*(?:<\/script>|$)/);
          return m ? JSON.parse(m[1]) : null;
        },
        // window.__NEXT_DATA__ = {...}
        () => {
          const m = text.match(/window\.__NEXT_DATA__\s*=\s*(\{[\s\S]*?\});?\s*(?:<\/script>|$)/);
          return m ? JSON.parse(m[1]) : null;
        },
        // 直接找包含 jobName 的 JSON
        () => {
          const m = text.match(/(\{[\s\S]*"jobName"[\s\S]*\})/);
          return m ? JSON.parse(m[1]) : null;
        },
        // 找包含 postDescription 的 JSON
        () => {
          const m = text.match(/(\{[\s\S]*"postDescription"[\s\S]*\})/);
          return m ? JSON.parse(m[1]) : null;
        },
        // 变量赋值: var/let/const xxx = {...}
        () => {
          const m = text.match(/(?:var|let|const)\s+\w+\s*=\s*(\{[\s\S]*\})\s*;?/);
          return m ? JSON.parse(m[1]) : null;
        },
      ];

      for (const tryParse of strategies) {
        try {
          const data = tryParse();
          if (data) {
            const job = findJobInObject(data);
            if (job && (job.jobName || job.title || job.positionName)) {
              return parseJobData(job);
            }
          }
        } catch (e) {}
      }
    }
    return null;
  }

  // 递归查找嵌套对象中的岗位数据
  function findJobInObject(obj, depth) {
    depth = depth || 0;
    if (depth > 6 || !obj || typeof obj !== 'object') return null;

    if (obj.jobName || obj.postDescription || (obj.title && (obj.salary || obj.salaryDesc))) {
      return obj;
    }

    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i++) {
      const val = obj[keys[i]];
      if (val && typeof val === 'object') {
        const result = findJobInObject(val, depth + 1);
        if (result) return result;
      }
    }
    return null;
  }

  function parseJobData(job) {
    return {
      id: job.encryptJobId || job.jobId || job.id || hashStr(window.location.href),
      title: cleanText(job.jobName || job.title || job.positionName || ''),
      salary: cleanText(job.salary || job.salaryDesc || job.payDesc || ''),
      location: cleanText([job.cityName || job.city, job.areaDistrict || job.district].filter(Boolean).join(' ')),
      company: cleanText(job.brandName || job.companyName || job.company || ''),
      bossName: cleanText(job.bossName || job.hrName || ''),
      bossTitle: cleanText(job.bossTitle || job.hrTitle || ''),
      jd: cleanText(job.postDescription || job.jobDesc || job.description || job.content || ''),
      requirements: Array.isArray(job.skills) ? job.skills.map(function(s) { return typeof s === 'string' ? s : s.name || ''; }).filter(Boolean) : [],
      companyInfo: cleanText([job.brandScaleName || job.companySize, job.brandIndustry || job.industry].filter(Boolean).join(' · ')),
      url: window.location.href,
      jdHash: hashStr(job.postDescription || job.jobDesc || ''),
      source: 'ssr',
    };
  }

  // ==================== DOM 提取（降级，过滤 CSS） ====================

  function isCSS(text) {
    if (!text) return true;
    return text.includes('display:') || text.includes('font-size:') || text.includes('{') && text.includes('}');
  }

  function extractField(selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el) {
        var text = el.textContent?.trim();
        if (text && text.length > 0 && text.length < 500 && !isCSS(text)) {
          return text;
        }
      }
    }
    return '';
  }

  /**
   * 自动选中 JD 区域并复制到剪贴板
   * 步骤：注入CSS解锁选中 → 选中JD容器 → 复制 → 读取剪贴板 → 移除注入CSS
   */
  async function autoCopyJD() {
    // 找 JD 容器
    var jdContainer = null;
    var selectors = [
      '[class*="job-detail"]', '[class*="detail-content"]',
      '[class*="job-desc"]', '[class*="job-sec"]',
      '[class*="job-detail-section"]', '.detail-content',
      '[class*="job-detail"] [class*="text"]',
      '[class*="detail"] [class*="content"]',
    ];
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el && el.textContent.length > 50) {
        jdContainer = el;
        break;
      }
    }

    if (!jdContainer) return '';

    // 注入 CSS 强制解锁文字选中
    var style = document.createElement('style');
    style.id = 'boss-say-unselect-fix';
    style.textContent = '*, *::before, *::after { user-select: auto !important; -webkit-user-select: auto !important; }';
    document.head.appendChild(style);

    // 保存原始选区
    var sel = window.getSelection();
    var hadOld = sel.rangeCount > 0;
    var oldRange = hadOld ? sel.getRangeAt(0).cloneRange() : null;

    try {
      // 选中 JD 容器的全部内容
      var range = document.createRange();
      range.selectNodeContents(jdContainer);
      sel.removeAllRanges();
      sel.addRange(range);

      // 复制到剪贴板
      document.execCommand('copy');

      // 读取剪贴板
      var clipText = await navigator.clipboard.readText();
      return clipText || '';
    } catch (e) {
      return '';
    } finally {
      // 恢复
      sel.removeAllRanges();
      if (oldRange) sel.addRange(oldRange);
      // 移除注入的 CSS
      var fix = document.getElementById('boss-say-unselect-fix');
      if (fix) fix.remove();
    }
  }

  function extractFromDOM() {
    // 提取元信息
    var title = extractField(['.job-name', '[class*="job-name"]', 'h1']);
    var salary = extractField(['.salary', '[class*="salary"]']);
    var location = extractField(['.job-area', '[class*="job-area"]']);
    var company = extractField(['.company-name', '[class*="company-name"]']);

    // JD 提取：textContent 先试
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
      source: jd ? 'dom' : 'none',
    };
  }

  // ==================== 输入框注入 ====================

  async function injectMessageToInput(message, retries, interval) {
    retries = retries || 10;
    interval = interval || 500;
    var inputSelectors = [
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
      await new Promise(function(r) { setTimeout(r, interval); });
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
    btn.addEventListener('click', function() {
      chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(function() {});
    });
    document.body.appendChild(btn);
  }

  // ==================== 监听消息 ====================

  var cachedJobInfo = null;

  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.type === 'EXTRACT_JOB_INFO') {
      // 有缓存直接返回
      if (cachedJobInfo && cachedJobInfo.url === window.location.href && cachedJobInfo.title) {
        safeResponse(sendResponse, { success: true, jobInfo: cachedJobInfo });
        return false;
      }

      var debug = [];
      var jobId = getJobIdFromURL();
      debug.push('JobID:' + (jobId || '无'));

      // 方案1：从页面 script 标签提取 SSR 数据
      var jobInfo = extractFromScripts();
      if (jobInfo && jobInfo.title) {
        debug.push('SSR成功:' + jobInfo.title);
        debug.push('JD:' + (jobInfo.jd ? jobInfo.jd.length + '字' : '无'));
        jobInfo.debug = debug.join(' | ');
        cachedJobInfo = jobInfo;
        safeResponse(sendResponse, { success: true, jobInfo: jobInfo });
        return false;
      }
      debug.push('SSR:无数据');

      // 方案2：DOM 提取（降级）
      jobInfo = extractFromDOM();
      debug.push('title:' + (jobInfo.title || '无'));
      debug.push('company:' + (jobInfo.company || '无'));
      debug.push('JD:' + (jobInfo.jd ? jobInfo.jd.length + '字' : '无'));

      // 方案3：通过 service worker 调 API（不触发页面安全检测）
      if (jobId) {
        chrome.runtime.sendMessage({ type: 'FETCH_JOB_DETAIL', data: { jobId: jobId } }, function(apiResp) {
          if (apiResp && apiResp.success && apiResp.jobInfo) {
            // API 数据合并
            jobInfo.title = apiResp.jobInfo.title || jobInfo.title;
            jobInfo.salary = apiResp.jobInfo.salary || jobInfo.salary;
            jobInfo.company = apiResp.jobInfo.company || jobInfo.company;
            jobInfo.location = apiResp.jobInfo.location || jobInfo.location;
            jobInfo.bossName = apiResp.jobInfo.bossName || jobInfo.bossName;
            jobInfo.jd = apiResp.jobInfo.jd || jobInfo.jd;
            jobInfo.requirements = apiResp.jobInfo.requirements || jobInfo.requirements;
            jobInfo.companyInfo = apiResp.jobInfo.companyInfo || jobInfo.companyInfo;
            jobInfo.source = apiResp.jobInfo.source;
            debug.push('SW-API成功:' + jobInfo.title);
          } else {
            debug.push('SW-API:' + (apiResp?.error || '失败'));
          }
          debug.push('JD:' + (jobInfo.jd ? jobInfo.jd.length + '字' : '无'));
          jobInfo.debug = debug.join(' | ');
          cachedJobInfo = jobInfo;
          try { sendResponse({ success: true, jobInfo: jobInfo }); } catch(e) {}
        });
        return true; // async
      }

      debug.push('JD:' + (jobInfo.jd ? jobInfo.jd.length + '字' : '无'));
      jobInfo.debug = debug.join(' | ');
      cachedJobInfo = jobInfo;
      safeResponse(sendResponse, { success: true, jobInfo: jobInfo });
      return false;
    }

    if (request.type === 'AUTO_COPY_JD') {
      autoCopyJD().then(function(jd) {
        safeResponse(sendResponse, { success: !!jd, jd: jd });
      });
      return true; // async
    }

    if (request.type === 'FILL_MESSAGE') {
      var message = request.data?.message;
      if (message) {
        injectMessageToInput(message).then(function(filled) {
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
    injectBossSayButton();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    window.addEventListener('load', init);
  }

  var lastUrl = location.href;
  new MutationObserver(function() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      cachedJobInfo = null;
      setTimeout(init, 1000);
    }
  }).observe(document.body, { childList: true, subtree: true });

})();
