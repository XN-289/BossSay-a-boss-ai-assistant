/**
 * BossSay - 评估反馈模块
 * 记录消息效果，优化 prompt，A/B 测试
 */

const BossEvaluate = {

  // ==================== 记录消息 ====================

  /**
   * 记录一次消息生成
   * @param {Object} data
   * @param {string} data.jobTitle - 职位
   * @param {string} data.company - 公司
   * @param {string} data.style - 风格
   * @param {string} data.message - 生成的消息
   * @param {number} data.matchScore - 匹配度分数
   * @param {Array} data.trace - 推理链
   * @param {boolean} data.userEdited - 用户是否编辑了消息
   */
  async recordGeneration(data) {
    const record = {
      id: Date.now().toString(36),
      timestamp: Date.now(),
      jobTitle: data.jobTitle || '',
      company: data.company || '',
      style: data.style || 'professional',
      message: data.message || '',
      matchScore: data.matchScore || 0,
      trace: data.trace || [],
      userEdited: data.userEdited || false,
      // 效果追踪（后续更新）
      sent: false,
      replied: null, // null=未记录, true=回复, false=未回复
    };

    try {
      const stored = await this._getHistory();
      stored.unshift(record);
      if (stored.length > 200) stored.length = 200;
      await chrome.storage.local.set({ bossSay_history: stored });
      return record.id;
    } catch (e) {
      return null;
    }
  },

  /**
   * 标记消息已发送
   */
  async markSent(recordId) {
    const history = await this._getHistory();
    const record = history.find(r => r.id === recordId);
    if (record) {
      record.sent = true;
      record.sentAt = Date.now();
      await chrome.storage.local.set({ bossSay_history: history });
    }
  },

  /**
   * 标记 HR 是否回复
   */
  async markReplied(recordId, replied) {
    const history = await this._getHistory();
    const record = history.find(r => r.id === recordId);
    if (record) {
      record.replied = replied;
      record.repliedAt = Date.now();
      await chrome.storage.local.set({ bossSay_history: history });
    }
  },

  // ==================== 统计分析 ====================

  /**
   * 获取消息效果统计
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

    // 计算回复率
    for (const style of Object.keys(byStyle)) {
      const s = byStyle[style];
      s.replyRate = s.sent > 0 ? Math.round((s.replied / s.sent) * 100) : 0;
    }

    // 按匹配度分组
    const byMatchScore = { high: { sent: 0, replied: 0 }, mid: { sent: 0, replied: 0 }, low: { sent: 0, replied: 0 } };
    for (const r of sent) {
      const group = r.matchScore >= 70 ? 'high' : r.matchScore >= 40 ? 'mid' : 'low';
      byMatchScore[group].sent++;
      if (r.replied) byMatchScore[group].replied++;
    }

    return {
      total: history.length,
      sent: sent.length,
      replied: replied.length,
      replyRate: sent.length > 0 ? Math.round((replied.length / sent.length) * 100) : 0,
      byStyle,
      byMatchScore,
    };
  },

  /**
   * 获取最优风格
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

  // ==================== 内部方法 ====================

  async _getHistory() {
    try {
      const data = await chrome.storage.local.get('bossSay_history');
      return data.bossSay_history || [];
    } catch (e) {
      return [];
    }
  },
};
