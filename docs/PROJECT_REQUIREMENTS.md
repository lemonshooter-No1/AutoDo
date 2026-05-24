# AutoDo MVP 需求（极简版 v0.2）

> **目标**：只跑通 6 步核心闭环，体现「零浏览、零聊天」。

## 产品一句话

**AI 发布并推送任务。雇主：点发布 → 等完成 → 付款。雇员：等推送 → 接单 → 干活 → 拿钱。**

---

## 体验原则（最高优先级）

| 角色 | 只做这些 | 明确不做 |
|------|----------|----------|
| 雇主 | 输入需求 → 回答 AI 追问（若有）→ 确认价并付款 → 看进度 | 逛任务市场、挑人、聊天 |
| 雇员 | 开听单 → 收 Push → 看标准卡片 → 接单 → 按卡片交付 | 搜任务、议价、聊天 |
| 平台/AI | 解析、澄清、派单、验货、放款 | 让双方直接沟通 |

---

## 六步闭环（MVP 全部范围）

```
雇主输入 → ①解析 → ②澄清 → ③托管 → ④派单 → ⑤执行 → ⑥验货结算
```

### ① AI 意图解析与标准化

- **输入**：雇主自然语言。
- **输出**：标准 JSON（TaskSpec）：
  - `task_type` 任务类型
  - `time` 时间窗
  - `location` 地理位置
  - `skills` 所需技能标签
  - `estimated_minutes` 预计耗时
  - `suggested_price` 建议薪酬
  - `steps` / `deliverables` 执行与交付说明（供卡片展示）

### ② AI 预检与澄清

- 缺关键信息（如门禁、楼栋、联系人）→ **只问雇主**（结构化追问，不是聊天）。
- 仅当 AI 判定 **「工人可无脑执行」**（`executable_ready: true`）→ 才允许生成待确认订单。

### ③ 资金托管

- 雇主确认订单与金额 → **预扣/托管** → 订单进入 **待派发池**。

### ④ 时空与技能派单

- **线下**：Geo 半径 **5km** + 技能标签 + 当前空闲 → 候选雇员。
- **线上**：推入全球技能匹配队列（MVP 可先 mock 一条队列）。
- 向候选雇员发 **App Push**（MVP 可用 API 模拟推送记录）。

### ⑤ 抢单与执行

- 雇员收到 Push → 查看 **标准化任务卡片** → **接单**（先接先得）。
- 按卡片执行，**无需与雇主沟通**。

### ⑥ 结果校验与自动结算

- 雇员提交交付物（照片/文件等）。
- **规则 + AI** 初步验货 → 通过 → **托管款自动进雇员钱包**。

---

## 订单状态（仅保留必要状态）

```
parsing → clarifying → awaiting_payment → escrowed → dispatching
  → assigned → in_progress → submitted → completed
```

失败/取消：`cancelled`（MVP 从简，不做复杂争议）。

---

## TaskSpec 最小字段

```json
{
  "task_type": "pet_feeding",
  "title": "上门喂猫",
  "time_window": { "start": "", "end": "" },
  "location": { "address": "", "lat": null, "lng": null },
  "skills": ["pet_care"],
  "estimated_minutes": 30,
  "suggested_price_cents": 8000,
  "steps": ["..."],
  "deliverables": [{ "type": "photo", "description": "猫粮盆/猫现状" }],
  "executable_ready": false,
  "missing_fields": ["access_code"]
}
```

---

## MVP 不做的功能

- 雇主↔雇员 IM、浏览任务大厅、挑人比价
- 运营后台（除日志）、多城市配置、开放 API/MCP
- 真实支付牌照（先用 **mock 托管**）；真实 Push（先用 **inbox 模拟**）
- 复杂争议与人工仲裁

---

## 验收标准（跑通即可）

1. 雇主用一句话创建任务，缺信息时只看到 **澄清表单**，补全后才能确认付款。
2. 付款（mock）后，5km 内空闲且技能匹配的雇员 **inbox 出现推送**。
3. 雇员接单 → 提交照片 → 系统验货通过 → 钱包余额增加。
4. 全程无「聊天」「浏览任务列表」接口。

---

## 技术实现（当前仓库）

| 部分 | 说明 |
|------|------|
| `backend/src/` | Node + Express + JSON 存储，六步 API 已打通 |
| AI | 规则 mock（喂猫/跑腿关键词）；后续可接 OpenAI |
| 支付/Push | mock 托管 + inbox 模拟推送 |
