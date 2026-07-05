/**
 * BossSay - AI Agent 核心模块
 *
 * 架构概述：
 *   采用 ReAct（Reasoning + Acting）模式，实现思考-行动-观察的多步推理循环。
 *   支持两种运行模式：
 *     1. 简单模式（run）：兼容旧版，直接执行推理链
 *     2. 智能体模式（runAgentic）：完整规划-执行-反思流水线
 *
 * 核心能力：
 *   - ReAct 循环：think → act → observe
 *   - 工具注册表：可扩展的工具系统
 *   - 任务规划：执行前生成有序步骤和依赖关系
 *   - 反思机制：每步执行后评估质量，决定是否重试
 *   - 置信度评分：每步返回 0-1 置信度，低置信度触发重试
 *   - 自适应重试：失败时分析错误并调整策略
 *   - 上下文窗口管理：跟踪 token 用量，过长时自动摘要
 *   - 结构化输出验证：JSON schema 校验 + 自动修复
 *   - 思维链提示：系统提示中嵌入显式推理指令
 *   - 步骤依赖跟踪：步骤声明依赖项，依赖失败则跳过
 *   - 状态机：IDLE → PLANNING → EXECUTING → REFLECTING → DONE/ERROR
 *   - 事件系统：状态转换时发射事件，供 UI 展示实时进度
 */

// ============================================================
// 常量定义
// ============================================================

/** 每步最大重试次数 */
const MAX_RETRIES = 3;

/** API 调用超时时间（毫秒） */
const API_TIMEOUT_MS = 30000;

/** 上下文窗口估算上限（字符数，粗略估算） */
const CONTEXT_CHAR_LIMIT = 12000;

/** 状态机状态枚举 */
const AgentState = Object.freeze({
  IDLE: 'IDLE',
  PLANNING: 'PLANNING',
  EXECUTING: 'EXECUTING',
  REFLECTING: 'REFLECTING',
  DONE: 'DONE',
  ERROR: 'ERROR',
});

/** 默认风格指令 */
const DEFAULT_STYLE_INSTRUCTIONS = {
  professional: '语气专业、简洁、自信。用数据和成果说话。',
  friendly: '语气热情、真诚、有温度。展示真诚兴趣。',
  humor: '语气轻松、幽默、有个性。保持专业底线。',
  concise: '不超过 120 字，信息密度最高。不废话。',
};

/** 工具输出 JSON Schema 定义（用于结构化验证） */
const TOOL_SCHEMAS = {
  analyzeJD: {
    required: ['coreRequirements'],
    properties: {
      coreRequirements: 'array',
      niceToHave: 'array',
      roleType: 'string',
      seniority: 'string',
      keySkills: 'array',
    },
  },
  matchResume: {
    required: ['matchedSkills', 'matchRatio'],
    properties: {
      matchedSkills: 'array',
      matchedExperience: 'array',
      gaps: 'array',
      strengths: 'array',
      matchRatio: 'number',
    },
  },
  evaluateFit: {
    required: ['score', 'strategy'],
    properties: {
      score: 'number',
      strategy: 'string',
      emphasis: 'string',
    },
  },
  generateMessage: {
    required: ['message'],
    properties: {
      message: 'string',
      review: 'object',
    },
  },
  reviewMessage: {
    required: ['issues'],
    properties: {
      issues: 'array',
      suggestions: 'array',
      score: 'number',
      length: 'number',
      hasFabrication: 'boolean',
    },
  },
};

// ============================================================
// BossAgent 主体
// ============================================================

const BossAgent = {
  // ----------------------------------------------------------
  // 内部状态
  // ----------------------------------------------------------
  _state: AgentState.IDLE,
  _trace: [],
  _listeners: {},
  _tools: {},
  _contextTokens: 0,

  // ----------------------------------------------------------
  // 初始化：注册内置工具
  // ----------------------------------------------------------
  init() {
    this._registerBuiltinTools();
    return this;
  },

  // ============================================================
  // 公共接口
  // ============================================================

  /**
   * 旧版兼容入口：简单模式
   * 保持与 v2.x 完全相同的调用方式和返回结构。
   *
   * @param {Object} params
   * @param {Object} params.profile       - 求职者资料
   * @param {Object} params.jobInfo       - 岗位信息
   * @param {string} params.style         - 消息风格
   * @param {Function} params.callAPI     - API 调用函数 (messages) => response
   * @param {Object} [params.stylePrompts]- 用户自定义风格配置
   * @param {Function} [params.onProgress]- 进度回调 (stepName, detail) => void
   * @returns {Object} { message, trace, matchScore }
   */
  async run(params) {
    const { profile, jobInfo, style, callAPI, stylePrompts, onProgress } = params;
    const trace = [];
    const progress = onProgress || (() => {});

    // Step 1: 分析 JD + 匹配简历
    progress('analyze_jd', '分析岗位 + 匹配简历...');
    const analysisResult = await this.analyzeAndMatch(profile, jobInfo, callAPI);
    trace.push({ step: 'analyze_jd', ...analysisResult.analyzeJD });
    trace.push({ step: 'match_resume', ...analysisResult.matchResume });

    // Step 2: 评估匹配度
    progress('evaluate_fit', '评估匹配度...');
    const matchResult = analysisResult.matchResume.result || { matchedSkills: [], matchRatio: 0 };
    const evaluation = this.evaluateFit(matchResult);
    trace.push({ step: 'evaluate_fit', ...evaluation });

    // Step 3: 生成消息 + 自我审查
    progress('generate_draft', '生成消息 + 审查...');
    const draftAndReview = await this.generateAndReview(
      profile, jobInfo, analysisResult.analyzeJD.result, matchResult, evaluation.result, style, callAPI, stylePrompts
    );
    trace.push({ step: 'generate_draft', ...draftAndReview.draft });
    trace.push({ step: 'review', ...draftAndReview.review });

    // 如果审查发现问题，修正
    let finalMessage = draftAndReview.draft.result;
    if (draftAndReview.review.result?.issues?.length > 0) {
      progress('revise', '修正消息...');
      const revised = await this.reviseMessage(
        finalMessage, draftAndReview.review.result.issues, profile, jobInfo, callAPI
      );
      trace.push({ step: 'revise', ...revised });
      finalMessage = revised.result;
    }

    return {
      message: finalMessage,
      trace,
      matchScore: evaluation.result?.score || 0,
    };
  },

  /**
   * 智能体模式入口：完整的规划-执行-反思流水线
   * 使用 ReAct 循环、工具注册表、状态机和事件系统。
   *
   * @param {Object} params - 同 run() 的参数
   * @returns {Object} { message, trace, matchScore, state, plan }
   */
  async runAgentic(params) {
    this._trace = [];
    this._contextTokens = 0;
    const { profile, jobInfo, style, callAPI, stylePrompts, onProgress } = params;
    this._callAPI = callAPI;
    this._onProgress = onProgress || (() => {});

    try {
      // 阶段一：规划
      this._transitionState(AgentState.PLANNING);
      const plan = this._createPlan(profile, jobInfo, style);
      this._emit('planCreated', { plan });

      // 阶段二：按计划逐步执行
      this._transitionState(AgentState.EXECUTING);
      const results = {};
      let finalMessage = '';

      for (const step of plan.steps) {
        // 检查依赖是否满足
        if (!this._checkDependencies(step, results)) {
          this._recordTrace(step.id, false, '依赖步骤失败，跳过', 0);
          this._emit('stepSkipped', { step: step.id, reason: 'dependency_failed' });
          continue;
        }

        // ReAct 循环执行该步骤
        const stepResult = await this._executeStepWithReact(step, {
          profile, jobInfo, style, stylePrompts, callAPI, results,
        });
        results[step.id] = stepResult;

        // 提取最终消息
        if (step.id === 'generateMessage' && stepResult.success) {
          finalMessage = stepResult.data?.message || stepResult.data || '';
        }
        if (step.id === 'reviseMessage' && stepResult.success) {
          finalMessage = stepResult.data || finalMessage;
        }
      }

      // 阶段三：反思
      this._transitionState(AgentState.REFLECTING);
      const reflection = this._reflectOnResult(finalMessage, results);

      // 如果反思发现严重问题且未经过修正，尝试一次修正
      if (reflection.needsRevision && !results.reviseMessage?.success) {
        this._emit('reflectionTriggered', { reflection });
        const reviewIssues = results.reviewMessage?.data?.issues || [];
        if (reviewIssues.length > 0) {
          const revised = await this.reviseMessage(
            finalMessage, reviewIssues, profile, jobInfo, callAPI
          );
          if (revised.success) {
            finalMessage = revised.result;
            this._recordTrace('reviseMessage', true, revised.result, 0.8);
          }
        }
      }

      // 完成
      this._transitionState(AgentState.DONE);
      const evalResult = results.evaluateFit?.data || { score: 0 };

      return {
        message: finalMessage,
        trace: this._trace,
        matchScore: evalResult.score || 0,
        state: this._state,
        plan,
      };
    } catch (err) {
      this._transitionState(AgentState.ERROR);
      this._emit('error', { error: err.message });
      throw err;
    }
  },

  // ============================================================
  // 事件系统
  // ============================================================

  /**
   * 注册事件监听器
   * @param {string} event   - 事件名称
   * @param {Function} fn    - 回调函数
   */
  on(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  },

  /**
   * 移除事件监听器
   */
  off(event, fn) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(f => f !== fn);
  },

  /**
   * 触发事件
   * @param {string} event - 事件名称
   * @param {Object} data  - 事件数据
   */
  _emit(event, data) {
    const payload = { event, timestamp: Date.now(), ...data };
    (this._listeners[event] || []).forEach(fn => {
      try { fn(payload); } catch (_) { /* 监听器异常不阻塞主流程 */ }
    });
    // 同时通知 onProgress 回调（兼容旧版 UI）
    if (this._onProgress) {
      this._onProgress(event, JSON.stringify(data).slice(0, 100));
    }
  },

  // ============================================================
  // 状态机
  // ============================================================

  /**
   * 状态转换：校验合法性并发射事件
   * @param {string} newState - 目标状态
   */
  _transitionState(newState) {
    const validTransitions = {
      [AgentState.IDLE]:       [AgentState.PLANNING],
      [AgentState.PLANNING]:   [AgentState.EXECUTING, AgentState.ERROR],
      [AgentState.EXECUTING]:  [AgentState.REFLECTING, AgentState.ERROR],
      [AgentState.REFLECTING]: [AgentState.DONE, AgentState.ERROR],
      [AgentState.DONE]:       [AgentState.IDLE],
      [AgentState.ERROR]:      [AgentState.IDLE],
    };
    const allowed = validTransitions[this._state] || [];
    if (!allowed.includes(newState)) {
      // 非法转换降级为错误
      this._emit('stateError', { from: this._state, to: newState });
      return;
    }
    const oldState = this._state;
    this._state = newState;
    this._emit('stateChange', { from: oldState, to: newState });
  },

  // ============================================================
  // 工具注册表
  // ============================================================

  /**
   * 注册内置工具
   */
  _registerBuiltinTools() {
    this.registerTool('analyzeJD', {
      description: '分析岗位 JD，提取核心要求和关键技能',
      execute: async (ctx) => {
        return this._toolAnalyzeJD(ctx.profile, ctx.jobInfo, ctx.callAPI);
      },
    });
    this.registerTool('matchResume', {
      description: '将简历与 JD 进行匹配',
      execute: async (ctx) => {
        // 依赖 analyzeJD 的结果
        const jdResult = ctx.results.analyzeJD?.data;
        return this._toolMatchResume(ctx.profile, ctx.jobInfo, jdResult, ctx.callAPI);
      },
    });
    this.registerTool('evaluateFit', {
      description: '评估匹配度并制定消息策略',
      execute: async (ctx) => {
        const matchData = ctx.results.matchResume?.data || { matchedSkills: [], matchRatio: 0 };
        return this.evaluateFit(matchData);
      },
    });
    this.registerTool('generateMessage', {
      description: '根据分析结果生成打招呼消息',
      execute: async (ctx) => {
        const jdData = ctx.results.analyzeJD?.data || {};
        const matchData = ctx.results.matchResume?.data || {};
        const evalData = ctx.results.evaluateFit?.data || {};
        return this._toolGenerateMessage(
          ctx.profile, ctx.jobInfo, jdData, matchData, evalData, ctx.style, ctx.callAPI, ctx.stylePrompts
        );
      },
    });
    this.registerTool('reviewMessage', {
      description: '审查生成的消息质量',
      execute: async (ctx) => {
        const msg = ctx.results.generateMessage?.data?.message || '';
        return this._toolReviewMessage(msg, ctx.profile, ctx.callAPI);
      },
    });
    this.registerTool('reviseMessage', {
      description: '根据审查意见修正消息',
      execute: async (ctx) => {
        const msg = ctx.results.generateMessage?.data?.message || '';
        const issues = ctx.results.reviewMessage?.data?.issues || [];
        return this.reviseMessage(msg, issues, ctx.profile, ctx.jobInfo, ctx.callAPI);
      },
    });
  },

  /**
   * 注册自定义工具（外部可调用以扩展能力）
   * @param {string} name    - 工具名称
   * @param {Object} tool    - { description, execute: async (context) => result }
   */
  registerTool(name, tool) {
    this._tools[name] = tool;
  },

  /**
   * 调用已注册工具
   * @param {string} name    - 工具名称
   * @param {Object} context - 执行上下文
   * @returns {*} 工具执行结果
   */
  async invokeTool(name, context) {
    const tool = this._tools[name];
    if (!tool) throw new Error(`工具 "${name}" 未注册`);
    return tool.execute(context);
  },

  // ============================================================
  // 规划器
  // ============================================================

  /**
   * 创建执行计划：定义步骤、依赖和执行顺序
   * @returns {Object} { steps: [{ id, dependencies, description }] }
   */
  _createPlan() {
    const steps = [
      {
        id: 'analyzeJD',
        dependencies: [],
        description: '分析岗位 JD，提取核心要求和关键技能',
      },
      {
        id: 'matchResume',
        dependencies: ['analyzeJD'],
        description: '将简历与 JD 匹配，计算匹配度',
      },
      {
        id: 'evaluateFit',
        dependencies: ['matchResume'],
        description: '评估匹配度并制定消息策略',
      },
      {
        id: 'generateMessage',
        dependencies: ['analyzeJD', 'matchResume', 'evaluateFit'],
        description: '根据分析结果生成打招呼消息',
      },
      {
        id: 'reviewMessage',
        dependencies: ['generateMessage'],
        description: '审查消息质量',
      },
    ];

    // 仅在审查发现问题时才需要修正步骤
    return { steps };
  },

  /**
   * 检查步骤的依赖是否全部满足
   * @param {Object} step    - 步骤定义
   * @param {Object} results - 已完成步骤的结果
   * @returns {boolean}
   */
  _checkDependencies(step, results) {
    return step.dependencies.every(dep => results[dep]?.success);
  },

  // ============================================================
  // ReAct 循环
  // ============================================================

  /**
   * 使用 ReAct 模式执行单个步骤
   * 流程：思考(think) → 行动(act) → 观察(observe) → 反思(reflect)
   *
   * @param {Object} step    - 步骤定义
   * @param {Object} context - 执行上下文
   * @returns {Object} { success, data, confidence, reflections }
   */
  async _executeStepWithReact(step, context) {
    let attempt = 0;
    let lastError = null;
    let strategy = 'default'; // 重试时可调整策略

    while (attempt < MAX_RETRIES) {
      attempt++;
      const startTime = Date.now();

      // --- 思考 ---
      const thought = this._think(step, context, attempt, lastError, strategy);
      this._emit('think', { step: step.id, thought, attempt });

      // --- 行动 ---
      try {
        const result = await this.invokeTool(step.id, {
          ...context,
          strategy,
          attempt,
        });

        // --- 观察 ---
        const observation = this._observe(step, result);

        // --- 结构化验证 ---
        const validation = this._validateOutput(step.id, observation.data);
        if (!validation.valid) {
          // 尝试自动修复
          const fixed = this._autoFixOutput(step.id, observation.data);
          if (fixed) {
            observation.data = fixed;
            observation.confidence *= 0.9; // 修复后降低置信度
          }
        }

        // --- 反思 ---
        const reflection = this._reflect(step, observation);
        const elapsed = Date.now() - startTime;

        this._recordTrace(step.id, true, observation.data, observation.confidence, elapsed, reflection);
        this._emit('stepComplete', {
          step: step.id,
          confidence: observation.confidence,
          elapsed,
          attempt,
        });

        // 如果置信度过低且还有重试机会，调整策略重试
        if (observation.confidence < 0.5 && attempt < MAX_RETRIES) {
          strategy = this._adjustStrategy(step, observation, attempt);
          lastError = new Error('置信度过低: ' + observation.confidence.toFixed(2));
          this._emit('lowConfidenceRetry', { step: step.id, confidence: observation.confidence, attempt });
          continue;
        }

        return {
          success: true,
          data: observation.data,
          confidence: observation.confidence,
          reflections: reflection,
        };
      } catch (err) {
        lastError = err;
        const elapsed = Date.now() - startTime;
        this._recordTrace(step.id, false, null, 0, elapsed, { error: err.message });
        this._emit('stepError', { step: step.id, error: err.message, attempt });

        // 自适应重试：分析错误并调整策略
        if (attempt < MAX_RETRIES) {
          strategy = this._adjustStrategy(step, { error: err.message }, attempt);
          continue;
        }
      }
    }

    // 所有重试用尽
    return { success: false, data: null, confidence: 0, error: lastError?.message };
  },

  /**
   * 思考阶段：生成当前步骤的推理
   * @returns {string} 思考内容
   */
  _think(step, context, attempt, lastError, strategy) {
    const parts = [`步骤 [${step.id}]：${step.description}`];
    if (attempt > 1) {
      parts.push(`第 ${attempt} 次尝试，策略: ${strategy}`);
      if (lastError) parts.push(`上次错误: ${lastError.message}`);
    }
    return parts.join(' | ');
  },

  /**
   * 观察阶段：分析执行结果
   * @returns {Object} { data, confidence }
   */
  _observe(step, result) {
    if (!result || !result.success) {
      return { data: result?.result || null, confidence: 0 };
    }
    // 根据结果丰富度估算置信度
    const data = result.result || result.data || result;
    let confidence = 0.7; // 基础置信度
    if (data && typeof data === 'object') {
      const keys = Object.keys(data);
      if (keys.length >= 3) confidence += 0.1;
      if (keys.length >= 5) confidence += 0.1;
    }
    if (typeof data === 'string' && data.length > 20) confidence += 0.1;
    return { data, confidence: Math.min(confidence, 1) };
  },

  /**
   * 反思阶段：评估步骤结果质量
   * @returns {Object} 反思结论
   */
  _reflect(step, observation) {
    const issues = [];
    if (observation.confidence < 0.5) issues.push('置信度过低');
    if (!observation.data) issues.push('结果为空');
    return {
      quality: observation.confidence >= 0.7 ? 'good' : observation.confidence >= 0.4 ? 'acceptable' : 'poor',
      issues,
      recommendation: issues.length > 0 ? '建议重试' : '可接受',
    };
  },

  /**
   * 自适应策略调整：根据错误类型和尝试次数调整执行策略
   * @returns {string} 新策略标识
   */
  _adjustStrategy(step, observation, attempt) {
    if (attempt === 1) return 'simplify_prompt';
    if (attempt === 2) return 'fallback_defaults';
    return 'default';
  },

  /**
   * 对整个结果的最终反思
   * @returns {Object} { needsRevision, issues, score }
   */
  _reflectOnResult(finalMessage, results) {
    const issues = [];
    if (!finalMessage || finalMessage.length < 20) issues.push('消息过短或为空');
    if (finalMessage && finalMessage.length > 200) issues.push('消息过长');
    if (results.reviewMessage?.data?.issues?.length > 0) {
      issues.push(...results.reviewMessage.data.issues);
    }
    const reviewScore = results.reviewMessage?.data?.score || 100;
    return {
      needsRevision: issues.length > 0 && reviewScore < 70,
      issues,
      score: reviewScore,
    };
  },

  // ============================================================
  // 结构化输出验证
  // ============================================================

  /**
   * 验证工具输出是否符合 schema
   * @param {string} toolName - 工具名称
   * @param {*} data          - 待验证数据
   * @returns {Object} { valid, errors }
   */
  _validateOutput(toolName, data) {
    const schema = TOOL_SCHEMAS[toolName];
    if (!schema || !data || typeof data !== 'object') return { valid: true, errors: [] };

    const errors = [];
    for (const field of schema.required) {
      if (data[field] === undefined) {
        errors.push(`缺少必填字段: ${field}`);
      }
    }
    for (const [field, expectedType] of Object.entries(schema.properties)) {
      if (data[field] !== undefined) {
        if (expectedType === 'array' && !Array.isArray(data[field])) {
          errors.push(`字段 ${field} 应为数组`);
        } else if (expectedType === 'number' && typeof data[field] !== 'number') {
          errors.push(`字段 ${field} 应为数字`);
        } else if (expectedType === 'boolean' && typeof data[field] !== 'boolean') {
          errors.push(`字段 ${field} 应为布尔值`);
        }
      }
    }
    return { valid: errors.length === 0, errors };
  },

  /**
   * 自动修复常见输出问题
   * @param {string} toolName - 工具名称
   * @param {Object} data     - 待修复数据
   * @returns {Object|null} 修复后的数据，无法修复返回 null
   */
  _autoFixOutput(toolName, data) {
    if (!data || typeof data !== 'object') return null;
    const fixed = { ...data };

    // 通用修复：字符串化数组字段
    const schema = TOOL_SCHEMAS[toolName];
    if (schema) {
      for (const [field, expectedType] of Object.entries(schema.properties)) {
        if (expectedType === 'array' && typeof fixed[field] === 'string') {
          try { fixed[field] = JSON.parse(fixed[field]); } catch (_) { fixed[field] = []; }
        }
        if (expectedType === 'number' && typeof fixed[field] === 'string') {
          const num = parseFloat(fixed[field]);
          if (!isNaN(num)) fixed[field] = num;
        }
      }
    }

    // 特定工具修复
    if (toolName === 'evaluateFit' && typeof fixed.score === 'number') {
      fixed.score = Math.round(Math.max(0, Math.min(100, fixed.score)));
    }
    if (toolName === 'matchResume' && typeof fixed.matchRatio === 'number') {
      fixed.matchRatio = Math.max(0, Math.min(1, fixed.matchRatio));
    }

    return fixed;
  },

  // ============================================================
  // 上下文窗口管理
  // ============================================================

  /**
   * 估算文本的 token 数量（粗略：1 中文字 ≈ 1.5 token，1 英文词 ≈ 1 token）
   * @param {string} text
   * @returns {number}
   */
  _estimateTokens(text) {
    if (!text) return 0;
    const chineseChars = (text.match(/[一-鿿]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars * 1.5 + otherChars / 4);
  },

  /**
   * 管理上下文：如果过长则摘要压缩
   * @param {Array} messages - 消息数组
   * @param {Function} callAPI - API 函数
   * @returns {Array} 处理后的消息数组
   */
  async _manageContext(messages, callAPI) {
    const totalChars = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
    if (totalChars < CONTEXT_CHAR_LIMIT) return messages;

    // 过长时：对系统消息之后的长内容进行摘要
    const systemMsg = messages.find(m => m.role === 'system');
    const userMsgs = messages.filter(m => m.role !== 'system');

    const summarized = [];
    for (const msg of userMsgs) {
      if ((msg.content?.length || 0) > 2000) {
        summarized.push({
          role: msg.role,
          content: msg.content.slice(0, 1500) + '\n...(内容已截断，共' + msg.content.length + '字符)',
        });
      } else {
        summarized.push(msg);
      }
    }

    return [systemMsg, ...summarized].filter(Boolean);
  },

  // ============================================================
  // 追踪记录
  // ============================================================

  /**
   * 记录推理链追踪信息
   */
  _recordTrace(step, success, data, confidence, elapsed = 0, reflection = null) {
    this._trace.push({
      step,
      success,
      confidence: Math.round((confidence || 0) * 100) / 100,
      elapsed,
      reflection,
      timestamp: Date.now(),
      dataPreview: data ? (typeof data === 'string' ? data.slice(0, 80) : JSON.stringify(data).slice(0, 80)) : null,
    });
  },

  // ============================================================
  // 工具实现（内部）
  // ============================================================

  /**
   * 工具：分析 JD
   * @private
   */
  async _toolAnalyzeJD(profile, jobInfo, callAPI) {
    const prompt = this._buildAnalyzePrompt(jobInfo, profile);
    const messages = await this._manageContext([
      { role: 'system', content: '你是岗位分析与简历匹配助手。客观评估匹配度，不要夸大。只返回 JSON。' },
      { role: 'user', content: prompt },
    ], callAPI);

    const response = await this._withTimeout(() => callAPI(messages));
    const parsed = this._parseJSON(response);
    return {
      success: true,
      result: parsed.analysis || parsed,
    };
  },

  /**
   * 工具：匹配简历
   * @private
   */
  async _toolMatchResume(profile, jobInfo, jdResult, callAPI) {
    // 如果 analyzeJD 已经返回了 match 数据，直接使用
    if (jdResult?.matchedSkills) {
      return { success: true, result: jdResult };
    }

    const prompt = `将求职者简历与以下岗位要求进行匹配。

岗位：${jobInfo.title || '未知'}
核心要求：${JSON.stringify(jdResult?.coreRequirements || [])}
关键技能：${JSON.stringify(jdResult?.keySkills || [])}

求职者：
- 技能：${profile.skills || '(无)'}
- 经历：${profile.experience || '(无)'}

返回严格 JSON：
{
  "matchedSkills": ["匹配的技能"],
  "matchedExperience": ["匹配的经历"],
  "gaps": ["缺少的技能"],
  "strengths": ["优势"],
  "matchRatio": 0.75
}
只返回 JSON。`;

    const response = await this._withTimeout(() => callAPI([
      { role: 'system', content: '你是简历匹配助手。客观评估，只返回 JSON。' },
      { role: 'user', content: prompt },
    ]));
    const parsed = this._parseJSON(response);
    return { success: true, result: parsed };
  },

  /**
   * 工具：生成消息
   * @private
   */
  async _toolGenerateMessage(profile, jobInfo, jdData, matchData, evalData, style, callAPI, stylePrompts) {
    const allStyles = { ...DEFAULT_STYLE_INSTRUCTIONS };
    if (stylePrompts) {
      for (const [key, config] of Object.entries(stylePrompts)) {
        if (config.instruction) allStyles[key] = config.instruction;
      }
    }
    const styleInstruction = allStyles[style] || allStyles.professional;

    const prompt = `根据以下信息，生成一条 Boss直聘打招呼消息。

求职者背景：
- 简历：${profile.resume || '(无)'}
- 经历：${profile.experience || '(无)'}
- 技能：${profile.skills || '(无)'}
- 到岗时间：${profile.availableDate || '(未填写)'}
- 实习时长：${profile.internshipDuration || '(未填写)'}
- 求职类型：${profile.jobType || '(未填写)'}
- 转正意愿：${profile.wantFulltime || '(未填写)'}

目标岗位：${jobInfo.title} @ ${jobInfo.company || '未知'}
薪资：${jobInfo.salary || '未知'}
地点：${jobInfo.location || '未知'}

匹配分析：
- 匹配技能：${JSON.stringify(matchData.matchedSkills || [])}
- 突出优势：${JSON.stringify(matchData.strengths || [])}
- 消息策略：${evalData.strategy || '直接展示匹配技能'}

风格要求：${styleInstruction}

消息规则：
1. 80-150 字
2. 三段式：能力匹配 → 到岗信息 → 收尾提问
3. 只用简历中已有的信息，绝对不编造
4. 直接输出消息，不要前缀、引号、说明

只输出消息文本。`;

    const response = await this._withTimeout(() => callAPI([
      { role: 'system', content: '你是求职消息撰写助手。直接输出打招呼消息，不要其他内容。' },
      { role: 'user', content: prompt },
    ]));

    return { success: true, result: { message: response.trim() } };
  },

  /**
   * 工具：审查消息
   * @private
   */
  async _toolReviewMessage(message, profile, callAPI) {
    const prompt = `审查以下求职打招呼消息的质量。

消息：
${message}

求职者真实信息：
- 简历：${profile.resume || '(无)'}
- 技能：${profile.skills || '(无)'}

审查规则：
1. 是否编造了简历中没有的经历/数据？
2. 是否超过 150 字？
3. 是否有空洞表达（"我对贵公司很感兴趣"）？
4. 是否包含到岗信息？
5. 是否有收尾提问？

返回严格 JSON：
{
  "issues": ["问题1", "问题2"],
  "suggestions": ["建议1"],
  "length": 120,
  "hasFabrication": false,
  "score": 85
}
只返回 JSON。`;

    const response = await this._withTimeout(() => callAPI([
      { role: 'system', content: '你是消息审查助手。严格审查，只返回 JSON。' },
      { role: 'user', content: prompt },
    ]));
    const parsed = this._parseJSON(response);
    return { success: true, result: parsed };
  },

  // ============================================================
  // 旧版兼容方法（保持原有签名不变）
  // ============================================================

  /**
   * 超时包装器：为 API 调用添加超时保护
   */
  async _withTimeout(promiseFn, timeoutMs = API_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('API 调用超时（' + (timeoutMs / 1000) + '秒）'));
      }, timeoutMs);

      promiseFn().then(
        (result) => { clearTimeout(timer); resolve(result); },
        (err) => { clearTimeout(timer); reject(err); }
      );
    });
  },

  /**
   * 合并分析 JD + 匹配简历（旧版兼容，单次 API 调用）
   */
  async analyzeAndMatch(profile, jobInfo, callAPI) {
    const prompt = this._buildAnalyzePrompt(jobInfo, profile) + `

求职者简历：
- 摘要：${profile.resume || '(无)'}
- 经历：${profile.experience || '(无)'}
- 技能：${profile.skills || '(无)'}
- 学历：${profile.education || '(无)'}

返回格式（严格 JSON，不要其他内容）：
{
  "analysis": {
    "coreRequirements": ["核心要求1", "核心要求2"],
    "niceToHave": ["加分项1", "加分项2"],
    "roleType": "技术/产品/运营/设计/其他",
    "seniority": "初级/中级/高级",
    "keySkills": ["技能1", "技能2"]
  },
  "match": {
    "matchedSkills": ["匹配的技能1", "匹配的技能2"],
    "matchedExperience": ["匹配的经历1", "匹配的经历2"],
    "gaps": ["缺少的技能1"],
    "strengths": ["突出的优势1", "突出的优势2"],
    "matchRatio": 0.75
  }
}

只返回 JSON，不要其他内容。`;

    try {
      const response = await this._withTimeout(() => callAPI([
        { role: 'system', content: '你是岗位分析与简历匹配助手。客观评估匹配度，不要夸大。只返回 JSON。' },
        { role: 'user', content: prompt },
      ]));
      const parsed = this._parseJSON(response);
      return {
        analyzeJD: { success: true, result: parsed.analysis || { coreRequirements: [], keySkills: [] } },
        matchResume: { success: true, result: parsed.match || { matchedSkills: [], matchRatio: 0 } },
      };
    } catch (e) {
      throw new Error('分析岗位失败: ' + e.message);
    }
  },

  /**
   * 构建 JD 分析提示词（复用逻辑）
   */
  _buildAnalyzePrompt(jobInfo, profile) {
    return `分析以下岗位 JD。

岗位：${jobInfo.title || '未知'}
公司：${jobInfo.company || '未知'}
薪资：${jobInfo.salary || '未知'}
地点：${jobInfo.location || '未知'}
JD：${jobInfo.jd || '(无)'}`;
  },

  /**
   * 评估匹配度（本地计算，无需 API）
   */
  evaluateFit(matchResult) {
    const ratio = matchResult.matchRatio || 0;
    let strategy = '';

    if (ratio >= 0.7) {
      strategy = '高匹配：直接展示匹配的技能和经历，自信表达';
    } else if (ratio >= 0.4) {
      strategy = '中匹配：强调可迁移技能和学习能力，展示潜力';
    } else {
      strategy = '低匹配：突出通用能力（沟通、学习、执行力），表达强烈兴趣';
    }

    return {
      success: true,
      result: {
        score: Math.round(ratio * 100),
        strategy,
        emphasis: ratio >= 0.7 ? 'skills' : ratio >= 0.4 ? 'potential' : 'attitude',
      },
    };
  },

  /**
   * 合并生成消息 + 自我审查（旧版兼容，单次 API 调用）
   */
  async generateAndReview(profile, jobInfo, jdAnalysis, matchResult, evaluation, style, callAPI, stylePrompts) {
    const allStyles = { ...DEFAULT_STYLE_INSTRUCTIONS };
    if (stylePrompts) {
      for (const [key, config] of Object.entries(stylePrompts)) {
        if (config.instruction) allStyles[key] = config.instruction;
      }
    }
    const styleInstruction = allStyles[style] || allStyles.professional;

    const prompt = `根据以下信息，生成一条 Boss直聘打招呼消息，然后自我审查。

求职者背景：
- 简历：${profile.resume || '(无)'}
- 经历：${profile.experience || '(无)'}
- 技能：${profile.skills || '(无)'}
- 到岗时间：${profile.availableDate || '(未填写)'}
- 实习时长：${profile.internshipDuration || '(未填写)'}
- 求职类型：${profile.jobType || '(未填写)'}
- 转正意愿：${profile.wantFulltime || '(未填写)'}

目标岗位：${jobInfo.title} @ ${jobInfo.company || '未知'}
薪资：${jobInfo.salary || '未知'}
地点：${jobInfo.location || '未知'}

匹配分析：
- 匹配技能：${JSON.stringify(matchResult.matchedSkills || [])}
- 匹配经历：${JSON.stringify(matchResult.matchedExperience || [])}
- 突出优势：${JSON.stringify(matchResult.strengths || [])}
- 消息策略：${evaluation.strategy}

风格要求：${styleInstruction}

消息规则：
1. 80-150 字
2. 三段式：能力匹配 → 到岗信息 → 收尾提问
3. 只用简历中已有的信息，绝对不编造
4. 直接输出消息，不要前缀、引号、说明

审查规则：
1. 是否编造了简历中没有的经历/数据？
2. 是否超过 150 字？
3. 是否有空洞表达（"我对贵公司很感兴趣"）？
4. 是否包含到岗信息？
5. 是否有收尾提问？

返回严格 JSON（不要其他内容）：
{
  "message": "生成的打招呼消息",
  "review": {
    "issues": ["问题1", "问题2"],
    "suggestions": ["建议1"],
    "length": 120,
    "hasFabrication": false,
    "score": 85
  }
}

只返回 JSON。`;

    try {
      const response = await this._withTimeout(() => callAPI([
        { role: 'system', content: '你是求职消息撰写助手。先写消息，再自我审查。只返回 JSON，不要其他内容。' },
        { role: 'user', content: prompt },
      ]));
      const parsed = this._parseJSON(response);
      return {
        draft: { success: true, result: parsed.message || '' },
        review: { success: true, result: parsed.review || { issues: [], score: 0 } },
      };
    } catch (e) {
      throw new Error('生成消息失败: ' + e.message);
    }
  },

  /**
   * 根据审查意见修正消息
   */
  async reviseMessage(message, issues, profile, jobInfo, callAPI) {
    const prompt = `修正以下消息中的问题。

原消息：
${message}

发现的问题：
${issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}

求职者真实信息：
- 简历：${profile.resume || '(无)'}
- 技能：${profile.skills || '(无)'}

规则：
- 只修正问题，不要大幅改动
- 绝对不编造简历中没有的内容
- 保持 80-150 字
- 直接输出修正后的消息`;

    try {
      const response = await this._withTimeout(() => callAPI([
        { role: 'system', content: '你是消息修正助手。只输出修正后的消息，不要其他内容。' },
        { role: 'user', content: prompt },
      ]));
      return { success: true, result: response.trim() };
    } catch (e) {
      return { success: false, result: message, error: e.message };
    }
  },

  // ============================================================
  // JSON 解析（增强版）
  // ============================================================

  /**
   * 解析 JSON 字符串
   * 处理策略：strip markdown 围栏 → 直接解析 → 正则提取 → 修复常见错误
   */
  _parseJSON(text) {
    if (!text) throw new Error('AI 返回为空');

    // 去除 markdown 代码围栏
    let cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/gi, '').trim();

    // 直接解析
    try {
      return JSON.parse(cleaned);
    } catch (_) { /* 继续尝试 */ }

    // 正则提取第一个 JSON 对象
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (_) {
        // 修复常见 JSON 错误：尾逗号、单引号
        let fixed = match[0]
          .replace(/,\s*([\]}])/g, '$1')         // 去尾逗号
          .replace(/'/g, '"')                      // 单引号转双引号
          .replace(/(\w+)\s*:/g, '"$1":');           // 未加引号的键名（简化处理）
        try {
          return JSON.parse(fixed);
        } catch (e3) {
          throw new Error('JSON 解析失败: ' + e3.message);
        }
      }
    }
    throw new Error('无法从 AI 返回中提取 JSON');
  },
};

// 自动初始化内置工具
BossAgent.init();

// 导出（兼容浏览器全局变量和 ES Module）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BossAgent, AgentState };
} else if (typeof window !== 'undefined') {
  window.BossAgent = BossAgent;
  window.AgentState = AgentState;
}
