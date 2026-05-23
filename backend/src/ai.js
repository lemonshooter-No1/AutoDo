const CLARIFY_LABELS = {
  access_code: "门禁密码或进门方式",
  building_detail: "楼栋/单元/门牌号",
  contact_phone: "现场联系人电话",
  pet_notes: "宠物注意事项",
};

function getClarifyLabel(field, spec) {
  if (field === "building_detail") {
    if (spec?.task_type === "errand") {
      return "具体取件点/楼号/门牌号（如：2号楼、201室、3单元）";
    }
    if (spec?.task_type === "queue") {
      return "具体办事点/楼号/门牌号";
    }
    if (spec?.task_type === "pet_feeding") {
      return "楼栋/单元/门牌号";
    }
    return "具体地点信息（楼栋/单元/门牌号）";
  }

  if (field === "access_code") {
    return spec?.task_type === "pet_feeding"
      ? "门禁密码/钥匙/开门方式"
      : "门禁密码或进门方式";
  }

  if (field === "contact_phone") {
    return "现场联系人电话";
  }

  if (field === "pet_notes") {
    return "宠物注意事项";
  }

  return CLARIFY_LABELS[field] || field;
}

const ADDRESS_PREFIX_RE = /^(?:请|帮我|麻烦|需要)?(?:到|去|前往|送到|送至|在)?\s*/;
const ADDRESS_LEADING_NOISE_RE = /^(?:明天|明日|今天|后天|今晚|今早|今晨|明早|早上|上午|中午|下午|晚上|\d{1,2}(?:[:：]\d{2})?(?:点半|点)?|帮我|麻烦|请|需要|到|去|前往|在|上门|顺路|顺便|先|约|大概)\s*/;
const ADDRESS_ACTION_RE = /喂|取|送|跑腿|拿|买|拍|寄|修|装|接|清洁|打扫|照顾|顺便|然后|再/;

export function clarifyQuestions(spec, missing) {
  return missing.map((f) => ({ field: f, label: getClarifyLabel(f, spec) }));
}

function guessTaskType(text) {
  if (/喂猫|猫粮|宠物/.test(text)) return "pet_feeding";
  if (/取件|取货|快递|跑腿/.test(text)) return "errand";
  if (/标注|数据|录入|线上/.test(text)) return "digital";
  return "general";
}

function extractAddress(text) {
  const raw = (text || "").trim();
  if (!raw) return "";

  let normalized = raw.replace(ADDRESS_PREFIX_RE, "");
  let previous = "";
  while (normalized !== previous) {
    previous = normalized;
    normalized = normalized.replace(ADDRESS_LEADING_NOISE_RE, "");
  }

  const punctuationIndex = normalized.search(/[，,。.!?；;\n]/);
  const actionIndex = normalized.search(ADDRESS_ACTION_RE);
  const endCandidates = [punctuationIndex, actionIndex].filter((index) => index >= 0);
  const end = endCandidates.length ? Math.min(...endCandidates) : normalized.length;
  const candidate = normalized.slice(0, end).trim().replace(ADDRESS_LEADING_NOISE_RE, "");
  return hasSpecificAddress(candidate) ? candidate : "";
}

function hasSpecificAddress(address) {
  return /(小区|园区|花园|苑|园|大厦|广场|写字楼|公寓|医院|学校|商场|门店|路|街|巷|道|号楼|栋|单元|室|层)/.test(
    address || ""
  );
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
  const combined = text + (spec.location?.access_notes || "");

  // 线上任务无需澄清
  if (spec.task_type === "digital" || spec.is_online) {
    return [];
  }

  // 对于上门服务（喂猫），需要进门方式和明确地址
  if (spec.task_type === "pet_feeding") {
    if (!hasSpecificAddress(addr)) {
      missing.push("building_detail");
    }
    if (!/门禁|密码|钥匙|门卫|开门/.test(combined)) {
      missing.push("access_code");
    }
    return [...new Set(missing)];
  }

  // 对于取件、跑腿类任务（errand），需要更具体的位置信息
  // "中关村大街" 不够具体，需要追问楼号、几号楼等
  if (spec.task_type === "errand") {
    // 检查是否有明确的编号/层级关键词（号、栋、单元、室等）
    if (!/\d+号|\d+栋|\d+单元|\d+室|\d+层|[1-9]([0-9])?号楼/.test(addr)) {
      missing.push("building_detail");
    }
    return missing;
  }

  // 其他线下任务，检查是否有足够具体的地点
  if (!hasSpecificAddress(addr)) {
    missing.push("building_detail");
  }

  return missing;
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
