/**
 * BossSay - Content Script v6
 * 简化版：同步返回 + API 降级
 */

(function () {
  'use strict';

  console.log('[BossSay] v6 加载, URL:', window.location.href);

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

  // ==================== 从 DOM 提取元信息 ====================

  function extractField(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent?.trim();
        // 过滤掉 CSS 内容
        if (text && text.length > 0 && text.length < 500 && !text.includes('{') && !text.includes('display:')) {
          return text;
        }
      }
    }
    return '';
  }

  function extractMeta() {
    return {
      title: extractField(['.job-name', '[class*="job-name"]', 'h1']),
      salary: extractField(['.salary', '[class*="salary"]']),
      location: extractField(['.job-area', '[class*="job-area"]']),
      company: extractField(['.company-name', '[class*="company-name"]']),
      bossName: extractField(['.info-primary .name', '[class*="boss"] .name']),
    };
  }

  // ==================== 主提取逻辑 ====================

  function doExtract() {
    const jobId = getJobIdFromURL();
    const meta = extractMeta();
    const debug = [];

    debug.push('v6');
    debug.push('JobID:' + (jobId || '无'));
    debug.push('title:' + (meta.title || '无'));
    debug.push('company:' + (meta.company || '无'));

    // 检查页面是否有真实内容（非CSS）
    const bodyText = document.body?.textContent || '';
    const hasCSS = bodyText.includes('display:inline-block') || bodyText.includes('font-size:0');
    debug.push('页面有CSS:' + hasCSS);

    // 尝试找到 JD 内容（过滤掉 CSS）
    let jd = '';
    const allDivs = document.querySelectorAll('div, section');
    for (const div of allDivs) {
      const text = div.textContent?.trim() || '';
      // 跳过包含 CSS 的内容
      if (text.includes('display:') || text.includes('{') || text.includes('}')) continue;
      // 找包含 JD 关键词的段落
      if (text.length > 50 && text.length < 3000) {
        if (/岗位职责|工作内容|任职要求|岗位要求|职位描述|工作职责/.test(text)) {
          jd = text;
          break;
        }
      }
    }
    debug.push('JD:' + (jd.length > 0 ? jd.length + '字' : '无'));

    const jobInfo = {
      id: jobId || hashStr(window.location.href),
      title: cleanText(meta.title),
      salary: cleanText(meta.salary),
      location: cleanText(meta.location),
      company: cleanText(meta.company),
      bossName: cleanText(meta.bossName),
      bossTitle: '',
      jd: cleanText(jd),
      requirements: [],
      companyInfo: '',
      url: window.location.href,
      jdHash: hashStr(jd),
      source: jd ? 'dom' : 'none',
      debug: debug.join(' | '),
    };

    console.log('[BossSay] 提取结果:', jobInfo);
    return jobInfo;
  }

  // ==================== 异步 API 调用（补充数据） ====================

  async function enrichWithAPI(jobInfo) {
    const jobId = getJobIdFromURL();
    if (!jobId) {
      jobInfo.debug += ' | 无JobID';
      return jobInfo;
    }

    const urls = [
      `/wapi/zpgeek/job/detail.json?jobId=${jobId}`,
      `/wapi/zpgeek/job/detail.json?lid=${jobId}`,
      `/wapi/zpgeek/job/detail.json?encryptJobId=${jobId}`,
      `/wapi/zpgeek/job/internship/detail.json?jobId=${jobId}`,
    ];

    for (const url of urls) {
      try {
        const resp = await fetch(url, { credentials: 'include' });
        jobInfo.debug += ' | ' + url.split('?')[0] + ':' + resp.status;

        if (!resp.ok) continue;

        const data = await resp.json();
        const code = data.code || data.statusCode;
        const job = data?.data || data?.zpData || data;

        jobInfo.debug += '|code:' + code;

        if (!job) continue;

        // 检查是否有有效数据
        const hasJD = job.postDescription || job.jobDesc || job.description;
        const hasTitle = job.jobName || job.title || job.positionName;

        if (hasTitle) {
          jobInfo.title = cleanText(job.jobName || job.title || jobInfo.title);
          jobInfo.salary = cleanText(job.salary || job.salaryDesc || jobInfo.salary);
          jobInfo.company = cleanText(job.brandName || job.companyName || jobInfo.company);
          jobInfo.location = cleanText([job.cityName, job.areaDistrict].filter(Boolean).join(' ') || jobInfo.location);
          jobInfo.bossName = cleanText(job.bossName || jobInfo.bossName);
          if (hasJD) {
            jobInfo.jd = cleanText(hasJD);
          }
          jobInfo.source = 'api';
          jobInfo.debug += '|OK';
          return jobInfo;
        }
      } catch (e) {
        jobInfo.debug += '|err:' + e.message.substring(0, 30);
        continue;
      }
    }
    jobInfo.debug += '|全部失败';
    return jobInfo;
  }

  // ==================== 输入框注入 ====================

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
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
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
      await new Promise(r => setTimeout(r, interval));
    }
    return false;
  }

  // ==================== BossSay 按钮 ====================

  function injectBossSayButton() {
    if (document.getElementById('boss-say-open-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'boss-say-open-btn';
    btn.textContent = 'BossSay';
    btn.title = '打开 BossSay';
    btn.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:999999;padding:10px 18px;background:linear-gradient(135deg,#4FACFE,#00F2FE);color:#fff;border:none;border-radius:24px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 4px 15px rgba(79,172,254,0.4);font-family:sans-serif;';
    btn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(() => {});
    });
    document.body.appendChild(btn);
  }

  // ==================== 监听消息 ====================

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[BossSay] 收到消息:', request.type);

    if (request.type === 'EXTRACT_JOB_INFO') {
      // 如果有缓存且URL没变，直接返回
      if (cachedJobInfo && cachedJobInfo.url === window.location.href && cachedJobInfo.title) {
        sendResponse({ success: true, jobInfo: cachedJobInfo });
        return false;
      }

      // 同步提取DOM信息
      const jobInfo = doExtract();

      // 异步调API补充JD，用sendResponse返回
      enrichWithAPI(jobInfo).then(updated => {
        cachedJobInfo = updated;
        try { sendResponse({ success: true, jobInfo: updated }); } catch(e) {}
      });

      return true; // async response
    }

    if (request.type === 'FILL_MESSAGE') {
      const message = request.data?.message;
      if (message) {
        injectMessageToInput(message).then(filled => {
          sendResponse({ success: filled });
        });
        return true;
      }
      sendResponse({ success: false, error: '消息内容为空' });
      return false;
    }

    return false;
  });

  // ==================== 缓存 ====================

  let cachedJobInfo = null;

  // ==================== 初始化 ====================

  function init() {
    injectBossSayButton();
    console.log('[BossSay] 初始化完成, JobID:', getJobIdFromURL());
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    window.addEventListener('load', init);
  }

  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      cachedJobInfo = null;
      setTimeout(init, 1000);
    }
  }).observe(document.body, { childList: true, subtree: true });

})();
