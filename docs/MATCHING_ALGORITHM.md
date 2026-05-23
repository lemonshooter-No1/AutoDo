# AutoDo 推荐匹配算法设计稿（MatchScore）

> **版本**：v1.0  
> **状态**：Phase 1 已实现（`backend/src/matching/`）  
> **关联**：[REPUTATION.md](./REPUTATION.md) · [PROJECT_REQUIREMENTS.md](./PROJECT_REQUIREMENTS.md)  
> **机密性**：匹配分、分解日志、探索策略均为**后端内部**，**禁止**通过雇主/雇员前端或公开 API 暴露。

---

## 1. 背景与目标

### 1.1 业务目标

在 AutoDo「零聊天、听单式」众包模型中，任务托管成功后，系统需在**不打扰雇员**的前提下，将订单推送给**最可能接单且最可能高质量完成**的雇员。

### 1.2 算法目标（可量化）

| 指标 | 说明 | 方向 |
|------|------|------|
| Push→Accept 转化率 | 推送后接单比例 | ↑ |
| Accept→Complete 率 | 接单后验货通过比例 | ↑ |
| 平均接单耗时 | 雇主从派单到有人接单 | ↓ |
| 每单推送人数 K | 在转化率不降前提下 | ↓ |
| 验货一次通过率 | AI/规则验货通过 | ↑ |

### 1.3 非目标

- 不做任务大厅列表推荐（雇员主路径仍为 Push 听单）。
- 不让雇主挑选具体雇员（无浏览、无聊天）。
- 不在前端展示匹配分、信誉分解、探索标记。

### 1.4 与现有实现的关系

当前 `backend/src/dispatch.js` 为 **v0**：5km 召回 + 信誉降序 + 固定推 Top 5。  
本设计为 **v1 MatchScore**：召回 → 多维打分 → 派单策略 → 反馈学习。

---

## 2. 问题定义

对每个 **任务 T** 与 **雇员 W**（W 已通过硬召回），计算匹配分：

```text
M(T, W) ∈ [0, 1]
```

派单策略根据 `M` 排序结果决定：

- 推送给哪些人（K 人）；
- 是否采用竞争性推送或顺序独家邀约；
- 是否注入少量探索流量（Bandit）。

**核心命题**：最大化期望完成质量与接单效率，而非单一「距离最近」或「信誉最高」。

---

## 3. 系统架构

```text
                    ┌─────────────────┐
                    │  Task Escrowed  │
                    └────────┬────────┘
                             ▼
                    ┌─────────────────┐
                    │  Recall 硬召回   │  recall.js
                    └────────┬────────┘
                             ▼
                    ┌─────────────────┐
                    │  Scoring 打分    │  scoring.js
                    │  P_complete      │
                    │  P_accept        │
                    │  S_pay, S_dist   │
                    └────────┬────────┘
                             ▼
                    ┌─────────────────┐
                    │  Policy 派单策略 │  policy.js
                    └────────┬────────┘
                             ▼
                    ┌─────────────────┐
                    │  Push / Inbox   │
                    └────────┬────────┘
                             ▼
                    ┌─────────────────┐
                    │  Feedback 反馈   │  行为日志 → 系数更新
                    └─────────────────┘
```

### 3.1 模块职责

| 模块 | 建议路径 | 职责 |
|------|----------|------|
| `recall` | `backend/src/matching/recall.js` | 硬约束过滤，输出候选集 C |
| `scoring` | `backend/src/matching/scoring.js` | 计算四子分与 MatchScore |
| `policy` | `backend/src/matching/policy.js` | Top-K / 顺序邀约 / 探索 |
| `dispatch` | `backend/src/dispatch.js` | 编排入口，写 inbox 与 dispatch_log |
| `stats` | `backend/src/matching/stats.js` | 工人/品类历史统计（可选 Phase 2） |
| `config` | `backend/config/matching.json` | 权重、半径、K、探索率 |

---

## 4. 第一层：召回（Recall）

### 4.1 硬约束（全部满足才进入 C）

| # | 约束 | 规则 |
|---|------|------|
| R1 | 在线 | `worker.is_online === true` |
| R2 | 技能 | `required_skills ∩ worker.skills ≠ ∅`（无要求则跳过） |
| R3 | 地理 | 线下：`haversine(task, worker) ≤ RADIUS_KM`；线上：全国队列 |
| R4 | 负载 | `worker.in_progress_count ≤ MAX_CONCURRENT`（默认 2） |
| R5 | 重复推送 | 本任务未向该 worker 推送过 |
| R6 | 风控 | 非黑名单；可选：近期取消率 < 阈值 |

### 4.2 默认参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `RADIUS_KM` | 5 | 线下物理任务 |
| `RADIUS_KM_urgent` | 8 | 紧急/高价任务可扩（Phase 2） |
| `MAX_CONCURRENT` | 2 | 同时进行中单上限 |

### 4.3 输出

```typescript
interface RecallCandidate {
  worker_id: string;
  distance_km: number | null;  // 线上为 null
}
```

---

## 5. 第二层：打分（Scoring）

### 5.1 综合分公式

```text
M = w_c · P_complete + w_a · P_accept + w_p · S_pay + w_d · S_dist
```

约束：`w_c + w_a + w_p + w_d = 1`，各分量 ∈ [0, 1]。

### 5.2 默认权重（线下普通任务）

| 符号 | 含义 | 默认 w |
|------|------|--------|
| `P_complete` | 完成概率（验货通过） | **0.35** |
| `P_accept` | 接单意愿 | **0.30** |
| `S_pay` | 报酬吸引力 | **0.20** |
| `S_dist` | 距离便利 | **0.15** |

### 5.3 分场景权重

| 场景 `task_profile` | w_c | w_a | w_p | w_d |
|-------------------|-----|-----|-----|-----|
| `offline_urgent` | 0.30 | 0.25 | 0.15 | **0.30** |
| `offline_normal` | 0.35 | 0.30 | 0.20 | 0.15 |
| `online_digital` | 0.40 | 0.30 | **0.25** | 0.05 |

`task_profile` 由规则判定：线上 → `online_digital`；`estimated_minutes ≤ 45` 且价高 → `offline_urgent`；否则 `offline_normal`。

### 5.4 距离分 S_dist

线下（指数衰减）：

```text
S_dist = exp(-α · d_km)
```

| 参数 | 建议值 |
|------|--------|
| α | 0.35（约 3km 处 ≈ 0.35 分） |

线上：`S_dist = 1`。

**Phase 2**：`d_km` 替换为高德路网 ETA（分钟）后，`S_dist = exp(-α_t · ETA_min)`。

### 5.5 报酬分 S_pay

```text
price_norm = (price_cents - floor_c) / max(ceiling_c - floor_c, 1)
reserve    = worker.reserve_price_cents[type]   // 历史接单均价，缺省用品类中位数
x          = price_norm - reserve / ceiling_c
S_pay      = σ(β · x)    // σ 为 sigmoid，β 默认 4
```

品类底价表 `floor_c / ceiling_c`（单位：分，MVP 可静态配置）：

| task_type | floor | ceiling |
|-----------|-------|---------|
| pet_feeding | 5000 | 15000 |
| errand | 4000 | 12000 |
| queue | 8000 | 25000 |
| digital | 5000 | 30000 |
| general | 4000 | 10000 |

优质雇主加成（内部）：`S_pay *= 1.05` 当 `employer.reputation_internal.tier === 'premium'`。

### 5.6 接单意愿 P_accept

逻辑回归形态（MVP 用可配置系数；数据不足时用先验）：

```text
logit = b0
      + b1 · accept_rate_type(w, task_type)    // 贝叶斯平滑历史接单率
      + b2 · price_match(w, price_cents)
      + b3 · exp(-0.4 · d_km)
      - b4 · load_penalty(w)                     // min(1, in_progress / MAX_CONCURRENT)
      - b5 · push_fatigue_today(w)               // 今日推送未接次数 × 0.08

P_accept = σ(logit)
```

**贝叶斯平滑**（按任务类型）：

```text
accept_rate_type = (accepts_type + m · p_global) / (pushes_type + m)
```

| 参数 | 建议值 | 说明 |
|------|--------|------|
| m | 5 | 伪计数 |
| p_global | 0.25 | 全局先验接单率 |

**MVP 默认系数**（无历史时退化为规则）：

| 系数 | 值 |
|------|-----|
| b0 | -0.5 |
| b1 | 2.2 |
| b2 | 0.8 |
| b3 | 1.0 |
| b4 | 1.5 |
| b5 | 1.0 |

### 5.7 完成概率 P_complete

```text
logit_c = c0
        + c1 · (rep_w / 100)
        + c2 · skill_match(w, task)              // 1.0 全匹配，0.5 部分，0 不匹配
        + c3 · avg_confidence_w                  // 历史 verification_confidence 均值，缺省 0.7
        + c4 · (rep_employer / 100) · 0.5
        + c5 · executable_score(task)            // AI 输出 0–1
        - c6 · complexity(task)                  // min(0.3, steps.length × 0.04)

P_complete = σ(logit_c)
```

**MVP 默认系数**：

| 系数 | 值 |
|------|-----|
| c0 | -0.8 |
| c1 | 2.0 |
| c2 | 1.2 |
| c3 | 1.5 |
| c4 | 0.6 |
| c5 | 1.8 |
| c6 | 1.0 |

### 5.8 信誉的用法

- **不**将 `reputation_internal.score` 单独作为第五维，避免与佣金、距离重复。
- 雇主/雇员信誉分别进入 `P_complete`、`P_accept`、`S_pay`（见 [REPUTATION.md](./REPUTATION.md)）。
- 对外 API、前端 **永不返回** `reputation_internal` 与 `match_score`。

### 5.9 打分输出结构

```typescript
interface MatchScoreBreakdown {
  worker_id: string;
  M: number;                    // 综合分 0–1
  P_complete: number;
  P_accept: number;
  S_pay: number;
  S_dist: number;
  weights: { wc: number; wa: number; wp: number; wd: number };
  distance_km: number | null;
  rank?: number;                // 排序后填充
  explore?: boolean;            // 是否探索流量
}
```

---

## 6. 第三层：派单策略（Policy）

### 6.1 策略模式

| 模式 | 标识 | 行为 | 适用 |
|------|------|------|------|
| 竞争性推送 | `broadcast` | 同时推 Top-K | 默认、绝大多数任务 |
| 顺序独家邀约 | `serial` | 每次推 1 人，超时推下一名 | 高价或低 executable_score |
| 探索注入 | `explore` | 从 M 中段抽样 1 人替换末位 | 全平台 ε 比例 |

### 6.2 模式选择规则

```text
if price_cents >= SERIAL_PRICE_THRESHOLD
   or executable_score < 0.88
  → policy = serial
else
  → policy = broadcast
```

| 参数 | 默认值 |
|------|--------|
| `SERIAL_PRICE_THRESHOLD` | 15000（分） |
| `SERIAL_OFFER_TIMEOUT_SEC` | 120 |

### 6.3 Broadcast：动态 K

1. 按 `M` 降序排列候选。
2. 依次累加 `P_accept`，直到累计 ≥ `COVERAGE_TARGET` 或达到 `K_MAX`。
3. `K = max(K_MIN, 累计人数)`。

| 参数 | 默认值 |
|------|--------|
| `K_MIN` | 2 |
| `K_MAX` | 5 |
| `COVERAGE_TARGET` | 0.70 |

### 6.4 探索（Thompson Sampling 简化版）

对每个 `(worker, task_type)` 维护：

```text
accepts ~ Beta(α, β)
α = 1 + accept_count
β = 1 + (push_count - accept_count)
```

在 Top-(K+1) 中，以概率 `EPSILON_EXPLORE`（默认 **0.10**）将第 K 名替换为「非 Top 但 Thompson 采样最高」的工人（且不在 Top 内），标记 `explore: true`。

目的：冷启动与系数标定；**不向前端暴露**。

### 6.5 Serial：顺序邀约

1. 按 `M` 排序。
2. 仅向排名第 1 的 worker 推送，`offer_expires_at = now + TIMEOUT`。
3. 超时未接 → 自动推第 2 名（Phase 2 定时任务或接单 API 触发）。

MVP 可先实现 broadcast；serial 为配置开关预留。

---

## 7. 数据模型扩展

### 7.1 Task（任务）

| 字段 | 类型 | 说明 |
|------|------|------|
| `paid_at` | ISO8601 | 已有 |
| `completed_at` | ISO8601 | 已有 |
| `verification_confidence` | number | 已有 |
| `dispatch_policy` | string | `broadcast` / `serial` |
| `dispatch_log` | array | 见 7.4 |
| `match_profile` | string | 打分使用的 task_profile |

### 7.2 WorkerInbox（推送）

| 字段 | 类型 | 说明 |
|------|------|------|
| `match_score` | number | M，内部 |
| `score_breakdown` | object | MatchScoreBreakdown，内部 |
| `offer_mode` | string | broadcast / serial |
| `offer_expires_at` | ISO8601 | serial 模式 |
| `explore` | boolean | 是否探索单 |

### 7.3 Worker.stats_internal（建议，内部）

```json
{
  "by_type": {
    "pet_feeding": {
      "push_count": 12,
      "accept_count": 5,
      "complete_count": 5,
      "price_sum_cents": 40000
    }
  },
  "push_fatigue_date": "2026-05-23",
  "push_fatigue_count": 2,
  "reserve_price_cents": { "pet_feeding": 8000 }
}
```

### 7.4 dispatch_log（单次派单快照）

```json
{
  "at": "2026-05-23T10:00:00Z",
  "policy": "broadcast",
  "task_profile": "offline_normal",
  "candidate_count": 18,
  "pushed_count": 4,
  "top": [
    { "worker_id": "w1", "M": 0.82, "P_accept": 0.71, "...": "..." }
  ]
}
```

---

## 8. 反馈与在线更新

### 8.1 事件

| 事件 | 触发点 | 更新 |
|------|--------|------|
| `push` | 写入 inbox | push_count++ |
| `accept` | 接单 API | accept_count++ |
| `complete` | 验货通过 | complete_count++，重算信誉 |
| `expire` | 超时未接 | 用于 serial 下一波 |

### 8.2 系数更新（Phase 2）

- 每周离线回归：用 `dispatch_log` + 结果拟合 `b*`、`c*`。
- Phase 3：Contextual Bandit 按 task 特征调权。

---

## 9. 冷启动与公平

| 场景 | 策略 |
|------|------|
| 新雇员无历史 | `accept_rate` 用全局先验；保证 ε 探索流量 |
| 新雇员永不接单 | `explore` 池每周每类型至少 1 次 push |
| 头部垄断 | 同人同日 push 上限 `MAX_PUSH_PER_WORKER_DAY`（默认 20） |
| 恶意刷分 | 信誉需最低完成单数；验货权重下限 |

---

## 10. 内部 API（不对前端）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/internal/match/preview?task_id=` | 预览 Top-N 打分分解（调试） |
| POST | `/internal/match/recompute-stats` | 全量重算 worker stats |
| GET | `/internal/reputation/:userId` | 已有，见 REPUTATION.md |

访问建议：仅开发环境或管理员 Token；生产可加 `INTERNAL_API_KEY` 头。

---

## 11. 实现阶段

### Phase 1（MVP，1–2 周）

- [x] `matching/recall.js` + `scoring.js` + `policy.js`
- [x] 替换 `dispatch.js` 排序逻辑
- [x] 写入 `match_score`、`dispatch_log`
- [x] `matching.json` 默认系数
- [x] `/internal/match/preview`

### Phase 2（2–4 周）

- [x] `worker.stats_internal` 持久化与事件更新（v2：miss/探索/置信度/汇总）
- [x] 动态 K + 探索 Bandit（Thompson Sampling，`matching/bandit.js`）
- [x] 品类底价表自动统计（分位数，`matching/category-prices.js`）
- [ ] Serial 顺序邀约 + 超时续推

### Phase 3（可选）

- [ ] 高德 ETA 接入 `S_dist`
- [ ] 离线系数拟合 pipeline
- [ ] A/B 实验框架

---

## 12. 评估与基线

### 12.1 离线回放

用历史 `store.json` 快照：对已完成任务，用当时特征重算 `M`，看 Top-1 是否包含实际接单人（Hit@1 / Hit@3）。

### 12.2 在线对比

| 实验组 | 描述 |
|--------|------|
| A | 当前 v0：信誉 + 距离 |
| B | MatchScore v1 broadcast |
| C | B + 探索 |

### 12.3 北极星

**单位任务期望完成价值** ≈ `P_accept × P_complete × price_cents`（在派单时刻估算，事后用真实结果校准）。

---

## 13. 竞品差异（产品叙事）

| 平台 | 匹配方式 | AutoDo |
|------|----------|--------|
| 任务大厅 | 人搜单 | 单找人，预测式 Push |
| 纯 LBS 跑腿 | 距离优先 | 距离 × 报酬 × 意愿 × 完成概率 |
| RentAHuman | 浏览/协商 | 零聊天 + TaskSpec + MatchScore |
| 网约车 | 顺序派单 | 众包场景 + Bandit 探索 |

**一句话**：不是「推给最近的 5 个人」，而是「推给最会接、最能成、且报酬匹配的那几个人」。

---

## 14. 配置示例（matching.json）

```json
{
  "radius_km": 5,
  "max_concurrent": 2,
  "weights": {
    "offline_normal": { "wc": 0.35, "wa": 0.30, "wp": 0.20, "wd": 0.15 },
    "offline_urgent": { "wc": 0.30, "wa": 0.25, "wp": 0.15, "wd": 0.30 },
    "online_digital": { "wc": 0.40, "wa": 0.30, "wp": 0.25, "wd": 0.05 }
  },
  "dist_alpha": 0.35,
  "pay_beta": 4,
  "policy": {
    "k_min": 2,
    "k_max": 5,
    "coverage_target": 0.7,
    "epsilon_explore": 0.1,
    "serial_price_threshold_cents": 15000,
    "serial_timeout_sec": 120
  },
  "category_price_cents": {
    "pet_feeding": { "floor": 5000, "ceiling": 15000 },
    "errand": { "floor": 4000, "ceiling": 12000 },
    "queue": { "floor": 8000, "ceiling": 25000 },
    "digital": { "floor": 5000, "ceiling": 30000 },
    "general": { "floor": 4000, "ceiling": 10000 }
  },
  "accept_model": { "b0": -0.5, "b1": 2.2, "b2": 0.8, "b3": 1.0, "b4": 1.5, "b5": 1.0 },
  "complete_model": { "c0": -0.8, "c1": 2.0, "c2": 1.2, "c3": 1.5, "c4": 0.6, "c5": 1.8, "c6": 1.0 },
  "bayesian_prior": { "m": 5, "global_accept_rate": 0.25 }
}
```

---

## 15. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-05-23 | 初稿：Recall + MatchScore + Policy + 数据模型 + 实施阶段 |
