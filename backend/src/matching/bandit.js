/**
 * Thompson Sampling（Beta-Bernoulli）
 * 用于探索流量：对接单率不确定性高的雇员给予展示机会
 */

function sampleGamma(shape) {
  if (shape < 1) {
    return sampleGamma(shape + 1) * Math.random() ** (1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x;
    let v;
    do {
      x = randn();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.033 * (x * x) * (x * x)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function randn() {
  const u = Math.random() || 1e-10;
  const v = Math.random() || 1e-10;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Beta(α, β) 采样 */
export function sampleBeta(alpha, beta) {
  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  return x / (x + y);
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** 可复现的 [0,1) 伪随机（同 task+worker 多次派单预览结果一致） */
export function deterministicUniform(taskId, workerId, salt = "") {
  const base = hashSeed(`${taskId}:${workerId}:${salt}`);
  return base;
}

function betaParams(worker, taskType, config) {
  const bucket = worker.stats_internal?.by_type?.[taskType];
  const m = config.bayesian_prior?.m ?? 5;
  const p0 = config.bayesian_prior?.global_accept_rate ?? 0.25;
  const pushes = bucket?.push_count ?? 0;
  const accepts = bucket?.accept_count ?? 0;
  const alpha = 1 + accepts + m * p0;
  const beta = 1 + Math.max(0, pushes - accepts) + m * (1 - p0);
  return { alpha, beta, pushes, accepts };
}

/** Thompson 采样接单率 */
export function thompsonAcceptSample(worker, taskType, config, taskId = null) {
  const { alpha, beta, pushes } = betaParams(worker, taskType, config);
  let sample = sampleBeta(alpha, beta);

  const exploreCfg = config.explore || {};
  if (exploreCfg.deterministic_seed && taskId) {
    const u = deterministicUniform(taskId, worker.id, "thompson");
    sample = sample * 0.85 + u * 0.15;
  }

  return { sample, alpha, beta, pushes, uncertainty: 1 / Math.sqrt(pushes + 1) };
}

/** 是否属于「值得探索」的冷启动/高不确定雇员 */
export function isExploreCandidate(worker, taskType, config) {
  const { pushes, alpha, beta } = betaParams(worker, taskType, config);
  const exploreCfg = config.explore || {};
  const maxPushes = exploreCfg.cold_start_max_pushes ?? 5;
  const minUncertainty = exploreCfg.min_uncertainty ?? 0.35;

  if (pushes <= maxPushes) return true;
  const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
  return variance >= minUncertainty;
}
