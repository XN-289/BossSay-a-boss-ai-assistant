/**
 * BossSay - Popup 脚本 v2
 * 升级：备份/恢复、API 测试、风格自定义、历史记录
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
    jobMeta: $('job-meta'),
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
  };

  let currentJobInfo = null;

  // ==================== 标签切换 ====================

  els.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      els.tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      els.tabContents.forEach(c => c.classList.remove('active'));
      $(`tab-${tab.dataset.tab}`).classList.add('active');

      // 切换到"更多"时加载历史
      if (tab.dataset.tab === 'more') loadHistory();
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
      const resp = await chrome.runtime.sendMessage({ type: 'GET_PROFILE' });
      if (resp?.success) {
        const p = resp.profile;
        els.inputResume.value = p.bossSay_resume || '';
        els.inputExperience.value = p.bossSay_experience || '';
        els.inputSkills.value = p.bossSay_skills || '';
        els.inputGithub.value = p.bossSay_github || '';
        els.inputPortfolio.value = p.bossSay_portfolio || '';
        els.inputSelfIntro.value = p.bossSay_selfIntro || '';
      }
    } catch (e) {
      console.error('加载资料失败:', e);
    }
  }

  async function loadSettings() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_API_CONFIG' });
      if (resp?.success) {
        const c = resp.config;
        els.inputApiUrl.value = c.baseUrl || '';
        els.inputApiKey.value = c.apiKey || '';
        els.inputModel.value = c.modelName || '';
      }
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
      const isBoss = tab.url.includes('zhipin.com/job_detail') || tab.url.includes('zhipin.com/web/geek/job');
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

      if (resp?.success && resp.jobInfo) {
        currentJobInfo = resp.jobInfo;
        els.jobTitle.textContent = currentJobInfo.title || '未识别到职位名称';
        els.jobMeta.textContent = [currentJobInfo.company, currentJobInfo.salary, currentJobInfo.location].filter(Boolean).join(' · ');
        els.jobInfoCard.style.display = 'block';
        els.btnGenerate.style.display = 'flex';
        els.resultArea.style.display = 'none';
        showSuccess('✅ 岗位信息扫描成功');
      } else {
        showError('未能从当前页面提取岗位信息');
      }
    } catch (error) {
      showError('扫描失败：' + error.message + '。请刷新页面后重试。');
    } finally {
      els.btnExtract.disabled = false;
      els.btnExtract.innerHTML = '🔍 扫描当前页面岗位';
    }
  });

  // ==================== 生成消息 ====================

  els.btnGenerate.addEventListener('click', () => doGenerate());
  els.btnRegen.addEventListener('click', () => doGenerate());

  async function doGenerate() {
    if (!currentJobInfo) {
      showError('请先扫描岗位信息');
      return;
    }

    hideMessages();
    const style = els.styleSelect.value;
    chrome.storage.local.set({ bossSay_stylePreference: style });

    els.btnGenerate.disabled = true;
    els.btnGenerate.innerHTML = '<span class="loading"></span> AI 思考中...';

    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'GENERATE_MESSAGE',
        data: { jobInfo: currentJobInfo, style },
      });

      if (resp?.success) {
        els.messageOutput.value = resp.message;
        els.resultArea.style.display = 'block';
        showSuccess('✅ 消息生成成功');
      } else {
        showError(resp?.error || '生成失败，请重试');
      }
    } catch (error) {
      showError('请求失败：' + error.message);
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

  async function uploadPDF(file) {
    const statusEl = els.pdfUploadStatus;
    const statusIcon = statusEl.querySelector('.pdf-status-icon');
    const statusText = statusEl.querySelector('.pdf-status-text');

    // 清空上次日志
    clearDebugLog();

    // 显示解析中状态
    statusEl.style.display = 'flex';
    statusEl.className = 'pdf-upload-status loading';
    statusIcon.textContent = '⏳';
    statusText.textContent = `正在处理 ${file.name}...`;

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

      if (!rawText || rawText.trim().length < 10) {
        debugLog('⚠️ 文本过短，可能是扫描件（图片PDF）', 'err');
        throw new Error('PDF 中未提取到有效文本（仅 ' + textLen + ' 字符）。可能是扫描件/图片PDF，请使用文字版 PDF。');
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

      // 第四步：调用 AI（通过 service worker + 轮询）
      debugLog(`🤖 步骤4: 调用 AI (${config.modelName})...`, 'step');
      const textForAI = rawText.substring(0, 6000);
      debugLog(`发送给 AI 的文本长度: ${textForAI.length} 字符`, 'data');

      const parsePrompt = `你是一个简历解析助手。请分析以下 PDF 提取的简历原始文本，将其整理为结构化的简历信息。

请严格按照以下 JSON 格式返回（不要返回其他内容，只返回 JSON）：
{
  "summary": "简历摘要（包含姓名、学校、学历、求职意向等核心信息，2-3句话概括）",
  "experience": "工作经历和项目经历（按时间倒序，包含公司名、职位、时间段、主要工作内容）",
  "skills": "技能标签（用逗号分隔，如：React, Vue, Node.js, Python, MySQL）"
}

注意：
- summary 只放概括性描述，不要放完整工作经历
- experience 放具体的工作/项目经历详情
- skills 提取所有技术技能，用英文逗号分隔
- 如果信息不足，对应字段留空字符串

简历原始文本：
${textForAI}`;

      let aiMessage;
      try {
        // 直接从 popup fetch（有 host_permissions）
        debugLog('popup 直接 fetch API...', 'step');
        let apiUrl = config.baseUrl.trim();
        if (!apiUrl.endsWith('/')) apiUrl += '/';
        apiUrl += 'chat/completions';
        debugLog('URL: ' + apiUrl, 'data');

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + config.apiKey,
          },
          body: JSON.stringify({
            model: config.modelName,
            messages: [
              { role: 'system', content: '你是一个专业的简历解析助手，擅长从非结构化文本中提取结构化信息。只返回JSON，不要返回其他内容。' },
              { role: 'user', content: parsePrompt },
            ],
            temperature: 0.3,
            max_tokens: 2000,
          }),
        });

        debugLog('HTTP 状态: ' + response.status + ' ' + response.statusText, response.ok ? 'ok' : 'err');

        if (!response.ok) {
          const errBody = await response.text();
          debugLog('错误响应: ' + errBody.substring(0, 500), 'err');
          throw new Error('API 返回 ' + response.status + ': ' + errBody.substring(0, 200));
        }

        const data = await response.json();
        aiMessage = data.choices?.[0]?.message?.content?.trim();
        debugLog('AI 返回长度: ' + (aiMessage?.length || 0) + ' 字符', aiMessage ? 'ok' : 'err');
        debugLog('AI 原始返回(前500字): ' + (aiMessage || '').substring(0, 500), 'data');
      } catch (fetchErr) {
        // 详细记录错误信息
        debugLog('❌ fetch 异常类型: ' + fetchErr.constructor.name, 'err');
        debugLog('❌ 错误消息: ' + fetchErr.message, 'err');
        debugLog('❌ 错误名称: ' + fetchErr.name, 'err');

        if (fetchErr.message.includes('Failed to fetch') || fetchErr.message.includes('NetworkError')) {
          debugLog('⚠️ 可能原因: CORS 限制 / 网络不通 / SSL 错误', 'warn');
          debugLog('⚠️ 请检查: 1)网络是否正常 2)API URL 是否正确 3)是否需要代理', 'warn');
        }

        throw new Error('fetch 失败: ' + fetchErr.message);
      }

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

      // 显示成功状态
      statusEl.className = 'pdf-upload-status success';
      statusIcon.textContent = '✅';
      statusText.textContent = `✅ ${file.name} 解析成功，AI 已提取简历信息`;
      els.dividerOr.style.display = 'flex';

      debugLog('🎉 全部完成！信息已自动填入', 'ok');
      showSuccess('✅ PDF 简历已通过 AI 智能解析，信息已自动填入');

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
      bossSay_github: els.inputGithub.value.trim(),
      bossSay_portfolio: els.inputPortfolio.value.trim(),
      bossSay_selfIntro: els.inputSelfIntro.value.trim(),
    };

    if (!profile.bossSay_resume && !profile.bossSay_experience) {
      return showError('请至少填写简历或经历中的一项');
    }

    try {
      const resp = await chrome.runtime.sendMessage({ type: 'SAVE_PROFILE', data: profile });
      if (resp?.success) {
        els.profileSuccess.style.display = 'block';
        setTimeout(() => els.profileSuccess.style.display = 'none', 3000);
      }
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
      const resp = await chrome.runtime.sendMessage({ type: 'SAVE_API_CONFIG', data: config });
      if (resp?.success) {
        els.settingsSuccess.style.display = 'block';
        setTimeout(() => els.settingsSuccess.style.display = 'none', 3000);
      }
    } catch (e) {
      showError('保存失败：' + e.message);
    }
  });

  // ==================== API 连接测试 ====================

  els.btnTestApi.addEventListener('click', async () => {
    hideMessages();
    els.btnTestApi.disabled = true;
    els.btnTestApi.textContent = '⏳ 测试中...';

    try {
      const resp = await chrome.runtime.sendMessage({ type: 'TEST_API' });
      if (resp?.success) {
        els.settingsSuccess.textContent = `✅ 连接成功！模型响应: "${resp.reply}"`;
        els.settingsSuccess.style.display = 'block';
        setTimeout(() => {
          els.settingsSuccess.style.display = 'none';
          els.settingsSuccess.textContent = '✅ 设置已保存';
        }, 5000);
      } else {
        els.settingsError.textContent = '❌ ' + (resp.error || '连接失败');
        els.settingsError.style.display = 'block';
      }
    } catch (error) {
      els.settingsError.textContent = '❌ 请求失败: ' + error.message;
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

  // ==================== 历史记录 ====================

  async function loadHistory() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });
      const history = resp?.history || [];

      if (history.length === 0) {
        els.historyList.innerHTML = '<p class="help-text">暂无历史记录</p>';
        return;
      }

      els.historyList.innerHTML = history.slice(0, 20).map(item => `
        <div class="history-item">
          <div class="history-title">${item.jobTitle || '未知职位'} · ${item.company || ''}</div>
          <div class="history-msg">${(item.message || '').substring(0, 60)}...</div>
          <div class="history-time">${new Date(item.timestamp).toLocaleString()}</div>
        </div>
      `).join('');
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
