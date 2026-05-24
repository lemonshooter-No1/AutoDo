function getApiKey() {
  return process.env.SILICONFLOW_API_KEY || "";
}

function getApiBase() {
  return process.env.SILICONFLOW_API_BASE || "https://api.siliconflow.cn/v1";
}

function getModel() {
  return process.env.LLM_MODEL || "Qwen/Qwen3-8B";
}

const SYSTEM_PROMPT = `你是一个任务解析助手。用户会用自然语言描述一个需要线下执行的任务。
你需要输出严格的 JSON，包含以下字段（都用中文）：

{
  "task_type": "pet_feeding | errand | queue | digital | general",
  "title": "简短任务标题（6-12字）",
  "summary": "一句话概括任务（40字以内）",
  "time": "时间描述，如'明天 早上8点'",
  "location": "提取的地址，若无则留空字符串",
  "suggested_price_cents": 建议报酬（整数，单位分），参考：宠物喂养5000-8000，跑腿4000-6000，排队代办8000-15000，线上任务5000-10000,
  "estimated_minutes": 预估耗时分钟数,
  "missing_fields": ["缺少的字段列表：access_code/门禁方式, building_detail/门牌楼栋, contact_phone/联系电话, pet_notes/宠物备注"],
  "is_online": true或false（是否可以纯线上完成）
}

task_type 分类规则：
- 喂食/遛/照顾宠物 → pet_feeding
- 取件/送货/跑腿 → errand  
- 排队/挂号/代买/代购 → queue
- 数据标注/审核/翻译/远程办公 → digital
- 其他 → general

只输出 JSON，不要任何额外文字。`;

export async function parseTaskLLM(raw) {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const res = await fetch(`${getApiBase()}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: getModel(),
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: raw },
        ],
        temperature: 0.1,
        max_tokens: 800,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.warn("LLM API error:", res.status);
      return null;
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content);
    return parsed;
  } catch (e) {
    console.warn("LLM parse failed, fallback to rules:", e.message);
    return null;
  }
}

export function isLLMAvailable() {
  return !!getApiKey();
}
