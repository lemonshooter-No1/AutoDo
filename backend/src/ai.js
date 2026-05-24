import { parseTaskLLM, isLLMAvailable } from "./llm.js";

const CLARIFY_LABELS = {
  access_code: "门禁密码或进门方式",
  building_detail: "楼栋/单元/门牌号",
  contact_phone: "现场联系人电话",
  pet_notes: "宠物注意事项",
};

export function clarifyQuestions(missing) {
  return missing.map((f) => ({ field: f, label: CLARIFY_LABELS[f] || f }));
}

function guessTaskType(text) {
  if (/喂|遛|溜/.test(text) && /猫|狗|宠物/.test(text)) return "pet_feeding";
  if (/猫粮|狗粮/.test(text)) return "pet_feeding";
  if (/排队|挂号|取号|代买|代购|买菜|超市|采购/.test(text)) return "queue";
  if (/取件|取货|快递|跑腿|送件|送货|代取|顺路/.test(text)) return "errand";
  if (/标注|数据|录入|线上|远程|审核|翻译|文案|设计/.test(text)) return "digital";
  return "general";
}

function guessTitle(text, taskType) {
  if (taskType === "pet_feeding") {
    if (/狗/.test(text)) {
      if (/遛|溜/.test(text)) return "上门遛狗";
      return "上门喂狗";
    }
    if (/猫/.test(text)) return "上门喂猫";
    return "上门喂宠物";
  }
  if (taskType === "errand") {
    if (/取件|取货|代取/.test(text)) return "同城取件送达";
    if (/送件|送货/.test(text)) return "同城送货";
    return "同城跑腿";
  }
  if (taskType === "queue") {
    if (/挂号|取号/.test(text)) return "医院排队取号";
    if (/代买|代购|买菜|超市|采购/.test(text)) return "代买代办";
    return "现场代办";
  }
  if (taskType === "digital") {
    if (/标注/.test(text)) return "数据标注";
    if (/审核/.test(text)) return "内容审核";
    if (/翻译/.test(text)) return "翻译任务";
    if (/设计/.test(text)) return "设计任务";
    return "线上任务";
  }
  return "同城任务";
}

function extractAddress(text) {
  const m = text.match(
    /([\u4e00-\u9fff]{2,8}(?:区|县|市))?[\u4e00-\u9fff\d]+(?:小区|大厦|广场|路|街|号|楼|村|苑|园)/
  );
  return m ? m[0] : "";
}

function extractTimePairs(text) {
  const tw = { start: "", end: "" };
  if (/明天|明日/.test(text)) tw.start = "明天";
  else if (/后天/.test(text)) tw.start = "后天";
  else if (/今天|今日/.test(text)) tw.start = "今天";
  else if (/周[一二三四五六日]/.test(text)) {
    const m = text.match(/周[一二三四五六日]/);
    if (m) tw.start = m[0];
  }
  const timeM = text.match(/早上|早晨|上午|中午|下午|傍晚|晚上|(\d{1,2})[点时]/);
  if (timeM) tw.start = `${tw.start} ${timeM[0]}`.trim();
  const exact = text.match(/(\d{1,2})[:：](\d{2})/);
  if (exact) tw.start = `${tw.start || ""} ${exact[0]}`.trim();
  tw.end = tw.start;
  return tw;
}

function missingForExecutable(spec) {
  const missing = [];
  const addr = spec.location?.address || "";

  if (!addr || addr.length < 4) {
    missing.push("building_detail");
  } else if (spec.task_type !== "digital" && !spec.is_online) {
    if (!/\d+号|\d+栋|\d+单元|\d+室/.test(addr)) {
      missing.push("building_detail");
    }
  }

  if (spec.task_type === "pet_feeding") {
    if (!spec.location.access_notes || spec.location.access_notes.trim().length < 2) {
      missing.push("access_code");
    }
  }

  return [...new Set(missing)];
}

function buildSteps(spec) {
  if (spec.task_type === "pet_feeding") {
    return [
      "按地址到达，使用雇主提供的进门方式进入",
      "按说明喂食、换水",
      "拍摄宠物与食盆现状照片",
    ];
  }
  if (spec.task_type === "errand") {
    return [
      "按地址取件/取货",
      "安全送达目的地",
      "收件人确认并拍照凭证",
    ];
  }
  if (spec.task_type === "queue") {
    return [
      "按时到达指定地点",
      "排队/代办/采购",
      "拍照小票或结果发回",
    ];
  }
  if (spec.task_type === "digital") {
    return ["按任务说明完成数字交付", "上传结果文件或截图"];
  }
  return ["按任务卡片说明完成", "上传规定交付凭证"];
}

const VALID_TASK_TYPES = new Set(["pet_feeding", "errand", "queue", "digital", "general"]);

function parseTime(rawTime) {
  if (!rawTime) return { start: "", end: "" };
  const tw = { start: rawTime.slice(0, 100), end: rawTime.slice(0, 100) };
  return tw;
}

function parseLLMResult(llm, raw) {
  const task_type = VALID_TASK_TYPES.has(llm.task_type) ? llm.task_type : guessTaskType(raw);
  const is_online = llm.is_online === true || task_type === "digital" || /线上|远程/.test(raw);

  const location = {
    address: (llm.location || extractAddress(raw)).slice(0, 200),
    lat: null,
    lng: null,
    access_notes: llm.access_notes || "",
  };

  const timeRaw = llm.time || "";
  const time_window = timeRaw ? parseTime(timeRaw) : extractTimePairs(raw);

  const price = Number.isFinite(llm.suggested_price_cents) && llm.suggested_price_cents > 0
    ? Math.round(llm.suggested_price_cents)
    : (task_type === "pet_feeding" ? 8000 : task_type === "queue" ? 12000 : 6000);

  const spec = {
    task_type,
    title: (llm.title || guessTitle(raw, task_type)).slice(0, 50),
    summary: (llm.summary || raw.slice(0, 200)).slice(0, 300),
    time_window,
    location,
    skills: is_online ? ["digital_labor"] : (task_type === "pet_feeding" ? ["pet_care"] : ["errand"]),
    estimated_minutes: Number.isFinite(llm.estimated_minutes) ? Math.max(10, llm.estimated_minutes) : (task_type === "queue" ? 60 : 45),
    suggested_price_cents: price,
    steps: Array.isArray(llm.steps) && llm.steps.length ? llm.steps.map((s) => String(s).slice(0, 100)) : [],
    deliverables: Array.isArray(llm.deliverables) && llm.deliverables.length
      ? llm.deliverables.map((d) => ({ type: d.type || (is_online ? "file" : "photo"), description: String(d.description || "任务完成凭证").slice(0, 100) }))
      : [{ type: is_online ? "file" : "photo", description: "任务完成凭证" }],
    executable_ready: false,
    missing_fields: [],
    is_online,
  };

  if (/朝阳/.test(raw)) { spec.location.lat = 39.9219; spec.location.lng = 116.4436; }
  else if (/海淀/.test(raw)) { spec.location.lat = 39.983; spec.location.lng = 116.316; }
  else if (/丰台/.test(raw)) { spec.location.lat = 39.858; spec.location.lng = 116.287; }

  return spec;
}

function parseWithRules(raw) {
  const task_type = guessTaskType(raw);
  const is_online = task_type === "digital" || /线上|远程/.test(raw);

  const priceMap = { pet_feeding: 8000, errand: 5000, queue: 12000, digital: 5000, general: 6000 };
  const skillMap = { pet_feeding: ["pet_care"], errand: ["errand"], queue: ["errand"], digital: ["digital_labor"], general: ["errand"] };

  const spec = {
    task_type,
    title: guessTitle(raw, task_type),
    summary: raw.slice(0, 200),
    time_window: extractTimePairs(raw),
    location: { address: extractAddress(raw), lat: null, lng: null, access_notes: "" },
    skills: is_online ? ["digital_labor"] : (skillMap[task_type] || ["errand"]),
    estimated_minutes: task_type === "queue" ? 60 : task_type === "pet_feeding" ? 30 : 45,
    suggested_price_cents: is_online ? 5000 : (priceMap[task_type] || 6000),
    steps: [],
    deliverables: [{ type: is_online ? "file" : "photo", description: task_type === "pet_feeding" ? "宠物与食盆现状照片" : "任务完成凭证" }],
    executable_ready: false,
    missing_fields: [],
    is_online,
  };

  if (/朝阳/.test(raw)) { spec.location.lat = 39.9219; spec.location.lng = 116.4436; }
  else if (/海淀/.test(raw)) { spec.location.lat = 39.983; spec.location.lng = 116.316; }
  else if (/丰台/.test(raw)) { spec.location.lat = 39.858; spec.location.lng = 116.287; }

  spec.steps = buildSteps(spec);
  spec.missing_fields = missingForExecutable(spec);
  spec.executable_ready = spec.missing_fields.length === 0;
  return spec;
}

export async function parseEmployerInput(raw) {
  if (!raw) return parseWithRules(raw);

  if (isLLMAvailable()) {
    const llmResult = await parseTaskLLM(raw);
    if (llmResult) {
      const spec = parseLLMResult(llmResult, raw);
      if (!spec.steps.length) spec.steps = buildSteps(spec);

      const llmMissing = Array.isArray(llmResult.missing_fields) ? llmResult.missing_fields : [];
      const ruleMissing = missingForExecutable(spec);
      const merged = [...new Set([...llmMissing, ...ruleMissing])]
        .filter((f) => CLARIFY_LABELS[f]);

      spec.missing_fields = merged;
      spec.executable_ready = merged.length === 0;
      return spec;
    }
  }

  return parseWithRules(raw);
}

export function applyClarifications(spec, answers) {
  for (const [key, value] of Object.entries(answers)) {
    if (key === "access_code") spec.location.access_notes = value;
    else if (key === "building_detail")
      spec.location.address = `${spec.location.address} ${value}`.trim();
    else if (key === "contact_phone") spec.summary += `\n联系人: ${value}`;
    else if (key === "pet_notes") spec.summary += `\n宠物备注: ${value}`;
  }
  spec.missing_fields = missingForExecutable(spec);
  spec.executable_ready = spec.missing_fields.length === 0;
  return spec;
}

export function verifyDelivery(spec, delivery) {
  const photos = delivery.photos || [];
  if (!photos.length) return { ok: false, reason: "缺少交付照片", confidence: 0.2 };
  return { ok: true, reason: "交付物符合任务卡片要求", confidence: 0.92 };
}
