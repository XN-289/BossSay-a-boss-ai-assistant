/**
 * BossSay 记忆与学习系统
 *
 * 负责管理 AI Agent 的短期记忆、长期记忆、情景记忆和语义记忆
 * 通过 chrome.storage.local 持久化存储，支持记忆的存储、检索、遗忘和整合
 *
 * 记忆架构：
 *   STM (短期记忆) - 当前会话上下文，LRU 驱逐，最多50条
 *   LTM (长期记忆) - 持久化存储，按重要性驱逐，最多500条
 *   Episodic (情景记忆) - 过去交互的完整记录，用于经验学习
 *   Semantic (语义记忆) - 从情景记忆中提取的模式和规律
 */

// ==================== 常量定义 ====================

const MEMORY_STORAGE_KEY = 'bossSay_memory';
const MEMORY_VERSION = 1;

// 记忆类别
const MEMORY_CATEGORIES = {
  USER_PREFERENCES: 'userPreferences',       // 用户偏好
  COMPANY_PATTERNS: 'companyPatterns',       // 公司模式
  STYLE_EFFECTIVENESS: 'styleEffectiveness', // 风格有效性
  SKILL_MATCHES: 'skillMatches'              // 技能匹配
};

// 结果类型
const OUTCOME_TYPES = {
  GENERATED: 'generated',   // 已生成
  SENT: 'sent',             // 已发送
  REPLIED: 'replied',       // 已回复
  NO_REPLY: 'noReply',      // 未回复
  REJECTED: 'rejected'      // 被拒绝
};

// 驱逐策略权重
const EVICTION_WEIGHTS = {
  accessCount: 0.3,
  recency: 0.4,
  relevance: 0.3
};

// ==================== 工具函数 ====================

/**
 * 生成唯一 ID
 * @returns {string} 格式: mem_<timestamp>_<random>
 */
function generateId() {
  return `mem_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 计算记忆条目的综合得分（用于驱逐决策）
 * @param {Object} entry - 记忆条目
 * @returns {number} 0-1 之间的得分
 */
function calculateEntryScore(entry) {
  const now = Date.now();
  const ageInDays = (now - entry.timestamp) / (1000 * 60 * 60 * 24);

  // 访问频率归一化（假设最大访问100次）
  const accessScore = Math.min(entry.accessCount / 100, 1);

  // 时间衰减（越新越好，7天半衰期）
  const recencyScore = Math.pow(0.5, ageInDays / 7);

  // 相关性分数（直接使用存储的值）
  const relevanceScore = entry.relevance || 0.5;

  return (
    EVICTION_WEIGHTS.accessCount * accessScore +
    EVICTION_WEIGHTS.recency * recencyScore +
    EVICTION_WEIGHTS.relevance * relevanceScore
  );
}

/**
 * 计算两个记忆条目之间的相似度
 * @param {Object} a - 记忆条目A
 * @param {Object} b - 记忆条目B
 * @returns {number} 0-1 之间的相似度
 */
function calculateSimilarity(a, b) {
  let score = 0;
  let factors = 0;

  // 类别匹配
  if (a.category === b.category) {
    score += 0.3;
  }
  factors += 0.3;

  // 内容相似度（简单关键词重叠）
  if (a.content && b.content) {
    const wordsA = new Set(JSON.stringify(a.content).toLowerCase().split(/\W+/));
    const wordsB = new Set(JSON.stringify(b.content).toLowerCase().split(/\W+/));
    const intersection = [...wordsA].filter(w => wordsB.has(w) && w.length > 2);
    const union = new Set([...wordsA, ...wordsB]);
    score += (intersection.length / union.size) * 0.5;
    factors += 0.5;
  }

  // 公司名匹配
  if (a.content?.company && b.content?.company) {
    if (a.content.company === b.content.company) {
      score += 0.2;
    }
    factors += 0.2;
  }

  return factors > 0 ? score / factors : 0;
}

// ==================== BossMemory 主对象 ====================

const BossMemory = {

  // ---------- 内部状态 ----------

  /** @type {Object|null} 长期记忆缓存（内存中的副本） */
  _cache: null,

  /** @type {boolean} 是否已初始化 */
  _initialized: false,

  /** @type {Array} 短期记忆队列 */
  _stm: [],

  /** @type {number} 短期记忆最大容量 */
  _stmMaxSize: 50,

  /** @type {number} 长期记忆最大容量 */
  _ltmMaxSize: 500,

  // ---------- 初始化与迁移 ----------

  /**
   * 初始化记忆系统
   * 从 chrome.storage.local 加载持久化数据，执行必要的迁移
   * @returns {Promise<void>}
   */
  async init() {
    if (this._initialized) return;

    try {
      const stored = await this._loadFromStorage();

      if (!stored) {
        // 首次使用，创建空记忆结构
        this._cache = this._createEmptyMemory();
        await this._saveToStorage();
        console.log('[BossMemory] 首次初始化，创建空记忆结构');
      } else if (stored.version < MEMORY_VERSION) {
        // 版本迁移
        this._cache = this._migrate(stored);
        await this._saveToStorage();
        console.log(`[BossMemory] 从版本 ${stored.version} 迁移到 ${MEMORY_VERSION}`);
      } else {
        this._cache = stored;
        console.log(`[BossMemory] 已加载记忆：${this._cache.longTerm.length} 条长期记忆，${this._cache.episodic.length} 条情景记忆`);
      }

      this._initialized = true;
    } catch (error) {
      console.error('[BossMemory] 初始化失败:', error);
      this._cache = this._createEmptyMemory();
      this._initialized = true;
    }
  },

  /**
   * 创建空的记忆数据结构
   * @returns {Object} 空记忆对象
   */
  _createEmptyMemory() {
    return {
      version: MEMORY_VERSION,
      longTerm: [],           // 长期记忆条目数组
      episodic: [],           // 情景记忆（交互记录）
      semantic: {             // 语义记忆（提取的模式）
        companyPreferences: {},   // 公司偏好: { "腾讯": { preferredStyle: "professional", ... } }
        rolePatterns: {},         // 角色模式: { "前端开发": { effectiveSkills: [...], ... } }
        styleStats: {},           // 风格统计: { "professional": { sent: 10, replied: 3, ... } }
        skillCombinations: {}     // 技能组合: { "React+TypeScript": { successRate: 0.6, ... } }
      },
      abTests: [],            // A/B 测试记录
      lastConsolidation: Date.now(),
      createdAt: Date.now()
    };
  },

  /**
   * 数据版本迁移
   * @param {Object} oldData - 旧版本数据
   * @returns {Object} 迁移后的数据
   */
  _migrate(oldData) {
    const newData = this._createEmptyMemory();

    // 保留旧数据中的有效字段
    if (Array.isArray(oldData.longTerm)) {
      newData.longTerm = oldData.longTerm.map(entry => ({
        id: entry.id || generateId(),
        category: entry.category || 'unknown',
        content: entry.content || {},
        timestamp: entry.timestamp || Date.now(),
        accessCount: entry.accessCount || 0,
        relevance: entry.relevance || 0.5
      }));
    }

    if (Array.isArray(oldData.episodic)) {
      newData.episodic = oldData.episodic;
    }

    if (oldData.semantic) {
      newData.semantic = { ...newData.semantic, ...oldData.semantic };
    }

    return newData;
  },

  // ---------- 存储操作 ----------

  /**
   * 从 chrome.storage.local 加载记忆数据
   * @returns {Promise<Object|null>}
   */
  _loadFromStorage() {
    return new Promise((resolve) => {
      chrome.storage.local.get(MEMORY_STORAGE_KEY, (result) => {
        if (chrome.runtime.lastError) {
          console.error('[BossMemory] 读取存储失败:', chrome.runtime.lastError);
          resolve(null);
        } else {
          resolve(result[MEMORY_STORAGE_KEY] || null);
        }
      });
    });
  },

  /**
   * 将记忆数据保存到 chrome.storage.local
   * @returns {Promise<void>}
   */
  async _saveToStorage() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [MEMORY_STORAGE_KEY]: this._cache }, () => {
        if (chrome.runtime.lastError) {
          console.error('[BossMemory] 保存存储失败:', chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  },

  // ---------- 核心记忆操作 ----------

  /**
   * 存储一条记忆
   * @param {string} key - 记忆键名/标识
   * @param {*} value - 记忆内容
   * @param {string} category - 记忆类别（MEMORY_CATEGORIES 之一）
   * @param {number} importance - 重要性 0-1，默认 0.5
   * @returns {Promise<Object>} 存储的记忆条目
   */
  async store(key, value, category = 'general', importance = 0.5) {
    await this._ensureInitialized();

    const entry = {
      id: generateId(),
      key: key,
      category: category,
      content: value,
      timestamp: Date.now(),
      accessCount: 0,
      relevance: Math.max(0, Math.min(1, importance))
    };

    // 先存短期记忆
    this._addToSTM(entry);

    // 再存长期记忆（带容量管理）
    this._cache.longTerm.push(entry);
    if (this._cache.longTerm.length > this._ltmMaxSize) {
      await this._evictLTM();
    }

    await this._saveToStorage();
    return entry;
  },

  /**
   * 检索相关记忆
   * @param {string} query - 查询关键词或对象
   * @param {string} [category] - 可选的类别过滤
   * @param {number} [limit=10] - 返回结果数量上限
   * @returns {Promise<Array>} 匹配的记忆条目，按相关性排序
   */
  async recall(query, category = null, limit = 10) {
    await this._ensureInitialized();

    const queryStr = typeof query === 'string' ? query.toLowerCase() : JSON.stringify(query).toLowerCase();
    const queryWords = new Set(queryStr.split(/\W+/).filter(w => w.length > 1));

    let candidates = this._cache.longTerm;

    // 按类别过滤
    if (category) {
      candidates = candidates.filter(e => e.category === category);
    }

    // 计算匹配得分
    const scored = candidates.map(entry => {
      let matchScore = 0;

      // 键名匹配
      if (entry.key && entry.key.toLowerCase().includes(queryStr)) {
        matchScore += 0.4;
      }

      // 内容关键词匹配
      const contentStr = JSON.stringify(entry.content).toLowerCase();
      const contentWords = new Set(contentStr.split(/\W+/).filter(w => w.length > 1));
      const overlap = [...queryWords].filter(w => contentWords.has(w));
      matchScore += (overlap.length / Math.max(queryWords.size, 1)) * 0.4;

      // 综合得分 = 匹配度 * 原始相关性
      const finalScore = matchScore * (entry.relevance || 0.5);

      return { ...entry, _matchScore: finalScore };
    });

    // 过滤掉零匹配，按分数排序
    const results = scored
      .filter(e => e._matchScore > 0)
      .sort((a, b) => b._matchScore - a._matchScore)
      .slice(0, limit);

    // 更新访问计数
    for (const result of results) {
      const original = this._cache.longTerm.find(e => e.id === result.id);
      if (original) {
        original.accessCount = (original.accessCount || 0) + 1;
      }
    }

    // 异步保存（不阻塞返回）
    this._saveToStorage().catch(console.error);

    return results;
  },

  /**
   * 遗忘匹配指定条件的记忆
   * @param {Object} criteria - 过滤条件，如 { category: 'old', before: timestamp }
   * @returns {Promise<number>} 被删除的记忆数量
   */
  async forget(criteria) {
    await this._ensureInitialized();

    const beforeCount = this._cache.longTerm.length;

    this._cache.longTerm = this._cache.longTerm.filter(entry => {
      // 类别过滤
      if (criteria.category && entry.category !== criteria.category) {
        return true; // 保留
      }
      // 时间过滤
      if (criteria.before && entry.timestamp >= criteria.before) {
        return true;
      }
      // 键名过滤
      if (criteria.key && entry.key !== criteria.key) {
        return true;
      }
      // ID 过滤
      if (criteria.id && entry.id !== criteria.id) {
        return true;
      }
      return false; // 删除
    });

    const removed = beforeCount - this._cache.longTerm.length;
    if (removed > 0) {
      await this._saveToStorage();
      console.log(`[BossMemory] 已遗忘 ${removed} 条记忆`);
    }

    return removed;
  },

  /**
   * 记忆整合 - 合并相关记忆，提取模式
   * 建议定期调用（如每天一次或每次重要交互后）
   * @returns {Promise<Object>} 整合结果摘要
   */
  async consolidate() {
    await this._ensureInitialized();

    const results = {
      merged: 0,
      patternsExtracted: 0,
      episodicUpdated: 0
    };

    // 1. 合并高度相似的长期记忆
    const toMerge = new Set();
    for (let i = 0; i < this._cache.longTerm.length; i++) {
      if (toMerge.has(i)) continue;
      for (let j = i + 1; j < this._cache.longTerm.length; j++) {
        if (toMerge.has(j)) continue;
        const sim = calculateSimilarity(this._cache.longTerm[i], this._cache.longTerm[j]);
        if (sim > 0.85) {
          // 合并到更相关的那条
          const [keep, discard] = this._cache.longTerm[i].relevance >= this._cache.longTerm[j].relevance
            ? [i, j] : [j, i];
          this._cache.longTerm[keep].accessCount += this._cache.longTerm[discard].accessCount;
          this._cache.longTerm[keep].relevance = Math.min(1,
            (this._cache.longTerm[keep].relevance + this._cache.longTerm[discard].relevance) / 2 + 0.1
          );
          toMerge.add(discard);
          results.merged++;
        }
      }
    }

    // 移除被合并的条目
    if (toMerge.size > 0) {
      this._cache.longTerm = this._cache.longTerm.filter((_, i) => !toMerge.has(i));
    }

    // 2. 从情景记忆中提取语义模式
    results.patternsExtracted = this._extractPatternsFromEpisodic();

    // 3. 更新情景记忆的衰减
    results.episodicUpdated = this._decayEpisodicRelevance();

    this._cache.lastConsolidation = Date.now();
    await this._saveToStorage();

    console.log('[BossMemory] 整合完成:', results);
    return results;
  },

  // ---------- 上下文与学习 ----------

  /**
   * 获取与当前职位相关的上下文记忆
   * @param {Object} jobInfo - 职位信息 { company, title, skills, ... }
   * @returns {Promise<Object>} 相关上下文
   */
  async getContext(jobInfo) {
    await this._ensureInitialized();

    const context = {
      companyHistory: null,     // 该公司的历史记录
      rolePatterns: null,       // 该角色类型的模式
      skillMatches: null,       // 技能匹配历史
      preferredStyle: null,     // 推荐风格
      pastInteractions: []      // 过去与该公司/角色的交互
    };

    if (!jobInfo) return context;

    // 查找公司历史
    if (jobInfo.company) {
      context.companyHistory = this._cache.semantic.companyPreferences[jobInfo.company] || null;
      context.pastInteractions = this._cache.episodic.filter(
        e => e.company === jobInfo.company
      ).slice(-5); // 最近5次
    }

    // 查找角色模式
    if (jobInfo.title) {
      const roleKey = this._normalizeRole(jobInfo.title);
      context.rolePatterns = this._cache.semantic.rolePatterns[roleKey] || null;
    }

    // 查找技能匹配
    if (jobInfo.skills && jobInfo.skills.length > 0) {
      context.skillMatches = await this.getSkillMatchHistory(jobInfo.skills);
    }

    // 推荐风格
    context.preferredStyle = await this.getAdaptiveStyle(jobInfo);

    return context;
  },

  /**
   * 从结果中学习 - 更新记忆中的有效性数据
   * @param {string} recordId - 情景记忆记录ID
   * @param {string} outcome - 结果类型 (OUTCOME_TYPES 之一)
   * @returns {Promise<void>}
   */
  async learnFromOutcome(recordId, outcome) {
    await this._ensureInitialized();

    // 更新情景记忆
    const episode = this._cache.episodic.find(e => e.id === recordId);
    if (!episode) {
      console.warn(`[BossMemory] 未找到情景记忆: ${recordId}`);
      return;
    }

    episode.outcome = outcome;
    episode.outcomeTimestamp = Date.now();

    // 计算成功值：replied=1, sent=0.5, noReply=0.2, rejected=0
    const successMap = {
      [OUTCOME_TYPES.REPLIED]: 1.0,
      [OUTCOME_TYPES.SENT]: 0.5,
      [OUTCOME_TYPES.NO_REPLY]: 0.2,
      [OUTCOME_TYPES.REJECTED]: 0.0,
      [OUTCOME_TYPES.GENERATED]: 0.3
    };
    const successValue = successMap[outcome] || 0.3;

    // 更新公司偏好
    if (episode.company) {
      if (!this._cache.semantic.companyPreferences[episode.company]) {
        this._cache.semantic.companyPreferences[episode.company] = {
          interactions: 0,
          replies: 0,
          preferredStyle: null,
          styleScores: {}
        };
      }
      const companyPref = this._cache.semantic.companyPreferences[episode.company];
      companyPref.interactions++;
      if (outcome === OUTCOME_TYPES.REPLIED) companyPref.replies++;

      // 更新风格得分
      if (episode.style) {
        if (!companyPref.styleScores[episode.style]) {
          companyPref.styleScores[episode.style] = { sent: 0, replied: 0, score: 0 };
        }
        const styleStat = companyPref.styleScores[episode.style];
        styleStat.sent++;
        if (outcome === OUTCOME_TYPES.REPLIED) styleStat.replied++;
        styleStat.score = styleStat.sent > 0 ? styleStat.replied / styleStat.sent : 0;

        // 更新推荐风格（选择得分最高的）
        let bestStyle = null;
        let bestScore = -1;
        for (const [style, stat] of Object.entries(companyPref.styleScores)) {
          if (stat.sent >= 2 && stat.score > bestScore) {
            bestScore = stat.score;
            bestStyle = style;
          }
        }
        companyPref.preferredStyle = bestStyle;
      }
    }

    // 更新角色模式
    if (episode.role) {
      const roleKey = this._normalizeRole(episode.role);
      if (!this._cache.semantic.rolePatterns[roleKey]) {
        this._cache.semantic.rolePatterns[roleKey] = {
          interactions: 0,
          effectiveStyles: {},
          effectiveSkills: {}
        };
      }
      const rolePattern = this._cache.semantic.rolePatterns[roleKey];
      rolePattern.interactions++;

      if (episode.style) {
        if (!rolePattern.effectiveStyles[episode.style]) {
          rolePattern.effectiveStyles[episode.style] = { count: 0, success: 0 };
        }
        rolePattern.effectiveStyles[episode.style].count++;
        rolePattern.effectiveStyles[episode.style].success += successValue;
      }
    }

    // 更新风格统计
    if (episode.style) {
      if (!this._cache.semantic.styleStats[episode.style]) {
        this._cache.semantic.styleStats[episode.style] = {
          totalSent: 0,
          totalReplied: 0,
          successRate: 0
        };
      }
      const styleStats = this._cache.semantic.styleStats[episode.style];
      if (outcome === OUTCOME_TYPES.SENT || outcome === OUTCOME_TYPES.REPLIED) {
        styleStats.totalSent++;
      }
      if (outcome === OUTCOME_TYPES.REPLIED) {
        styleStats.totalReplied++;
      }
      styleStats.successRate = styleStats.totalSent > 0
        ? styleStats.totalReplied / styleStats.totalSent
        : 0;
    }

    // 更新技能组合
    if (episode.skills && episode.skills.length > 0) {
      const comboKey = episode.skills.sort().join('+');
      if (!this._cache.semantic.skillCombinations[comboKey]) {
        this._cache.semantic.skillCombinations[comboKey] = {
          count: 0,
          successes: 0,
          successRate: 0
        };
      }
      const combo = this._cache.semantic.skillCombinations[comboKey];
      combo.count++;
      combo.successes += successValue;
      combo.successRate = combo.successes / combo.count;
    }

    // 记录 A/B 测试数据
    this._cache.abTests.push({
      id: generateId(),
      timestamp: Date.now(),
      company: episode.company,
      role: episode.role,
      style: episode.style,
      skills: episode.skills,
      outcome: outcome,
      successValue: successValue
    });

    // 清理过旧的 A/B 测试数据（保留最近500条）
    if (this._cache.abTests.length > 500) {
      this._cache.abTests = this._cache.abTests.slice(-500);
    }

    await this._saveToStorage();
    console.log(`[BossMemory] 已学习结果: ${recordId} -> ${outcome}`);
  },

  /**
   * 获取自适应风格推荐
   * 基于公司历史、角色模式和全局统计综合推荐
   * @param {Object} jobInfo - 职位信息
   * @returns {Promise<Object|null>} 推荐的风格及置信度
   */
  async getAdaptiveStyle(jobInfo) {
    await this._ensureInitialized();

    const candidates = {};

    // 来源1: 该公司历史最佳风格
    if (jobInfo.company && this._cache.semantic.companyPreferences[jobInfo.company]) {
      const pref = this._cache.semantic.companyPreferences[jobInfo.company];
      if (pref.preferredStyle && pref.interactions >= 2) {
        candidates[pref.preferredStyle] = (candidates[pref.preferredStyle] || 0) + 0.5;
      }
    }

    // 来源2: 该角色类型最有效风格
    if (jobInfo.title) {
      const roleKey = this._normalizeRole(jobInfo.title);
      const rolePattern = this._cache.semantic.rolePatterns[roleKey];
      if (rolePattern) {
        for (const [style, data] of Object.entries(rolePattern.effectiveStyles)) {
          if (data.count >= 2) {
            const effectiveness = data.success / data.count;
            candidates[style] = (candidates[style] || 0) + effectiveness * 0.3;
          }
        }
      }
    }

    // 来源3: 全局风格统计
    for (const [style, stats] of Object.entries(this._cache.semantic.styleStats)) {
      if (stats.totalSent >= 3) {
        candidates[style] = (candidates[style] || 0) + stats.successRate * 0.2;
      }
    }

    // 选择得分最高的候选
    let bestStyle = null;
    let bestScore = 0;
    for (const [style, score] of Object.entries(candidates)) {
      if (score > bestScore) {
        bestScore = score;
        bestStyle = style;
      }
    }

    if (bestStyle) {
      return {
        style: bestStyle,
        confidence: Math.min(bestScore, 1),
        sources: {
          companyBased: !!(jobInfo.company && this._cache.semantic.companyPreferences[jobInfo.company]?.preferredStyle),
          roleBased: !!(jobInfo.title && this._cache.semantic.rolePatterns[this._normalizeRole(jobInfo.title)]),
          globalStats: Object.keys(this._cache.semantic.styleStats).length > 0
        }
      };
    }

    return null;
  },

  /**
   * 获取公司洞察
   * @param {string} company - 公司名称
   * @returns {Promise<Object>} 公司相关洞察
   */
  async getCompanyInsights(company) {
    await this._ensureInitialized();

    const insights = {
      company: company,
      totalInteractions: 0,
      replyRate: 0,
      preferredStyle: null,
      bestStyles: [],
      recentEpisodes: [],
      patterns: null
    };

    // 从语义记忆获取
    const pref = this._cache.semantic.companyPreferences[company];
    if (pref) {
      insights.totalInteractions = pref.interactions;
      insights.replyRate = pref.interactions > 0 ? pref.replies / pref.interactions : 0;
      insights.preferredStyle = pref.preferredStyle;

      // 排名所有尝试过的风格
      insights.bestStyles = Object.entries(pref.styleScores || {})
        .map(([style, data]) => ({
          style,
          sent: data.sent,
          replied: data.replied,
          successRate: data.score
        }))
        .sort((a, b) => b.successRate - a.successRate);
    }

    // 从情景记忆获取最近交互
    insights.recentEpisodes = this._cache.episodic
      .filter(e => e.company === company)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10);

    return insights;
  },

  /**
   * 获取技能匹配历史
   * @param {Array<string>} skills - 技能列表
   * @returns {Promise<Object>} 技能匹配结果
   */
  async getSkillMatchHistory(skills) {
    await this._ensureInitialized();

    const result = {
      exactMatches: [],
      partialMatches: [],
      recommendations: []
    };

    if (!skills || skills.length === 0) return result;

    const normalizedSkills = skills.map(s => s.toLowerCase().trim());

    // 精确匹配（完全相同的技能组合）
    const comboKey = normalizedSkills.sort().join('+');
    if (this._cache.semantic.skillCombinations[comboKey]) {
      result.exactMatches.push({
        skills: normalizedSkills,
        ...this._cache.semantic.skillCombinations[comboKey]
      });
    }

    // 部分匹配（包含部分相同技能的组合）
    for (const [key, data] of Object.entries(this._cache.semantic.skillCombinations)) {
      if (key === comboKey) continue;
      const comboSkills = key.split('+');
      const overlap = normalizedSkills.filter(s => comboSkills.includes(s));
      if (overlap.length > 0 && overlap.length < normalizedSkills.length) {
        result.partialMatches.push({
          skills: comboSkills,
          overlap: overlap,
          overlapRate: overlap.length / normalizedSkills.length,
          ...data
        });
      }
    }

    // 按成功率排序部分匹配
    result.partialMatches.sort((a, b) => b.successRate - a.successRate);

    // 推荐：历史上与这些技能搭配成功率高的其他技能
    const recommendedSkills = {};
    for (const [key, data] of Object.entries(this._cache.semantic.skillCombinations)) {
      const comboSkills = key.split('+');
      const hasOverlap = normalizedSkills.some(s => comboSkills.includes(s));
      if (hasOverlap && data.successRate > 0.5) {
        for (const skill of comboSkills) {
          if (!normalizedSkills.includes(skill)) {
            if (!recommendedSkills[skill]) {
              recommendedSkills[skill] = { count: 0, totalSuccess: 0 };
            }
            recommendedSkills[skill].count++;
            recommendedSkills[skill].totalSuccess += data.successRate;
          }
        }
      }
    }

    result.recommendations = Object.entries(recommendedSkills)
      .map(([skill, data]) => ({
        skill,
        frequency: data.count,
        avgSuccessRate: data.totalSuccess / data.count
      }))
      .sort((a, b) => b.avgSuccessRate - a.avgSuccessRate)
      .slice(0, 5);

    return result;
  },

  // ---------- 短期记忆管理 ----------

  /**
   * 添加条目到短期记忆（LRU 策略）
   * @param {Object} entry - 记忆条目
   */
  _addToSTM(entry) {
    // 检查是否已存在（按 id 去重）
    const existingIndex = this._stm.findIndex(e => e.id === entry.id);
    if (existingIndex >= 0) {
      // 移到最前（最近使用）
      this._stm.splice(existingIndex, 1);
    }

    // 添加到最前
    this._stm.unshift({ ...entry, _stmTimestamp: Date.now() });

    // 超出容量时驱逐最旧的
    while (this._stm.length > this._stmMaxSize) {
      this._stm.pop();
    }
  },

  /**
   * 查询短期记忆
   * @param {string} query - 查询词
   * @returns {Array} 匹配的短期记忆
   */
  querySTM(query) {
    const queryLower = query.toLowerCase();
    return this._stm.filter(entry => {
      const contentStr = JSON.stringify(entry.content).toLowerCase();
      return contentStr.includes(queryLower) ||
             (entry.key && entry.key.toLowerCase().includes(queryLower));
    });
  },

  /**
   * 清空短期记忆（会话结束时调用）
   */
  clearSTM() {
    this._stm = [];
    console.log('[BossMemory] 短期记忆已清空');
  },

  // ---------- 长期记忆驱逐 ----------

  /**
   * 驱逐长期记忆中得分最低的条目
   * @returns {Promise<void>}
   */
  async _evictLTM() {
    // 按综合得分排序
    this._cache.longTerm.sort((a, b) => calculateEntryScore(b) - calculateEntryScore(a));

    // 移除得分最低的条目，直到容量达标
    while (this._cache.longTerm.length > this._ltmMaxSize) {
      const evicted = this._cache.longTerm.pop();
      console.log(`[BossMemory] 驱逐记忆: ${evicted.key || evicted.id}`);
    }
  },

  // ---------- 模式提取 ----------

  /**
   * 从情景记忆中提取语义模式
   * @returns {number} 提取的模式数量
   */
  _extractPatternsFromEpisodic() {
    let extracted = 0;

    // 按公司分组
    const byCompany = {};
    for (const ep of this._cache.episodic) {
      if (!ep.company) continue;
      if (!byCompany[ep.company]) byCompany[ep.company] = [];
      byCompany[ep.company].push(ep);
    }

    // 提取公司模式
    for (const [company, episodes] of Object.entries(byCompany)) {
      if (episodes.length < 2) continue;

      const replied = episodes.filter(e => e.outcome === OUTCOME_TYPES.REPLIED);
      if (replied.length === 0) continue;

      // 统计成功风格
      const styleCounts = {};
      for (const ep of replied) {
        if (ep.style) {
          styleCounts[ep.style] = (styleCounts[ep.style] || 0) + 1;
        }
      }

      // 找到最成功的风格
      const bestStyle = Object.entries(styleCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([style]) => style)[0];

      if (bestStyle) {
        if (!this._cache.semantic.companyPreferences[company]) {
          this._cache.semantic.companyPreferences[company] = {
            interactions: episodes.length,
            replies: replied.length,
            preferredStyle: bestStyle,
            styleScores: {}
          };
        }
        extracted++;
      }
    }

    return extracted;
  },

  /**
   * 衰减情景记忆的相关性
   * @returns {number} 被清理的情景记忆数量
   */
  _decayEpisodicRelevance() {
    const now = Date.now();
    const maxAge = 90 * 24 * 60 * 60 * 1000; // 90天

    const beforeCount = this._cache.episodic.length;

    // 移除超过90天且没有正面结果的情景记忆
    this._cache.episodic = this._cache.episodic.filter(ep => {
      const age = now - ep.timestamp;
      if (age > maxAge && ep.outcome !== OUTCOME_TYPES.REPLIED) {
        return false; // 移除
      }
      return true;
    });

    return beforeCount - this._cache.episodic.length;
  },

  // ---------- 辅助方法 ----------

  /**
   * 确保已初始化
   * @returns {Promise<void>}
   */
  async _ensureInitialized() {
    if (!this._initialized) {
      await this.init();
    }
  },

  /**
   * 标准化角色名称（用于匹配）
   * @param {string} role - 原始角色名
   * @returns {string} 标准化后的角色名
   */
  _normalizeRole(role) {
    if (!role) return 'unknown';
    return role
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[\/\\、]/g, '+')
      .replace(/工程师|开发|程序员/g, 'dev')
      .replace(/设计师|设计/g, 'design')
      .replace(/产品经理/g, 'pm')
      .replace(/运营/g, 'ops');
  },

  /**
   * 记录一次交互（创建情景记忆）
   * @param {Object} record - 交互记录
   * @param {string} record.company - 公司名
   * @param {string} record.role - 职位名
   * @param {string} record.style - 使用的风格
   * @param {Array<string>} record.skills - 相关技能
   * @param {string} record.outcome - 结果（可选，后续更新）
   * @param {Object} record.context - 额外上下文
   * @returns {Promise<Object>} 创建的情景记忆
   */
  async recordInteraction(record) {
    await this._ensureInitialized();

    const episode = {
      id: generateId(),
      timestamp: Date.now(),
      company: record.company || null,
      role: record.role || null,
      style: record.style || null,
      skills: record.skills || [],
      outcome: record.outcome || OUTCOME_TYPES.GENERATED,
      context: record.context || {}
    };

    this._cache.episodic.push(episode);

    // 限制情景记忆数量（保留最近1000条）
    if (this._cache.episodic.length > 1000) {
      this._cache.episodic = this._cache.episodic.slice(-1000);
    }

    await this._saveToStorage();
    return episode;
  },

  /**
   * 获取记忆系统统计信息
   * @returns {Promise<Object>} 统计数据
   */
  async getStats() {
    await this._ensureInitialized();

    return {
      shortTermCount: this._stm.length,
      shortTermMax: this._stmMaxSize,
      longTermCount: this._cache.longTerm.length,
      longTermMax: this._ltmMaxSize,
      episodicCount: this._cache.episodic.length,
      companyCount: Object.keys(this._cache.semantic.companyPreferences).length,
      roleCount: Object.keys(this._cache.semantic.rolePatterns).length,
      styleCount: Object.keys(this._cache.semantic.styleStats).length,
      skillComboCount: Object.keys(this._cache.semantic.skillCombinations).length,
      abTestCount: this._cache.abTests.length,
      lastConsolidation: this._cache.lastConsolidation,
      createdAt: this._cache.createdAt
    };
  },

  /**
   * 导出所有记忆数据（用于备份或调试）
   * @returns {Promise<Object>} 完整的记忆数据
   */
  async exportData() {
    await this._ensureInitialized();
    return JSON.parse(JSON.stringify(this._cache));
  },

  /**
   * 导入记忆数据（合并或覆盖）
   * @param {Object} data - 要导入的数据
   * @param {boolean} merge - 是否合并（true）还是覆盖（false）
   * @returns {Promise<void>}
   */
  async importData(data, merge = true) {
    await this._ensureInitialized();

    if (merge) {
      // 合并长期记忆（去重）
      const existingIds = new Set(this._cache.longTerm.map(e => e.id));
      for (const entry of (data.longTerm || [])) {
        if (!existingIds.has(entry.id)) {
          this._cache.longTerm.push(entry);
        }
      }

      // 合并情景记忆
      const existingEpIds = new Set(this._cache.episodic.map(e => e.id));
      for (const ep of (data.episodic || [])) {
        if (!existingEpIds.has(ep.id)) {
          this._cache.episodic.push(ep);
        }
      }

      // 合并语义记忆（深度合并）
      if (data.semantic) {
        for (const key of Object.keys(data.semantic)) {
          this._cache.semantic[key] = {
            ...this._cache.semantic[key],
            ...data.semantic[key]
          };
        }
      }
    } else {
      this._cache = this._createEmptyMemory();
      Object.assign(this._cache, data);
      this._cache.version = MEMORY_VERSION;
    }

    await this._saveToStorage();
    console.log('[BossMemory] 数据导入完成');
  }
};

// 导出为全局对象
if (typeof window !== 'undefined') {
  window.BossMemory = BossMemory;
}

// 支持 ES Module 导出（如果需要）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BossMemory, MEMORY_CATEGORIES, OUTCOME_TYPES };
}
