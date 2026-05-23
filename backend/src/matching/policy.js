import {
  isExploreCandidate,
  thompsonAcceptSample,
} from "./bandit.js";

export function selectPolicyMode(task, config) {
  const spec = task.spec || {};
  const price = task.escrow_cents || spec.suggested_price_cents || 0;
  const threshold = config.policy?.serial_price_threshold_cents ?? 15000;
  const exec = spec.executable_ready ? 0.95 : 0.7;
  if (price >= threshold || exec < 0.88) return "serial";
  return "broadcast";
}

/**
 * 从 Top-K 之外的候选池中，用 Thompson Sampling 选一名探索雇员
 * 优先：冷启动 / 高不确定，且采样值不低于末位 exploit 的一定比例
 */
function pickExploreReplacement(scored, selectedCount, task, config) {
  const taskType = task.spec?.task_type || "general";
  const exploreCfg = config.explore || {};
  const minRank = selectedCount;
  const pool = scored.slice(minRank);

  const exploitLast = scored[Math.min(selectedCount, scored.length) - 1];
  const minRatio = exploreCfg.min_sample_vs_last ?? 0.75;

  let best = null;
  let bestSample = -1;

  for (const row of pool) {
    if (!isExploreCandidate(row.worker, taskType, config)) continue;

    const { sample } = thompsonAcceptSample(
      row.worker,
      taskType,
      config,
      task.id
    );
    if (exploitLast && sample < exploitLast.P_accept * minRatio) continue;

    if (sample > bestSample) {
      bestSample = sample;
      best = row;
    }
  }

  if (!best && pool.length) {
    for (const row of pool) {
      const { sample } = thompsonAcceptSample(
        row.worker,
        taskType,
        config,
        task.id
      );
      if (sample > bestSample) {
        bestSample = sample;
        best = row;
      }
    }
  }

  return best;
}

/** broadcast：动态 K + Thompson 探索（替换末位） */
export function applyBroadcastPolicy(scored, task, config) {
  const pol = config.policy || {};
  const exploreCfg = config.explore || {};
  const kMin = pol.k_min ?? 2;
  const kMax = pol.k_max ?? 5;
  const target = pol.coverage_target ?? 0.7;
  const epsilon = exploreCfg.epsilon ?? pol.epsilon_explore ?? 0.1;

  if (!scored.length) return [];

  let cumulative = 0;
  const selected = [];
  for (const row of scored) {
    if (selected.length >= kMax) break;
    selected.push({ ...row, explore: false });
    cumulative += row.P_accept;
    if (cumulative >= target && selected.length >= kMin) break;
  }
  while (selected.length < kMin && selected.length < scored.length) {
    const next = scored[selected.length];
    if (!selected.find((s) => s.worker_id === next.worker_id)) {
      selected.push({ ...next, explore: false });
    } else break;
  }

  const canExplore =
    selected.length >= kMin &&
    scored.length > selected.length &&
    (exploreCfg.always_one_if_pool ?? true);

  let doExplore = false;
  if (canExplore) {
    const hasCold = scored
      .slice(selected.length)
      .some((r) =>
        isExploreCandidate(r.worker, task.spec?.task_type || "general", config)
      );
    if (hasCold) doExplore = true;
    else if (Math.random() < epsilon) doExplore = true;
  }

  if (doExplore) {
    const exploreRow = pickExploreReplacement(
      scored,
      selected.length,
      task,
      config
    );
    if (
      exploreRow &&
      !selected.some((s) => s.worker_id === exploreRow.worker_id)
    ) {
      selected[selected.length - 1] = {
        ...exploreRow,
        explore: true,
        explore_reason: "thompson",
      };
    }
  }

  return selected;
}

/** serial：仅推 Top 1，带过期时间 */
export function applySerialPolicy(scored, config) {
  if (!scored.length) return [];
  const timeoutSec = config.policy?.serial_timeout_sec ?? 120;
  const expires = new Date(Date.now() + timeoutSec * 1000).toISOString();
  return [{ ...scored[0], explore: false, offer_expires_at: expires }];
}

export function applyPolicy(scored, mode, task, config) {
  if (!scored.length) return [];
  if (mode === "serial") return applySerialPolicy(scored, config);
  return applyBroadcastPolicy(scored, task, config);
}
