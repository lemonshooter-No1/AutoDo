import { recomputeCategoryPrices } from "./category-prices.js";
import { getMatchingConfig } from "./config.js";
import { recallCandidates, resolveTaskProfile } from "./recall.js";
import { applyPolicy, selectPolicyMode } from "./policy.js";
import { buildScoreBreakdown, scoreCandidates } from "./scoring.js";

/** 内部调试：预览匹配结果（不写入 inbox） */
export function previewMatch(state, task) {
  const config = getMatchingConfig();
  recomputeCategoryPrices(state, config);
  const candidates = recallCandidates(state, task, config);
  const profile = resolveTaskProfile(task, config);
  const scored = scoreCandidates(state, task, candidates, config);
  const policy = selectPolicyMode(task, config);
  const selected = applyPolicy(scored, policy, task, config);

  return {
    task_id: task.id,
    task_profile: profile,
    policy,
    candidate_count: candidates.length,
    would_push_count: selected.length,
    category_prices: state.matching_meta?.category_price_cents,
    top_scored: scored.slice(0, 10).map(buildScoreBreakdown),
    selected: selected.map(buildScoreBreakdown),
  };
}
