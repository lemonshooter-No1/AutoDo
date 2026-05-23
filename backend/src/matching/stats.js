/** 雇员匹配统计（内部，不对前端） */

import { getCategoryBounds } from "./category-prices.js";

const STATS_VERSION = 2;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function emptyBucket() {
  return {
    push_count: 0,
    accept_count: 0,
    complete_count: 0,
    miss_count: 0,
    explore_push_count: 0,
    explore_accept_count: 0,
    price_sum_cents: 0,
    confidence_sum: 0,
    last_push_at: null,
    last_accept_at: null,
    last_complete_at: null,
  };
}

function emptyTotals() {
  return {
    push_count: 0,
    accept_count: 0,
    complete_count: 0,
    miss_count: 0,
    explore_push_count: 0,
  };
}

export function ensureStatsInternal(worker) {
  if (!worker.stats_internal || worker.stats_internal.version !== STATS_VERSION) {
    const prev = worker.stats_internal || {};
    worker.stats_internal = {
      version: STATS_VERSION,
      by_type: prev.by_type || {},
      totals: prev.totals || emptyTotals(),
      push_fatigue_date: prev.push_fatigue_date || todayKey(),
      push_fatigue_count: prev.push_fatigue_count || 0,
      push_ignored_today: prev.push_ignored_today || 0,
      reserve_price_cents: prev.reserve_price_cents || {},
      explore: {
        last_explore_at: prev.explore?.last_explore_at || null,
        explore_accept_rate: prev.explore?.explore_accept_rate || null,
      },
      updated_at: new Date().toISOString(),
    };
    for (const [type, bucket] of Object.entries(worker.stats_internal.by_type)) {
      worker.stats_internal.by_type[type] = { ...emptyBucket(), ...bucket };
    }
  }
  return worker.stats_internal;
}

function typeBucket(stats, taskType) {
  if (!stats.by_type[taskType]) stats.by_type[taskType] = emptyBucket();
  return stats.by_type[taskType];
}

function bumpTotals(stats, field, delta = 1) {
  if (!stats.totals) stats.totals = emptyTotals();
  stats.totals[field] = (stats.totals[field] || 0) + delta;
}

export function getWorkerInProgressCount(state, workerId) {
  return Object.values(state.tasks).filter(
    (t) =>
      t.worker_id === workerId &&
      ["in_progress", "submitted"].includes(t.status)
  ).length;
}

export function acceptRateForType(worker, taskType, config) {
  const stats = ensureStatsInternal(worker);
  const bucket = typeBucket(stats, taskType);
  const m = config.bayesian_prior.m;
  const p0 = config.bayesian_prior.global_accept_rate;
  return (bucket.accept_count + m * p0) / (bucket.push_count + m);
}

export function pushFatigueToday(worker) {
  const stats = ensureStatsInternal(worker);
  const today = todayKey();
  if (stats.push_fatigue_date !== today) {
    stats.push_fatigue_date = today;
    stats.push_fatigue_count = 0;
    stats.push_ignored_today = 0;
  }
  return stats.push_fatigue_count;
}

export function pushesToday(state, workerId) {
  const today = todayKey();
  return state.inbox.filter(
    (i) =>
      i.worker_id === workerId &&
      i.pushed_at &&
      i.pushed_at.slice(0, 10) === today
  ).length;
}

export function reservePriceCents(worker, taskType, state, config) {
  const stats = ensureStatsInternal(worker);
  if (stats.reserve_price_cents[taskType] != null) {
    return stats.reserve_price_cents[taskType];
  }
  const bucket = stats.by_type[taskType];
  if (bucket?.accept_count > 0) {
    return Math.round(bucket.price_sum_cents / bucket.accept_count);
  }
  const { floor, ceiling } = getCategoryBounds(state, taskType, config);
  return Math.round((floor + ceiling) / 2);
}

function touchStats(stats) {
  stats.updated_at = new Date().toISOString();
}

export function recordPush(state, worker, task, opts = {}) {
  const stats = ensureStatsInternal(worker);
  const taskType = task.spec?.task_type || "general";
  const bucket = typeBucket(stats, taskType);
  const now = new Date().toISOString();

  bucket.push_count += 1;
  bucket.last_push_at = now;
  bumpTotals(stats, "push_count");

  if (opts.explore) {
    bucket.explore_push_count += 1;
    bumpTotals(stats, "explore_push_count");
    stats.explore.last_explore_at = now;
  }

  const today = todayKey();
  if (stats.push_fatigue_date !== today) {
    stats.push_fatigue_date = today;
    stats.push_fatigue_count = 0;
    stats.push_ignored_today = 0;
  }
  stats.push_fatigue_count += 1;
  touchStats(stats);
}

export function recordAccept(state, worker, task, opts = {}) {
  const stats = ensureStatsInternal(worker);
  const taskType = task.spec?.task_type || "general";
  const bucket = typeBucket(stats, taskType);
  const now = new Date().toISOString();
  const price = task.escrow_cents || task.spec?.suggested_price_cents || 0;

  bucket.accept_count += 1;
  bucket.last_accept_at = now;
  if (price > 0) bucket.price_sum_cents += price;
  bumpTotals(stats, "accept_count");

  if (opts.explore) {
    bucket.explore_accept_count += 1;
    const ep = bucket.explore_push_count || 1;
    stats.explore.explore_accept_rate =
      Math.round((bucket.explore_accept_count / ep) * 1000) / 1000;
  }

  stats.reserve_price_cents[taskType] = Math.round(
    bucket.price_sum_cents / bucket.accept_count
  );
  touchStats(stats);
}

export function recordComplete(state, worker, task) {
  const stats = ensureStatsInternal(worker);
  const taskType = task.spec?.task_type || "general";
  const bucket = typeBucket(stats, taskType);
  const now = new Date().toISOString();

  bucket.complete_count += 1;
  bucket.last_complete_at = now;
  if (typeof task.verification_confidence === "number") {
    bucket.confidence_sum += task.verification_confidence;
  }
  bumpTotals(stats, "complete_count");
  touchStats(stats);
}

/** 推送后他人接单：记 miss，用于 Bandit 失败观测 */
export function recordMiss(state, worker, task, opts = {}) {
  const stats = ensureStatsInternal(worker);
  const taskType = task.spec?.task_type || "general";
  const bucket = typeBucket(stats, taskType);

  bucket.miss_count += 1;
  bumpTotals(stats, "miss_count");

  const today = todayKey();
  if (stats.push_fatigue_date === today) {
    stats.push_ignored_today += 1;
  }
  touchStats(stats);
}

export function recomputeAllWorkerStats(state) {
  for (const user of Object.values(state.users)) {
    if (user.role !== "worker") continue;
    user.stats_internal = {
      version: STATS_VERSION,
      by_type: {},
      totals: emptyTotals(),
      push_fatigue_date: todayKey(),
      push_fatigue_count: 0,
      push_ignored_today: 0,
      reserve_price_cents: {},
      explore: { last_explore_at: null, explore_accept_rate: null },
      updated_at: new Date().toISOString(),
    };
  }

  const sortedInbox = [...(state.inbox || [])].sort(
    (a, b) => new Date(a.pushed_at) - new Date(b.pushed_at)
  );

  for (const row of sortedInbox) {
    const worker = state.users[row.worker_id];
    const task = state.tasks[row.task_id];
    if (!worker || !task) continue;

    recordPush(state, worker, task, { explore: row.explore });
    if (row.accepted) {
      recordAccept(state, worker, task, { explore: row.explore });
    }
  }

  for (const task of Object.values(state.tasks)) {
    if (!task.worker_id) continue;
    const winnerInbox = state.inbox.find(
      (i) => i.task_id === task.id && i.worker_id === task.worker_id
    );
    for (const row of state.inbox) {
      if (row.task_id !== task.id || row.worker_id === task.worker_id) continue;
      if (row.accepted) continue;
      const w = state.users[row.worker_id];
      if (!w) continue;
      if (
        ["in_progress", "submitted", "completed"].includes(task.status) ||
        task.worker_id
      ) {
        recordMiss(state, w, task, { explore: row.explore });
      }
    }
    if (task.status === "completed") {
      const w = state.users[task.worker_id];
      if (w) recordComplete(state, w, task);
    }
  }
}
