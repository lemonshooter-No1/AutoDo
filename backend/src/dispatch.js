const RADIUS_KM = 5;
const PUSH_TOP_N = 5;

function haversineKm(lat1, lng1, lat2, lng2) {
  const r = 6371;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dphi = ((lat2 - lat1) * Math.PI) / 180;
  const dlmb = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dlmb / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

/** ④ 派单 + 模拟 Push inbox */
export function dispatchTask(state, task) {
  const spec = task.spec;
  const required = new Set(spec.skills || []);
  const pushed = [];

  const workers = Object.values(state.users).filter(
    (u) => u.role === "worker" && u.is_online
  );

  const candidates = [];
  for (const w of workers) {
    const wSkills = new Set(w.skills || []);
    if (required.size && ![...required].some((s) => wSkills.has(s))) continue;

    if (spec.is_online) {
      candidates.push({ w, dist: null });
      continue;
    }
    const { lat, lng } = spec.location || {};
    if (w.lat == null || w.lng == null) continue;
    if (lat == null || lng == null) {
      candidates.push({ w, dist: 0 });
      continue;
    }
    const dist = haversineKm(lat, lng, w.lat, w.lng);
    if (dist <= RADIUS_KM) candidates.push({ w, dist });
  }

  candidates.sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0));
  for (const { w } of candidates.slice(0, PUSH_TOP_N)) {
    const exists = state.inbox.some(
      (i) => i.worker_id === w.id && i.task_id === task.id
    );
    if (exists) continue;
    state.inbox.push({
      worker_id: w.id,
      task_id: task.id,
      accepted: false,
      pushed_at: new Date().toISOString(),
    });
    pushed.push(w.id);
  }

  task.push_sent_to = pushed;
  task.status = "dispatching";
  task.updated_at = new Date().toISOString();
  return pushed;
}
