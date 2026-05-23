import { getCategoryBounds } from "./category-prices.js";
import {
  acceptRateForType,
  getWorkerInProgressCount,
  pushFatigueToday,
  reservePriceCents,
} from "./stats.js";
import { resolveTaskProfile } from "./recall.js";

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function categoryBounds(state, taskType, config) {
  return getCategoryBounds(state, taskType, config);
}

function skillMatchScore(worker, spec) {
  const required = spec.skills || [];
  if (!required.length) return 1;
  const wSkills = new Set(worker.skills || []);
  const matched = required.filter((s) => wSkills.has(s)).length;
  if (matched === required.length) return 1;
  if (matched > 0) return 0.5;
  return 0;
}

function executableScore(spec) {
  if (spec.executable_ready) return 0.95;
  const missing = spec.missing_fields?.length ?? 0;
  return clamp01(0.7 - missing * 0.08);
}

function complexityScore(spec) {
  const steps = spec.steps?.length ?? 0;
  return Math.min(0.3, steps * 0.04);
}

function avgWorkerConfidence(worker, state) {
  const completed = Object.values(state.tasks).filter(
    (t) => t.worker_id === worker.id && t.status === "completed"
  );
  const vals = completed
    .map((t) => t.verification_confidence)
    .filter((c) => typeof c === "number");
  if (!vals.length) return 0.7;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function scoreDist(distance_km, isOnline, alpha) {
  if (isOnline || distance_km == null) return 1;
  return Math.exp(-alpha * distance_km);
}

function scorePay(state, task, worker, employer, config) {
  const spec = task.spec || {};
  const taskType = spec.task_type || "general";
  const { floor, ceiling } = categoryBounds(state, taskType, config);
  const price = task.escrow_cents || spec.suggested_price_cents || floor;
  const span = Math.max(ceiling - floor, 1);
  const priceNorm = clamp01((price - floor) / span);
  const reserve = reservePriceCents(worker, taskType, state, config);
  const x = priceNorm - reserve / Math.max(ceiling, 1);
  let s = sigmoid((config.pay_beta ?? 4) * x);
  if (employer?.reputation_internal?.tier === "premium") s = clamp01(s * 1.05);
  return s;
}

function scoreAcceptWithState(state, task, worker, distance_km, config) {
  const spec = task.spec || {};
  const taskType = spec.task_type || "general";
  const b = config.accept_model;
  const price = task.escrow_cents || spec.suggested_price_cents || 0;
  const { ceiling } = categoryBounds(state, taskType, config);
  const reserve = reservePriceCents(worker, taskType, state, config);
  const priceMatch = clamp01((price - reserve) / Math.max(ceiling, 1));
  const acceptRate = acceptRateForType(worker, taskType, config);
  const load =
    getWorkerInProgressCount(state, worker.id) / (config.max_concurrent || 2);
  const fatigue = pushFatigueToday(worker) * 0.08;
  const d = distance_km ?? 0;

  const logit =
    b.b0 +
    b.b1 * acceptRate +
    b.b2 * priceMatch +
    b.b3 * Math.exp(-0.4 * d) -
    b.b4 * Math.min(1, load) -
    b.b5 * fatigue;

  return sigmoid(logit);
}

function scoreComplete(task, worker, employer, state, config) {
  const spec = task.spec || {};
  const c = config.complete_model;
  const repW = worker.reputation_internal?.score ?? 50;
  const repE = employer?.reputation_internal?.score ?? 50;

  const logit =
    c.c0 +
    c.c1 * (repW / 100) +
    c.c2 * skillMatchScore(worker, spec) +
    c.c3 * avgWorkerConfidence(worker, state) +
    c.c4 * (repE / 100) * 0.5 +
    c.c5 * executableScore(spec) -
    c.c6 * complexityScore(spec);

  return sigmoid(logit);
}

/** 对召回候选打分并排序 */
export function scoreCandidates(state, task, candidates, config) {
  const profile = resolveTaskProfile(task, config);
  const weights = config.weights[profile] || config.weights.offline_normal;
  const spec = task.spec || {};
  const employer = state.users[task.employer_id];
  const alpha = config.dist_alpha ?? 0.35;

  const scored = candidates.map(({ worker, distance_km }) => {
    const S_dist = scoreDist(distance_km, spec.is_online, alpha);
    const S_pay = scorePay(state, task, worker, employer, config);
    const P_accept = scoreAcceptWithState(state, task, worker, distance_km, config);
    const P_complete = scoreComplete(task, worker, employer, state, config);
    const M = clamp01(
      weights.wc * P_complete +
        weights.wa * P_accept +
        weights.wp * S_pay +
        weights.wd * S_dist
    );

    return {
      worker_id: worker.id,
      worker,
      distance_km,
      M,
      P_complete,
      P_accept,
      S_pay,
      S_dist,
      weights: { ...weights },
      task_profile: profile,
    };
  });

  scored.sort((a, b) => b.M - a.M);
  scored.forEach((row, i) => {
    row.rank = i + 1;
  });
  return scored;
}

export function buildScoreBreakdown(row) {
  return {
    worker_id: row.worker_id,
    M: row.M,
    P_complete: row.P_complete,
    P_accept: row.P_accept,
    S_pay: row.S_pay,
    S_dist: row.S_dist,
    weights: row.weights,
    distance_km: row.distance_km,
    rank: row.rank,
    explore: row.explore || false,
  };
}
