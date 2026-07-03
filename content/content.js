/**
 * BossSay - Content Script v5
 * 直接调用 Boss直聘 API 获取岗位信息（绕过 CSS 反爬）
 *
 * 功能：
 * 1. 从 URL 提取 Job ID，调 /wapi/zpgeek/job/detail.json 获取真实数据
 * 2. 降级：从页面 SSR 数据（__INITIAL_STATE__ 等）提取
 * 3. 响应 popup 的 EXTRACT_JOB_INFO 和 FILL_MESSAGE 请求
 * 4. 右下角 BossSay 浮动按钮
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
    // 格式1: /job_detail/xxx.html
    const m1 = url.match(/job_detail\/([a-zA-Z0-9_-]+)\.html/);
    if (m1) return m1[1];
    // 格式2: /web/geek/job?jobId=xxx
    const m2 = url.match(/[?&]jobId=([^&]+)/);
    if (m2) return m2[1];
    // 格式3: /web/geek/job/xxx
    const m3 = url.match(/geek\/job\/([a-zA-Z0-9_-]+)/);
    if (m3) return m3[1];
    return '';
  }

  // ==================== 方案1：调 Boss直聘 API ====================

  async function fetchJobFromAPI() {
    const jobId = getJobIdFromURL();
    if (!jobId) {
      console.log('[BossSay] 无法从URL提取Job ID');
      return null;
    }
    console.log('[BossSay] Job ID:', jobId);

    const urls = [
      `/wapi/zpgeek/job/detail.json?jobId=${jobId}`,
      `/wapi/zpgeek/job/detail.json?lid=${jobId}`,
      `/wapi/zpgeek/search/joblist.json?jobId=${jobId}`,
    ];

    for (const url of urls) {
      try {
        console.log('[BossSay] 尝试 API:', url);
        const resp = await fetch(url, {
          credentials: 'include',
          headers: { 'Accept': 'application/json' },
        });
        console.log('[BossSay] API 响应:', resp.status, resp.statusText);

        if (!resp.ok) {
          console.log('[BossSay] API 非200，跳过');
          continue;
        }

        const data = await resp.json();
        console.log('[BossSay] API 返回数据 keys:', Object.keys(data));
        console.log('[BossSay] API 返回数据(前500字):', JSON.stringify(data).substring(0, 500));

        const job = data?.data || data?.zpData || data?.result || data;
        if (!job) {
          console.log('[BossSay] API 数据为空');
          continue;
        }
        console.log('[BossSay] job keys:', Object.keys(job));
        console.log('[BossSay] jobName:', job.jobName, 'title:', job.title);

        if (!job.jobName && !job.title && !job.positionName) {
          console.log('[BossSay] API 数据无职位名称，跳过');
          continue;
        }

        return parseJobData(job);
      } catch (e) {
        console.log('[BossSay] API 异常:', e.message);
        continue;
      }
    }
    console.log('[BossSay] 所有 API 尝试均失败');
    return null;
  }

  // ==================== 方案2：从页面 SSR 数据提取 ====================

  function extractFromSSR() {
    // Boss直聘可能在页面内嵌 SSR 数据
    const stateKeys = ['__INITIAL_STATE__', '__NEXT_DATA__', '__NUXT__', 'window.__INITIAL_STATE__'];

    for (const key of stateKeys) {
      try {
        let data;
        if (key.startsWith('window.')) {
          data = eval(key);
        } else {
          data = window[key];
        }
        if (data) {
          const job = findJobInObject(data);
          if (job) return parseJobData(job);
        }
      } catch (e) {}
    }

    // 从 script 标签中查找 JSON 数据
    const scripts = document.querySelectorAll('script:not([src])');
    for (const script of scripts) {
      const text = script.textContent;
      if (!text || text.length < 50) continue;

      // 查找 jobName 或 postDescription 字段
      if (text.includes('jobName') || text.includes('postDescription')) {
        try {
          // 尝试提取 JSON 对象
          const jsonMatch = text.match(/\{[\s\S]*"jobName"[\s\S]*\}/);
          if (jsonMatch) {
            const data = JSON.parse(jsonMatch[0]);
            const job = findJobInObject(data) || data;
            if (job.jobName || job.title) return parseJobData(job);
          }
        } catch (e) {}
      }
    }

    return null;
  }

  // 在嵌套对象中查找岗位数据
  function findJobInObject(obj, depth = 0) {
    if (depth > 5 || !obj || typeof obj !== 'object') return null;

    // 直接包含岗位字段
    if (obj.jobName || obj.postDescription || (obj.title && obj.salaryDesc)) {
      return obj;
    }

    // 递归查找
    for (const key of Object.keys(obj)) {
      if (key === 'data' || key === 'zpData' || key === 'result' || key === 'jobInfo' || key === 'job') {
        const result = findJobInObject(obj[key], depth + 1);
        if (result) return result;
      }
    }

    // 数组
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const result = findJobInObject(item, depth + 1);
        if (result) return result;
      }
    }

    return null;
  }

  // ==================== 解析岗位数据 ====================

  function parseJobData(job) {
    const jobName = job.jobName || job.title || job.positionName || '';
    const salary = job.salary || job.salaryDesc || job.payDesc || '';
    const city = job.cityName || job.city || '';
    const district = job.areaDistrict || job.district || '';
    const location = [city, district].filter(Boolean).join(' ');
    const company = job.brandName || job.companyName || job.company || '';
    const bossName = job.bossName || job.hrName || '';
    const bossTitle = job.bossTitle || job.hrTitle || '';

    // JD 内容
    const jd = job.postDescription || job.jobDesc || job.description ||
               job.content || job.detail || '';

    // 技能标签
    const skills = job.skills || job.labels || job.tags || [];
    const requirements = Array.isArray(skills)
      ? skills.map(s => typeof s === 'string' ? s : s.name || s.tag || '').filter(Boolean)
      : [];

    const companyInfo = job.brandScaleName || job.companySize || '';
    const industry = job.brandIndustry || job.industry || '';
    const jobId = job.encryptJobId || job.jobId || job.id || '';

    return {
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
    btn.style.cssText = [
      'position: fixed', 'bottom: 24px', 'right: 24px', 'z-index: 999999',
      'padding: 10px 18px',
      'background: linear-gradient(135deg, #4FACFE 0%, #00F2FE 100%)',
      'color: #fff', 'border: none', 'border-radius: 24px',
      'font-size: 14px', 'font-weight: 600', 'cursor: pointer',
      'box-shadow: 0 4px 15px rgba(79, 172, 254, 0.4)',
      'transition: all 0.2s',
      'font-family: -apple-system, BlinkMacSystemFont, sans-serif',
    ].join(';');

    btn.addEventListener('mouseenter', () => { btn.style.transform = 'translateY(-2px)'; });
    btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
    btn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(() => {
        btn.textContent = '请点击扩展图标';
        setTimeout(() => { btn.textContent = 'BossSay'; }, 2000);
      });
    });

    document.body.appendChild(btn);
  }

  // ==================== 监听消息 ====================

  // 缓存结果
  let cachedJobInfo = null;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'EXTRACT_JOB_INFO') {
      // 如果已有缓存且 URL 没变，直接返回
      if (cachedJobInfo && cachedJobInfo.url === window.location.href) {
        safeResponse(sendResponse, { success: true, jobInfo: cachedJobInfo });
        return true;
      }

      // 异步获取
      (async () => {
        const debug = [];
        const jobId = getJobIdFromURL();
        debug.push('JobID:' + (jobId || '无'));

        // 方案1：调 API
        let jobInfo = null;
        try {
          jobInfo = await fetchJobFromAPI();
          if (jobInfo && jobInfo.title) {
            jobInfo.source = 'api';
            debug.push('API成功:' + jobInfo.title);
          } else {
            debug.push('API失败:无有效数据');
          }
        } catch (e) {
          debug.push('API异常:' + e.message);
        }

        if (!jobInfo || !jobInfo.title) {
          // 方案2：SSR 数据
          jobInfo = extractFromSSR();
          if (jobInfo && jobInfo.title) {
            jobInfo.source = 'ssr';
            debug.push('SSR成功:' + jobInfo.title);
          } else {
            debug.push('SSR失败');
            jobInfo = {
              id: hashStr(window.location.href),
              title: '', salary: '', location: '', company: '',
              bossName: '', bossTitle: '', jd: '', requirements: [],
              companyInfo: '', url: window.location.href, jdHash: '',
              source: 'none',
              debug: debug.join(' | '),
            };
          }
        }

        if (jobInfo) jobInfo.debug = debug.join(' | ');
        cachedJobInfo = jobInfo;
        safeResponse(sendResponse, { success: true, jobInfo });
      })();

      return true; // async
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
    console.log('[BossSay] Content Script v5 已加载，Job ID:', getJobIdFromURL());
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 500);
  } else {
    window.addEventListener('load', () => setTimeout(init, 500));
  }

  let lastUrl = location.href;
  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      cachedJobInfo = null;
      setTimeout(init, 1000);
    }
  });
  urlObserver.observe(document.body, { childList: true, subtree: true });

})();
