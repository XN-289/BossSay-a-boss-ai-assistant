/**
 * BossSay - 评估反馈模块（增强版）
 *
 * 功能：
 *   1. 消息生成记录与效果追踪（原版兼容）
 *   2. 时间序列统计（按日/周聚合，趋势分析）
 *   3. A/B 测试框架（同一岗位多消息变体对比）
 *   4. 风格效果引擎（按公司类型/职位深度分析）
 *   5. 匹配度校准（预测 vs 实际回复率，自动校准）
 *   6. 仪表盘数据生成（供 UI 展示）
 *   7. 数据导出/导入（CSV / JSON）
 *   8. 洞察自动生成（如"技术公司用专业风格回复率高15%"）
 *   9. 目标追踪（如"回复率50%"、"本月10次面试"）
 *  10. 推荐引擎（基于历史推荐风格/时机/策略）
 *  11. 失败模式检测（未回复原因分析）
 */

const BossEvaluate = {

  // ==================== 常量 ====================

  /** 存储键名 */
  STORAGE_KEY: 'bossSay_history',
  GOALS_KEY: 'bossSay_goals',
  CALIBRATION_KEY: 'bossSay_calibration',
  AB_TESTS_KEY: 'bossSay_ab_tests',

  /** 最大历史记录数 */
  MAX_HISTORY: 500,

  /** 匹配度分组阈值 */
  MATCH_THRESHOLDS: { high: 70, mid: 40 },

  // ==================== 1. 记录消息（原版兼容 + 增强） ====================

  /**
   * 记录一次消息生成
   * @param {Object} data
   * @param {string} data.jobTitle - 职位
   * @param {string} data.company - 公司
   * @param {string} data.companyType - 公司类型（tech/startup/finance/...）
   * @param {string} data.style - 风格
   * @param {string} data.message - 生成的消息
   * @param {number} data.matchScore - 匹配度分数
   * @param {Array}  data.trace - 推理链
   * @param {boolean} data.userEdited - 用户是否编辑了消息
   * @param {string} [data.variantId] - A/B 测试变体 ID
   * @param {string} [data.abTestId] - 关联的 A/B 测试 ID
   * @param {Object} [data.jobMeta] - 岗位元数据（薪资/经验要求等）
   * @returns {string|null} 记录 ID
   */
  async recordGeneration(data) {
    const now = Date.now();
    const record = {
      id: now.toString(36) + Math.random().toString(36).slice(2, 6),
      timestamp: now,
      // ---- 基本字段（原版兼容） ----
      jobTitle: data.jobTitle || '',
      company: data.company || '',
      style: data.style || 'professional',
      message: data.message || '',
      matchScore: data.matchScore || 0,
      trace: data.trace || [],
      userEdited: data.userEdited || false,
      sent: false,
      replied: null, // null=未记录, true=回复, false=未回复
      // ---- 增强字段 ----
      companyType: data.companyType || '',
      variantId: data.variantId || null,
      abTestId: data.abTestId || null,
      jobMeta: data.jobMeta || {},   // { salary, experience, city, ... }
      sentAt: null,
      repliedAt: null,
      messageLength: (data.message || '').length,
      dayOfWeek: new Date(now).getDay(), // 0=周日
      hourOfDay: new Date(now).getHours(),
    };

    try {
      const stored = await this._getHistory();
      stored.unshift(record);
      if (stored.length > this.MAX_HISTORY) stored.length = this.MAX_HISTORY;
      await this._save(STORAGE_KEY || 'bossSay_history', stored);

      // 如果关联了 A/B 测试，同步记录
      if (data.abTestId) {
        await this._recordABVariant(data.abTestId, data.variantId, record.id);
      }

      return record.id;
    } catch (e) {
      console.error('[BossEvaluate] recordGeneration 失败:', e);
      return null;
    }
  },

  /**
   * 标记消息已发送
   * @param {string} recordId
   */
  async markSent(recordId) {
    const history = await this._getHistory();
    const record = history.find(r => r.id === recordId);
    if (record) {
      record.sent = true;
      record.sentAt = Date.now();
      await this._saveHistory(history);
    }
  },

  /**
   * 标记 HR 是否回复
   * @param {string} recordId
   * @param {boolean} replied
   */
  async markReplied(recordId, replied) {
    const history = await this._getHistory();
    const record = history.find(r => r.id === recordId);
    if (record) {
      record.replied = replied;
      record.repliedAt = Date.now();
      await this._saveHistory(history);

      // 更新匹配度校准数据
      if (record.sent && record.matchScore > 0) {
        await this._updateCalibration(record.matchScore, replied);
      }
    }
  },

  // ==================== 2. 时间序列统计 ====================

  /**
   * 获取按日/周聚合的时间序列数据
   * @param {'day'|'week'} [granularity='day'] - 粒度
   * @param {number} [days=30] - 回溯天数
   * @returns {Object} { labels: [], sent: [], replied: [], replyRates: [] }
   */
  async getTimeSeries(granularity = 'day', days = 30) {
    const history = await this._getHistory();
    const now = Date.now();
    const cutoff = now - days * 86400000;
    const sent = history.filter(r => r.sent && r.sentAt >= cutoff);

    // 按时间桶分组
    const buckets = {};
    for (const r of sent) {
      const key = granularity === 'week'
        ? this._weekKey(r.sentAt)
        : this._dayKey(r.sentAt);
      if (!buckets[key]) buckets[key] = { sent: 0, replied: 0 };
      buckets[key].sent++;
      if (r.replied) buckets[key].replied++;
    }

    // 排序生成数组
    const sorted = Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b));
    const labels = sorted.map(([k]) => k);
    const sentArr = sorted.map(([, v]) => v.sent);
    const repliedArr = sorted.map(([, v]) => v.replied);
    const replyRates = sorted.map(([, v]) =>
      v.sent > 0 ? Math.round((v.replied / v.sent) * 100) : 0
    );

    return { labels, sent: sentArr, replied: repliedArr, replyRates };
  },

  /**
   * 趋势分析：最近 N 天 vs 之前 N 天的变化
   * @param {number} [windowSize=7] - 对比窗口（天）
   * @returns {Object} { current, previous, trend, delta }
   */
  async getTrend(windowSize = 7) {
    const history = await this._getHistory();
    const now = Date.now();
    const currentStart = now - windowSize * 86400000;
    const previousStart = currentStart - windowSize * 86400000;

    const calc = (start, end) => {
      const subset = history.filter(r => r.sent && r.sentAt >= start && r.sentAt < end);
      const replied = subset.filter(r => r.replied);
      return {
        sent: subset.length,
        replied: replied.length,
        replyRate: subset.length > 0 ? Math.round((replied.length / subset.length) * 100) : 0,
      };
    };

    const current = calc(currentStart, now);
    const previous = calc(previousStart, currentStart);
    const delta = current.replyRate - previous.replyRate;

    let trend = 'stable';
    if (delta > 5) trend = 'improving';
    else if (delta < -5) trend = 'declining';

    return { current, previous, trend, delta };
  },

  // ==================== 3. A/B 测试框架 ====================

  /**
   * 创建一个 A/B 测试
   * @param {Object} config
   * @param {string} config.jobTitle - 目标岗位
   * @param {string} config.company - 目标公司
   * @param {string[]} config.variants - 变体名称数组（如 ['styleA', 'styleB']）
   * @returns {string} 测试 ID
   */
  async createABTest(config) {
    const test = {
      id: 'ab_' + Date.now().toString(36),
      createdAt: Date.now(),
      jobTitle: config.jobTitle || '',
      company: config.company || '',
      variants: (config.variants || []).map(v => ({
        name: v,
        recordIds: [],
      })),
      status: 'active', // active | completed | archived
    };

    const tests = await this._getABTests();
    tests.unshift(test);
    if (tests.length > 50) tests.length = 50;
    await this._save(this.AB_TESTS_KEY, tests);
    return test.id;
  },

  /**
   * 获取 A/B 测试结果
   * @param {string} testId
   * @returns {Object|null} 含各变体的发送数、回复数、回复率
   */
  async getABTestResult(testId) {
    const tests = await this._getABTests();
    const test = tests.find(t => t.id === testId);
    if (!test) return null;

    const history = await this._getHistory();
    const variants = test.variants.map(v => {
      const records = v.recordIds
        .map(id => history.find(r => r.id === id))
        .filter(Boolean);
      const sentRecords = records.filter(r => r.sent);
      const replied = sentRecords.filter(r => r.replied);
      return {
        name: v.name,
        total: records.length,
        sent: sentRecords.length,
        replied: replied.length,
        replyRate: sentRecords.length > 0
          ? Math.round((replied.length / sentRecords.length) * 100) : 0,
        avgMatchScore: records.length > 0
          ? Math.round(records.reduce((s, r) => s + r.matchScore, 0) / records.length) : 0,
      };
    });

    // 找出最优变体
    const best = variants.reduce((a, b) =>
      (a.replyRate >= b.replyRate ? a : b), variants[0]);

    return { testId, test, variants, best: best ? best.name : null };
  },

  /**
   * 获取所有活跃的 A/B 测试
   * @returns {Array}
   */
  async getActiveABTests() {
    const tests = await this._getABTests();
    return tests.filter(t => t.status === 'active');
  },

  // ==================== 4. 风格效果引擎 ====================

  /**
   * 按风格 + 公司类型 + 职位关键词的深度分析
   * @returns {Object} 多维度交叉分析结果
   */
  async getStyleEffectiveness() {
    const history = await this._getHistory();
    const sent = history.filter(r => r.sent);

    // 按风格统计
    const byStyle = this._groupBy(sent, 'style');

    // 按 公司类型 x 风格 交叉统计
    const companyTypeXStyle = {};
    for (const r of sent) {
      const ct = r.companyType || 'unknown';
      if (!companyTypeXStyle[ct]) companyTypeXStyle[ct] = {};
      if (!companyTypeXStyle[ct][r.style]) companyTypeXStyle[ct][r.style] = { sent: 0, replied: 0 };
      companyTypeXStyle[ct][r.style].sent++;
      if (r.replied) companyTypeXStyle[ct][r.style].replied++;
    }

    // 计算回复率
    for (const ct of Object.keys(companyTypeXStyle)) {
      for (const s of Object.keys(companyTypeXStyle[ct])) {
        const d = companyTypeXStyle[ct][s];
        d.replyRate = d.sent > 0 ? Math.round((d.replied / d.sent) * 100) : 0;
      }
    }

    // 按职位关键词分组（提取常见关键词）
    const byJobKeyword = {};
    for (const r of sent) {
      const keywords = this._extractJobKeywords(r.jobTitle);
      for (const kw of keywords) {
        if (!byJobKeyword[kw]) byJobKeyword[kw] = {};
        if (!byJobKeyword[kw][r.style]) byJobKeyword[kw][r.style] = { sent: 0, replied: 0 };
        byJobKeyword[kw][r.style].sent++;
        if (r.replied) byJobKeyword[kw][r.style].replied++;
      }
    }
    for (const kw of Object.keys(byJobKeyword)) {
      for (const s of Object.keys(byJobKeyword[kw])) {
        const d = byJobKeyword[kw][s];
        d.replyRate = d.sent > 0 ? Math.round((d.replied / d.sent) * 100) : 0;
      }
    }

    return { byStyle: this._calcRates(byStyle), companyTypeXStyle, byJobKeyword };
  },

  // ==================== 5. 匹配度校准 ====================

  /**
   * 更新校准数据（内部方法）
   * 记录 "预测匹配度 -> 是否回复" 的映射
   */
  async _updateCalibration(predictedScore, actuallyReplied) {
    try {
      const data = await this._get(this.CALIBRATION_KEY) || [];
      data.push({
        predicted: predictedScore,
        actual: actuallyReplied ? 1 : 0,
        timestamp: Date.now(),
      });
      // 保留最近 500 条
      if (data.length > 500) data.splice(0, data.length - 500);
      await this._save(this.CALIBRATION_KEY, data);
    } catch (e) { /* 静默失败 */ }
  },

  /**
   * 获取匹配度校准报告
   * 对比预测匹配度区间与实际回复率
   * @returns {Object} { calibration, bias, suggestion }
   */
  async getCalibrationReport() {
    const data = await this._get(this.CALIBRATION_KEY) || [];
    if (data.length < 10) {
      return { calibration: [], bias: null, suggestion: '数据不足，至少需要10条已回复记录' };
    }

    // 按预测分数区间分组（每10分为一档）
    const bins = {};
    for (const d of data) {
      const bin = Math.floor(d.predicted / 10) * 10;
      const label = `${bin}-${bin + 9}`;
      if (!bins[label]) bins[label] = { total: 0, replied: 0 };
      bins[label].total++;
      bins[label].replied += d.actual;
    }

    const calibration = Object.entries(bins)
      .sort(([a], [b]) => parseInt(a) - parseInt(b))
      .map(([range, v]) => ({
        range,
        predictedMid: parseInt(range) + 5,
        sampleSize: v.total,
        actualReplyRate: Math.round((v.replied / v.total) * 100),
      }));

    // 计算偏差：预测高分区的实际回复率是否低于预期
    const highBin = calibration.find(c => parseInt(c.range) >= 70);
    const lowBin = calibration.find(c => parseInt(c.range) < 40);
    let bias = null;
    if (highBin && lowBin) {
      const diff = highBin.actualReplyRate - lowBin.actualReplyRate;
      bias = {
        description: diff > 30 ? '匹配度预测较准确' : diff > 10 ? '匹配度预测一般准确' : '匹配度预测偏差较大',
        highActual: highBin.actualReplyRate,
        lowActual: lowBin.actualReplyRate,
      };
    }

    return { calibration, bias, suggestion: this._calibrationSuggestion(calibration) };
  },

  // ==================== 6. 仪表盘数据 ====================

  /**
   * 生成完整的仪表盘数据
   * 一次调用获取所有 UI 需要的数据
   * @returns {Object}
   */
  async getDashboardData() {
    const [stats, trend, timeSeries, styleEff, calibration, goals, insights, recommendations] =
      await Promise.all([
        this.getStats(),
        this.getTrend(),
        this.getTimeSeries('day', 30),
        this.getStyleEffectiveness(),
        this.getCalibrationReport(),
        this.getGoals(),
        this.generateInsights(),
        this.getRecommendations(),
      ]);

    return {
      summary: {
        totalGenerated: stats.total,
        totalSent: stats.sent,
        totalReplied: stats.replied,
        overallReplyRate: stats.replyRate,
        trend: trend.trend,
        trendDelta: trend.delta,
      },
      timeSeries,
      byStyle: stats.byStyle,
      byMatchScore: stats.byMatchScore,
      styleEffectiveness: styleEff,
      calibration: calibration.calibration,
      goals,
      insights,
      recommendations,
      lastUpdated: Date.now(),
    };
  },

  // ==================== 7. 导出/导入 ====================

  /**
   * 导出数据为 JSON 字符串
   * @param {'all'|'history'|'stats'} [scope='all']
   * @returns {string} JSON 字符串
   */
  async exportJSON(scope = 'all') {
    if (scope === 'stats') {
      return JSON.stringify(await this.getDashboardData(), null, 2);
    }
    if (scope === 'history') {
      return JSON.stringify(await this._getHistory(), null, 2);
    }
    // all: 导出全部存储数据
    const all = {
      history: await this._getHistory(),
      goals: await this._get(this.GOALS_KEY) || [],
      calibration: await this._get(this.CALIBRATION_KEY) || [],
      abTests: await this._getABTests(),
      exportedAt: Date.now(),
      version: '3.0',
    };
    return JSON.stringify(all, null, 2);
  },

  /**
   * 导出历史数据为 CSV 字符串
   * @returns {string} CSV 内容
   */
  async exportCSV() {
    const history = await this._getHistory();
    const headers = [
      'id', 'timestamp', 'jobTitle', 'company', 'companyType', 'style',
      'matchScore', 'sent', 'replied', 'sentAt', 'repliedAt',
      'userEdited', 'messageLength', 'dayOfWeek', 'hourOfDay',
    ];
    const rows = history.map(r =>
      headers.map(h => {
        let v = r[h];
        if (v === null || v === undefined) v = '';
        if (typeof v === 'string') v = `"${v.replace(/"/g, '""')}"`;
        return v;
      }).join(',')
    );
    return [headers.join(','), ...rows].join('\n');
  },

  /**
   * 导入 JSON 数据（合并或覆盖）
   * @param {string} jsonStr - JSON 字符串
   * @param {boolean} [merge=true] - true=合并去重, false=覆盖
   * @returns {Object} { imported: number, skipped: number }
   */
  async importJSON(jsonStr, merge = true) {
    let imported = 0, skipped = 0;
    try {
      const data = JSON.parse(jsonStr);
      if (data.history && Array.isArray(data.history)) {
        const existing = merge ? await this._getHistory() : [];
        const existIds = new Set(existing.map(r => r.id));
        for (const r of data.history) {
          if (existIds.has(r.id)) { skipped++; continue; }
          existing.push(r);
          imported++;
        }
        existing.sort((a, b) => b.timestamp - a.timestamp);
        if (existing.length > this.MAX_HISTORY) existing.length = this.MAX_HISTORY;
        await this._saveHistory(existing);
      }
      if (data.goals) await this._save(this.GOALS_KEY, data.goals);
      if (data.calibration) await this._save(this.CALIBRATION_KEY, data.calibration);
      if (data.abTests) await this._save(this.AB_TESTS_KEY, data.abTests);
      return { imported, skipped };
    } catch (e) {
      throw new Error('导入失败：JSON 格式无效 - ' + e.message);
    }
  },

  // ==================== 8. 洞察生成 ====================

  /**
   * 自动生成数据洞察
   * @returns {Array<Object>} 洞察列表 [{ type, title, detail, priority }]
   */
  async generateInsights() {
    const insights = [];
    const stats = await this.getStats();
    const trend = await this.getTrend();
    const styleEff = await this.getStyleEffectiveness();

    // 整体回复率洞察
    if (stats.sent >= 5) {
      if (stats.replyRate >= 50) {
        insights.push({ type: 'positive', title: '回复率优秀', detail: `你的整体回复率为 ${stats.replyRate}%，高于平均水平。`, priority: 1 });
      } else if (stats.replyRate < 20) {
        insights.push({ type: 'warning', title: '回复率偏低', detail: `你的整体回复率仅 ${stats.replyRate}%，建议调整消息风格或目标岗位。`, priority: 2 });
      }
    }

    // 趋势洞察
    if (trend.trend === 'improving') {
      insights.push({ type: 'positive', title: '效果持续改善', detail: `最近7天回复率比上7天提高了 ${trend.delta} 个百分点。`, priority: 1 });
    } else if (trend.trend === 'declining') {
      insights.push({ type: 'warning', title: '效果有所下降', detail: `最近7天回复率比上7天下降了 ${Math.abs(trend.delta)} 个百分点。`, priority: 2 });
    }

    // 风格洞察（找最优风格）
    const styleEntries = Object.entries(stats.byStyle).filter(([, d]) => d.sent >= 3);
    if (styleEntries.length >= 2) {
      const sorted = styleEntries.sort((a, b) => b[1].replyRate - a[1].replyRate);
      const best = sorted[0];
      const worst = sorted[sorted.length - 1];
      const diff = best[1].replyRate - worst[1].replyRate;
      if (diff > 10) {
        insights.push({
          type: 'info',
          title: '风格效果差异明显',
          detail: `"${best[0]}"风格回复率 ${best[1].replyRate}%，比"${worst[0]}"风格 (${worst[1].replyRate}%) 高 ${diff} 个百分点。`,
          priority: 2,
        });
      }
    }

    // 公司类型 x 风格 交叉洞察
    for (const [ct, styles] of Object.entries(styleEff.companyTypeXStyle)) {
      if (ct === 'unknown') continue;
      const entries = Object.entries(styles).filter(([, d]) => d.sent >= 3);
      if (entries.length >= 2) {
        const best = entries.reduce((a, b) => a[1].replyRate > b[1].replyRate ? a : b);
        const ctLabel = this._companyTypeLabel(ct);
        if (best[1].replyRate > 40) {
          insights.push({
            type: 'info',
            title: `${ctLabel}偏好分析`,
            detail: `在${ctLabel}类公司，使用"${best[0]}"风格回复率达 ${best[1].replyRate}%。`,
            priority: 3,
          });
        }
      }
    }

    // 匹配度洞察
    const highGroup = stats.byMatchScore.high;
    const lowGroup = stats.byMatchScore.low;
    if (highGroup.sent >= 3 && lowGroup.sent >= 3) {
      const diff = (highGroup.sent > 0 ? Math.round(highGroup.replied / highGroup.sent * 100) : 0) -
                   (lowGroup.sent > 0 ? Math.round(lowGroup.replied / lowGroup.sent * 100) : 0);
      if (diff > 20) {
        insights.push({
          type: 'positive',
          title: '匹配度影响显著',
          detail: `高匹配度岗位回复率比低匹配度岗位高 ${diff} 个百分点，AI 匹配评估有效。`,
          priority: 2,
        });
      }
    }

    // 用户编辑洞察
    const edited = stats.sent > 0 ? (await this._getHistory()).filter(r => r.sent && r.userEdited) : [];
    if (edited.length >= 3) {
      const editedReplied = edited.filter(r => r.replied);
      const editedRate = Math.round((editedReplied.length / edited.length) * 100);
      const aiOnlyRate = stats.replyRate;
      if (editedRate > aiOnlyRate + 10) {
        insights.push({
          type: 'info',
          title: '手动编辑提升效果',
          detail: `手动编辑后的消息回复率 (${editedRate}%) 比纯 AI 生成 (${aiOnlyRate}%) 高。你的调整很有价值。`,
          priority: 3,
        });
      }
    }

    return insights.sort((a, b) => a.priority - b.priority);
  },

  // ==================== 9. 目标追踪 ====================

  /**
   * 设置一个目标
   * @param {Object} goal
   * @param {string} goal.name - 目标名称
   * @param {string} goal.type - 类型: 'replyRate' | 'interviews' | 'sentCount'
   * @param {number} goal.target - 目标值
   * @param {string} goal.deadline - 截止日期（ISO 字符串）
   * @returns {string} 目标 ID
   */
  async setGoal(goal) {
    const goals = await this._get(this.GOALS_KEY) || [];
    const entry = {
      id: 'goal_' + Date.now().toString(36),
      name: goal.name,
      type: goal.type,
      target: goal.target,
      deadline: goal.deadline || null,
      createdAt: Date.now(),
      status: 'active',
    };
    goals.push(entry);
    await this._save(this.GOALS_KEY, goals);
    return entry.id;
  },

  /**
   * 获取所有目标及其进度
   * @returns {Array<Object>}
   */
  async getGoals() {
    const goals = await this._get(this.GOALS_KEY) || [];
    const stats = await this.getStats();
    const history = await this._getHistory();

    return goals.map(g => {
      let current = 0;
      if (g.type === 'replyRate') {
        current = stats.replyRate;
      } else if (g.type === 'interviews') {
        // "面试"通过 replied=true 且 repliedAt 在本月统计
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        current = history.filter(r =>
          r.replied === true && r.repliedAt && r.repliedAt >= monthStart.getTime()
        ).length;
      } else if (g.type === 'sentCount') {
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        current = history.filter(r =>
          r.sent && r.sentAt && r.sentAt >= monthStart.getTime()
        ).length;
      }

      const progress = g.target > 0 ? Math.min(Math.round((current / g.target) * 100), 100) : 0;
      const deadlinePassed = g.deadline ? new Date(g.deadline) < new Date() : false;
      const completed = current >= g.target;

      return { ...g, current, progress, completed, deadlinePassed };
    });
  },

  /**
   * 删除一个目标
   * @param {string} goalId
   */
  async deleteGoal(goalId) {
    const goals = await this._get(this.GOALS_KEY) || [];
    const filtered = goals.filter(g => g.id !== goalId);
    await this._save(this.GOALS_KEY, filtered);
  },

  // ==================== 10. 推荐引擎 ====================

  /**
   * 基于历史数据给出推荐
   * @returns {Object} { style, timing, tips }
   */
  async getRecommendations() {
    const stats = await this.getStats();
    const history = await this._getHistory();
    const sent = history.filter(r => r.sent);

    // 推荐最优风格
    let style = null;
    const styleEntries = Object.entries(stats.byStyle).filter(([, d]) => d.sent >= 3);
    if (styleEntries.length > 0) {
      const best = styleEntries.reduce((a, b) => a[1].replyRate > b[1].replyRate ? a : b);
      style = { name: best[0], replyRate: best[1].replyRate, confidence: best[1].sent >= 10 ? 'high' : 'medium' };
    }

    // 推荐最佳发送时段
    let timing = null;
    if (sent.length >= 10) {
      const byHour = {};
      for (const r of sent) {
        const h = r.hourOfDay != null ? r.hourOfDay : new Date(r.sentAt || r.timestamp).getHours();
        if (!byHour[h]) byHour[h] = { sent: 0, replied: 0 };
        byHour[h].sent++;
        if (r.replied) byHour[h].replied++;
      }
      const hourEntries = Object.entries(byHour).filter(([, v]) => v.sent >= 3);
      if (hourEntries.length > 0) {
        const bestHour = hourEntries.reduce((a, b) => {
          const rateA = a[1].replied / a[1].sent;
          const rateB = b[1].replied / b[1].sent;
          return rateA > rateB ? a : b;
        });
        const h = parseInt(bestHour[0]);
        timing = {
          bestHour: h,
          label: `${h}:00-${h + 1}:00`,
          replyRate: Math.round((bestHour[1].replied / bestHour[1].sent) * 100),
        };
      }
    }

    // 实用建议
    const tips = [];
    if (stats.replyRate < 30 && stats.sent >= 10) {
      tips.push('回复率偏低，建议尝试不同风格或提高目标岗位匹配度。');
    }
    const userEditedRate = sent.length > 0
      ? Math.round(sent.filter(r => r.userEdited).length / sent.length * 100) : 0;
    if (userEditedRate < 20 && stats.replyRate < 40) {
      tips.push('你很少编辑 AI 生成的消息，手动微调可能提升效果。');
    }
    if (stats.byMatchScore.low.sent > stats.byMatchScore.high.sent) {
      tips.push('你发送了大量低匹配度岗位，建议聚焦高匹配度职位以提升效率。');
    }

    return { style, timing, tips };
  },

  // ==================== 11. 失败模式检测 ====================

  /**
   * 分析未回复的模式
   * @returns {Object} { patterns, summary }
   */
  async detectFailurePatterns() {
    const history = await this._getHistory();
    const sent = history.filter(r => r.sent);
    const notReplied = sent.filter(r => r.replied === false);
    const replied = sent.filter(r => r.replied === true);

    if (notReplied.length < 3) {
      return { patterns: [], summary: '未回复样本不足，无法检测模式。' };
    }

    const patterns = [];

    // 模式1：匹配度低导致未回复
    const avgMatchNoReply = notReplied.reduce((s, r) => s + r.matchScore, 0) / notReplied.length;
    const avgMatchReplied = replied.length > 0
      ? replied.reduce((s, r) => s + r.matchScore, 0) / replied.length : 0;
    if (replied.length >= 3 && avgMatchNoReply < avgMatchReplied - 10) {
      patterns.push({
        type: 'low_match',
        severity: 'high',
        description: `未回复岗位的平均匹配度 (${Math.round(avgMatchNoReply)}) 明显低于已回复岗位 (${Math.round(avgMatchReplied)})。`,
        suggestion: '优先投递高匹配度岗位，或提升简历与岗位的匹配点。',
      });
    }

    // 模式2：特定风格回复率差
    const notRepliedByStyle = this._groupBy(notReplied, 'style');
    const repliedByStyle = this._groupBy(replied, 'style');
    for (const style of Object.keys(notRepliedByStyle)) {
      const noRepCount = notRepliedByStyle[style].length;
      const repCount = repliedByStyle[style] ? repliedByStyle[style].length : 0;
      const total = noRepCount + repCount;
      if (total >= 5) {
        const rate = Math.round((repCount / total) * 100);
        if (rate < 15) {
          patterns.push({
            type: 'style_mismatch',
            severity: 'medium',
            description: `"${style}"风格的回复率仅 ${rate}%（${total} 次使用）。`,
            suggestion: `考虑减少使用"${style}"风格，或分析其消息内容是否需要优化。`,
          });
        }
      }
    }

    // 模式3：发送时机问题
    const noReplyByHour = {};
    for (const r of notReplied) {
      const h = r.hourOfDay != null ? r.hourOfDay : new Date(r.sentAt || r.timestamp).getHours();
      noReplyByHour[h] = (noReplyByHour[h] || 0) + 1;
    }
    const nightNoReply = (noReplyByHour[22] || 0) + (noReplyByHour[23] || 0) + (noReplyByHour[0] || 0) + (noReplyByHour[1] || 0) + (noReplyByHour[2] || 0) + (noReplyByHour[3] || 0) + (noReplyByHour[4] || 0) + (noReplyByHour[5] || 0);
    if (nightNoReply >= notReplied.length * 0.3 && notReplied.length >= 5) {
      patterns.push({
        type: 'bad_timing',
        severity: 'low',
        description: `${Math.round(nightNoReply / notReplied.length * 100)}% 的未回复消息在深夜时段发送。`,
        suggestion: 'HR 通常在工作时间查看消息，建议在 9:00-18:00 之间发送。',
      });
    }

    // 模式4：消息过长
    const avgLenNoReply = notReplied.reduce((s, r) => s + r.messageLength, 0) / notReplied.length;
    if (replied.length >= 3) {
      const avgLenReplied = replied.reduce((s, r) => s + r.messageLength, 0) / replied.length;
      if (avgLenNoReply > avgLenReplied * 1.5 && avgLenNoReply > 200) {
        patterns.push({
          type: 'too_long',
          severity: 'medium',
          description: `未回复消息平均长度 (${Math.round(avgLenNoReply)} 字) 远超已回复消息 (${Math.round(avgLenReplied)} 字)。`,
          suggestion: '消息过长可能降低 HR 阅读意愿，建议控制在 150 字以内。',
        });
      }
    }

    const summary = patterns.length === 0
      ? '未发现明显失败模式，继续保持当前策略。'
      : `发现 ${patterns.length} 个潜在问题，建议逐一优化。`;

    return { patterns, summary };
  },

  // ==================== 12. 获取统计（原版增强） ====================

  /**
   * 获取消息效果统计（原版 getStats 增强版）
   */
  async getStats() {
    const history = await this._getHistory();
    const sent = history.filter(r => r.sent);
    const replied = sent.filter(r => r.replied === true);

    // 按风格统计
    const byStyle = {};
    for (const r of sent) {
      if (!byStyle[r.style]) byStyle[r.style] = { sent: 0, replied: 0 };
      byStyle[r.style].sent++;
      if (r.replied) byStyle[r.style].replied++;
    }
    for (const style of Object.keys(byStyle)) {
      const s = byStyle[style];
      s.replyRate = s.sent > 0 ? Math.round((s.replied / s.sent) * 100) : 0;
    }

    // 按匹配度分组
    const byMatchScore = {
      high: { sent: 0, replied: 0 },
      mid: { sent: 0, replied: 0 },
      low: { sent: 0, replied: 0 },
    };
    for (const r of sent) {
      const group = r.matchScore >= this.MATCH_THRESHOLDS.high ? 'high'
        : r.matchScore >= this.MATCH_THRESHOLDS.mid ? 'mid' : 'low';
      byMatchScore[group].sent++;
      if (r.replied) byMatchScore[group].replied++;
    }
    for (const g of Object.keys(byMatchScore)) {
      const s = byMatchScore[g];
      s.replyRate = s.sent > 0 ? Math.round((s.replied / s.sent) * 100) : 0;
    }

    // 按公司类型统计
    const byCompanyType = {};
    for (const r of sent) {
      const ct = r.companyType || 'unknown';
      if (!byCompanyType[ct]) byCompanyType[ct] = { sent: 0, replied: 0 };
      byCompanyType[ct].sent++;
      if (r.replied) byCompanyType[ct].replied++;
    }
    for (const ct of Object.keys(byCompanyType)) {
      const s = byCompanyType[ct];
      s.replyRate = s.sent > 0 ? Math.round((s.replied / s.sent) * 100) : 0;
    }

    return {
      total: history.length,
      sent: sent.length,
      replied: replied.length,
      replyRate: sent.length > 0 ? Math.round((replied.length / sent.length) * 100) : 0,
      byStyle,
      byMatchScore,
      byCompanyType,
    };
  },

  /**
   * 获取最优风格（原版方法）
   */
  async getBestStyle() {
    const stats = await this.getStats();
    let best = null;
    let bestRate = -1;

    for (const [style, data] of Object.entries(stats.byStyle)) {
      if (data.sent >= 3 && data.replyRate > bestRate) {
        bestRate = data.replyRate;
        best = style;
      }
    }

    return { style: best, replyRate: bestRate };
  },

  // ==================== 内部工具方法 ====================

  /** 从 chrome.storage.local 读取 */
  async _get(key) {
    try {
      const data = await chrome.storage.local.get(key);
      return data[key] || null;
    } catch (e) {
      return null;
    }
  },

  /** 写入 chrome.storage.local */
  async _save(key, value) {
    try {
      await chrome.storage.local.set({ [key]: value });
    } catch (e) {
      console.error('[BossEvaluate] 存储写入失败:', key, e);
    }
  },

  /** 获取历史记录（兼容旧存储键） */
  async _getHistory() {
    return (await this._get(this.STORAGE_KEY)) || [];
  },

  /** 保存历史记录 */
  async _saveHistory(history) {
    await this._save(this.STORAGE_KEY, history);
  },

  /** 获取 A/B 测试列表 */
  async _getABTests() {
    return (await this._get(this.AB_TESTS_KEY)) || [];
  },

  /** A/B 测试内部：记录变体关联 */
  async _recordABVariant(testId, variantId, recordId) {
    const tests = await this._getABTests();
    const test = tests.find(t => t.id === testId);
    if (test) {
      const variant = test.variants.find(v => v.name === variantId);
      if (variant) {
        variant.recordIds.push(recordId);
        await this._save(this.AB_TESTS_KEY, tests);
      }
    }
  },

  /**
   * 按字段分组数组
   * @param {Array} arr
   * @param {string} field
   * @returns {Object} { [fieldValue]: [items] }
   */
  _groupBy(arr, field) {
    const groups = {};
    for (const item of arr) {
      const key = item[field] || 'unknown';
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    return groups;
  },

  /**
   * 计算分组回复率（用于 byStyle 等分组对象）
   * @param {Object} grouped - { [key]: [records] }
   * @returns {Object} { [key]: { sent, replied, replyRate } }
   */
  _calcRates(grouped) {
    const result = {};
    for (const [key, records] of Object.entries(grouped)) {
      const sent = records.filter(r => r.sent);
      const replied = sent.filter(r => r.replied);
      result[key] = {
        sent: sent.length,
        replied: replied.length,
        replyRate: sent.length > 0 ? Math.round((replied.length / sent.length) * 100) : 0,
      };
    }
    return result;
  },

  /**
   * 从职位标题提取关键词
   * @param {string} jobTitle
   * @returns {string[]} 关键词列表
   */
  _extractJobKeywords(jobTitle) {
    if (!jobTitle) return [];
    const patterns = [
      { regex: /前端|frontend/i, kw: '前端' },
      { regex: /后端|backend/i, kw: '后端' },
      { regex: /全栈|fullstack|full.?stack/i, kw: '全栈' },
      { regex: /算法|algorithm/i, kw: '算法' },
      { regex: /数据|data/i, kw: '数据' },
      { regex: /产品|product/i, kw: '产品' },
      { regex: /设计|design|UI|UX/i, kw: '设计' },
      { regex: /测试|test|QA/i, kw: '测试' },
      { regex: /运维|devops|SRE/i, kw: '运维' },
      { regex: /AI|机器学习|深度学习|NLP|CV/i, kw: 'AI' },
      { regex: /Java(?!Script)/i, kw: 'Java' },
      { regex: /Python/i, kw: 'Python' },
      { regex: /Go|Golang/i, kw: 'Go' },
      { regex: /Android|安卓/i, kw: 'Android' },
      { regex: /iOS/i, kw: 'iOS' },
      { regex: /安全|security/i, kw: '安全' },
      { regex: /嵌入式|embedded/i, kw: '嵌入式' },
      { regex: /销售|sale/i, kw: '销售' },
      { regex: /运营|operation/i, kw: '运营' },
      { regex: /经理|manager|总监|director/i, kw: '管理' },
    ];
    const found = [];
    for (const p of patterns) {
      if (p.regex.test(jobTitle)) found.push(p.kw);
    }
    return found.length > 0 ? found : ['其他'];
  },

  /**
   * 日期键（YYYY-MM-DD）
   * @param {number} timestamp
   * @returns {string}
   */
  _dayKey(timestamp) {
    const d = new Date(timestamp);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  /**
   * 周键（YYYY-Wxx）
   * @param {number} timestamp
   * @returns {string}
   */
  _weekKey(timestamp) {
    const d = new Date(timestamp);
    const jan1 = new Date(d.getFullYear(), 0, 1);
    const weekNum = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
    return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
  },

  /**
   * 公司类型中文标签
   * @param {string} type
   * @returns {string}
   */
  _companyTypeLabel(type) {
    const map = {
      tech: '科技/互联网',
      startup: '创业公司',
      finance: '金融',
      education: '教育',
      healthcare: '医疗',
      ecommerce: '电商',
      game: '游戏',
      enterprise: '传统企业',
    };
    return map[type] || type;
  },

  /**
   * 校准建议生成
   * @param {Array} calibration
   * @returns {string}
   */
  _calibrationSuggestion(calibration) {
    if (calibration.length < 3) return '数据不足，继续积累数据以获得更准确的校准。';
    const high = calibration.filter(c => parseInt(c.range) >= 70);
    const low = calibration.filter(c => parseInt(c.range) < 40);
    if (high.length > 0 && low.length > 0) {
      const highRate = high.reduce((s, c) => s + c.actualReplyRate, 0) / high.length;
      const lowRate = low.reduce((s, c) => s + c.actualReplyRate, 0) / low.length;
      if (highRate - lowRate > 25) {
        return '匹配度预测较准确，高匹配度岗位确实更容易获得回复。';
      } else {
        return '匹配度预测与实际回复率关联较弱，建议关注风格和消息质量。';
      }
    }
    return '继续积累数据以获得更准确的校准分析。';
  },
};

// 导出（兼容浏览器全局变量和 CommonJS）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BossEvaluate;
} else if (typeof window !== 'undefined') {
  window.BossEvaluate = BossEvaluate;
}
