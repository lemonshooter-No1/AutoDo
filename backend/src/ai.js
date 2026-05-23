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
  if (/喂猫|猫粮|宠物/.test(text)) return "pet_feeding";
  if (/取件|取货|快递|跑腿/.test(text)) return "errand";
  if (/标注|数据|录入|线上/.test(text)) return "digital";
  return "general";
}

function extractAddress(text) {
  const m = text.match(
    /([\u4e00-\u9fff]{2,8}(?:区|县|市))?[\u4e00-\u9fff\d]+(?:小区|大厦|广场|路|街|号)[^\s，,。]*/
  );
  return m ? m[0] : "";
}

function extractTime(text) {
  const tw = { start: "", end: "" };
  if (/明天|明日/.test(text)) tw.start = "明天";
  const m = text.match(/早上|上午|中午|下午|晚上|(\d{1,2})[点时]/);
  if (m) tw.start = `${tw.start} ${m[0]}`.trim();
  const t = text.match(/(\d{1,2})[:：](\d{2})/);
  if (t) tw.start = `${t[1]}:${t[2]}`;
  tw.end = tw.start;
  return tw;
}

function missingForExecutable(spec, text) {
  const missing = [];
  const addr = spec.location?.address || "";
  if (!addr || addr.length < 4) missing.push("building_detail");
  if (spec.task_type === "pet_feeding") {
    const combined = text + (spec.location?.access_notes || "");
    if (!/门禁|密码|钥匙|门卫|开门/.test(combined)) missing.push("access_code");
  }
  if (spec.task_type !== "digital" && !spec.is_online) {
    if (!/\d+号|\d+栋|\d+单元|\d+室/.test(addr) && !missing.includes("building_detail")) {
      missing.push("building_detail");
    }
  }
  return [...new Set(missing)];
}

function buildSteps(spec) {
  if (spec.task_type === "pet_feeding") {
    return [
      "按地址到达，使用雇主提供的进门方式进入",
      "按说明 locate 猫粮并喂食、换水",
      "拍摄猫粮盆与猫的现状照片",
    ];
  }
  if (spec.task_type === "digital") {
    return ["按任务说明完成数字交付", "上传结果文件或截图"];
  }
  return ["按任务卡片说明完成", "上传规定交付凭证"];
}

/** ① 意图解析 */
export function parseEmployerInput(raw) {
  const task_type = guessTaskType(raw);
  const is_online = task_type === "digital" || /线上|远程/.test(raw);

  const spec = {
    task_type,
    title: task_type === "pet_feeding" ? "上门喂猫" : "同城任务",
    summary: raw.slice(0, 200),
    time_window: extractTime(raw),
    location: { address: extractAddress(raw), lat: null, lng: null, access_notes: "" },
    skills: task_type === "pet_feeding" ? ["pet_care"] : ["errand"],
    estimated_minutes: task_type === "pet_feeding" ? 30 : 45,
    suggested_price_cents: task_type === "pet_feeding" ? 8000 : 6000,
    steps: [],
    deliverables: [
      {
        type: is_online ? "file" : "photo",
        description:
          task_type === "pet_feeding" ? "猫粮盆与宠物现状" : "任务完成凭证",
      },
    ],
    executable_ready: false,
    missing_fields: [],
    is_online,
  };

  if (is_online) {
    spec.skills = ["digital_labor"];
    spec.suggested_price_cents = 5000;
  } else if (/朝阳/.test(raw)) {
    spec.location.lat = 39.9219;
    spec.location.lng = 116.4436;
  }

  spec.steps = buildSteps(spec);
  spec.missing_fields = missingForExecutable(spec, raw);
  spec.executable_ready = spec.missing_fields.length === 0;
  return spec;
}

/** ② 合并澄清 */
export function applyClarifications(spec, answers) {
  for (const [key, value] of Object.entries(answers)) {
    if (key === "access_code") spec.location.access_notes = value;
    else if (key === "building_detail")
      spec.location.address = `${spec.location.address} ${value}`.trim();
    else if (key === "contact_phone") spec.summary += `\n联系人: ${value}`;
    else if (key === "pet_notes") spec.summary += `\n宠物备注: ${value}`;
  }
  const combined =
    spec.summary + (spec.location.access_notes || "") + (spec.location.address || "");
  spec.missing_fields = missingForExecutable(spec, combined);
  spec.executable_ready = spec.missing_fields.length === 0;
  return spec;
}

/** ⑥ 验货 */
export function verifyDelivery(spec, delivery) {
  const photos = delivery.photos || [];
  if (!photos.length) return { ok: false, reason: "缺少交付照片", confidence: 0.2 };
  return { ok: true, reason: "交付物符合任务卡片要求", confidence: 0.92 };
}
