import { haversineKm } from "./geo.js";
import { getWorkerInProgressCount, pushesToday } from "./stats.js";

export function resolveTaskProfile(task, config) {
  const spec = task.spec || {};
  if (spec.is_online) return "online_digital";
  const price = task.escrow_cents || spec.suggested_price_cents || 0;
  const urgentPrice = config.policy?.urgent_price_cents ?? 12000;
  const urgentMin = config.policy?.urgent_max_minutes ?? 45;
  if (
    price >= urgentPrice &&
    (spec.estimated_minutes ?? 999) <= urgentMin
  ) {
    return "offline_urgent";
  }
  return "offline_normal";
}

function recallRadiusKm(task, config) {
  const profile = resolveTaskProfile(task, config);
  if (profile === "offline_urgent") {
    return config.radius_km_urgent ?? config.radius_km;
  }
  return config.radius_km;
}

/** 硬召回：返回 RecallCandidate[] */
export function recallCandidates(state, task, config) {
  const spec = task.spec || {};
  const required = new Set(spec.skills || []);
  const maxConcurrent = config.max_concurrent ?? 2;
  const maxPushDay = config.max_push_per_worker_day ?? 20;
  const radiusKm = recallRadiusKm(task, config);

  const workers = Object.values(state.users).filter(
    (u) => u.role === "worker" && u.is_online && !u.blacklisted
  );

  const out = [];
  for (const w of workers) {
    if (getWorkerInProgressCount(state, w.id) >= maxConcurrent) continue;

    const wSkills = new Set(w.skills || []);
    if (required.size && ![...required].some((s) => wSkills.has(s))) continue;

    const alreadyPushed = state.inbox?.some(
      (i) => i.worker_id === w.id && i.task_id === task.id
    );
    if (alreadyPushed) continue;

    if (pushesToday(state, w.id) >= maxPushDay) continue;

    let distance_km = null;

    if (spec.is_online) {
      out.push({ worker: w, distance_km: null });
      continue;
    }

    const { lat, lng } = spec.location || {};
    if (w.lat == null || w.lng == null) continue;

    if (lat == null || lng == null) {
      out.push({ worker: w, distance_km: 0 });
      continue;
    }

    distance_km = haversineKm(lat, lng, w.lat, w.lng);
    if (distance_km <= radiusKm) {
      out.push({ worker: w, distance_km });
    }
  }

  return out;
}
