/** 品类底价/顶价：从已托管任务价格分布自动统计，不足样本时回退配置默认值 */

const PAID_STATUSES = new Set([
  "escrowed",
  "dispatching",
  "in_progress",
  "submitted",
  "completed",
]);

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function taskPriceCents(task) {
  const p = task.escrow_cents || task.spec?.suggested_price_cents;
  return typeof p === "number" && p > 0 ? p : null;
}

/**
 * 从 state.tasks 重算各 task_type 的 floor/ceiling，写入 state.matching_meta
 */
export function recomputeCategoryPrices(state, config) {
  if (!state.matching_meta) state.matching_meta = {};

  const cfg = config.category_price || {};
  const minSamples = cfg.min_samples ?? 3;
  const pFloor = cfg.floor_percentile ?? 0.1;
  const pCeil = cfg.ceiling_percentile ?? 0.9;
  const defaults = config.category_price_cents || {};

  const pricesByType = {};
  for (const task of Object.values(state.tasks || {})) {
    if (!PAID_STATUSES.has(task.status)) continue;
    const price = taskPriceCents(task);
    if (price == null) continue;
    const type = task.spec?.task_type || "general";
    if (!pricesByType[type]) pricesByType[type] = [];
    pricesByType[type].push(price);
  }

  const allTypes = new Set([
    ...Object.keys(defaults),
    ...Object.keys(pricesByType),
  ]);

  const result = {};
  const now = new Date().toISOString();

  for (const type of allTypes) {
    const fallback = defaults[type] || defaults.general;
    const arr = (pricesByType[type] || []).slice().sort((a, b) => a - b);

    if (arr.length < minSamples) {
      result[type] = {
        floor: fallback.floor,
        ceiling: fallback.ceiling,
        source: "default",
        sample_count: arr.length,
        updated_at: now,
      };
      continue;
    }

    let floor = Math.round(percentile(arr, pFloor));
    let ceiling = Math.round(percentile(arr, pCeil));
    floor = Math.max(fallback.floor * 0.7, Math.min(floor, fallback.ceiling));
    ceiling = Math.max(floor + 500, Math.min(ceiling, fallback.ceiling * 1.3));
    if (ceiling <= floor) ceiling = floor + 1000;

    result[type] = {
      floor,
      ceiling,
      source: "computed",
      sample_count: arr.length,
      median: Math.round(percentile(arr, 0.5)),
      updated_at: now,
    };
  }

  state.matching_meta.category_price_cents = result;
  state.matching_meta.category_prices_updated_at = now;
  return result;
}

/** 打分用：优先用统计价，否则配置默认 */
export function getCategoryBounds(state, taskType, config) {
  const computed = state.matching_meta?.category_price_cents?.[taskType];
  if (computed) {
    return { floor: computed.floor, ceiling: computed.ceiling, source: computed.source };
  }
  const fallback =
    config.category_price_cents?.[taskType] ||
    config.category_price_cents?.general ||
    { floor: 4000, ceiling: 10000 };
  return { floor: fallback.floor, ceiling: fallback.ceiling, source: "default" };
}
