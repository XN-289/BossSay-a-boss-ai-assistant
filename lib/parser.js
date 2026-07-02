/**
 * BossSay - JD 解析模块
 * 从 Boss 直聘页面提取岗位信息
 */

/**
 * Boss 直聘页面选择器配置
 * 如果页面结构更新，用户可以自定义这些选择器
 */
const DEFAULT_SELECTORS = {
  // 职位名称
  jobTitle: '.job-name',
  // 薪资范围
  salary: '.salary',
  // 工作地点
  location: '.job-area-wrapper .job-area',
  // JD 正文（岗位描述）
  jdContent: '.job-detail-section .job-sec-text',
  // 岗位要求（技能标签等）
  requirements: '.job-tags .tag-list li',
  // 公司名称
  company: '.company-info .company-name',
  // 公司简介
  companyInfo: '.company-info .company-tag-list',
  // HR 信息
  bossName: '.info-primary .name',
  bossTitle: '.info-primary .boss-title',
};

/**
 * 从页面元素中安全提取文本
 * @param {Element|null} element
 * @returns {string}
 */
function safeGetText(element) {
  if (!element) return '';
  return element.textContent?.trim() || '';
}

/**
 * 从页面元素中提取所有子元素的文本
 * @param {string} selector - CSS 选择器
 * @returns {string[]}
 */
function safeGetAllText(selector) {
  const elements = document.querySelectorAll(selector);
  return Array.from(elements).map(el => el.textContent?.trim()).filter(Boolean);
}

/**
 * 清理 JD 文本，去除多余空白
 * @param {string} text
 * @returns {string}
 */
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}

/**
 * 从 Boss 直聘岗位详情页提取岗位信息
 * @param {Object} [customSelectors] - 自定义选择器（可选）
 * @returns {Object} 岗位信息
 */
function extractJobInfo(customSelectors) {
  const selectors = { ...DEFAULT_SELECTORS, ...customSelectors };

  // 提取各个字段
  const jobTitle = safeGetText(document.querySelector(selectors.jobTitle));
  const salary = safeGetText(document.querySelector(selectors.salary));
  const location = safeGetText(document.querySelector(selectors.location));
  const company = safeGetText(document.querySelector(selectors.company));
  const bossName = safeGetText(document.querySelector(selectors.bossName));
  const bossTitle = safeGetText(document.querySelector(selectors.bossTitle));

  // JD 正文 - 可能在多个 section 中
  let jdContent = '';
  const jdElements = document.querySelectorAll(selectors.jdContent);
  if (jdElements.length > 0) {
    jdContent = Array.from(jdElements)
      .map(el => el.textContent?.trim())
      .filter(Boolean)
      .join('\n');
  }

  // 如果没有找到 JD，尝试更通用的选择器
  if (!jdContent) {
    const fallbackSelectors = [
      '.job-detail-section',
      '.job-sec-text',
      '[class*="job-detail"]',
      '[class*="job-desc"]',
    ];
    for (const sel of fallbackSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent?.trim().length > 50) {
        jdContent = el.textContent.trim();
        break;
      }
    }
  }

  // 技能标签
  const requirements = safeGetAllText(selectors.requirements);

  // 公司信息
  const companyInfo = safeGetText(document.querySelector(selectors.companyInfo));

  // 组装结果
  const jobInfo = {
    title: cleanText(jobTitle),
    salary: cleanText(salary),
    location: cleanText(location),
    company: cleanText(company),
    bossName: cleanText(bossName),
    bossTitle: cleanText(bossTitle),
    jd: cleanText(jdContent),
    requirements: requirements,
    companyInfo: cleanText(companyInfo),
  };

  return jobInfo;
}

/**
 * 检查当前页面是否是 Boss 直聘岗位详情页
 * @returns {boolean}
 */
function isJobDetailPage() {
  const url = window.location.href;
  return url.includes('zhipin.com/job_detail') || url.includes('zhipin.com/web/geek/job');
}

/**
 * 从页面中提取岗位信息的简化版本
 * 用于快速获取关键信息
 * @returns {Object}
 */
function extractJobInfoSimple() {
  const jobTitle = safeGetText(document.querySelector('.job-name, [class*="job-name"]'));
  const salary = safeGetText(document.querySelector('.salary, [class*="salary"]'));
  const location = safeGetText(document.querySelector('.job-area, [class*="job-area"]'));
  const company = safeGetText(document.querySelector('.company-name, [class*="company-name"]'));

  // 尝试获取 JD 内容
  let jd = '';
  const jdSelectors = [
    '.job-detail-section .job-sec-text',
    '.job-detail-section',
    '.job-sec-text',
    '[class*="job-detail"]',
    '[class*="job-desc"]',
  ];

  for (const sel of jdSelectors) {
    const el = document.querySelector(sel);
    if (el && el.textContent?.trim().length > 30) {
      jd = el.textContent.trim();
      break;
    }
  }

  return {
    title: cleanText(jobTitle),
    salary: cleanText(salary),
    location: cleanText(location),
    company: cleanText(company),
    jd: cleanText(jd),
  };
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_SELECTORS,
    extractJobInfo,
    extractJobInfoSimple,
    isJobDetailPage,
    cleanText,
  };
}
