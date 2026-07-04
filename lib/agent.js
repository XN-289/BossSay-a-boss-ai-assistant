/**
 * BossSay - AI Agent 模块
 * 实现 ReAct 模式的多步推理链
 *
 * 架构：
 *   Analyze JD + Match Resume (combined) → Evaluate Fit → Generate Draft + Review (combined)
 *   每一步都有 30 秒超时保护
 */

const BossAgent = {
  /**
   * Agent 主入口：执行多步推理链
   * @param {Object} params
   * @param {Object} params.profile - 求职者资料
   * @param {Object} params.jobInfo - 岗位信息
   * @param {string} params.style - 消息风格
   * @param {Function} params.callAPI - API 调用函数 (messages) => response
   * @param {Object} [params.stylePrompts] - 用户自定义风格配置
   * @param {Function} [params.onProgress] - 进度回调 (stepName, detail) => void
   * @returns {Object} { message, trace }
   */
  async run(params) {
    const { profile, jobInfo, style, callAPI, stylePrompts, onProgress } = params;
    const trace = []; // 推理链追踪
    const progress = onProgress || (() => {});

    // Step 1: 分析 JD + 匹配简历（合并为一次 API 调用）
    progress('analyze_jd', '分析岗位 + 匹配简历...');
    const analysisResult = await this.analyzeAndMatch(profile, jobInfo, callAPI);
    trace.push({ step: 'analyze_jd', ...analysisResult.analyzeJD });
    trace.push({ step: 'match_resume', ...analysisResult.matchResume });

    // Step 2: 评估匹配度（本地计算，无需 API）
    progress('evaluate_fit', '评估匹配度...');
    const matchResult = analysisResult.matchResume.result || { matchedSkills: [], matchRatio: 0 };
    const evaluation = this.evaluateFit(matchResult);
    trace.push({ step: 'evaluate_fit', ...evaluation });

    // Step 3: 生成消息 + 自我审查（合并为一次 API 调用）
    progress('generate_draft', '生成消息 + 审查...');
    const draftAndReview = await this.generateAndReview(
      profile, jobInfo, analysisResult.analyzeJD.result, matchResult, evaluation.result, style, callAPI, stylePrompts
    );
    trace.push({ step: 'generate_draft', ...draftAndReview.draft });
    trace.push({ step: 'review', ...draftAndReview.review });

    // 如果审查发现问题，用审查意见修正
    let finalMessage = draftAndReview.draft.result;
    if (draftAndReview.review.result && draftAndReview.review.result.issues && draftAndReview.review.result.issues.length > 0) {
      progress('revise', '修正消息...');
      const revised = await this.reviseMessage(
        finalMessage, draftAndReview.review.result.issues, profile, jobInfo, callAPI
      );
      trace.push({ step: 'revise', ...revised });
      finalMessage = revised.result;
    }

    return {
      message: finalMessage,
      trace: trace,
      matchScore: evaluation.result?.score || 0,
    };
  },

  /**
   * 超时包装器：为 API 调用添加 30 秒超时
   */
  async _withTimeout(promiseFn, timeoutMs = 30000) {
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
   * Step 1: 合并分析 JD + 匹配简历（单次 API 调用）
   */
  async analyzeAndMatch(profile, jobInfo, callAPI) {
    const prompt = `分析以下岗位 JD 并将求职者简历与岗位要求进行匹配。返回 JSON。

岗位：${jobInfo.title || '未知'}
公司：${jobInfo.company || '未知'}
薪资：${jobInfo.salary || '未知'}
地点：${jobInfo.location || '未知'}
JD：${jobInfo.jd || '(无)'}

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
   * Step 2: 评估匹配度（本地计算，无需 API）
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
        strategy: strategy,
        emphasis: ratio >= 0.7 ? 'skills' : ratio >= 0.4 ? 'potential' : 'attitude',
      },
    };
  },

  /**
   * Step 3: 合并生成消息 + 自我审查（单次 API 调用）
   */
  async generateAndReview(profile, jobInfo, jdAnalysis, matchResult, evaluation, style, callAPI, stylePrompts) {
    // 优先使用用户自定义的风格配置
    const DEFAULT_STYLE_INSTRUCTIONS = {
      professional: '语气专业、简洁、自信。用数据和成果说话。',
      friendly: '语气热情、真诚、有温度。展示真诚兴趣。',
      humor: '语气轻松、幽默、有个性。保持专业底线。',
      concise: '不超过 120 字，信息密度最高。不废话。',
    };

    const allStyles = { ...DEFAULT_STYLE_INSTRUCTIONS };
    if (stylePrompts) {
      for (const [key, config] of Object.entries(stylePrompts)) {
        if (config.instruction) {
          allStyles[key] = config.instruction;
        }
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
   * Step 4: 根据审查意见修正消息
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

  /**
   * 解析 JSON 字符串 - 更健壮的版本
   * 1. 先尝试 strip markdown code fences
   * 2. 直接 JSON.parse
   * 3. 回退到正则匹配
   */
  _parseJSON(text) {
    if (!text) throw new Error('AI 返回为空');

    // Strip markdown code fences
    let cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/gi, '').trim();

    // 尝试直接解析整个内容
    try {
      return JSON.parse(cleaned);
    } catch (e1) {
      // 回退到正则匹配第一个 JSON 对象
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch (e2) {
          // 尝试修复常见 JSON 错误（尾逗号等）
          const fixed = match[0].replace(/,\s*([\]}])/g, '$1');
          try {
            return JSON.parse(fixed);
          } catch (e3) {
            throw new Error('JSON 解析失败: ' + e3.message);
          }
        }
      }
      throw new Error('无法从 AI 返回中提取 JSON');
    }
  },
};
