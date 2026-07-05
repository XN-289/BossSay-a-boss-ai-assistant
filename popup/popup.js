/**
 * BossSay - Popup 脚本 v3.0
 * 全面增强版：Agent 仪表盘、记忆面板、智能推荐、批量模式、快捷键、错误恢复等
 *
 * 主要模块：
 *   1. Agent 仪表盘 - 实时状态、步骤进度、计时
 *   2. 记忆面板 - 公司知识、学习模式、记忆洞察
 *   3. 智能推荐 - 基于记忆的最佳风格/策略建议
 *   4. 富推理链 - 可交互的推理过程可视化
 *   5. 批量模式 - 为多个扫描岗位批量生成消息
 *   6. 快捷操作 - 扫描+生成+填入一步到位
 *   7. 洞察卡片 - AI 生成的策略洞察
 *   8. 目标追踪 - 用户目标进度展示
 *   9. 自适应 UI - 根据页面类型调整界面
 *   10. 错误恢复 - 更友好的错误处理与诊断
 */

(function () {
  'use strict';

  // ==================== 常量定义 ====================

  /** Agent 状态枚举 */
  const AGENT_STATE = {
    IDLE: 'idle',
    PLANNING: 'planning',
    EXECUTING: 'executing',
    REFLECTING: 'reflecting',
    DONE: 'done',
    ERROR: 'error',
  };

  /** 页面类型枚举 */
  const PAGE_TYPE = {
    SEARCH: 'search',
    DETAIL: 'detail',
    CHAT: 'chat',
    OTHER: 'other',
  };

  /** 风格中文名称映射 */
  const STYLE_NAMES = {
    professional: '专业正式',
    friendly: '热情亲切',
    humor: '幽默轻松',
    concise: '简洁明了',
  };

  /** 推理步骤中文名称 */
  const STEP_LABELS = {
    analyze_jd: '分析岗位 + 匹配简历',
    match_resume: '匹配简历',
    evaluate_fit: '评估匹配度',
    generate_draft: '生成消息',
    review: '自我审查',
    revise: '修正消息',
  };

  /** 错误类型与建议映射 */
  const ERROR_SUGGESTIONS = {
    'Failed to fetch': { title: '网络连接失败', suggestion: '请检查网络连接，或确认 API 地址是否正确。如果是 CORS 问题，插件会自动切换到后台代理模式。' },
    'NetworkError': { title: '网络错误', suggestion: '无法连接到 API 服务器，请检查网络设置。' },
    'NO_API_CONFIG': { title: '未配置 AI 模型', suggestion: '请先在「设置」页面配置 API 地址、API Key 和模型名称。' },
    '超时': { title: '请求超时', suggestion: 'API 响应时间过长，可能是模型负载高。请稍后重试，或换一个更快的模型。' },
    '401': { title: '认证失败', suggestion: 'API Key 无效或已过期，请在设置中重新配置。' },
    '429': { title: '请求过于频繁', suggestion: '已达到 API 速率限制，请稍等片刻后重试。' },
    '500': { title: '服务器错误', suggestion: 'API 服务端出错，请稍后重试。' },
  };

  // ==================== DOM 元素缓存 ====================

  const $ = id => document.getElementById(id);

  const els = {
    // 标签导航
    tabs: document.querySelectorAll('.tab'),
    tabContents: document.querySelectorAll('.tab-content'),
    // 生成页面
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
    // 资料页面 - PDF 上传
    pdfDropArea: $('pdf-drop-area'),
    pdfFileInput: $('pdf-file-input'),
    pdfUploadStatus: $('pdf-upload-status'),
    dividerOr: $('divider-or'),
    debugLogPanel: $('debug-log-panel'),
    debugLogBody: $('debug-log-body'),
    debugLogClear: $('debug-log-clear'),
    // 资料页面 - 表单
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
    // 设置页面
    inputApiUrl: $('input-api-url'),
    inputApiKey: $('input-api-key'),
    inputModel: $('input-model'),
    btnSaveSettings: $('btn-save-settings'),
    btnTestApi: $('btn-test-api'),
    settingsSuccess: $('settings-success'),
    settingsError: $('settings-error'),
    styleEditor: $('style-editor'),
    btnSaveStyles: $('btn-save-styles'),
    // 更多页面
    btnExport: $('btn-export'),
    btnImport: $('btn-import'),
    cbExcludeKey: $('cb-exclude-key'),
    cbExcludeResume: $('cb-exclude-resume'),
    fileImport: $('file-import'),
    historyList: $('history-list'),
    btnClearHistory: $('btn-clear-history'),
    btnClearData: $('btn-clear-data'),
    statsPanel: $('stats-panel'),
  };

  // ==================== 应用状态 ====================

  /** 当前扫描到的岗位信息 */
  let currentJobInfo = null;

  /** 当前页面类型 */
  let currentPageType = PAGE_TYPE.OTHER;

  /** Agent 当前状态 */
  let agentState = AGENT_STATE.IDLE;

  /** 批量模式：已扫描的岗位列表 */
  let batchJobs = [];

  /** 批量模式：当前处理索引 */
  let batchIndex = -1;

  /** 记忆数据缓存 */
  let memoryCache = {
    companyHistory: {},   // 公司 -> 历史数据
    bestStyles: {},       // 公司 -> 最佳风格
    patterns: [],         // 学习到的模式
    goals: [],            // 用户目标
  };

  /** 上下文洞察缓存 */
  let contextInsights = [];

  /** 步骤计时器 */
  let stepTimers = {};

  // ==================== Agent 事件系统 ====================

  /**
   * 简易事件总线 - 用于 Agent 状态变更通知 UI 更新
   * 支持的事件类型：
   *   agent:stateChange  - Agent 状态变化
   *   agent:stepStart    - 步骤开始
   *   agent:stepEnd      - 步骤结束
   *   agent:progress     - 进度更新
   *   agent:error        - 错误发生
   *   memory:updated     - 记忆更新
   *   insight:new        - 新洞察
   */
  const EventBus = {
    _listeners: {},

    /** 注册事件监听 */
    on(event, callback) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(callback);
    },

    /** 触发事件 */
    emit(event, data) {
      const listeners = this._listeners[event] || [];
      listeners.forEach(cb => {
        try { cb(data); } catch (e) { console.error('[EventBus] 回调执行出错:', e); }
      });
    },

    /** 移除监听 */
    off(event, callback) {
      if (!this._listeners[event]) return;
      this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
    },
  };

  // ==================== Agent 仪表盘 UI ====================

  /**
   * 更新 Agent 仪表盘状态显示
   * 在生成按钮下方展示当前 Agent 的工作状态
   */
  function updateAgentDashboard(state, detail) {
    agentState = state;

    // 查找或创建仪表盘容器
    let dashboard = $('agent-dashboard');
    if (!dashboard) {
      dashboard = document.createElement('div');
      dashboard.id = 'agent-dashboard';
      dashboard.className = 'agent-dashboard';
      els.btnGenerate.parentNode.insertBefore(dashboard, els.btnGenerate.nextSibling);
    }

    // 状态图标映射
    const stateIcons = {
      [AGENT_STATE.IDLE]: '',
      [AGENT_STATE.PLANNING]: '🧠',
      [AGENT_STATE.EXECUTING]: '⚡',
      [AGENT_STATE.REFLECTING]: '🔍',
      [AGENT_STATE.DONE]: '✅',
      [AGENT_STATE.ERROR]: '❌',
    };

    const stateLabels = {
      [AGENT_STATE.IDLE]: '',
      [AGENT_STATE.PLANNING]: '规划中',
      [AGENT_STATE.EXECUTING]: '执行中',
      [AGENT_STATE.REFLECTING]: '反思中',
      [AGENT_STATE.DONE]: '完成',
      [AGENT_STATE.ERROR]: '出错',
    };

    // 空闲状态隐藏仪表盘
    if (state === AGENT_STATE.IDLE) {
      dashboard.style.display = 'none';
      return;
    }

    dashboard.style.display = 'block';

    // 计算已用时间
    const elapsed = stepTimers._start ? Math.round((Date.now() - stepTimers._start) / 1000) : 0;

    dashboard.innerHTML = `
      <div class="dashboard-header">
        <span class="dashboard-state-icon">${stateIcons[state] || ''}</span>
        <span class="dashboard-state-label">${stateLabels[state] || state}</span>
        <span class="dashboard-timer">${elapsed > 0 ? elapsed + 's' : ''}</span>
      </div>
      ${detail ? `<div class="dashboard-detail">${detail}</div>` : ''}
      ${renderStepProgress()}
    `;
  }

  /**
   * 渲染步骤进度条
   * 显示 Agent 各步骤的完成状态和耗时
   */
  function renderStepProgress() {
    const steps = ['analyze_jd', 'match_resume', 'evaluate_fit', 'generate_draft', 'review', 'revise'];
    const currentIdx = steps.indexOf(stepTimers._currentStep || '');

    if (currentIdx < 0 && agentState !== AGENT_STATE.DONE) return '';

    const stepsHtml = steps.map((step, idx) => {
      const isCompleted = stepTimers[step + '_done'] === true;
      const isCurrent = step === stepTimers._currentStep;
      const isSkipped = step === 'revise' && agentState === AGENT_STATE.DONE && !stepTimers['revise_done'];
      const duration = stepTimers[step + '_duration'] || 0;

      let cls = 'step-item';
      if (isCompleted) cls += ' completed';
      else if (isCurrent) cls += ' active';
      else if (isSkipped) cls += ' skipped';

      return `
        <div class="${cls}">
          <span class="step-dot">${isCompleted ? '✓' : isSkipped ? '–' : isCurrent ? '●' : '○'}</span>
          <span class="step-name">${STEP_LABELS[step] || step}</span>
          ${duration > 0 ? `<span class="step-duration">${duration}ms</span>` : ''}
        </div>
      `;
    }).join('');

    return `<div class="step-progress">${stepsHtml}</div>`;
  }

  /**
   * 标记步骤开始
   */
  function markStepStart(stepName) {
    stepTimers._currentStep = stepName;
    stepTimers[stepName + '_start'] = Date.now();
  }

  /**
   * 标记步骤完成
   */
  function markStepEnd(stepName) {
    stepTimers[stepName + '_done'] = true;
    const start = stepTimers[stepName + '_start'] || Date.now();
    stepTimers[stepName + '_duration'] = Date.now() - start;
  }

  // ==================== 记忆系统 ====================

  /**
   * 加载记忆数据
   * 从历史记录中提取公司知识和学习模式
   */
  async function loadMemory() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });
      const history = resp?.history || [];

      // 按公司聚合历史数据
      const companyMap = {};
      for (const item of history) {
        const company = item.company || '未知';
        if (!companyMap[company]) {
          companyMap[company] = {
            count: 0,
            styles: {},
            replied: 0,
            sent: 0,
            titles: [],
          };
        }
        const c = companyMap[company];
        c.count++;
        if (item.sent) c.sent++;
        if (item.replied === true) c.replied++;
        // 记录该公司的风格使用和回复率
        if (!c.styles[item.style]) c.styles[item.style] = { sent: 0, replied: 0 };
        if (item.sent) c.styles[item.style].sent++;
        if (item.replied === true) c.styles[item.style].replied++;
        if (item.jobTitle && !c.titles.includes(item.jobTitle)) {
          c.titles.push(item.jobTitle);
          if (c.titles.length > 5) c.titles.shift(); // 只保留最近5个
        }
      }

      // 计算每个公司的最佳风格
      const bestStyles = {};
      for (const [company, data] of Object.entries(companyMap)) {
        let best = null;
        let bestRate = -1;
        for (const [style, sdata] of Object.entries(data.styles)) {
          if (sdata.sent >= 2) {
            const rate = sdata.replied / sdata.sent;
            if (rate > bestRate) {
              bestRate = rate;
              best = style;
            }
          }
        }
        if (best) {
          bestStyles[company] = { style: best, rate: Math.round(bestRate * 100) };
        }
      }

      // 提取学习模式（高频使用且有效的风格）
      const patterns = [];
      for (const [company, bs] of Object.entries(bestStyles)) {
        if (bs.rate > 30) {
          patterns.push({
            company: company,
            bestStyle: bs.style,
            replyRate: bs.rate,
          });
        }
      }

      // 加载用户目标
      const goalData = await chrome.storage.local.get('bossSay_goals');
      const goals = goalData.bossSay_goals || [];

      memoryCache = {
        companyHistory: companyMap,
        bestStyles: bestStyles,
        patterns: patterns,
        goals: goals,
      };

      EventBus.emit('memory:updated', memoryCache);
    } catch (e) {
      console.error('[Memory] 加载记忆失败:', e);
    }
  }

  /**
   * 获取当前公司的智能推荐
   * @param {string} company - 公司名称
   * @returns {Object|null} 推荐信息
   */
  function getSmartRecommendation(company) {
    if (!company) return null;

    const bestStyle = memoryCache.bestStyles[company];
    const history = memoryCache.companyHistory[company];

    if (!history || history.count < 2) return null;

    const recommendation = {
      company: company,
      hasHistory: true,
      totalContacted: history.count,
      sent: history.sent,
      replied: history.replied,
      overallReplyRate: history.sent > 0 ? Math.round((history.replied / history.sent) * 100) : 0,
      bestStyle: bestStyle,
      pastTitles: history.titles,
    };

    return recommendation;
  }

  /**
   * 生成上下文洞察卡片数据
   * 基于当前岗位和历史记忆生成策略建议
   */
  function generateInsights(jobInfo) {
    const insights = [];

    if (!jobInfo) return insights;

    // 洞察1：公司历史推荐
    const rec = getSmartRecommendation(jobInfo.company);
    if (rec && rec.bestStyle) {
      const styleName = STYLE_NAMES[rec.bestStyle.style] || rec.bestStyle.style;
      insights.push({
        type: 'recommendation',
        icon: '💡',
        title: `${rec.company} 最佳风格`,
        body: `「${styleName}」在该公司回复率为 ${rec.bestStyle.rate}%（共联系 ${rec.totalContacted} 次）`,
        action: { label: '使用该风格', style: rec.bestStyle.style },
      });
    }

    // 洞察2：匹配度分析
    if (rec && rec.overallReplyRate > 0) {
      insights.push({
        type: 'stat',
        icon: '📊',
        title: `${rec.company} 历史回复率`,
        body: `已发送 ${rec.sent} 条，回复 ${rec.replied} 条，回复率 ${rec.overallReplyRate}%`,
      });
    }

    // 洞察3：全局最佳风格
    let globalBest = null;
    let globalBestRate = -1;
    for (const p of memoryCache.patterns) {
      if (p.replyRate > globalBestRate) {
        globalBestRate = p.replyRate;
        globalBest = p;
      }
    }
    if (globalBest && globalBest.replyRate > 40) {
      insights.push({
        type: 'global',
        icon: '🌟',
        title: '全局最佳风格',
        body: `「${STYLE_NAMES[globalBest.bestStyle] || globalBest.bestStyle}」在你历史数据中回复率最高（${globalBest.replyRate}%）`,
      });
    }

    // 洞察4：目标进度
    if (memoryCache.goals.length > 0) {
      const activeGoal = memoryCache.goals.find(g => g.active !== false);
      if (activeGoal) {
        const progress = activeGoal.current || 0;
        const target = activeGoal.target || 10;
        const pct = Math.round((progress / target) * 100);
        insights.push({
          type: 'goal',
          icon: '🎯',
          title: `目标：${activeGoal.name || '求职进度'}`,
          body: `已完成 ${progress}/${target}（${pct}%）`,
          progress: pct,
        });
      }
    }

    contextInsights = insights;
    return insights;
  }

  /**
   * 渲染洞察卡片
   */
  function renderInsightCards(insights) {
    let container = $('insight-cards');
    if (!container) {
      container = document.createElement('div');
      container.id = 'insight-cards';
      container.className = 'insight-cards';
      // 插入到风格选择器之后
      const styleGroup = els.styleSelect.closest('.form-group');
      if (styleGroup) {
        styleGroup.parentNode.insertBefore(container, styleGroup.nextSibling);
      }
    }

    if (!insights || insights.length === 0) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'block';
    container.innerHTML = insights.map(insight => {
      let actionHtml = '';
      if (insight.action) {
        actionHtml = `<button class="insight-action" data-action="apply-style" data-style="${insight.action.style}">${insight.action.label}</button>`;
      }
      let progressHtml = '';
      if (insight.progress !== undefined) {
        progressHtml = `
          <div class="insight-progress-bar">
            <div class="insight-progress-fill" style="width:${insight.progress}%"></div>
          </div>
        `;
      }
      return `
        <div class="insight-card insight-${insight.type}">
          <div class="insight-header">
            <span class="insight-icon">${insight.icon}</span>
            <span class="insight-title">${insight.title}</span>
          </div>
          <div class="insight-body">${insight.body}</div>
          ${progressHtml}
          ${actionHtml}
        </div>
      `;
    }).join('');

    // 绑定洞察卡片中的操作按钮
    container.querySelectorAll('.insight-action[data-action="apply-style"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const style = btn.dataset.style;
        if (style) {
          els.styleSelect.value = style;
          chrome.storage.local.set({ bossSay_stylePreference: style });
          showSuccess('已切换到推荐风格：' + (STYLE_NAMES[style] || style));
        }
      });
    });
  }

  // ==================== 记忆面板 ====================

  /**
   * 渲染记忆面板内容
   * 展示公司知识库、学习模式、目标追踪
   */
  function renderMemoryPanel() {
    const panel = $('memory-panel');
    if (!panel) return;

    const { companyHistory, bestStyles, patterns, goals } = memoryCache;
    const companies = Object.entries(companyHistory);

    let html = '';

    // --- 公司知识库 ---
    html += '<div class="memory-section">';
    html += '<h4 class="memory-section-title">📚 公司知识库</h4>';

    if (companies.length === 0) {
      html += '<p class="memory-empty">暂无历史数据，开始使用后会自动积累</p>';
    } else {
      // 按联系次数排序，显示前10个
      const sorted = companies.sort((a, b) => b[1].count - a[1].count).slice(0, 10);
      html += '<div class="memory-company-list">';
      for (const [company, data] of sorted) {
        const bs = bestStyles[company];
        const replyRate = data.sent > 0 ? Math.round((data.replied / data.sent) * 100) : 0;
        const bestStyleName = bs ? (STYLE_NAMES[bs.style] || bs.style) : '—';
        html += `
          <div class="memory-company-item">
            <div class="memory-company-name">${company}</div>
            <div class="memory-company-stats">
              联系 ${data.count} 次 · 发送 ${data.sent} · 回复率 ${replyRate}% · 最佳风格：${bestStyleName}
            </div>
            ${data.titles.length > 0 ? `<div class="memory-company-titles">岗位：${data.titles.join('、')}</div>` : ''}
          </div>
        `;
      }
      html += '</div>';
    }
    html += '</div>';

    // --- 学习模式 ---
    html += '<div class="memory-section">';
    html += '<h4 class="memory-section-title">🧩 学习模式</h4>';
    if (patterns.length === 0) {
      html += '<p class="memory-empty">数据积累中，需要更多历史记录才能发现模式</p>';
    } else {
      html += '<div class="memory-patterns">';
      for (const p of patterns.slice(0, 5)) {
        html += `
          <div class="memory-pattern-item">
            <span class="pattern-company">${p.company}</span>
            <span class="pattern-arrow">→</span>
            <span class="pattern-style">${STYLE_NAMES[p.bestStyle] || p.bestStyle}</span>
            <span class="pattern-rate">${p.replyRate}% 回复率</span>
          </div>
        `;
      }
      html += '</div>';
    }
    html += '</div>';

    // --- 目标追踪 ---
    html += '<div class="memory-section">';
    html += '<h4 class="memory-section-title">🎯 目标追踪</h4>';
    if (goals.length === 0) {
      html += '<p class="memory-empty">暂无设定目标</p>';
      html += '<button class="btn btn-secondary btn-sm" id="btn-add-goal">+ 添加目标</button>';
    } else {
      for (const goal of goals) {
        const progress = goal.current || 0;
        const target = goal.target || 10;
        const pct = Math.min(100, Math.round((progress / target) * 100));
        html += `
          <div class="memory-goal-item">
            <div class="goal-header">
              <span class="goal-name">${goal.name || '求职目标'}</span>
              <span class="goal-progress-text">${progress}/${target}</span>
            </div>
            <div class="goal-progress-bar">
              <div class="goal-progress-fill" style="width:${pct}%"></div>
            </div>
            <div class="goal-meta">${pct}% 完成 · ${goal.type === 'daily' ? '每日目标' : '总体目标'}</div>
          </div>
        `;
      }
    }
    html += '</div>';

    panel.innerHTML = html;

    // 绑定添加目标按钮
    const addGoalBtn = panel.querySelector('#btn-add-goal');
    if (addGoalBtn) {
      addGoalBtn.addEventListener('click', showGoalDialog);
    }
  }

  /**
   * 显示添加目标对话框（简单的 prompt 方式）
   */
  function showGoalDialog() {
    const name = prompt('目标名称（如：本周投递）：');
    if (!name) return;
    const target = parseInt(prompt('目标数量（如：20）：'), 10);
    if (!target || target < 1) return;

    const goal = {
      id: Date.now().toString(36),
      name: name,
      target: target,
      current: 0,
      type: 'total',
      active: true,
      createdAt: Date.now(),
    };

    memoryCache.goals.push(goal);
    chrome.storage.local.set({ bossSay_goals: memoryCache.goals });
    renderMemoryPanel();
    showSuccess('目标已添加：' + name);
  }

  /**
   * 更新目标进度
   */
  function updateGoalProgress() {
    if (!memoryCache.goals || memoryCache.goals.length === 0) return;
    for (const goal of memoryCache.goals) {
      if (goal.active !== false) {
        goal.current = (goal.current || 0) + 1;
      }
    }
    chrome.storage.local.set({ bossSay_goals: memoryCache.goals });
  }

  // ==================== 标签切换 ====================

  els.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // 切换标签样式
      els.tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      els.tabContents.forEach(c => c.classList.remove('active'));
      const targetContent = $(`tab-${tab.dataset.tab}`);
      if (targetContent) targetContent.classList.add('active');

      // 按需加载对应标签的数据
      const tabName = tab.dataset.tab;
      if (tabName === 'more') {
        loadHistory();
        loadStats();
      }
      if (tabName === 'settings') {
        loadStyleEditor();
      }
      if (tabName === 'memory') {
        loadMemory().then(() => renderMemoryPanel());
      }
    });
  });

  // ==================== 键盘快捷键 ====================

  /**
   * 注册并处理键盘快捷键
   * Ctrl+Enter: 快速生成
   * Ctrl+Shift+S: 扫描+生成一步到位
   * Ctrl+C (在结果区): 复制消息
   */
  document.addEventListener('keydown', (e) => {
    // Ctrl+Enter: 快速生成消息
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      if (currentJobInfo && !els.btnGenerate.disabled) {
        doGenerate();
      }
    }

    // Ctrl+Shift+S: 快捷操作（扫描+生成）
    if (e.ctrlKey && e.shiftKey && e.key === 'S') {
      e.preventDefault();
      doQuickAction();
    }

    // Escape: 关闭错误/成功消息
    if (e.key === 'Escape') {
      hideMessages();
    }
  });

  // ==================== 快捷操作 ====================

  /**
   * 一键快捷操作：扫描 + 生成 + 填入
   * 将多个步骤合并为一个流畅的操作
   */
  async function doQuickAction() {
    // 如果还没有扫描过，先扫描
    if (!currentJobInfo) {
      showSuccess('正在扫描页面...');
      await doExtract();
      if (!currentJobInfo) {
        showError('未能扫描到岗位信息，请先打开 Boss 直聘页面');
        return;
      }
    }

    // 生成消息
    await doGenerate();
  }

  // ==================== 初始化 ====================

  /**
   * 主初始化函数
   * 按顺序加载所有数据并初始化 UI
   */
  async function init() {
    await loadProfile();
    await loadSettings();
    await loadStylePreference();
    await checkCurrentPage();
    await loadMemory();

    // 初始化事件监听
    initEventListeners();

    // 初始化自适应 UI
    adaptUI();
  }

  /**
   * 注册全局事件监听（非 DOM 事件）
   */
  function initEventListeners() {
    // Agent 状态变化事件
    EventBus.on('agent:stateChange', (data) => {
      updateAgentDashboard(data.state, data.detail);
    });

    // Agent 步骤开始事件
    EventBus.on('agent:stepStart', (data) => {
      markStepStart(data.step);
      updateAgentDashboard(agentState, STEP_LABELS[data.step] || data.step);
    });

    // Agent 步骤结束事件
    EventBus.on('agent:stepEnd', (data) => {
      markStepEnd(data.step);
    });

    // 记忆更新事件
    EventBus.on('memory:updated', () => {
      // 如果当前有岗位信息，刷新洞察
      if (currentJobInfo) {
        const insights = generateInsights(currentJobInfo);
        renderInsightCards(insights);
      }
    });
  }

  // ==================== 自适应 UI ====================

  /**
   * 根据当前页面类型调整 UI 显示
   * 搜索页：显示批量模式入口
   * 详情页：显示单个生成
   * 聊天页：显示快速填入
   */
  function adaptUI() {
    // 隐藏所有模式特定的 UI
    const batchBtn = $('btn-batch-mode');
    const quickBtn = $('btn-quick-action');

    if (currentPageType === PAGE_TYPE.SEARCH) {
      // 搜索页：显示批量模式按钮
      if (batchBtn) batchBtn.style.display = 'flex';
      if (quickBtn) quickBtn.style.display = 'none';
    } else if (currentPageType === PAGE_TYPE.DETAIL) {
      // 详情页：显示快捷操作按钮
      if (batchBtn) batchBtn.style.display = 'none';
      if (quickBtn) quickBtn.style.display = 'flex';
    } else {
      if (batchBtn) batchBtn.style.display = 'none';
      if (quickBtn) quickBtn.style.display = 'none';
    }
  }

  // ==================== 加载资料 ====================

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

  // ==================== 加载设置 ====================

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

  // ==================== 加载风格偏好 ====================

  async function loadStylePreference() {
    try {
      const data = await chrome.storage.local.get('bossSay_stylePreference');
      if (data.bossSay_stylePreference) {
        els.styleSelect.value = data.bossSay_stylePreference;
      }
    } catch (e) {
      // 忽略
    }
  }

  // ==================== 检测当前页面 ====================

  /**
   * 检测当前标签页是否为 Boss 直聘页面
   * 根据 URL 判断页面类型并更新 UI
   */
  async function checkCurrentPage() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) return;

      const url = tab.url;
      const isSearch = url.includes('zhipin.com/geek/jobs') || url.includes('zhipin.com/web/geek/job');
      const isDetail = url.includes('zhipin.com/job_detail') || url.includes('zhipin.com/web/geek/job');
      const isChat = url.includes('zhipin.com/chat');
      const isBoss = isSearch || isDetail || isChat || url.includes('zhipin.com/geek');

      if (isSearch) {
        currentPageType = PAGE_TYPE.SEARCH;
      } else if (isDetail) {
        currentPageType = PAGE_TYPE.DETAIL;
      } else if (isChat) {
        currentPageType = PAGE_TYPE.CHAT;
      } else {
        currentPageType = PAGE_TYPE.OTHER;
      }

      if (isBoss) {
        els.pageGuide.style.display = 'none';
        els.btnExtract.style.display = 'flex';
      } else {
        els.pageGuide.innerHTML = `
          <p>当前页面不是 Boss 直聘岗位详情页</p>
          <p style="margin-top:8px;font-size:12px;color:#999">
            请打开 <a href="https://www.zhipin.com" target="_blank">zhipin.com</a> 并进入岗位详情页
          </p>
          <p style="margin-top:4px;font-size:11px;color:#bbb">快捷键：Ctrl+Shift+S 扫描+生成</p>
        `;
        els.btnExtract.style.display = 'none';
      }

      adaptUI();
    } catch (e) {
      // 忽略
    }
  }

  // ==================== 扫描页面 ====================

  els.btnExtract.addEventListener('click', () => doExtract());

  /**
   * 执行页面扫描
   * 从当前页面提取岗位信息，支持搜索页批量扫描和详情页单个扫描
   */
  async function doExtract() {
    hideMessages();
    els.btnExtract.disabled = true;
    els.btnExtract.textContent = '扫描中...';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const resp = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_JOB_INFO' });

      if (!resp?.success) {
        showError(resp?.error || '未能从当前页面提取岗位信息');
        return;
      }

      if (resp.pageType === 'search') {
        // 搜索页：批量扫描结果
        const jobs = resp.jobs || [];
        if (jobs.length === 0) {
          showError('未找到符合条件的岗位');
          return;
        }

        // 保存批量数据
        batchJobs = jobs;
        currentJobInfo = jobs[0];
        fillJobFields(currentJobInfo);
        els.jobInfoCard.style.display = 'block';
        els.btnGenerate.style.display = 'flex';
        els.resultArea.style.display = 'none';

        showSuccess(`搜索页扫描成功 | ${jobs.length} 个岗位`);

        // 生成洞察
        const insights = generateInsights(currentJobInfo);
        renderInsightCards(insights);

      } else if (resp.pageType === 'detail') {
        // 详情页：单个岗位
        batchJobs = [];
        currentJobInfo = resp.jobInfo;
        fillJobFields(currentJobInfo);
        els.jobInfoCard.style.display = 'block';
        els.btnGenerate.style.display = 'flex';
        els.resultArea.style.display = 'none';

        const jdLen = currentJobInfo.jd ? currentJobInfo.jd.length : 0;
        if (jdLen > 20) {
          showSuccess(`详情页扫描成功 | JD: ${jdLen} 字`);
        } else {
          showSuccess('已提取基本信息，可手动补充 JD');
        }

        // 生成洞察
        const insights = generateInsights(currentJobInfo);
        renderInsightCards(insights);
      }
    } catch (error) {
      showError('扫描失败：' + error.message + '。请刷新页面后重试。');
    } finally {
      els.btnExtract.disabled = false;
      els.btnExtract.innerHTML = '🔍 扫描当前页面岗位';
    }
  }

  /**
   * 将岗位信息填入表单字段
   */
  function fillJobFields(job) {
    els.jobTitle.value = job.title || '';
    els.jobCompany.value = job.company || '';
    els.jobSalary.value = job.salary || '';
    els.jobLocation.value = job.location || '';
    if (job.jd) els.jdInput.value = job.jd;
  }

  /**
   * 从表单字段读取岗位信息
   */
  function readJobFields() {
    return {
      title: els.jobTitle.value.trim(),
      company: els.jobCompany.value.trim(),
      salary: els.jobSalary.value.trim(),
      location: els.jobLocation.value.trim(),
      jd: els.jdInput.value.trim(),
    };
  }

  // ==================== 批量模式 ====================

  /**
   * 批量生成消息
   * 为搜索页扫描到的所有岗位依次生成消息
   */
  async function doBatchGenerate() {
    if (batchJobs.length === 0) {
      showError('请先在搜索页扫描多个岗位');
      return;
    }

    hideMessages();

    // 创建批量结果容器
    let batchContainer = $('batch-results');
    if (!batchContainer) {
      batchContainer = document.createElement('div');
      batchContainer.id = 'batch-results';
      batchContainer.className = 'batch-results';
      els.resultArea.parentNode.insertBefore(batchContainer, els.resultArea);
    }

    batchContainer.style.display = 'block';
    batchContainer.innerHTML = `
      <div class="batch-header">
        <span class="batch-title">批量生成</span>
        <span class="batch-progress">0/${batchJobs.length}</span>
      </div>
      <div class="batch-list"></div>
    `;

    const batchList = batchContainer.querySelector('.batch-list');
    const progressEl = batchContainer.querySelector('.batch-progress');
    const style = els.styleSelect.value;

    // 禁用按钮
    els.btnGenerate.disabled = true;

    let completed = 0;
    let succeeded = 0;

    for (let i = 0; i < batchJobs.length; i++) {
      batchIndex = i;
      const job = batchJobs[i];

      // 更新进度
      progressEl.textContent = `${i + 1}/${batchJobs.length}`;

      // 为每个岗位创建结果项
      const itemEl = document.createElement('div');
      itemEl.className = 'batch-item batch-loading';
      itemEl.innerHTML = `
        <div class="batch-item-header">
          <span class="batch-item-title">${job.title || '未知职位'}</span>
          <span class="batch-item-company">${job.company || ''}</span>
        </div>
        <div class="batch-item-status">生成中...</div>
      `;
      batchList.appendChild(itemEl);

      try {
        // 构造岗位信息
        const jobInfo = { ...job };

        // 调用 Agent 生成
        const result = await doGenerateForJob(jobInfo, style);

        // 更新 UI
        itemEl.className = 'batch-item batch-success';
        itemEl.querySelector('.batch-item-status').innerHTML = `
          <span class="batch-status-success">生成成功</span>
          <div class="batch-item-msg">${result.message}</div>
          <div class="batch-item-actions">
            <button class="btn-small btn-sent" data-index="${i}" data-msg="${encodeURIComponent(result.message)}">填入</button>
            <button class="btn-small btn-replied" data-index="${i}" data-msg="${encodeURIComponent(result.message)}">复制</button>
          </div>
        `;
        succeeded++;
      } catch (error) {
        itemEl.className = 'batch-item batch-error';
        itemEl.querySelector('.batch-item-status').textContent = '失败：' + error.message;
      }

      completed++;
    }

    // 恢复按钮
    els.btnGenerate.disabled = false;
    batchIndex = -1;

    // 绑定批量结果的操作按钮
    batchList.querySelectorAll('.btn-sent').forEach(btn => {
      btn.addEventListener('click', async () => {
        const msg = decodeURIComponent(btn.dataset.msg);
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          await chrome.tabs.sendMessage(tab.id, { type: 'FILL_MESSAGE', data: { message: msg } });
          showSuccess('消息已填入');
        } catch (e) {
          showError('填入失败');
        }
      });
    });

    batchList.querySelectorAll('.btn-replied').forEach(btn => {
      btn.addEventListener('click', async () => {
        const msg = decodeURIComponent(btn.dataset.msg);
        try {
          await navigator.clipboard.writeText(msg);
          showSuccess('已复制到剪贴板');
        } catch (e) {
          showError('复制失败');
        }
      });
    });

    showSuccess(`批量完成：${succeeded}/${batchJobs.length} 个岗位生成成功`);
  }

  /**
   * 为单个岗位生成消息（内部函数，供批量模式和单个模式共用）
   * @param {Object} jobInfo - 岗位信息
   * @param {string} style - 消息风格
   * @returns {Object} { message, trace, matchScore }
   */
  async function doGenerateForJob(jobInfo, style) {
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

    // 映射 bossSay_ 前缀的键到无前缀的键
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

    // 构建 API URL
    let apiUrl = apiConfig.baseUrl.trim().replace(/\/+$/, '');
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
        // 方式2: 失败时走 service worker 代理
        if (fetchErr.message.includes('Failed to fetch') || fetchErr.message.includes('NetworkError')) {
          const resp = await chrome.runtime.sendMessage({
            type: 'AI_CHAT_COMPLETIONS',
            data: {
              url: apiUrl,
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiConfig.apiKey },
              body: requestBody,
            },
          });
          if (!resp) throw new Error('插件后台无响应');
          if (!resp.success) throw new Error(resp.error || 'API 调用失败');
          return resp.content;
        }
        throw fetchErr;
      }
    };

    // 进度回调
    const onProgress = (stepName) => {
      EventBus.emit('agent:stepStart', { step: stepName });
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

    return result;
  }

  // ==================== 生成消息 ====================

  els.btnGenerate.addEventListener('click', () => doGenerate());
  els.btnRegen.addEventListener('click', () => doGenerate());

  /**
   * 执行消息生成主流程
   * 调用 BossAgent 进行多步推理链，实时更新 UI
   */
  async function doGenerate() {
    // 从可编辑字段读取岗位信息
    const jobFields = readJobFields();
    if (!jobFields.title && !jobFields.jd) {
      showError('请先扫描岗位，或手动填写职位名称和 JD');
      return;
    }

    // 构造 jobInfo（优先用手动编辑的值）
    const jobInfo = { ...currentJobInfo, ...jobFields };

    hideMessages();
    const style = els.styleSelect.value;
    chrome.storage.local.set({ bossSay_stylePreference: style });

    // 初始化 Agent 状态
    stepTimers = { _start: Date.now() };
    EventBus.emit('agent:stateChange', { state: AGENT_STATE.PLANNING, detail: '准备分析岗位...' });

    els.btnGenerate.disabled = true;
    els.btnGenerate.innerHTML = '<span class="loading"></span> AI 思考中...';

    try {
      // 获取 API 配置
      const configResp = await chrome.runtime.sendMessage({ type: 'GET_API_CONFIG' });
      const apiConfig = configResp?.config;
      if (!apiConfig?.apiKey || !apiConfig?.baseUrl || !apiConfig?.modelName) {
        throw new Error('NO_API_CONFIG');
      }

      // 获取求职者资料
      const profileResp = await chrome.runtime.sendMessage({ type: 'GET_PROFILE' });
      const profile = profileResp?.profile || {};

      // 获取用户自定义风格配置
      const styleResp = await chrome.storage.local.get('bossSay_stylePrompts');
      const stylePrompts = styleResp.bossSay_stylePrompts || {};

      // 映射 bossSay_ 前缀的键
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

      // 构建 API URL
      let apiUrl = apiConfig.baseUrl.trim().replace(/\/+$/, '');
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
          // 方式2: 失败时走 service worker 代理
          if (fetchErr.message.includes('Failed to fetch') || fetchErr.message.includes('NetworkError')) {
            const resp = await chrome.runtime.sendMessage({
              type: 'AI_CHAT_COMPLETIONS',
              data: {
                url: apiUrl,
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiConfig.apiKey },
                body: requestBody,
              },
            });
            if (!resp) throw new Error('插件后台无响应');
            if (!resp.success) throw new Error(resp.error || 'API 调用失败');
            return resp.content;
          }
          throw fetchErr;
        }
      };

      // Agent 进度回调
      const onProgress = (stepName, detail) => {
        EventBus.emit('agent:stepStart', { step: stepName });

        const STEP_BUTTON_LABELS = {
          analyze_jd: '分析岗位...',
          evaluate_fit: '评估匹配度...',
          generate_draft: '生成消息...',
          revise: '修正消息...',
        };
        els.btnGenerate.innerHTML = '<span class="loading"></span> ' + (STEP_BUTTON_LABELS[stepName] || detail || '处理中...');
      };

      // 切换到执行状态
      EventBus.emit('agent:stateChange', { state: AGENT_STATE.EXECUTING, detail: 'Agent 正在执行推理链...' });

      // 执行 Agent 多步推理链
      const result = await BossAgent.run({
        profile: mappedProfile,
        jobInfo: jobInfo,
        style: style,
        callAPI: callAPI,
        stylePrompts: stylePrompts,
        onProgress: onProgress,
      });

      // 切换到反思状态
      EventBus.emit('agent:stateChange', { state: AGENT_STATE.REFLECTING, detail: '审查生成结果...' });

      // 显示结果
      els.messageOutput.value = result.message;
      els.resultArea.style.display = 'block';

      // 显示匹配度
      if (result.matchScore !== undefined) {
        els.matchScoreValue.textContent = result.matchScore + '%';
        els.matchScore.style.display = 'flex';
      }

      // 安全获取 trace 长度
      const traceLen = (result.trace?.length || 0);

      // 渲染富推理链
      if (traceLen > 0) {
        renderTrace(result.trace);
        els.tracePanel.style.display = 'block';
      }

      // 标记完成
      EventBus.emit('agent:stateChange', { state: AGENT_STATE.DONE, detail: `完成（${traceLen} 步推理）` });
      EventBus.emit('agent:stepEnd', { step: 'done' });

      showSuccess(`消息生成成功（${traceLen} 步推理）`);

      // 记录评估数据
      BossEvaluate.recordGeneration({
        jobTitle: jobInfo.title,
        company: jobInfo.company,
        style: style,
        message: result.message,
        matchScore: result.matchScore,
        trace: result.trace,
      });

      // 更新目标进度
      updateGoalProgress();

      // 更新记忆
      await loadMemory();

    } catch (error) {
      EventBus.emit('agent:stateChange', { state: AGENT_STATE.ERROR, detail: error.message });
      showEnhancedError(error.message);
    } finally {
      els.btnGenerate.disabled = false;
      els.btnGenerate.innerHTML = '✨ AI 生成打招呼消息';
      // 3秒后重置仪表盘为空闲
      setTimeout(() => {
        updateAgentDashboard(AGENT_STATE.IDLE);
      }, 5000);
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
        showSuccess('消息已填入输入框');
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
      showSuccess('已复制到剪贴板');
    } catch (e) {
      els.messageOutput.select();
      document.execCommand('copy');
      showSuccess('已复制到剪贴板');
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
   * @param {Object} config - { baseUrl, apiKey, modelName }
   * @param {Object} requestBody - 完整请求体
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
      debugLog('fetch 异常类型: ' + fetchErr.constructor.name, 'err');
      debugLog('错误消息: ' + fetchErr.message, 'err');

      if (fetchErr.message.includes('Failed to fetch') || fetchErr.message.includes('NetworkError')) {
        debugLog('可能原因: CORS 限制 / 网络不通 / SSL 错误', 'warn');
      }

      throw new Error('fetch 失败: ' + fetchErr.message);
    }
  }

  /**
   * 上传并解析 PDF 简历
   * 支持文字版 PDF 和扫描件（需视觉模型）
   */
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

    debugLog(`文件: ${file.name} (${(file.size / 1024).toFixed(1)}KB)`, 'step');

    try {
      // 第一步：读取 PDF 文件
      debugLog('步骤1: 读取 PDF 文件...', 'step');
      const arrayBuffer = await file.arrayBuffer();
      debugLog(`ArrayBuffer 读取成功 (${arrayBuffer.byteLength} bytes)`, 'ok');

      // 第二步：提取文本
      debugLog('步骤2: 提取 PDF 文本...', 'step');
      let rawText;
      try {
        rawText = await PDFExtractor.extractText(arrayBuffer);
      } catch (extractErr) {
        debugLog('PDFExtractor 报错: ' + extractErr.message, 'err');
        throw new Error('PDF 文本提取失败: ' + extractErr.message);
      }

      const textLen = rawText?.length || 0;
      debugLog(`提取到文本长度: ${textLen} 字符`, textLen > 10 ? 'ok' : 'warn');

      if (textLen > 0) {
        debugLog('前200字: ' + rawText.substring(0, 200), 'data');
      }

      const isScannedPDF = !rawText || rawText.trim().length < 10;
      if (isScannedPDF) {
        debugLog('文本过短，检测为扫描件/图片PDF，将使用 AI 视觉识别', 'warn');
      }

      // 第三步：检查 AI 配置
      debugLog('步骤3: 检查 AI 配置...', 'step');
      const configResp = await chrome.runtime.sendMessage({ type: 'GET_API_CONFIG' });
      const config = configResp?.config;

      if (!config?.apiKey || !config?.baseUrl || !config?.modelName) {
        debugLog('AI 配置不完整!', 'err');
        throw new Error('NO_API_CONFIG');
      }
      debugLog(`模型: ${config.modelName}`, 'ok');

      // 第四步：调用 AI
      debugLog(`步骤4: 调用 AI (${config.modelName})...`, 'step');

      let aiMessage;
      if (isScannedPDF) {
        // 扫描件模式：渲染为图片 + AI 视觉识别
        debugLog('扫描件模式: 渲染 PDF 页面为图片...', 'step');
        let pages;
        try {
          pages = await PDFExtractor.renderPagesAsImages(arrayBuffer);
          debugLog(`渲染了 ${pages.length} 页`, 'ok');
        } catch (renderErr) {
          debugLog('渲染失败: ' + renderErr.message, 'err');
          throw new Error('PDF 页面渲染失败: ' + renderErr.message);
        }

        const imageContent = pages.map((page) => ({
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
          debugLog('AI 视觉识别返回内容过短', 'err');
          throw new Error('AI 未能从图片中识别出有效文字，请确认模型支持图片输入（如 GPT-4o、Claude 等视觉模型）');
        }

        debugLog('OCR 文本长度: ' + aiMessage.length + ' 字符，进行结构化解析...', 'step');
        rawText = aiMessage;
      }

      // 结构化解析（文字版和扫描件共用）
      const textForAI = (rawText || '').substring(0, 6000);

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
        debugLog('AI 返回空内容', 'err');
        throw new Error('AI 未能生成有效内容');
      }

      // 第五步：解析 JSON
      debugLog('步骤5: 解析 JSON...', 'step');
      let parsed;
      try {
        const jsonMatch = aiMessage.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
          debugLog('JSON 解析成功', 'ok');
          debugLog('summary=' + (parsed.summary?.substring(0, 80) || '空') + '...', 'data');
          debugLog('skills=' + (parsed.skills || '空'), 'data');
        } else {
          debugLog('无法匹配 JSON，AI 返回: ' + aiMessage.substring(0, 200), 'err');
          throw new Error('无法从 AI 返回中提取 JSON');
        }
      } catch (parseErr) {
        debugLog('JSON.parse 失败: ' + parseErr.message, 'err');
        throw new Error('AI 返回格式异常，请重试。如果反复失败，请换一个模型试试。');
      }

      // 第六步：填充表单
      debugLog('步骤6: 填充表单...', 'step');
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
        statusText.textContent = `${file.name} 扫描件识别成功，AI 已提取简历信息`;
        showSuccess('扫描件 PDF 已通过 AI 视觉识别 + 智能解析，信息已自动填入');
      } else {
        statusText.textContent = `${file.name} 解析成功，AI 已提取简历信息`;
        showSuccess('PDF 简历已通过 AI 智能解析，信息已自动填入');
      }
      els.dividerOr.style.display = 'flex';

      debugLog('全部完成！信息已自动填入', 'ok');

    } catch (err) {
      debugLog('错误: ' + err.message, 'err');
      statusEl.className = 'pdf-upload-status error';
      statusIcon.textContent = '❌';

      if (err.message === 'NO_API_CONFIG') {
        statusText.innerHTML = `❌ 需要先配置 AI 模型<br>
          <span class="pdf-status-help">
            请先在 <strong>设置</strong> 页面配置 API 地址和 API Key
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

      // 构建 URL
      let url = config.baseUrl.trim().replace(/\/+$/, '');
      if (!url.endsWith('/v1') && !url.endsWith('/v1/') && !url.includes('/chat/completions')) {
        url += '/v1';
      }
      url += '/chat/completions';

      // 通过 service worker 代理
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
      els.settingsSuccess.textContent = '连接成功！模型响应: "' + reply + '"';
      els.settingsSuccess.style.display = 'block';
      setTimeout(() => {
        els.settingsSuccess.style.display = 'none';
        els.settingsSuccess.textContent = '设置已保存';
      }, 5000);
    } catch (error) {
      els.settingsError.textContent = error.message;
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
        showSuccess('风格配置已保存');
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
        showSuccess('设置已导出');
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
          showSuccess('设置已导入，正在刷新...');
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

  // ==================== 统计面板 ====================

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
      if (Object.keys(stats.byStyle).length > 0) {
        html += '<div class="stats-section"><h4>按风格统计</h4>';
        for (const [style, data] of Object.entries(stats.byStyle)) {
          html += `
            <div class="stats-style-row">
              <span class="stats-style-name">${STYLE_NAMES[style] || style}</span>
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

        // 发送/回复标记按钮
        const actions = document.createElement('div');
        actions.className = 'history-actions';

        const btnSent = document.createElement('button');
        btnSent.className = 'btn-small ' + (item.sent ? 'btn-sent-active' : 'btn-sent');
        btnSent.textContent = item.sent ? '已发送' : '标记发送';
        btnSent.addEventListener('click', async (e) => {
          e.stopPropagation();
          await BossEvaluate.markSent(item.id);
          loadHistory();
          loadStats();
        });

        const btnReplied = document.createElement('button');
        btnReplied.className = 'btn-small ' + (item.replied === true ? 'btn-replied-active' : 'btn-replied');
        btnReplied.textContent = item.replied === true ? '已回复' : '标记回复';
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
    } catch (e) {
      // 忽略
    }
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

  // ==================== 富推理链渲染 ====================

  /**
   * 渲染可交互的推理链面板
   * 支持展开/折叠、置信度条、耗时显示
   */
  function renderTrace(trace) {
    els.traceBody.textContent = '';

    for (const step of trace) {
      const div = document.createElement('div');
      div.className = 'trace-step';

      // 步骤名称行
      const nameRow = document.createElement('div');
      nameRow.className = 'trace-step-header';

      const name = document.createElement('span');
      name.className = 'trace-step-name';
      name.textContent = STEP_LABELS[step.step] || step.step;

      // 耗时标签
      const duration = stepTimers[step.step + '_duration'];
      if (duration) {
        const timeTag = document.createElement('span');
        timeTag.className = 'trace-step-time';
        timeTag.textContent = duration + 'ms';
        nameRow.append(name, timeTag);
      } else {
        nameRow.appendChild(name);
      }

      // 置信度条
      let confidenceBar = null;
      if (step.result && step.result.matchRatio !== undefined) {
        confidenceBar = createConfidenceBar(Math.round(step.result.matchRatio * 100), '匹配度');
      } else if (step.result && step.result.score !== undefined) {
        confidenceBar = createConfidenceBar(step.result.score, '评分');
      }

      // 详情内容（可折叠）
      const detail = document.createElement('div');
      detail.className = 'trace-step-detail';

      if (step.step === 'analyze_jd' && step.result) {
        const reqs = (step.result.coreRequirements || []).join(', ') || '无';
        const skills = (step.result.keySkills || []).join(', ') || '无';
        detail.innerHTML = `<div><strong>核心要求:</strong> ${escHtml(reqs)}</div><div><strong>关键技能:</strong> ${escHtml(skills)}</div>`;
      } else if (step.step === 'match_resume' && step.result) {
        const matched = (step.result.matchedSkills || []).join(', ') || '无';
        const matchedExp = (step.result.matchedExperience || []).join(', ') || '无';
        const ratio = Math.round((step.result.matchRatio || 0) * 100);
        detail.innerHTML = `<div><strong>匹配技能:</strong> ${escHtml(matched)}</div><div><strong>匹配经历:</strong> ${escHtml(matchedExp)}</div><div><strong>匹配度:</strong> ${ratio}%</div>`;
      } else if (step.step === 'evaluate_fit' && step.result) {
        detail.innerHTML = `<div><strong>分数:</strong> ${step.result.score || 0} 分</div><div><strong>策略:</strong> ${escHtml(step.result.strategy || '')}</div>`;
      } else if (step.step === 'generate_draft') {
        detail.innerHTML = step.success ? '<span style="color:#27ae60">生成成功</span>' : `<span style="color:#e74c3c">失败: ${escHtml(step.error || '')}</span>`;
      } else if (step.step === 'review' && step.result) {
        const issues = step.result.issues || [];
        const issueList = issues.length > 0 ? issues.map(i => escHtml(i)).join('<br>') : '无';
        const fabrication = step.result.hasFabrication ? '<span style="color:#e74c3c">有编造</span>' : '<span style="color:#27ae60">无编造</span>';
        detail.innerHTML = `<div><strong>评分:</strong> ${step.result.score || 0} 分</div><div><strong>问题:</strong><br>${issueList}</div><div><strong>编造检测:</strong> ${fabrication}</div>`;
      } else if (step.step === 'revise') {
        detail.innerHTML = step.success ? '<span style="color:#27ae60">已修正</span>' : '<span style="color:#e67e22">修正失败</span>';
      } else {
        detail.innerHTML = step.success ? '<span style="color:#27ae60">完成</span>' : `<span style="color:#e74c3c">${escHtml(step.error || '失败')}</span>`;
      }

      div.append(nameRow);
      if (confidenceBar) div.appendChild(confidenceBar);
      div.appendChild(detail);

      els.traceBody.appendChild(div);
    }
  }

  /**
   * 创建置信度/分数进度条
   */
  function createConfidenceBar(value, label) {
    const container = document.createElement('div');
    container.className = 'confidence-bar-container';

    const barBg = document.createElement('div');
    barBg.className = 'confidence-bar-bg';

    const barFill = document.createElement('div');
    barFill.className = 'confidence-bar-fill';
    // 根据分数设置颜色
    const color = value >= 70 ? '#27ae60' : value >= 40 ? '#f39c12' : '#e74c3c';
    barFill.style.width = Math.min(100, value) + '%';
    barFill.style.background = color;

    const barLabel = document.createElement('span');
    barLabel.className = 'confidence-bar-label';
    barLabel.textContent = `${label}: ${value}%`;

    barBg.appendChild(barFill);
    container.append(barLabel, barBg);
    return container;
  }

  /**
   * HTML 转义（防止 XSS）
   */
  function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ==================== 增强错误处理 ====================

  /**
   * 显示增强的错误信息
   * 包含错误标题、诊断信息和修复建议
   */
  function showEnhancedError(errorMessage) {
    // 匹配已知错误类型
    let title = '生成失败';
    let suggestion = '请稍后重试，或检查设置是否正确。';
    let diagnostic = errorMessage;

    for (const [key, info] of Object.entries(ERROR_SUGGESTIONS)) {
      if (errorMessage.includes(key)) {
        title = info.title;
        suggestion = info.suggestion;
        break;
      }
    }

    // 构建增强错误 HTML
    let html = `
      <div class="error-enhanced">
        <div class="error-title">${escHtml(title)}</div>
        <div class="error-detail">${escHtml(errorMessage)}</div>
        <div class="error-suggestion">${escHtml(suggestion)}</div>
        <div class="error-actions">
          <button class="btn-small btn-sent" id="btn-error-retry">重试</button>
          <button class="btn-small btn-replied" id="btn-error-settings">检查设置</button>
        </div>
      </div>
    `;

    els.errorMsg.innerHTML = html;
    els.errorMsg.style.display = 'block';
    els.successMsg.style.display = 'none';

    // 重试按钮
    const retryBtn = $('btn-error-retry');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        hideMessages();
        doGenerate();
      });
    }

    // 跳转设置按钮
    const settingsBtn = $('btn-error-settings');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        hideMessages();
        // 模拟点击设置标签
        const settingsTab = document.querySelector('[data-tab="settings"]');
        if (settingsTab) settingsTab.click();
      });
    }

    // 自动隐藏（延长到15秒，给用户时间阅读建议）
    setTimeout(() => {
      if (els.errorMsg.style.display !== 'none') {
        els.errorMsg.style.display = 'none';
      }
    }, 15000);
  }

  // ==================== 通用消息显示 ====================

  function showError(msg) {
    els.errorMsg.textContent = msg;
    els.errorMsg.style.display = 'block';
    els.successMsg.style.display = 'none';
    setTimeout(() => els.errorMsg.style.display = 'none', 8000);
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

  // ==================== 快捷键提示栏 ====================

  /**
   * 在页面底部添加快捷键提示
   */
  function initShortcutHints() {
    const footer = document.querySelector('.footer');
    if (!footer) return;

    const hints = document.createElement('div');
    hints.className = 'shortcut-hints';
    hints.innerHTML = `
      <span class="shortcut-hint"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> 快速生成</span>
      <span class="shortcut-hint"><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> 扫描+生成</span>
      <span class="shortcut-hint"><kbd>Esc</kbd> 关闭提示</span>
    `;
    footer.appendChild(hints);
  }

  // ==================== 监听外部触发 ====================

  /**
   * 监听来自 service-worker 的 DO_GENERATE 消息
   * 当用户通过内容脚本快捷键触发生成时，service-worker 会打开 popup 并发送此消息
   */
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'DO_GENERATE') {
      // 延迟执行，等 popup 完全加载
      setTimeout(() => {
        doExtract().then(() => {
          setTimeout(doGenerate, 500);
        }).catch(() => {});
      }, 300);
      sendResponse({ success: true });
    }
    return false;
  });

  // ==================== 启动 ====================

  init();
  initShortcutHints();

})();
