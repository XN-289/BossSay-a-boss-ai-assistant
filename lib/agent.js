/**
 * BossSay - AI Agent 模块
 * 实现 ReAct 模式的多步推理链
 *
 * 架构：
 *   Analyze JD → Match Resume → Evaluate Fit → Generate → Review
 *   每一步都是独立的 API 调用，有结构化的输入输出
 */

const BossAgent = {
  /**
   * Agent 主入口：执行多步推理链
   * @param {Object} params
   * @param {Object} params.profile - 求职者资料
   * @param {Object} params.jobInfo - 岗位信息
   * @param {string} params.style - 消息风格
   * @param {Function} params.callAPI - API 调用函数 (messages) => response
   * @returns {Object} { message, trace }
   */
  async run(params) {
    const { profile, jobInfo, style, callAPI } = params;
    const trace = []; // 推理链追踪

    // Step 1: 分析 JD
    const jdAnalysis = await this.analyzeJD(jobInfo, callAPI);
    trace.push({ step: 'analyze_jd', ...jdAnalysis });

    // Step 2: 匹配简历
    const matchResult = await this.matchResume(profile, jdAnalysis.result, callAPI);
    trace.push({ step: 'match_resume', ...matchResult });

    // Step 3: 评估匹配度
    const evaluation = await this.evaluateFit(matchResult.result, callAPI);
    trace.push({ step: 'evaluate_fit', ...evaluation });

    // Step 4: 生成消息
    const draft = await this.generateDraft(profile, jobInfo, jdAnalysis.result, matchResult.result, evaluation.result, style, callAPI);
    trace.push({ step: 'generate_draft', ...draft });

    // Step 5: 自我审查
    const review = await this.reviewMessage(draft.result, profile, jobInfo, callAPI);
    trace.push({ step: 'review', ...review });

    // 如果审查发现问题，用审查意见修正
    let finalMessage = draft.result;
    if (review.result && review.result.issues && review.result.issues.length > 0) {
      const revised = await this.reviseMessage(draft.result, review.result.issues, profile, jobInfo, callAPI);
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
   * Step 1: 分析 JD，提取结构化要求
   */
  async analyzeJD(jobInfo, callAPI) {
    const prompt = `分析以下岗位 JD，提取结构化信息。返回 JSON。

岗位：${jobInfo.title || '未知'}
公司：${jobInfo.company || '未知'}
薪资：${jobInfo.salary || '未知'}
地点：${jobInfo.location || '未知'}
JD：${jobInfo.jd || '(无)'}

返回格式：
{
  "coreRequirements": ["核心要求1", "核心要求2"],
  "niceToHave": ["加分项1", "加分项2"],
  "roleType": "技术/产品/运营/设计/其他",
  "seniority": "初级/中级/高级",
  "keySkills": ["技能1", "技能2"]
}

只返回 JSON，不要其他内容。`;

    try {
      const response = await callAPI([
        { role: 'system', content: '你是岗位分析助手。只返回 JSON。' },
        { role: 'user', content: prompt },
      ]);
      const parsed = this._parseJSON(response);
      return { success: true, result: parsed };
    } catch (e) {
      return { success: false, result: { coreRequirements: [], keySkills: [] }, error: e.message };
    }
  },

  /**
   * Step 2: 匹配简历和 JD 要求
   */
  async matchResume(profile, jdAnalysis, callAPI) {
    const prompt = `将求职者简历与岗位要求进行匹配。返回 JSON。

求职者简历：
- 摘要：${profile.resume || '(无)'}
- 经历：${profile.experience || '(无)'}
- 技能：${profile.skills || '(无)'}
- 学历：${profile.education || '(无)'}

岗位核心要求：${JSON.stringify(jdAnalysis.coreRequirements || [])}
岗位关键技能：${JSON.stringify(jdAnalysis.keySkills || [])}

返回格式：
{
  "matchedSkills": ["匹配的技能1", "匹配的技能2"],
  "matchedExperience": ["匹配的经历1", "匹配的经历2"],
  "gaps": ["缺少的技能1"],
  "strengths": ["突出的优势1", "突出的优势2"],
  "matchRatio": 0.75
}

只返回 JSON。`;

    try {
      const response = await callAPI([
        { role: 'system', content: '你是简历匹配分析助手。客观评估匹配度，不要夸大。只返回 JSON。' },
        { role: 'user', content: prompt },
      ]);
      const parsed = this._parseJSON(response);
      return { success: true, result: parsed };
    } catch (e) {
      return { success: false, result: { matchedSkills: [], matchRatio: 0 }, error: e.message };
    }
  },

  /**
   * Step 3: 评估匹配度，决定消息策略
   */
  async evaluateFit(matchResult, callAPI) {
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
   * Step 4: 生成消息初稿
   */
  async generateDraft(profile, jobInfo, jdAnalysis, matchResult, evaluation, style, callAPI) {
    const STYLE_INSTRUCTIONS = {
      professional: '语气专业、简洁、自信。用数据和成果说话。',
      friendly: '语气热情、真诚、有温度。展示真诚兴趣。',
      humor: '语气轻松、幽默、有个性。保持专业底线。',
      concise: '不超过 120 字，信息密度最高。不废话。',
    };

    const styleInstruction = STYLE_INSTRUCTIONS[style] || STYLE_INSTRUCTIONS.professional;

    const prompt = `根据以下信息，生成一条 Boss直聘打招呼消息。

求职者背景：
- 简历：${profile.resume || '(无)'}
- 经历：${profile.experience || '(无)'}
- 技能：${profile.skills || '(无)'}
- 到岗时间：${profile.availableDate || '(未填写)'}
- 实习时长：${profile.internshipDuration || '(未填写)'}
- 求职类型：${profile.jobType || '(未填写)'}
- 转正意愿：${profile.wantFulltime || '(未填写)'}

目标岗位：${jobInfo.title} @ ${jobInfo.company}
薪资：${jobInfo.salary || '未知'}
地点：${jobInfo.location || '未知'}

匹配分析：
- 匹配技能：${JSON.stringify(matchResult.matchedSkills || [])}
- 匹配经历：${JSON.stringify(matchResult.matchedExperience || [])}
- 突出优势：${JSON.stringify(matchResult.strengths || [])}
- 消息策略：${evaluation.strategy}

风格要求：${styleInstruction}

规则：
1. 80-150 字
2. 三段式：能力匹配 → 到岗信息 → 收尾提问
3. 只用简历中已有的信息，绝对不编造
4. 直接输出消息，不要前缀、引号、说明`;

    try {
      const response = await callAPI([
        { role: 'system', content: '你是求职消息撰写助手。只输出消息内容，不要其他任何文字。' },
        { role: 'user', content: prompt },
      ]);
      return { success: true, result: response.trim() };
    } catch (e) {
      return { success: false, result: '', error: e.message };
    }
  },

  /**
   * Step 5: 自我审查
   */
  async reviewMessage(message, profile, jobInfo, callAPI) {
    const prompt = `审查以下 Boss直聘打招呼消息，检查是否有问题。

消息内容：
${message}

求职者真实信息：
- 简历：${profile.resume || '(无)'}
- 技能：${profile.skills || '(无)'}

返回 JSON：
{
  "issues": ["问题1", "问题2"],
  "suggestions": ["建议1"],
  "length": 120,
  "hasFabrication": false,
  "score": 85
}

检查项：
1. 是否编造了简历中没有的经历/数据？
2. 是否超过 150 字？
3. 是否有空洞表达（"我对贵公司很感兴趣"）？
4. 是否包含到岗信息？
5. 是否有收尾提问？

只返回 JSON。`;

    try {
      const response = await callAPI([
        { role: 'system', content: '你是消息审查助手。严格检查，不要放过任何问题。只返回 JSON。' },
        { role: 'user', content: prompt },
      ]);
      const parsed = this._parseJSON(response);
      return { success: true, result: parsed };
    } catch (e) {
      return { success: false, result: { issues: [], score: 0 }, error: e.message };
    }
  },

  /**
   * Step 6: 根据审查意见修正消息
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
      const response = await callAPI([
        { role: 'system', content: '你是消息修正助手。只输出修正后的消息，不要其他内容。' },
        { role: 'user', content: prompt },
      ]);
      return { success: true, result: response.trim() };
    } catch (e) {
      return { success: false, result: message, error: e.message };
    }
  },

  /**
   * 解析 JSON 字符串
   */
  _parseJSON(text) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('无法解析 JSON');
  },
};
