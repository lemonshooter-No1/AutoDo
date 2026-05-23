import { recomputeCategoryPrices } from "./matching/category-prices.js";
import { getMatchingConfig } from "./matching/config.js";
import { previewMatch } from "./matching/preview.js";
import { applyPolicy, selectPolicyMode } from "./matching/policy.js";
import { recallCandidates, resolveTaskProfile } from "./matching/recall.js";
import { buildScoreBreakdown, scoreCandidates } from "./matching/scoring.js";
import { recordPush } from "./matching/stats.js";

export { previewMatch };

/** ④ 派单 + Push inbox（MatchScore v1） */
export function dispatchTask(state, task) {
  const config = getMatchingConfig();
  recomputeCategoryPrices(state, config);
  const candidates = recallCandidates(state, task, config);
  const profile = resolveTaskProfile(task, config);
  const scored = scoreCandidates(state, task, candidates, config);
  const policy = selectPolicyMode(task, config);
  const selected = applyPolicy(scored, policy, task, config);

  const pushed = [];
  const now = new Date().toISOString();

  for (const row of selected) {
    const exists = state.inbox.some(
      (i) => i.worker_id === row.worker_id && i.task_id === task.id
    );
    if (exists) continue;

    const breakdown = buildScoreBreakdown(row);
    state.inbox.push({
      worker_id: row.worker_id,
      task_id: task.id,
      accepted: false,
      pushed_at: now,
      match_score: row.M,
      score_breakdown: breakdown,
      offer_mode: policy,
      offer_expires_at: row.offer_expires_at || null,
      explore: row.explore || false,
    });
    recordPush(state, row.worker, task, { explore: row.explore });
    pushed.push(row.worker_id);
  }

  task.dispatch_policy = policy;
  task.match_profile = profile;
  task.dispatch_log = {
    at: now,
    policy,
    task_profile: profile,
    candidate_count: candidates.length,
    pushed_count: pushed.length,
    category_prices: state.matching_meta?.category_price_cents,
    explore_slots: selected.filter((r) => r.explore).length,
    top: selected.map(buildScoreBreakdown),
  };
  task.push_sent_to = [...(task.push_sent_to || []), ...pushed];
  task.status = "dispatching";
  task.updated_at = now;
  return pushed;
}
