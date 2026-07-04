/**
 * BossSay - Popup 脚本 v2
 * 升级：备份/恢复、API 测试、风格自定义、历史记录、统计面板
 */

(function () {
  'use strict';

  // ==================== DOM 元素 ====================

  const $ = id => document.getElementById(id);

  const els = {
    // 标签
    tabs: document.querySelectorAll('.tab'),
    tabContents: document.querySelectorAll('.tab-content'),
    // 生成
    pageGuide: $('page-guide'),
    jobInfoCard: $('job-info-card'),
    jobTitle: $('job-title'),
    jobCompany: $('job-company'),
    jobSalary: $('job-salary'),
    jobLocation: $('job-location'),
    jdInput: $('jd-input'),
    matchScore: $('match-score'),
    matchScoreValue: $('match-score-value'),
    tracePanel: $('trace-panel'),
    traceBody: $('trace-body'),
    styleSelect: $('style-select'),
    btnExtract: $('btn-extract'),
    btnGenerate: $('btn-generate'),
    resultArea: $('result-area'),
    messageOutput: $('message-output'),
    btnFill: $('btn-fill'),
    btnCopy: $('btn-copy'),
    btnRegen: $('btn-regen'),
    errorMsg: $('error-msg'),
    successMsg: $('success-msg'),
    // 资料 - PDF 上传
    pdfDropArea: $('pdf-drop-area'),
    pdfFileInput: $('pdf-file-input'),
    pdfUploadStatus: $('pdf-upload-status'),
    dividerOr: $('divider-or'),
    debugLogPanel: $('debug-log-panel'),
    debugLogBody: $('debug-log-body'),
    debugLogClear: $('debug-log-clear'),
    // 资料 - 表单
    inputResume: $('input-resume'),
    inputExperience: $('input-experience'),
    inputSkills: $('input-skills'),
    inputEducation: $('input-education'),
    inputAvailableDate: $('input-available-date'),
    inputInternshipDuration: $('input-internship-duration'),
    inputJobType: $('input-job-type'),
    inputWantFulltime: $('input-want-fulltime'),
    inputGithub: $('input-github'),
    inputPortfolio: $('input-portfolio'),
    inputSelfIntro: $('input-selfintro'),
    btnSaveProfile: $('btn-save-profile'),
    profileSuccess: $('profile-success'),
    // 设置
    inputApiUrl: $('input-api-url'),
    inputApiKey: $('input-api-key'),
    inputModel: $('input-model'),
    btnSaveSettings: $('btn-save-settings'),
    btnTestApi: $('btn-test-api'),
    settingsSuccess: $('settings-success'),
    settingsError: $('settings-error'),
    styleEditor: $('style-editor'),
    btnSaveStyles: $('btn-save-styles'),
    // 更多
    btnExport: $('btn-export'),
    btnImport: $('btn-import'),
    cbExcludeKey: $('cb-exclude-key'),
    cbExcludeResume: $('cb-exclude-resume'),
    fileImport: $('file-import'),
    historyList: $('history-list'),
    btnClearHistory: $('btn-clear-history'),
    btnClearData: $('btn-clear-data'),
    // 统计面板
    statsPanel: $('stats-panel'),
  };

  let currentJobInfo = null;

  // ==================== 标签切换 ====================

  els.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      els.tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      els.tabContents.forEach(c => c.classList.remove('active'));
      $(`tab-${tab.dataset.tab}`).classList.add('active');

      // 切换到"更多"时加载历史和统计
      if (tab.dataset.tab === 'more') {
        loadHistory();
        loadStats();
      }
      // 切换到"设置"时加载风格配置
      if (tab.dataset.tab === 'settings') loadStyleEditor();
    });
  });

  // ==================== 初始化 ====================

  async function init() {
    await loadProfile();
    await loadSettings();
    await loadStylePreference();
    checkCurrentPage();
  }

  async function loadProfile() {
    try {
      const data = await chrome.storage.local.get('bossSay_profile');
      const p = data.bossSay_profile || {};
      els.inputResume.value = p.bossSay_resume || '';
      els.inputExperience.value = p.bossSay_experience || '';
      els.inputSkills.value = p.bossSay_skills || '';
      els.inputEducation.value = p.bossSay_education || '';
      els.inputAvailableDate.value = p.bossSay_availableDate || '';
      els.inputInternshipDuration.value = p.bossSay_internshipDuration || '';
      els.inputJobType.value = p.bossSay_jobType || '';
      els.inputWantFulltime.value = p.bossSay_wantFulltime || '';
      els.inputGithub.value = p.bossSay_github || '';
      els.inputPortfolio.value = p.bossSay_portfolio || '';
      els.inputSelfIntro.value = p.bossSay_selfIntro || '';
    } catch (e) {
      console.error('加载资料失败:', e);
    }
  }

  async function loadSettings() {
    try {
      const data = await chrome.storage.local.get('bossSay_apiConfig');
      const c = data.bossSay_apiConfig || {};
      els.inputApiUrl.value = c.baseUrl || '';
      els.inputApiKey.value = c.apiKey || '';
      els.inputModel.value = c.modelName || '';
    } catch (e) {
      console.error('加载设置失败:', e);
    }
  }

  async function loadStylePreference() {
    try {
      const data = await chrome.storage.local.get('bossSay_stylePreference');
      if (data.bossSay_stylePreference) {
        els.styleSelect.value = data.bossSay_stylePreference;
      }
    } catch (e) {}
  }

  async function checkCurrentPage() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) return;
      // FIX HIGH-6: 搜索页 URL 模式识别
      const isBoss = tab.url.includes('zhipin.com/job_detail')
        || tab.url.includes('zhipin.com/web/geek/job')
        || tab.url.includes('zhipin.com/geek/jobs')
        || tab.url.includes('zhipin.com/geek');
      if (isBoss) {
        els.pageGuide.style.display = 'none';
        els.btnExtract.style.display = 'flex';
      } else {
        els.pageGuide.innerHTML = `
          <p>⚠️ 当前页面不是 Boss 直聘岗位详情页</p>
          <p style="margin-top:8px;font-size:12px;color:#999">
            请打开 <a href="https://www.zhipin.com" target="_blank">zhipin.com</a> 并进入岗位详情页
          </p>
        `;
        els.btnExtract.style.display = 'none';
      }
    } catch (e) {}
  }

  // ==================== 扫描页面 ====================

  els.btnExtract.addEventListener('click', async () => {
    hideMessages();
    els.btnExtract.disabled = true;
    els.btnExtract.textContent = '🔍 扫描中...';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const resp = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_JOB_INFO' });

      if (!resp?.success) {
        showError(resp?.error || '未能从当前页面提取岗位信息');
        return;
      }

      if (resp.pageType === 'search') {
        const jobs = resp.jobs || [];
        if (jobs.length === 0) {
          showError('未找到符合条件的岗位');
          return;
        }
        currentJobInfo = jobs[0];
        fillJobFields(currentJobInfo);
        els.jobInfoCard.style.display = 'block';
        els.btnGenerate.style.display = 'flex';
        els.resultArea.style.display = 'none';
        showSuccess('✅ 搜索页扫描成功 | ' + jobs.length + ' 个岗位');
      } else if (resp.pageType === 'detail') {
        currentJobInfo = resp.jobInfo;
        fillJobFields(currentJobInfo);
        els.jobInfoCard.style.display = 'block';
        els.btnGenerate.style.display = 'flex';
        els.resultArea.style.display = 'none';

        const jdLen = currentJobInfo.jd ? currentJobInfo.jd.length : 0;
        if (jdLen > 20) {
          showSuccess('✅ 详情页扫描成功 | JD:' + jdLen + '字');
        } else {
          showSuccess('✅ 已提取基本信息，可手动补充 JD');
        }
      }
    } catch (error) {
      showError('扫描失败：' + error.message + '。请刷新页面后重试。');
    } finally {
      els.btnExtract.disabled = false;
      els.btnExtract.innerHTML = '🔍 扫描当前页面岗位';
    }
  });

  function fillJobFields(job) {
    els.jobTitle.value = job.title || '';
    els.jobCompany.value = job.company || '';
    els.jobSalary.value = job.salary || '';
    els.jobLocation.value = job.location || '';
    if (job.jd) els.jdInput.value = job.jd;
  }

  function readJobFields() {
    return {
      title: els.jobTitle.value.trim(),
      company: els.jobCompany.value.trim(),
      salary: els.jobSalary.value.trim(),
      location: els.jobLocation.value.trim(),
      jd: els.jdInput.value.trim(),
    };
  }

  // ==================== 生成消息 ====================

  els.btnGenerate.addEventListener('click', () => doGenerate());
  els.btnRegen.addEventListener('click', () => doGenerate());

  async function doGenerate() {
    // 从可编辑字段读取岗位信息
    const jobFields = readJobFields();
    if (!jobFields.title && !jobFields.jd) {
      showError('请先扫描岗位，或手动填写职位名称和 JD');
      return;
    }

    // 构造 jobInfo（优先用手动编辑的值，其次用扫描的值）
    const jobInfo = {
      ...currentJobInfo,
      ...jobFields,
    };

    hideMessages();
    const style = els.styleSelect.value;
    chrome.storage.local.set({ bossSay_stylePreference: style });

    els.btnGenerate.disabled = true;
    els.btnGenerate.innerHTML = '<span class="loading"></span> AI 思考中...';

    try {
      // 获取 API 配置
      const configResp = await chrome.runtime.sendMessage({ type: 'GET_API_CONFIG' });
      const apiConfig = configResp?.config;
      if (!apiConfig?.apiKey || !apiConfig?.baseUrl || !apiConfig?.modelName) {
        throw new Error('请先在设置页面配置 AI 模型');
      }

      // 获取求职者资料
      const profileResp = await chrome.runtime.sendMessage({ type: 'GET_PROFILE' });
      const profile = profileResp?.profile || {};

      // 获取用户自定义风格配置
      const styleResp = await chrome.storage.local.get('bossSay_stylePrompts');
      const stylePrompts = styleResp.bossSay_stylePrompts || {};

      // Map bossSay_ prefixed keys to unprefixed keys
      const mappedProfile = {
        resume: profile.bossSay_resume || '',
        experience: profile.bossSay_experience || '',
        skills: profile.bossSay_skills || '',
        education: profile.bossSay_education || '',
        availableDate: profile.bossSay_availableDate || '',
        internshipDuration: profile.bossSay_internshipDuration || '',
        jobType: profile.bossSay_jobType || '',
        wantFulltime: profile.bossSay_wantFulltime || '',
        github: profile.bossSay_github || '',
        portfolio: profile.bossSay_portfolio || '',
        selfIntro: profile.bossSay_selfIntro || '',
      };

      // FIX MED-3: Normalize URL to avoid double slashes
      let apiUrl = apiConfig.baseUrl.trim();
      apiUrl = apiUrl.replace(/\/+$/, '');
      // 自动补全 /v1 路径（如果用户没填）
      if (!apiUrl.endsWith('/v1') && !apiUrl.endsWith('/v1/') && !apiUrl.includes('/chat/completions')) {
        apiUrl += '/v1';
      }
      apiUrl += '/chat/completions';

      // API 调用函数
      const callAPI = async (messages) => {
        const requestBody = {
          model: apiConfig.modelName,
          messages: messages,
          temperature: 0.7,
          max_tokens: 2000,
        };

        // 方式1: popup 直接 fetch
        try {
          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + apiConfig.apiKey,
            },
            body: JSON.stringify(requestBody),
          });

          if (!response.ok) {
            const errText = await response.text();
            throw new Error('API ' + response.status + ': ' + errText.substring(0, 200));
          }

          const data = await response.json();
          const msg = data.choices?.[0]?.message;
          const content = (msg?.content || msg?.reasoning_content || '').trim();
          if (!content) throw new Error('AI 返回空内容');
          return content;
        } catch (fetchErr) {
          // 方式2: popup fetch 失败时走 service worker 代理
          if (fetchErr.message.includes('Failed to fetch') || fetchErr.message.includes('NetworkError')) {
            const resp = await chrome.runtime.sendMessage({
              type: 'AI_CHAT_COMPLETIONS',
              data: { url: apiUrl, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiConfig.apiKey }, body: requestBody },
            });
            if (!resp) throw new Error('插件后台无响应');
            if (!resp.success) throw new Error(resp.error || 'API 调用失败');
            return resp.content;
          }
          throw fetchErr;
        }
      };

      // FIX MED-8: Per-step progress callback
      const onProgress = (stepName, detail) => {
        const STEP_LABELS = {
          analyze_jd: '📋 分析岗位...',
          evaluate_fit: '📊 评估匹配度...',
          generate_draft: '✍️ 生成消息...',
          revise: '🔧 修正消息...',
        };
        els.btnGenerate.innerHTML = '<span class="loading"></span> ' + (STEP_LABELS[stepName] || detail || '处理中...');
      };

      // 执行 Agent 多步推理链
      const result = await BossAgent.run({
        profile: mappedProfile,
        jobInfo: jobInfo,
        style: style,
        callAPI: callAPI,
        stylePrompts: stylePrompts,
        onProgress: onProgress,
      });

      els.messageOutput.value = result.message;
      els.resultArea.style.display = 'block';

      // 显示匹配度
      if (result.matchScore !== undefined) {
        els.matchScoreValue.textContent = result.matchScore + '%';
        els.matchScore.style.display = 'flex';
      }

      // FIX HIGH-4: Safe trace length access
      const traceLen = (result.trace?.length || 0);

      // 显示推理链
      if (traceLen > 0) {
        renderTrace(result.trace);
        els.tracePanel.style.display = 'block';
      }

      showSuccess('✅ 消息生成成功（' + traceLen + ' 步推理）');

      // 记录评估数据（CRITICAL-6: 只用 BossEvaluate，不再单独发送 SAVE_HISTORY_ITEM）
      BossEvaluate.recordGeneration({
        jobTitle: jobInfo.title,
        company: jobInfo.company,
        style: style,
        message: result.message,
        matchScore: result.matchScore,
        trace: result.trace,
      });

    } catch (error) {
      showError('生成失败：' + error.message);
    } finally {
      els.btnGenerate.disabled = false;
      els.btnGenerate.innerHTML = '✨ AI 生成打招呼消息';
    }
  }

  // ==================== 填入/复制 ====================

  els.btnFill.addEventListener('click', async () => {
    const msg = els.messageOutput.value;
    if (!msg) return showError('没有可填入的消息');
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const resp = await chrome.tabs.sendMessage(tab.id, { type: 'FILL_MESSAGE', data: { message: msg } });
      if (resp?.success) {
        showSuccess('✅ 消息已填入输入框');
      } else {
        showError('未找到聊天输入框');
      }
    } catch (error) {
      showError('填入失败：' + error.message);
    }
  });

  els.btnCopy.addEventListener('click', async () => {
    const msg = els.messageOutput.value;
    if (!msg) return showError('没有可复制的消息');
    try {
      await navigator.clipboard.writeText(msg);
      showSuccess('✅ 已复制到剪贴板');
    } catch (e) {
      els.messageOutput.select();
      document.execCommand('copy');
      showSuccess('✅ 已复制到剪贴板');
    }
  });

  // ==================== PDF 简历上传 ====================

  // 点击上传区域
  els.pdfDropArea.addEventListener('click', () => {
    els.pdfFileInput.click();
  });

  // 拖拽上传
  els.pdfDropArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.pdfDropArea.classList.add('dragover');
  });

  els.pdfDropArea.addEventListener('dragleave', () => {
    els.pdfDropArea.classList.remove('dragover');
  });

  els.pdfDropArea.addEventListener('drop', (e) => {
    e.preventDefault();
    els.pdfDropArea.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
      uploadPDF(file);
    } else {
      showError('请上传 PDF 格式的文件');
    }
  });

  // 文件选择
  els.pdfFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) uploadPDF(file);
  });

  /**
   * 通用 AI API 调用函数
   * @param {object} config - { baseUrl, apiKey, modelName }
   * @param {object} requestBody - 完整的请求体
   * @returns {Promise<string>} AI 返回的文本内容
   */
  async function callAIAPI(config, requestBody) {
    debugLog('popup 直接 fetch API...', 'step');
    let apiUrl = config.baseUrl.trim().replace(/\/+$/, '');
    if (!apiUrl.endsWith('/v1') && !apiUrl.endsWith('/v1/') && !apiUrl.includes('/chat/completions')) {
      apiUrl += '/v1';
    }
    apiUrl += '/chat/completions';
    debugLog('URL: ' + apiUrl, 'data');

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + config.apiKey,
        },
        body: JSON.stringify(requestBody),
      });

      debugLog('HTTP 状态: ' + response.status + ' ' + response.statusText, response.ok ? 'ok' : 'err');

      if (!response.ok) {
        const errBody = await response.text();
        debugLog('错误响应: ' + errBody.substring(0, 500), 'err');
        throw new Error('API 返回 ' + response.status + ': ' + errBody.substring(0, 200));
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content?.trim();
      debugLog('AI 返回长度: ' + (content?.length || 0) + ' 字符', content ? 'ok' : 'err');
      debugLog('AI 原始返回(前500字): ' + (content || '').substring(0, 500), 'data');
      return content;
    } catch (fetchErr) {
      debugLog('❌ fetch 异常类型: ' + fetchErr.constructor.name, 'err');
      debugLog('❌ 错误消息: ' + fetchErr.message, 'err');
      debugLog('❌ 错误名称: ' + fetchErr.name, 'err');

      if (fetchErr.message.includes('Failed to fetch') || fetchErr.message.includes('NetworkError')) {
        debugLog('⚠️ 可能原因: CORS 限制 / 网络不通 / SSL 错误', 'warn');
        debugLog('⚠️ 请检查: 1)网络是否正常 2)API URL 是否正确 3)是否需要代理', 'warn');
      }

      throw new Error('fetch 失败: ' + fetchErr.message);
    }
  }

  async function uploadPDF(file) {
    const statusEl = els.pdfUploadStatus;
    const statusIcon = statusEl.querySelector('.pdf-status-icon');
    const statusText = statusEl.querySelector('.pdf-status-text');

    // 清空上次日志
    clearDebugLog();

    // 显示解析中状态
    statusEl.style.display = 'flex';
    statusEl.className = 'pdf-upload-status';
    statusIcon.innerHTML = '<span class="loading"></span>';
    statusText.textContent = '请等待...';

    debugLog(`📄 文件: ${file.name} (${(file.size/1024).toFixed(1)}KB)`, 'step');

    try {
      // 第一步：读取 PDF 文件
      debugLog('📖 步骤1: 读取 PDF 文件...', 'step');
      const arrayBuffer = await file.arrayBuffer();
      debugLog(`✅ ArrayBuffer 读取成功 (${arrayBuffer.byteLength} bytes)`, 'ok');

      // 第二步：提取文本
      debugLog('🔍 步骤2: 提取 PDF 文本...', 'step');
      debugLog('pdf.js 状态: ' + (typeof pdfjsLib !== 'undefined' ? '✅ 已加载' : '❌ 未加载'), typeof pdfjsLib !== 'undefined' ? 'ok' : 'warn');
      let rawText;
      try {
        rawText = await PDFExtractor.extractText(arrayBuffer);
      } catch (extractErr) {
        debugLog('❌ PDFExtractor 报错: ' + extractErr.message, 'err');
        throw new Error('PDF 文本提取失败: ' + extractErr.message);
      }

      const textLen = rawText?.length || 0;
      debugLog(`提取到文本长度: ${textLen} 字符`, textLen > 10 ? 'ok' : 'warn');

      if (textLen > 0) {
        debugLog('前200字: ' + rawText.substring(0, 200), 'data');
      }

      const isScannedPDF = !rawText || rawText.trim().length < 10;
      if (isScannedPDF) {
        debugLog('⚠️ 文本过短，检测为扫描件/图片PDF，将使用 AI 视觉识别', 'warn');
      }

      // 第三步：检查 AI 配置
      debugLog('⚙️ 步骤3: 检查 AI 配置...', 'step');
      const configResp = await chrome.runtime.sendMessage({ type: 'GET_API_CONFIG' });
      const config = configResp?.config;
      debugLog('API 响应: ' + JSON.stringify(configResp?.success), 'data');

      if (!config?.apiKey || !config?.baseUrl || !config?.modelName) {
        debugLog('❌ AI 配置不完整! apiKey=' + !!config?.apiKey + ' baseUrl=' + !!config?.baseUrl + ' model=' + config?.modelName, 'err');
        throw new Error('NO_API_CONFIG');
      }
      debugLog(`✅ 模型: ${config.modelName}`, 'ok');
      debugLog(`   URL: ${config.baseUrl}`, 'data');

      // 第四步：调用 AI
      debugLog(`🤖 步骤4: 调用 AI (${config.modelName})...`, 'step');

      let aiMessage;
      if (isScannedPDF) {
        // ===== 扫描件模式：渲染为图片 + AI 视觉识别 =====
        debugLog('🖼️ 扫描件模式: 渲染 PDF 页面为图片...', 'step');
        let pages;
        try {
          pages = await PDFExtractor.renderPagesAsImages(arrayBuffer);
          debugLog(`✅ 渲染了 ${pages.length} 页`, 'ok');
        } catch (renderErr) {
          debugLog('❌ 渲染失败: ' + renderErr.message, 'err');
          throw new Error('PDF 页面渲染失败: ' + renderErr.message);
        }

        // 构建图片消息
        const imageContent = pages.map((page, idx) => ({
          type: 'image_url',
          image_url: { url: page.dataUrl },
        }));

        const ocrPrompt = `你是一个简历 OCR 助手。请仔细识别这张简历图片中的所有文字内容，提取出完整的简历文本。

要求：
1. 识别图片中所有可见文字，包括姓名、联系方式、教育经历、工作经历、技能等
2. 保持原始排版结构，用换行分隔不同段落
3. 不要遗漏任何信息
4. 只返回识别到的纯文本，不要添加额外说明

请返回识别到的完整简历文本：`;

        const requestBody = {
          model: config.modelName,
          messages: [
            { role: 'system', content: '你是一个专业的 OCR 文字识别助手，擅长从图片中提取文字。只返回识别到的文字内容。' },
            { role: 'user', content: [...imageContent, { type: 'text', text: ocrPrompt }] },
          ],
          temperature: 0.3,
          max_tokens: 4000,
        };

        debugLog(`发送 ${pages.length} 张图片给 AI 做 OCR...`, 'step');
        aiMessage = await callAIAPI(config, requestBody);

        if (!aiMessage || aiMessage.trim().length < 10) {
          debugLog('❌ AI 视觉识别返回内容过短', 'err');
          throw new Error('AI 未能从图片中识别出有效文字，请确认模型支持图片输入（如 GPT-4o、Claude 等视觉模型）');
        }

        // OCR 识别出的文本再交给 AI 做结构化解析
        debugLog('📝 OCR 文本长度: ' + aiMessage.length + ' 字符，进行结构化解析...', 'step');
        rawText = aiMessage;
      }

      // ===== 结构化解析（文字版和扫描件共用） =====
      const textForAI = (rawText || '').substring(0, 6000);
      debugLog(`发送给 AI 的文本长度: ${textForAI.length} 字符`, 'data');

      const parsePrompt = `你是一个简历解析助手。请分析以下 PDF 提取的简历原始文本，将其整理为结构化的简历信息。

请严格按照以下 JSON 格式返回（不要返回其他内容，只返回 JSON）：
{
  "summary": "简历摘要（包含姓名、学校、学历、求职意向等核心信息，2-3句话概括）",
  "experience": "工作经历和项目经历（按时间倒序，包含公司名、职位、时间段、主要工作内容）",
  "skills": "技能标签（用逗号分隔，如：React, Vue, Node.js, Python, MySQL）",
  "education": "学校和学历信息（如：兰州大学 本科 计算机科学，2022-2026）",
  "availableDate": "到岗时间（如：随时到岗 / 7月15日后 / 一周内）",
  "internshipDuration": "可实习时长（如：可实习6个月 / 长期 / 仅暑假）",
  "jobType": "求职类型，只能是以下之一：实习、全职、都可",
  "wantFulltime": "转正意愿，只能是以下之一：希望转正、可以转正、暂不考虑、仅实习"
}

注意：
- summary 只放概括性描述，不要放完整工作经历
- experience 放具体的工作/项目经历详情
- skills 提取所有技术技能，用英文逗号分隔
- education 提取学校、学历、专业、入学/毕业年份
- availableDate 从简历中推断到岗时间，如果没写就留空
- internshipDuration 从简历中推断可实习时长，如果没写就留空
- jobType 必须是"实习"、"全职"或"都可"之一，如果无法判断就留空
- wantFulltime 必须是"希望转正"、"可以转正"、"暂不考虑"或"仅实习"之一，如果无法判断就留空
- 如果信息不足，对应字段留空字符串

简历原始文本：
${textForAI}`;

      // 发送文本给 AI 做结构化解析（文字版和扫描件共用）
      const parseRequestBody = {
        model: config.modelName,
        messages: [
          { role: 'system', content: '你是一个专业的简历解析助手，擅长从非结构化文本中提取结构化信息。只返回JSON，不要返回其他内容。' },
          { role: 'user', content: parsePrompt },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      };
      aiMessage = await callAIAPI(config, parseRequestBody);

      if (!aiMessage) {
        debugLog('❌ AI 返回空内容', 'err');
        throw new Error('AI 未能生成有效内容');
      }

      // 第五步：解析 JSON
      debugLog('📝 步骤5: 解析 JSON...', 'step');
      let parsed;
      try {
        const jsonMatch = aiMessage.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
          debugLog('✅ JSON 解析成功', 'ok');
          debugLog('summary=' + (parsed.summary?.substring(0, 80) || '空') + '...', 'data');
          debugLog('experience=' + (parsed.experience?.substring(0, 80) || '空') + '...', 'data');
          debugLog('skills=' + (parsed.skills || '空'), 'data');
          debugLog('education=' + (parsed.education || '空'), 'data');
          debugLog('到岗=' + (parsed.availableDate || '空') + ' 实习时长=' + (parsed.internshipDuration || '空'), 'data');
          debugLog('求职类型=' + (parsed.jobType || '空') + ' 转正=' + (parsed.wantFulltime || '空'), 'data');
        } else {
          debugLog('❌ 无法匹配 JSON，AI 返回: ' + aiMessage.substring(0, 200), 'err');
          throw new Error('无法从 AI 返回中提取 JSON');
        }
      } catch (parseErr) {
        debugLog('❌ JSON.parse 失败: ' + parseErr.message, 'err');
        throw new Error('AI 返回格式异常，请重试。如果反复失败，请换一个模型试试。');
      }

      // 第六步：填充表单
      debugLog('📋 步骤6: 填充表单...', 'step');
      if (parsed.summary) els.inputResume.value = parsed.summary;
      if (parsed.experience) els.inputExperience.value = parsed.experience;
      if (parsed.skills) els.inputSkills.value = parsed.skills;
      if (parsed.education) els.inputEducation.value = parsed.education;
      if (parsed.availableDate) els.inputAvailableDate.value = parsed.availableDate;
      if (parsed.internshipDuration) els.inputInternshipDuration.value = parsed.internshipDuration;
      if (parsed.jobType) els.inputJobType.value = parsed.jobType;
      if (parsed.wantFulltime) els.inputWantFulltime.value = parsed.wantFulltime;

      // 显示成功状态
      statusEl.className = 'pdf-upload-status success';
      statusIcon.textContent = '✅';
      if (isScannedPDF) {
        statusText.textContent = `✅ ${file.name} 扫描件识别成功，AI 已提取简历信息`;
        showSuccess('✅ 扫描件 PDF 已通过 AI 视觉识别 + 智能解析，信息已自动填入');
      } else {
        statusText.textContent = `✅ ${file.name} 解析成功，AI 已提取简历信息`;
        showSuccess('✅ PDF 简历已通过 AI 智能解析，信息已自动填入');
      }
      els.dividerOr.style.display = 'flex';

      debugLog('🎉 全部完成！信息已自动填入', 'ok');

    } catch (err) {
      debugLog('💥 错误: ' + err.message, 'err');
      statusEl.className = 'pdf-upload-status error';
      statusIcon.textContent = '❌';

      if (err.message === 'NO_API_CONFIG') {
        statusText.innerHTML = `❌ 需要先配置 AI 模型<br>
          <span class="pdf-status-help">
            请先在 <strong>⚙️ 设置</strong> 页面配置 API 地址和 API Key
          </span>`;
      } else {
        statusText.textContent = '❌ ' + err.message;
      }
    }
  }

  // ==================== 保存资料 ====================

  els.btnSaveProfile.addEventListener('click', async () => {
    const profile = {
      bossSay_resume: els.inputResume.value.trim(),
      bossSay_experience: els.inputExperience.value.trim(),
      bossSay_skills: els.inputSkills.value.trim(),
      bossSay_education: els.inputEducation.value.trim(),
      bossSay_availableDate: els.inputAvailableDate.value.trim(),
      bossSay_internshipDuration: els.inputInternshipDuration.value.trim(),
      bossSay_jobType: els.inputJobType.value,
      bossSay_wantFulltime: els.inputWantFulltime.value,
      bossSay_github: els.inputGithub.value.trim(),
      bossSay_portfolio: els.inputPortfolio.value.trim(),
      bossSay_selfIntro: els.inputSelfIntro.value.trim(),
    };

    if (!profile.bossSay_resume && !profile.bossSay_experience) {
      return showError('请至少填写简历或经历中的一项');
    }

    try {
      await chrome.storage.local.set({ bossSay_profile: profile });
      els.profileSuccess.style.display = 'block';
      setTimeout(() => els.profileSuccess.style.display = 'none', 3000);
    } catch (e) {
      showError('保存失败：' + e.message);
    }
  });

  // ==================== 保存设置 ====================

  els.btnSaveSettings.addEventListener('click', async () => {
    const config = {
      baseUrl: els.inputApiUrl.value.trim(),
      apiKey: els.inputApiKey.value.trim(),
      modelName: els.inputModel.value.trim(),
    };

    if (!config.apiKey || !config.baseUrl || !config.modelName) {
      return showError('请填写完整的 API 配置');
    }

    if (!config.baseUrl.endsWith('/')) config.baseUrl += '/';

    try {
      await chrome.storage.local.set({ bossSay_apiConfig: config });
      els.settingsSuccess.style.display = 'block';
      setTimeout(() => els.settingsSuccess.style.display = 'none', 3000);
    } catch (e) {
      showError('保存失败：' + e.message);
    }
  });

  // ==================== API 连接测试 ====================
  // FIX CRITICAL-4: Use service worker proxy instead of direct fetch

  els.btnTestApi.addEventListener('click', async () => {
    hideMessages();
    els.btnTestApi.disabled = true;
    els.btnTestApi.textContent = '⏳ 测试中...';

    try {
      const config = {
        baseUrl: els.inputApiUrl.value.trim(),
        apiKey: els.inputApiKey.value.trim(),
        modelName: els.inputModel.value.trim(),
      };
      if (!config.apiKey || !config.baseUrl || !config.modelName) {
        throw new Error('请先填写完整的 API 配置');
      }

      // Normalize URL with auto /v1
      let url = config.baseUrl.trim().replace(/\/+$/, '');
      if (!url.endsWith('/v1') && !url.endsWith('/v1/') && !url.includes('/chat/completions')) {
        url += '/v1';
      }
      url += '/chat/completions';

      // FIX CRITICAL-4: Go through service worker proxy
      const resp = await chrome.runtime.sendMessage({
        type: 'AI_CHAT_COMPLETIONS',
        data: {
          url: url,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + config.apiKey,
          },
          body: {
            model: config.modelName,
            messages: [{ role: 'user', content: 'Hi' }],
            max_tokens: 10,
          },
        },
      });

      if (!resp.success) throw new Error(resp.error);
      const reply = resp.content || '(无回复)';
      els.settingsSuccess.textContent = '✅ 连接成功！模型响应: "' + reply + '"';
      els.settingsSuccess.style.display = 'block';
      setTimeout(() => {
        els.settingsSuccess.style.display = 'none';
        els.settingsSuccess.textContent = '✅ 设置已保存';
      }, 5000);
    } catch (error) {
      els.settingsError.textContent = '❌ ' + error.message;
      els.settingsError.style.display = 'block';
    } finally {
      els.btnTestApi.disabled = false;
      els.btnTestApi.textContent = '🔗 测试连接';
    }
  });

  // ==================== 预设模型 ====================

  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      els.inputApiUrl.value = btn.dataset.url;
      els.inputModel.value = btn.dataset.model;
    });
  });

  // ==================== 风格自定义 ====================

  async function loadStyleEditor() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_STYLE_PROMPTS' });
      const prompts = resp?.prompts || {};

      els.styleEditor.innerHTML = '';
      for (const [key, config] of Object.entries(prompts)) {
        const div = document.createElement('div');
        div.className = 'form-group';
        div.innerHTML = `
          <label>${config.name}</label>
          <input type="text" class="style-name-input" data-key="${key}" value="${config.name}" placeholder="风格名称">
          <textarea class="style-prompt-input" data-key="${key}" rows="3" placeholder="风格描述...">${config.prompt}</textarea>
        `;
        els.styleEditor.appendChild(div);
      }
    } catch (e) {
      console.error('加载风格配置失败:', e);
    }
  }

  els.btnSaveStyles.addEventListener('click', async () => {
    const nameInputs = document.querySelectorAll('.style-name-input');
    const promptInputs = document.querySelectorAll('.style-prompt-input');

    const prompts = {};
    nameInputs.forEach(input => {
      const key = input.dataset.key;
      prompts[key] = prompts[key] || {};
      prompts[key].name = input.value;
    });
    promptInputs.forEach(input => {
      const key = input.dataset.key;
      prompts[key] = prompts[key] || {};
      prompts[key].prompt = input.value;
    });

    try {
      const resp = await chrome.runtime.sendMessage({ type: 'SAVE_STYLE_PROMPTS', data: prompts });
      if (resp?.success) {
        showSuccess('✅ 风格配置已保存');
      }
    } catch (e) {
      showError('保存失败：' + e.message);
    }
  });

  // ==================== 备份/恢复 ====================

  els.btnExport.addEventListener('click', async () => {
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'EXPORT_SETTINGS',
        data: {
          excludeApiKey: els.cbExcludeKey.checked,
          excludeResume: els.cbExcludeResume.checked,
        },
      });

      if (resp?.success) {
        const blob = new Blob([resp.data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bosssay-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showSuccess('✅ 设置已导出');
      }
    } catch (e) {
      showError('导出失败：' + e.message);
    }
  });

  els.btnImport.addEventListener('click', () => {
    els.fileImport.click();
  });

  els.fileImport.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const resp = await chrome.runtime.sendMessage({
          type: 'IMPORT_SETTINGS',
          data: event.target.result,
        });

        if (resp?.success) {
          showSuccess('✅ 设置已导入，正在刷新...');
          setTimeout(() => window.location.reload(), 1500);
        } else {
          showError(resp.message || '导入失败');
        }
      } catch (err) {
        showError('导入失败：' + err.message);
      }
    };
    reader.readAsText(file);
  });

  // ==================== 统计面板 (CRITICAL-7) ====================

  async function loadStats() {
    if (!els.statsPanel) return;

    try {
      const stats = await BossEvaluate.getStats();

      let html = `
        <div class="stats-summary">
          <div class="stats-row">
            <div class="stats-item">
              <span class="stats-number">${stats.total}</span>
              <span class="stats-label">总记录</span>
            </div>
            <div class="stats-item">
              <span class="stats-number">${stats.sent}</span>
              <span class="stats-label">已发送</span>
            </div>
            <div class="stats-item">
              <span class="stats-number">${stats.replied}</span>
              <span class="stats-label">已回复</span>
            </div>
            <div class="stats-item">
              <span class="stats-number">${stats.replyRate}%</span>
              <span class="stats-label">回复率</span>
            </div>
          </div>
        </div>
      `;

      // 按风格统计
      const styleNames = {
        professional: '专业正式',
        friendly: '热情亲切',
        humor: '幽默轻松',
        concise: '简洁明了',
      };

      if (Object.keys(stats.byStyle).length > 0) {
        html += '<div class="stats-section"><h4>按风格统计</h4>';
        for (const [style, data] of Object.entries(stats.byStyle)) {
          html += `
            <div class="stats-style-row">
              <span class="stats-style-name">${styleNames[style] || style}</span>
              <span class="stats-style-detail">发送 ${data.sent} / 回复 ${data.replied} / 回复率 ${data.replyRate}%</span>
            </div>
          `;
        }
        html += '</div>';
      }

      // 按匹配度统计
      const matchLabels = { high: '高匹配 (70%+)', mid: '中匹配 (40-70%)', low: '低匹配 (<40%)' };
      if (stats.byMatchScore) {
        html += '<div class="stats-section"><h4>按匹配度统计</h4>';
        for (const [group, data] of Object.entries(stats.byMatchScore)) {
          const rate = data.sent > 0 ? Math.round((data.replied / data.sent) * 100) : 0;
          html += `
            <div class="stats-style-row">
              <span class="stats-style-name">${matchLabels[group] || group}</span>
              <span class="stats-style-detail">发送 ${data.sent} / 回复 ${data.replied} / 回复率 ${rate}%</span>
            </div>
          `;
        }
        html += '</div>';
      }

      els.statsPanel.innerHTML = html;
    } catch (e) {
      console.error('加载统计失败:', e);
      els.statsPanel.innerHTML = '<p class="help-text">暂无统计数据</p>';
    }
  }

  // ==================== 历史记录 ====================

  async function loadHistory() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });
      const history = resp?.history || [];

      if (history.length === 0) {
        els.historyList.textContent = '暂无历史记录';
        return;
      }

      els.historyList.textContent = '';
      history.slice(0, 20).forEach(item => {
        const div = document.createElement('div');
        div.className = 'history-item';

        const title = document.createElement('div');
        title.className = 'history-title';
        title.textContent = (item.jobTitle || '未知职位') + ' · ' + (item.company || '');

        const msg = document.createElement('div');
        msg.className = 'history-msg';
        msg.textContent = (item.message || '').substring(0, 60) + '...';

        const time = document.createElement('div');
        time.className = 'history-time';
        time.textContent = new Date(item.timestamp).toLocaleString();

        // CRITICAL-7: Sent/Replied toggle buttons
        const actions = document.createElement('div');
        actions.className = 'history-actions';

        const btnSent = document.createElement('button');
        btnSent.className = 'btn-small ' + (item.sent ? 'btn-sent-active' : 'btn-sent');
        btnSent.textContent = item.sent ? '✅ 已发送' : '📤 标记发送';
        btnSent.addEventListener('click', async (e) => {
          e.stopPropagation();
          await BossEvaluate.markSent(item.id);
          loadHistory();
          loadStats();
        });

        const btnReplied = document.createElement('button');
        btnReplied.className = 'btn-small ' + (item.replied === true ? 'btn-replied-active' : 'btn-replied');
        btnReplied.textContent = item.replied === true ? '💬 已回复' : '💬 标记回复';
        btnReplied.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (item.replied === true) {
            await BossEvaluate.markReplied(item.id, null);
          } else {
            await BossEvaluate.markReplied(item.id, true);
          }
          loadHistory();
          loadStats();
        });

        actions.append(btnSent, btnReplied);
        div.append(title, msg, time, actions);
        els.historyList.appendChild(div);
      });
    } catch (e) {
      console.error('加载历史失败:', e);
    }
  }

  els.btnClearHistory.addEventListener('click', async () => {
    if (!confirm('确定清空历史记录？')) return;
    try {
      await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
      els.historyList.innerHTML = '<p class="help-text">暂无历史记录</p>';
    } catch (e) {}
  });

  // ==================== 清除数据 ====================

  els.btnClearData.addEventListener('click', async () => {
    if (!confirm('确定要清除所有数据吗？此操作不可撤销。')) return;
    try {
      await chrome.storage.local.clear();
      window.location.reload();
    } catch (e) {
      showError('清除失败：' + e.message);
    }
  });

  // ==================== 工具函数 ====================

  function renderTrace(trace) {
    const STEP_NAMES = {
      analyze_jd: '📋 分析 JD',
      match_resume: '🔗 匹配简历',
      evaluate_fit: '📊 评估匹配度',
      generate_draft: '✍️ 生成消息',
      review: '🔍 自我审查',
      revise: '🔧 修正消息',
    };

    els.traceBody.textContent = '';
    for (const step of trace) {
      const div = document.createElement('div');
      div.className = 'trace-step';

      const name = document.createElement('div');
      name.className = 'trace-step-name';
      name.textContent = STEP_NAMES[step.step] || step.step;

      const detail = document.createElement('div');
      detail.className = 'trace-step-detail';

      if (step.step === 'analyze_jd' && step.result) {
        detail.textContent = '核心要求: ' + (step.result.coreRequirements || []).join(', ') +
          '\n关键技能: ' + (step.result.keySkills || []).join(', ');
      } else if (step.step === 'match_resume' && step.result) {
        detail.textContent = '匹配技能: ' + (step.result.matchedSkills || []).join(', ') +
          '\n匹配经历: ' + (step.result.matchedExperience || []).join(', ') +
          '\n匹配度: ' + Math.round((step.result.matchRatio || 0) * 100) + '%';
      } else if (step.step === 'evaluate_fit' && step.result) {
        detail.textContent = '分数: ' + (step.result.score || 0) + '分' +
          '\n策略: ' + (step.result.strategy || '');
      } else if (step.step === 'generate_draft') {
        detail.textContent = step.success ? '✅ 生成成功' : '❌ ' + (step.error || '失败');
      } else if (step.step === 'review' && step.result) {
        const issues = step.result.issues || [];
        detail.textContent = '评分: ' + (step.result.score || 0) + '分' +
          '\n问题: ' + (issues.length > 0 ? issues.join('; ') : '无') +
          '\n编造检测: ' + (step.result.hasFabrication ? '⚠️ 有编造' : '✅ 无编造');
      } else if (step.step === 'revise') {
        detail.textContent = step.success ? '✅ 已修正' : '⚠️ 修正失败';
      } else {
        detail.textContent = step.success ? '✅ 完成' : '❌ ' + (step.error || '失败');
      }

      div.append(name, detail);
      els.traceBody.appendChild(div);
    }
  }

  function showError(msg) {
    els.errorMsg.textContent = '❌ ' + msg;
    els.errorMsg.style.display = 'block';
    els.successMsg.style.display = 'none';
    setTimeout(() => els.errorMsg.style.display = 'none', 5000);
  }

  function showSuccess(msg) {
    els.successMsg.textContent = msg;
    els.successMsg.style.display = 'block';
    els.errorMsg.style.display = 'none';
    setTimeout(() => els.successMsg.style.display = 'none', 3000);
  }

  function hideMessages() {
    els.errorMsg.style.display = 'none';
    els.successMsg.style.display = 'none';
  }

  // ==================== 调试日志面板 ====================

  function debugLog(text, type = 'step') {
    if (!els.debugLogPanel || !els.debugLogBody) return;
    els.debugLogPanel.style.display = 'block';
    const line = document.createElement('div');
    line.className = 'log-' + type;
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    line.textContent = `[${time}] ${text}`;
    els.debugLogBody.appendChild(line);
    els.debugLogBody.scrollTop = els.debugLogBody.scrollHeight;
  }

  function clearDebugLog() {
    if (els.debugLogBody) els.debugLogBody.innerHTML = '';
  }

  if (els.debugLogClear) {
    els.debugLogClear.addEventListener('click', clearDebugLog);
  }

  // ==================== 启动 ====================

  init();

})();
