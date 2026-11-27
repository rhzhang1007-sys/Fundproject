import {AI_BASE} from './ai-writing.mjs';
const RULES=AI_BASE+'依据是程序已计算的指标卡。使用准确中文指标名和给定区间，把结论落在数字上，优先解释事实的意义和可执行的研究步骤。内部口径规则：crossCheck=agree是同源口径筛查；累计净值比值不等于分红再投资收益。正文直接使用指标卡的收益名称与区间，无需复述内部规则。';
export const ANALYSIS_PROMPTS={
 analysis_overview:RULES+'概括组合结构、共同持股和风险来源，指出优先查看的指标。',
 analysis_structure:RULES+'解释共同持股、名义与有效持股、资金与风险贡献的差异，指出值得继续研究的联系。',
 analysis_cost:RULES+'在共同区间与相同费用项目下比较收益、回撤、波动和费用。',
 analysis_history:RULES+'结合回撤深度、持续时间、修复过程和持有期限解释历史体验。移除最差交易日的结果使用事后敏感性测算名称。',
 analysis_limits:RULES+'说明当前可以回答的问题。影响具体判断的缺失字段，只点明应查看的具体资料与查看方向。',
 analysis_ask:RULES+'先回答问题，再给指标依据，最后提供观察或核对动作。'
};
