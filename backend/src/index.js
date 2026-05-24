import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuid } from "uuid";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AMAP_REST_API_KEY = "75b6644c3fc46e7742a2fdabbb7b37f4";
const amapGeoCache = new Map();

import {
  applyClarifications,
  clarifyQuestions,
  parseEmployerInput,
  verifyDelivery,
} from "./ai.js";
import { dispatchTask, previewMatch } from "./dispatch.js";
import { recomputeCategoryPrices } from "./matching/category-prices.js";
import { getMatchingConfig } from "./matching/config.js";
import {
  recomputeAllWorkerStats,
  recordAccept,
  recordComplete,
  recordMiss,
} from "./matching/stats.js";
import { seedSampleBounties } from "./seed-samples.js";
import {
  recomputeAllReputations,
  recomputeUserReputation,
} from "./reputation.js";
import { db, getTask, getUser, upsertTask, upsertUser } from "./store.js";

const app = express();
app.use(express.json({ limit: "12mb" }));

async function transcribeAudioWithSiliconFlow({ audioBase64, mimeType, model }) {
  const apiKey = process.env.SILICON_FLOW_API_KEY;
  const apiBase = process.env.SILICON_FLOW_API_BASE || "https://api.siliconflow.cn/v1";
  if (!apiKey) {
    const error = new Error("未配置 SILICON_FLOW_API_KEY，无法进行语音转写");
    error.statusCode = 503;
    throw error;
  }

  const rawBase64 = String(audioBase64 || "");
  const payloadBase64 = rawBase64.includes(",") ? rawBase64.split(",")[1] : rawBase64;
  if (!payloadBase64) {
    const error = new Error("缺少音频内容");
    error.statusCode = 400;
    throw error;
  }

  const buffer = Buffer.from(payloadBase64, "base64");
  const fileName = mimeType?.includes("mp4") ? "voice.m4a" : mimeType?.includes("wav") ? "voice.wav" : "voice.webm";
  const blob = new Blob([buffer], { type: mimeType || "audio/webm" });
  const formData = new FormData();
  formData.append("file", blob, fileName);
  formData.append("model", model || "FunAudioLLM/SenseVoiceSmall");

  const response = await fetch(`${apiBase}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  const responseText = await response.text();
  let data = {};
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    data = { raw: responseText };
  }

  if (!response.ok) {
    const error = new Error(data.error || data.message || data.raw || "语音转写失败");
    error.statusCode = response.status;
    error.details = data;
    throw error;
  }

  return data.text || data.transcript || data.result || "";
}

function registerTranscribeRoute(route) {
  app.post(route, async (req, res) => {
    try {
      const text = await transcribeAudioWithSiliconFlow({
        audioBase64: req.body?.audio_base64,
        mimeType: req.body?.mime_type,
        model: req.body?.model,
      });
      res.json({ text });
    } catch (error) {
      res.status(error.statusCode || 500).json({
        error: error.message || "语音转写失败",
        details: error.details || null,
      });
    }
  });
}

registerTranscribeRoute("/api/audio/transcribe");
registerTranscribeRoute("/audio/transcribe");

function taskResponse(task) {
  return {
    id: task.id,
    status: task.status,
    employer_id: task.employer_id,
    worker_id: task.worker_id || null,
    raw_input: task.raw_input,
    spec: task.spec,
    clarifications: task.clarifications || {},
    escrow_cents: task.escrow_cents || 0,
    push_sent_to: task.push_sent_to || [],
    created_at: task.created_at,
    updated_at: task.updated_at,
  };
}

// ①② 雇主发布
app.post("/tasks", (req, res) => {
  const { employer_id, raw_input } = req.body || {};
  const state = db.read();
  const employer = getUser(state, employer_id);
  if (!employer || employer.role !== "employer") {
    return res.status(404).json({ error: "雇主不存在" });
  }

  const spec = parseEmployerInput(raw_input);
  const task = {
    id: uuid(),
    status: spec.executable_ready ? "awaiting_payment" : "clarifying",
    employer_id,
    worker_id: null,
    raw_input,
    spec,
    clarifications: {},
    escrow_cents: 0,
    push_sent_to: [],
    delivery: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  upsertTask(state, task);
  db.write(state);

  const out = taskResponse(task);
  if (!spec.executable_ready) out.clarify_questions = clarifyQuestions(spec, spec.missing_fields);
  res.json(out);
});

// ② 澄清
app.post("/tasks/:id/clarify", (req, res) => {
  const state = db.read();
  const task = getTask(state, req.params.id);
  if (!task) return res.status(404).json({ error: "任务不存在" });

  task.clarifications = { ...task.clarifications, ...(req.body.answers || {}) };
  task.spec = applyClarifications(task.spec, task.clarifications);
  task.status = task.spec.executable_ready ? "awaiting_payment" : "clarifying";
  task.updated_at = new Date().toISOString();
  upsertTask(state, task);
  db.write(state);

  const out = taskResponse(task);
  if (!task.spec.executable_ready) out.clarify_questions = clarifyQuestions(task.spec, task.spec.missing_fields);
  res.json(out);
});

// ③ 托管 + ④ 派单
app.post("/tasks/:id/confirm-payment", (req, res) => {
  const state = db.read();
  const task = getTask(state, req.params.id);
  if (!task) return res.status(404).json({ error: "任务不存在" });
  if (task.status !== "awaiting_payment") {
    return res.status(400).json({ error: `当前状态不可付款: ${task.status}` });
  }
  if (!task.spec.executable_ready) {
    return res.status(400).json({ error: "任务尚未达到可执行标准" });
  }

  const amount = req.body.amount_cents ?? task.spec.suggested_price_cents;
  task.escrow_cents = amount;
  task.paid_at = new Date().toISOString();
  task.status = "escrowed";
  task.updated_at = task.paid_at;
  dispatchTask(state, task);
  upsertTask(state, task);
  recomputeUserReputation(state, task.employer_id);
  db.write(state);
  res.json(taskResponse(task));
});

/** 已发布任务（供浏览，类似 RentAHuman bounties 列表） */
const PUBLIC_STATUSES = new Set([
  "escrowed",
  "dispatching",
  "in_progress",
  "submitted",
  "completed",
]);

function normalizeAddressForGeocode(address) {
  if (!address) return "";
  return address
    .split("→")[0]
    .split("-")[0]
    .split("/")[0]
    .replace(/\(.*?\)/g, "")
    .trim();
}

async function geocodeAddress(address) {
  const normalized = normalizeAddressForGeocode(address);
  if (!normalized || normalized === "远程") return null;
  if (amapGeoCache.has(normalized)) return amapGeoCache.get(normalized);

  const url = new URL("https://restapi.amap.com/v3/geocode/geo");
  url.searchParams.set("address", normalized);
  url.searchParams.set("city", "全国");
  url.searchParams.set("key", AMAP_REST_API_KEY);

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data?.status === "1" && Array.isArray(data.geocodes) && data.geocodes.length) {
      const first = data.geocodes[0];
      const [lng, lat] = String(first.location || "").split(",").map(Number);
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        const geo = {
          lng,
          lat,
          formattedAddress: first.formatted_address || first.formattedAddress || normalized,
        };
        amapGeoCache.set(normalized, geo);
        return geo;
      }
    }
  } catch (e) {
    console.warn("AMap geocode failed:", normalized, e.message);
  }

  amapGeoCache.set(normalized, null);
  return null;
}

async function toBountyItem(task) {
  const spec = task.spec || {};
  const loc = spec.location || {};
  const locationText = spec.is_online ? "远程" : loc.address || "—";
  let locationLat = Number.isFinite(loc.lat) ? loc.lat : null;
  let locationLng = Number.isFinite(loc.lng) ? loc.lng : null;
  let locationFormatted = locationText;

  if (!spec.is_online && (!Number.isFinite(locationLat) || !Number.isFinite(locationLng))) {
    const geo = await geocodeAddress(locationText);
    if (geo) {
      locationLat = geo.lat;
      locationLng = geo.lng;
      locationFormatted = geo.formattedAddress || locationText;
    }
  }

  return {
    id: task.id,
    title: spec.title || "任务",
    summary: (spec.summary || task.raw_input || "").slice(0, 200),
    task_type: spec.task_type || "general",
    price_cents: task.escrow_cents || spec.suggested_price_cents || 0,
    location: locationText,
    location_formatted: locationFormatted,
    location_lat: locationLat,
    location_lng: locationLng,
    status: task.status,
    open: task.status === "dispatching",
    created_at: task.created_at,
    steps: spec.steps || [],
  };
}

async function listBounties(req, res) {
  const sort = req.query.sort === "price" ? "price" : "new";
  const state = db.read();
  let tasks = Object.values(state.tasks).filter((t) => PUBLIC_STATUSES.has(t.status));

  if (sort === "price") {
    tasks.sort(
      (a, b) =>
        (b.escrow_cents || b.spec?.suggested_price_cents || 0) -
        (a.escrow_cents || a.spec?.suggested_price_cents || 0)
    );
  } else {
    tasks.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  const items = await Promise.all(tasks.map((task) => toBountyItem(task)));
  res.json({ items, total: tasks.length });
}

async function getBounty(req, res) {
  const task = getTask(db.read(), req.params.id);
  if (!task || !PUBLIC_STATUSES.has(task.status)) {
    return res.status(404).json({ error: "任务不存在或未公开发布" });
  }
  res.json(await toBountyItem(task));
}

app.get("/bounties", listBounties);
app.get("/bounties/:id", getBounty);
app.get("/api/bounties", listBounties);
app.get("/api/bounties/:id", getBounty);

app.get("/tasks/:id", (req, res) => {
  const task = getTask(db.read(), req.params.id);
  if (!task) return res.status(404).json({ error: "任务不存在" });
  res.json(taskResponse(task));
});

/** 雇主：我发布的全部任务及完成状态 */
function listEmployerTasks(req, res) {
  const state = db.read();
  const eid = req.params.id;
  const items = Object.values(state.tasks)
    .filter((t) => t.employer_id === eid)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map((t) => ({
      id: t.id,
      title: t.spec?.title || "任务",
      summary: (t.spec?.summary || t.raw_input || "").slice(0, 120),
      task_type: t.spec?.task_type,
      status: t.status,
      completed: t.status === "completed",
      price_cents: t.escrow_cents || t.spec?.suggested_price_cents || 0,
      worker_id: t.worker_id,
      push_count: (t.push_sent_to || []).length,
      created_at: t.created_at,
      updated_at: t.updated_at,
    }));
  res.json({ items, total: items.length });
}

/** 雇员：平台推送记录（含已接/未接） */
function listWorkerPushes(req, res) {
  const state = db.read();
  const wid = req.params.id;
  const items = state.inbox
    .filter((i) => i.worker_id === wid)
    .map((i) => {
      const task = getTask(state, i.task_id);
      if (!task) return null;
      const takenByOther = task.worker_id && task.worker_id !== wid;
      return {
        task_id: task.id,
        title: task.spec?.title,
        summary: (task.spec?.summary || "").slice(0, 120),
        price_cents: task.escrow_cents || task.spec?.suggested_price_cents || 0,
        pushed_at: i.pushed_at,
        accepted: i.accepted,
        task_status: task.status,
        can_accept:
          !i.accepted && !takenByOther && ["dispatching", "escrowed"].includes(task.status),
        missed: !i.accepted && takenByOther,
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at));
  res.json({ items, total: items.length });
}

/** 雇员：我接单的任务 */
function listWorkerAssignments(req, res) {
  const state = db.read();
  const wid = req.params.id;
  const items = Object.values(state.tasks)
    .filter((t) => t.worker_id === wid)
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .map((t) => ({
      id: t.id,
      title: t.spec?.title,
      status: t.status,
      completed: t.status === "completed",
      price_cents: t.escrow_cents || t.spec?.suggested_price_cents || 0,
      updated_at: t.updated_at,
    }));
  res.json({ items, total: items.length });
}

app.get("/employers/:id/tasks", listEmployerTasks);
app.get("/api/employers/:id/tasks", listEmployerTasks);
app.get("/workers/:id/pushes", listWorkerPushes);
app.get("/api/workers/:id/pushes", listWorkerPushes);
app.get("/workers/:id/assignments", listWorkerAssignments);
app.get("/api/workers/:id/assignments", listWorkerAssignments);

// 雇员听单
app.post("/workers/:id/online", (req, res) => {
  const state = db.read();
  const w = getUser(state, req.params.id);
  if (!w || w.role !== "worker") return res.status(404).json({ error: "雇员不存在" });
  w.is_online = true;
  w.lat = req.body.lat;
  w.lng = req.body.lng;
  if (req.body.skills) w.skills = req.body.skills;
  upsertUser(state, w);
  db.write(state);
  res.json({ worker_id: w.id, is_online: true, skills: w.skills });
});

app.get("/workers/:id/inbox", (req, res) => {
  const state = db.read();
  const items = state.inbox
    .filter((i) => i.worker_id === req.params.id && !i.accepted)
    .map((i) => {
      const task = getTask(state, i.task_id);
      if (!task || task.status === "completed") return null;
      return {
        task_id: task.id,
        title: task.spec.title,
        summary: task.spec.summary?.slice(0, 120),
        suggested_price_cents: task.spec.suggested_price_cents,
        pushed_at: i.pushed_at,
      };
    })
    .filter(Boolean);
  res.json(items);
});

app.get("/workers/:wid/tasks/:tid/card", (req, res) => {
  const state = db.read();
  const inbox = state.inbox.find(
    (i) => i.worker_id === req.params.wid && i.task_id === req.params.tid
  );
  if (!inbox) return res.status(404).json({ error: "未收到该任务推送" });
  const task = getTask(state, req.params.tid);
  res.json({
    task_id: task.id,
    status: task.status,
    card: task.spec,
    note: "按卡片执行，无需联系雇主",
  });
});

// ⑤ 接单
app.post("/workers/:wid/tasks/:tid/accept", (req, res) => {
  const state = db.read();
  const task = getTask(state, req.params.tid);
  if (!task) return res.status(404).json({ error: "任务不存在" });
  if (task.worker_id && task.worker_id !== req.params.wid) {
    return res.status(409).json({ error: "已被他人接单" });
  }
  const inbox = state.inbox.find(
    (i) => i.worker_id === req.params.wid && i.task_id === req.params.tid
  );
  if (!inbox) return res.status(403).json({ error: "你未收到此任务推送" });

  task.worker_id = req.params.wid;
  task.status = "in_progress";
  inbox.accepted = true;
  task.updated_at = new Date().toISOString();

  for (const row of state.inbox) {
    if (row.task_id !== task.id || row.worker_id === req.params.wid) continue;
    if (row.accepted) continue;
    const other = getUser(state, row.worker_id);
    if (other) recordMiss(state, other, task, { explore: row.explore });
  }

  const worker = getUser(state, req.params.wid);
  if (worker) recordAccept(state, worker, task, { explore: inbox.explore });
  upsertTask(state, task);
  db.write(state);
  res.json(taskResponse(task));
});

// ⑤⑥ 提交 + 验货 + 放款
app.post("/workers/:wid/tasks/:tid/submit", (req, res) => {
  const state = db.read();
  const task = getTask(state, req.params.tid);
  if (!task || task.worker_id !== req.params.wid) {
    return res.status(404).json({ error: "任务不存在或未指派给你" });
  }
  if (task.status !== "in_progress") {
    return res.status(400).json({ error: `当前状态不可提交: ${task.status}` });
  }

  const delivery = { photos: req.body.photos || [], notes: req.body.notes || "" };
  const { ok, reason, confidence } = verifyDelivery(task.spec, delivery);
  if (!ok) {
    return res.status(400).json({ verified: false, reason, confidence });
  }

  const worker = getUser(state, req.params.wid);
  const fee = Math.floor(task.escrow_cents * 0.15);
  const payout = task.escrow_cents - fee;
  worker.wallet_balance_cents = (worker.wallet_balance_cents || 0) + payout;
  task.delivery = delivery;
  task.verification_confidence = confidence;
  task.completed_at = new Date().toISOString();
  task.status = "completed";
  task.updated_at = task.completed_at;
  upsertUser(state, worker);
  upsertTask(state, task);
  recordComplete(state, worker, task);
  recomputeUserReputation(state, task.employer_id);
  recomputeUserReputation(state, task.worker_id);
  db.write(state);

  res.json({
    verified: true,
    reason,
    confidence,
    payout_cents: payout,
    task: taskResponse(task),
  });
});

app.get("/workers/:id/wallet", (req, res) => {
  const w = getUser(db.read(), req.params.id);
  if (!w) return res.status(404).json({ error: "雇员不存在" });
  res.json({ worker_id: w.id, balance_cents: w.wallet_balance_cents || 0 });
});

// Demo seeding endpoint removed.

/** 内部运维：查询信誉（勿接入前端） */
app.get("/internal/reputation/:userId", (req, res) => {
  const state = db.read();
  const user = getUser(state, req.params.userId);
  if (!user) return res.status(404).json({ error: "用户不存在" });
  const rep = recomputeUserReputation(state, user.id);
  db.write(state);
  res.json({
    user_id: user.id,
    role: user.role,
    reputation: rep,
  });
});

/** 内部：预览任务匹配打分（勿接入前端） */
app.get("/internal/match/preview", (req, res) => {
  const taskId = req.query.task_id;
  if (!taskId) {
    return res.status(400).json({ error: "缺少 task_id 查询参数" });
  }
  const state = db.read();
  const task = getTask(state, taskId);
  if (!task) return res.status(404).json({ error: "任务不存在" });
  res.json(previewMatch(state, task));
});

app.post("/internal/match/recompute-stats", (_req, res) => {
  const state = db.read();
  const config = getMatchingConfig();
  recomputeCategoryPrices(state, config);
  recomputeAllWorkerStats(state);
  db.write(state);
  res.json({
    ok: true,
    workers_updated: Object.keys(state.users).filter(
      (id) => state.users[id].role === "worker"
    ).length,
    category_prices: state.matching_meta?.category_price_cents,
  });
});

app.get("/internal/match/category-prices", (_req, res) => {
  const state = db.read();
  const prices = recomputeCategoryPrices(state, getMatchingConfig());
  db.write(state);
  res.json({ category_prices: prices });
});

app.post("/internal/reputation/recompute", (_req, res) => {
  const state = db.read();
  recomputeAllReputations(state);
  db.write(state);
  const summary = Object.fromEntries(
    Object.entries(state.users).map(([id, u]) => [
      id,
      {
        role: u.role,
        score: u.reputation_internal?.score,
        label: u.reputation_internal?.label,
      },
    ])
  );
  res.json({ ok: true, users: summary });
});

// 静态页面放最后，避免干扰 API
app.use(express.static(path.join(__dirname, "..", "public")));

const PORT = Number(process.env.PORT) || 8000;

const server = app.listen(PORT, () => {
  const state = db.read();
  recomputeAllReputations(state);
  recomputeCategoryPrices(state, getMatchingConfig());
  recomputeAllWorkerStats(state);
  db.write(state);
  console.log(`AutoDo  http://127.0.0.1:${PORT}  （前端 + API）`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\n端口 ${PORT} 已被占用。可选方案：\n` +
        `  1) 结束占用进程: netstat -ano | findstr :${PORT}  然后 taskkill /PID <pid> /F\n` +
        `  2) 换端口启动: set PORT=8001 && npm start\n`
    );
    process.exit(1);
  }
  throw err;
});
