/**
 * 信誉评级（仅后端内部使用，不返回给前端）
 *
 * 雇主：发布量 + 结款及时性 + 任务完成率
 * 雇员：完成量 + 验货质量 + 履约率
 */

const MS_HOUR = 3600000;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function hoursBetween(a, b) {
  if (!a || !b) return null;
  return (new Date(b) - new Date(a)) / MS_HOUR;
}

function defaultReputation(role) {
  return {
    score: 50,
    tier: "standard",
    label: role === "employer" ? "普通雇主" : "普通雇员",
    updated_at: new Date().toISOString(),
    metrics: {},
  };
}

/** 雇主信誉 0–100 */
export function computeEmployerReputation(employerId, tasks) {
  const mine = Object.values(tasks).filter((t) => t.employer_id === employerId);
  const published = mine.filter((t) =>
    ["escrowed", "dispatching", "in_progress", "submitted", "completed"].includes(t.status)
  );
  const completed = mine.filter((t) => t.status === "completed");
  const paidTasks = mine.filter((t) => t.paid_at);

  const completionRate = published.length ? completed.length / published.length : 0;

  const payDelays = paidTasks
    .map((t) => hoursBetween(t.created_at, t.paid_at))
    .filter((h) => h != null && h >= 0);
  const avgPayHours =
    payDelays.length ? payDelays.reduce((a, b) => a + b, 0) / payDelays.length : null;

  // 结款越快分越高：<1h 满分，>48h 趋近 0
  let payScore = 50;
  if (avgPayHours != null) {
    if (avgPayHours <= 1) payScore = 100;
    else if (avgPayHours <= 6) payScore = 85;
    else if (avgPayHours <= 24) payScore = 65;
    else if (avgPayHours <= 48) payScore = 40;
    else payScore = 20;
  }

  const volumeScore = clamp((published.length / 8) * 100, 0, 100);
  const completionScore = completionRate * 100;

  const score = Math.round(
    volumeScore * 0.3 + payScore * 0.35 + completionScore * 0.35
  );

  let tier = "standard";
  let label = "普通雇主";
  if (score >= 80 && published.length >= 3 && avgPayHours != null && avgPayHours <= 24) {
    tier = "premium";
    label = "优质雇主";
  } else if (score >= 65) {
    tier = "good";
    label = "良好雇主";
  }

  return {
    score: clamp(score, 0, 100),
    tier,
    label,
    updated_at: new Date().toISOString(),
    metrics: {
      tasks_published: published.length,
      tasks_completed: completed.length,
      completion_rate: Math.round(completionRate * 1000) / 10,
      avg_payment_hours: avgPayHours != null ? Math.round(avgPayHours * 10) / 10 : null,
      volume_score: Math.round(volumeScore),
      payment_score: Math.round(payScore),
    },
  };
}

/** 雇员信誉 0–100 */
export function computeWorkerReputation(workerId, tasks) {
  const assigned = Object.values(tasks).filter((t) => t.worker_id === workerId);
  const completed = assigned.filter((t) => t.status === "completed");
  const inProgress = assigned.filter((t) =>
    ["in_progress", "submitted"].includes(t.status)
  );

  const completionRate = assigned.length ? completed.length / assigned.length : 0;

  const qualities = completed
    .map((t) => t.verification_confidence)
    .filter((c) => typeof c === "number");
  const avgQuality = qualities.length
    ? qualities.reduce((a, b) => a + b, 0) / qualities.length
    : null;

  const qualityScore = avgQuality != null ? avgQuality * 100 : 50;
  const volumeScore = clamp((completed.length / 10) * 100, 0, 100);
  const completionScore = completionRate * 100;

  const score = Math.round(
    volumeScore * 0.35 + qualityScore * 0.35 + completionScore * 0.3
  );

  let tier = "standard";
  let label = "普通雇员";
  if (score >= 80 && completed.length >= 3 && (avgQuality == null || avgQuality >= 0.85)) {
    tier = "premium";
    label = "优秀雇员";
  } else if (score >= 65) {
    tier = "good";
    label = "良好雇员";
  }

  return {
    score: clamp(score, 0, 100),
    tier,
    label,
    updated_at: new Date().toISOString(),
    metrics: {
      tasks_assigned: assigned.length,
      tasks_completed: completed.length,
      tasks_in_progress: inProgress.length,
      completion_rate: Math.round(completionRate * 1000) / 10,
      avg_verification_confidence:
        avgQuality != null ? Math.round(avgQuality * 1000) / 1000 : null,
      volume_score: Math.round(volumeScore),
      quality_score: Math.round(qualityScore),
    },
  };
}

export function recomputeUserReputation(state, userId) {
  const user = state.users[userId];
  if (!user) return null;

  const rep =
    user.role === "employer"
      ? computeEmployerReputation(userId, state.tasks)
      : computeWorkerReputation(userId, state.tasks);

  user.reputation_internal = rep;
  return rep;
}

export function recomputeAllReputations(state) {
  for (const uid of Object.keys(state.users)) {
    recomputeUserReputation(state, uid);
  }
}

/** 派单排序用：取信誉分，无则 50 */
export function reputationScore(user) {
  return user?.reputation_internal?.score ?? 50;
}
