# 信誉评级（内部）

> **不展示在前端**。仅用于派单排序、风控与后续运营策略。

## 评级维度

### 雇主（优质雇主 / 良好 / 普通）

| 维度 | 权重 | 说明 |
|------|------|------|
| 发布量 | 30% | 已托管发布的任务数 |
| 结款及时性 | 35% | `created_at` → `paid_at` 平均时长 |
| 完成率 | 35% | 已完成 / 已发布 |

**优质雇主**：综合分 ≥ 80，且发布 ≥ 3 单，平均付款 ≤ 24 小时。

### 雇员（优秀雇员 / 良好 / 普通）

| 维度 | 权重 | 说明 |
|------|------|------|
| 完成量 | 35% | 已完成任务数 |
| 完成质量 | 35% | 验货 `verification_confidence` 均值 |
| 履约率 | 30% | 已完成 / 已接单 |

**优秀雇员**：综合分 ≥ 80，且完成 ≥ 3 单，平均验货置信度 ≥ 0.85。

## 数据存储

用户对象上的 `reputation_internal` 字段（JSON），**所有对外 API 均不返回该字段**。

任务补充字段：

- `paid_at` — 雇主确认托管时间
- `completed_at` — 任务完成时间
- `verification_confidence` — 验货置信度 0–1

## 触发重算

- 雇主确认付款后 → 重算该雇主
- 任务验货完成放款后 → 重算雇主 + 雇员
-- (seeding endpoint removed)

## 内部查询 API

```http
GET /internal/reputation/:userId
POST /internal/reputation/recompute
```

示例：

```powershell
curl http://127.0.0.1:8000/internal/reputation/<user_id>
curl -X POST http://127.0.0.1:8000/internal/reputation/recompute
```

## 派单

`dispatch.js` 在距离相近时 **优先推送给信誉更高的雇员**。
