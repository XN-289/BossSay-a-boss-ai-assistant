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
    // 资料
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

  // ==================== 启动 ====================

  init();

})();
