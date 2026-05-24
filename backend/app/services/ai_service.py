"""AI：意图解析、澄清判定、验货。无 API Key 时用规则 mock。"""

import json
import os
import re
from typing import Any

import requests

from app.schemas import DeliverableSpec, LocationSpec, TaskSpec, TimeWindow

# 澄清字段 → 展示文案
CLARIFY_LABELS = {
    "access_code": "门禁密码或进门方式",
    "building_detail": "楼栋/单元/门牌号",
    "contact_phone": "现场联系人电话",
    "pet_notes": "宠物注意事项（攻击性/躲藏位置等）",
}

ADDRESS_PREFIX_RE = re.compile(r"^(?:请|帮我|麻烦|需要)?(?:到|去|前往|送到|送至|在)?\s*")
ADDRESS_LEADING_NOISE_RE = re.compile(
    r"^(?:明天|明日|今天|后天|今晚|今早|今晨|明早|早上|上午|中午|下午|晚上|\d{1,2}(?:[:：]\d{2})?(?:点半|点)?|帮我|麻烦|请|需要|到|去|前往|在|上门|顺路|顺便|先|约|大概)\s*"
)
ADDRESS_ACTION_RE = re.compile(r"喂|取|送|跑腿|拿|买|拍|寄|修|装|接|清洁|打扫|照顾|顺便|然后|再")
SPECIFIC_ADDRESS_RE = re.compile(r"(小区|园区|花园|苑|园|大厦|广场|写字楼|公寓|医院|学校|商场|门店|路|街|巷|道|号楼|栋|单元|室|层)")


def _guess_task_type(text: str) -> str:
    if re.search(r"喂猫|猫粮|宠物", text):
        return "pet_feeding"
    if re.search(r"取件|取货|快递|跑腿", text):
        return "errand"
    if re.search(r"排队|代办", text):
        return "queue"
    if re.search(r"标注|数据|录入|线上", text):
        return "digital"
    return "general"


def _extract_address(text: str) -> str:
    raw = (text or "").strip()
    if not raw:
        return ""

    normalized = ADDRESS_PREFIX_RE.sub("", raw)
    previous = ""
    while normalized != previous:
        previous = normalized
        normalized = ADDRESS_LEADING_NOISE_RE.sub("", normalized)

    punctuation_index = re.search(r"[，,。.!?；;\n]", normalized)
    action_index = ADDRESS_ACTION_RE.search(normalized)
    end_candidates = [index.start() for index in [punctuation_index, action_index] if index]
    end = min(end_candidates) if end_candidates else len(normalized)
    candidate = ADDRESS_LEADING_NOISE_RE.sub("", normalized[:end]).strip()
    return candidate if SPECIFIC_ADDRESS_RE.search(candidate) else ""


def _extract_time(text: str) -> TimeWindow:
    tw = TimeWindow()
    if re.search(r"明天|明日", text):
        tw.start = "明天"
    if m := re.search(r"早上|上午|中午|下午|晚上|(\d{1,2})[点时]", text):
        tw.start = (tw.start + " " + m.group(0)).strip()
    if m := re.search(r"(\d{1,2})[:：](\d{2})", text):
        tw.start = f"{m.group(1)}:{m.group(2)}"
    tw.end = tw.start
    return tw


def _missing_for_executable(spec: TaskSpec, text: str) -> list[str]:
    """判断任务执行是否还缺少关键信息。
    
    策略：
    - 线上任务（digital）无需地址和门禁，返回 []
    - 上门任务（pet_feeding）需要清晰地址和进门方式
    - 取件/跑腿任务（errand）需要具体的编号信息（房号、栋号、单元号等）
    - 其他线下任务需要具体的地点标记
    """
    missing: list[str] = []
    addr = spec.location.address or ""
    combined_text = (text or "").lower() + (spec.location.access_notes or "").lower()

    # 线上任务无需澄清
    if spec.task_type == "digital" or spec.is_online:
        return []

    # 上门类任务需要进门方式和具体地址
    if spec.task_type == "pet_feeding":
        if not SPECIFIC_ADDRESS_RE.search(addr):
            missing.append("building_detail")
        if not re.search(r"门禁|密码|钥匙|门卫|开门", combined_text):
            missing.append("access_code")
        return list(dict.fromkeys(missing))

    # 取件/跑腿任务需要更具体的位置编号
    if spec.task_type == "errand":
        # 检查是否有明确的编号/层级关键词（号、栋、单元、室等）
        if not re.search(r"\d+号|\d+栋|\d+单元|\d+室|\d+层|[1-9]([0-9])?号楼", addr):
            missing.append("building_detail")
        return missing

    # 其他线下任务检查是否有足够具体的地点
    if not SPECIFIC_ADDRESS_RE.search(addr):
        missing.append("building_detail")

    return missing



def _build_steps(spec: TaskSpec) -> list[str]:
    if spec.task_type == "pet_feeding":
        return [
            "按地址到达，使用雇主提供的进门方式进入",
            "按雇主说明 locate 猫粮并喂食、换水",
            "拍摄猫粮盆与猫的现状照片",
        ]
    if spec.task_type == "digital":
        return ["按任务说明完成数字交付", "上传结果文件或截图"]
    return ["按任务卡片说明完成现场事项", "上传规定交付凭证"]


def decide_flow(spec: TaskSpec) -> str:
    """简单规则决定走 A（顺手帮）还是 B（悬赏令）。

    默认规则：
    - 若为线下任务且 suggested_price_cents <= 1000 且 estimated_minutes <= 60 → A
    - 否则 → B
    """
    try:
        price = int(spec.suggested_price_cents or 0)
        minutes = int(spec.estimated_minutes or 0)
    except Exception:
        return "B"
    if not spec.is_online and price <= 1000 and minutes <= 60:
        return "A"
    return "B"


def parse_employer_input(raw: str) -> TaskSpec:
    """① 意图解析 → TaskSpec"""
    # If a SILICON_FLOW_API_KEY is provided, prefer the DeepSeek model for parsing
    api_key = os.getenv("SILICON_FLOW_API_KEY")
    api_base = os.getenv("SILICON_FLOW_API_BASE", "https://api.siliconflow.cn/v1")
    use_mock = os.getenv("USE_MOCK_DEEPSEEK", "0") in ("1", "true", "True")

    # Local mock mode for testing when real API keys are not available.
    if use_mock:
        # Provide a deterministic, model-like TaskSpec for offline testing
        task_type = _guess_task_type(raw)
        is_online = task_type == "digital" or bool(re.search(r"线上|远程", raw))
        spec = TaskSpec(
            task_type=task_type,
            title=("上门喂猫" if task_type == "pet_feeding" else "同城任务"),
            summary=(raw[:200]),
            time_window=_extract_time(raw),
            location=LocationSpec(address=_extract_address(raw)),
            skills=( ["pet_care"] if task_type == "pet_feeding" else ["errand"] ),
            estimated_minutes=(30 if task_type == "pet_feeding" else 45),
            suggested_price_cents=(8000 if task_type == "pet_feeding" else 6000),
            is_online=is_online,
        )
        spec.steps = _build_steps(spec)
        spec.deliverables = [
            DeliverableSpec(
                type=("photo" if not is_online else "file"),
                description=("猫粮盆与宠物现状" if task_type == "pet_feeding" else "任务完成凭证"),
            )
        ]
        spec.missing_fields = _missing_for_executable(spec, raw)
        spec.executable_ready = len(spec.missing_fields) == 0
        spec.flow = decide_flow(spec)
        return spec

    if api_key:
        try:
            url = f"{api_base}/models/DeepSeek-V4-Flash/parse"
            payload = {"input": raw, "instructions": "提取任务类型、地点、时间、预算建议，并指出是否缺少执行所需的信息；返回标准化字段：task_type, title, summary, time, location, suggested_price_cents, missing_fields。中文返回。"}
            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            resp = requests.post(url, headers=headers, json=payload, timeout=6)
            if resp.ok:
                data = resp.json()
                # Expecting model to return a standardized JSON; provide safe fallbacks
                task_type = data.get("task_type") or _guess_task_type(raw)
                is_online = task_type == "digital" or bool(re.search(r"线上|远程", raw))
                spec = TaskSpec(
                    task_type=task_type,
                    title=data.get("title") or ("上门喂猫" if task_type == "pet_feeding" else "同城任务"),
                    summary=data.get("summary") or raw[:200],
                    time_window=_extract_time(data.get("time") or raw),
                    location=LocationSpec(address=data.get("location") or _extract_address(raw)),
                    skills=data.get("skills") or (["pet_care"] if task_type == "pet_feeding" else ["errand"]),
                    estimated_minutes=data.get("estimated_minutes") or (30 if task_type == "pet_feeding" else 45),
                    suggested_price_cents=int(data.get("suggested_price_cents") or (8000 if task_type == "pet_feeding" else 6000)),
                    is_online=is_online,
                )
                spec.steps = data.get("steps") or _build_steps(spec)
                spec.deliverables = [
                    DeliverableSpec(
                        type=("photo" if not is_online else "file"),
                        description=(data.get("deliverable_desc") or ("猫粮盆与宠物现状" if task_type == "pet_feeding" else "任务完成凭证")),
                    )
                ]
                spec.missing_fields = data.get("missing_fields") or _missing_for_executable(spec, raw)
                spec.executable_ready = len(spec.missing_fields) == 0
                spec.flow = decide_flow(spec)
                return spec
        except Exception:
            # On any error, fall back to the local heuristic parser
            pass

    # Fallback: original lightweight parser
    task_type = _guess_task_type(raw)
    is_online = task_type == "digital" or bool(re.search(r"线上|远程", raw))

    spec = TaskSpec(
        task_type=task_type,
        title="上门喂猫" if task_type == "pet_feeding" else "同城任务",
        summary=raw[:200],
        time_window=_extract_time(raw),
        location=LocationSpec(address=_extract_address(raw)),
        skills=["pet_care"] if task_type == "pet_feeding" else ["errand"],
        estimated_minutes=30 if task_type == "pet_feeding" else 45,
        suggested_price_cents=8000 if task_type == "pet_feeding" else 6000,
        is_online=is_online,
    )
    if is_online:
        spec.skills = ["digital_labor"]
        spec.suggested_price_cents = 5000
    elif "朝阳" in raw:
        # MVP：开发用固定坐标（朝阳区中心附近）
        spec.location.lat = 39.9219
        spec.location.lng = 116.4436

    spec.steps = _build_steps(spec)
    spec.deliverables = [
        DeliverableSpec(
            type="photo" if not is_online else "file",
            description="猫粮盆与宠物现状" if task_type == "pet_feeding" else "任务完成凭证",
        )
    ]
    spec.missing_fields = _missing_for_executable(spec, raw)
    spec.executable_ready = len(spec.missing_fields) == 0
    spec.flow = decide_flow(spec)
    return spec


def apply_clarifications(spec: TaskSpec, answers: dict[str, str]) -> TaskSpec:
    """② 合并澄清答案并重新判定可否执行"""
    for key, value in answers.items():
        if key == "access_code":
            spec.location.access_notes = value
        elif key == "building_detail":
            spec.location.address = (spec.location.address + " " + value).strip()
        elif key == "contact_phone":
            spec.summary += f"\n联系人: {value}"
        elif key == "pet_notes":
            spec.summary += f"\n宠物备注: {value}"

    combined = spec.summary + spec.location.access_notes + spec.location.address
    spec.missing_fields = _missing_for_executable(spec, combined)
    spec.executable_ready = len(spec.missing_fields) == 0
    spec.flow = decide_flow(spec)
    return spec


def clarify_questions(spec: TaskSpec, raw: str) -> list[dict[str, str]]:
    """基于缺失字段生成澄清问题，优先使用 DeepSeek 模型生成更友好的问题文本。

    返回格式：[{ 'field': 'building_detail', 'label': '楼栋/单元/门牌号' }, ...]
    """
    api_key = os.getenv("SILICON_FLOW_API_KEY")
    api_base = os.getenv("SILICON_FLOW_API_BASE", "https://api.siliconflow.cn/v1")
    use_mock = os.getenv("USE_MOCK_DEEPSEEK", "0") in ("1", "true", "True")
    missing = spec.missing_fields or []

    # Mock behavior: return readable labels for missing fields to aid offline testing
    if use_mock and missing:
        return [{"field": f, "label": CLARIFY_LABELS.get(f, f)} for f in missing]

    if api_key and missing:
        try:
            url = f"{api_base}/models/DeepSeek-V4-Flash/clarify"
            payload = {
                "input": raw,
                "missing_fields": missing,
                "instructions": "针对缺失字段生成简洁明了的问题供雇主填写，返回 JSON 列表，每项包含 field 和 label（中文）。例如：[{\"field\":\"building_detail\",\"label\":\"楼栋/单元/门牌号\"}]"
            }
            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            resp = requests.post(url, headers=headers, json=payload, timeout=6)
            if resp.ok:
                data = resp.json()
                qs = data.get("questions") or data.get("clarify_questions") or []
                out = []
                for q in qs:
                    field = q.get("field") if isinstance(q, dict) else None
                    label = q.get("label") if isinstance(q, dict) else None
                    if field:
                        out.append({"field": field, "label": label or CLARIFY_LABELS.get(field, field)})
                if out:
                    return out
        except Exception:
            pass

    # Fallback: simple mapping
    return [{"field": f, "label": CLARIFY_LABELS.get(f, f)} for f in missing]


def verify_delivery(spec: TaskSpec, delivery: dict[str, Any]) -> tuple[bool, str, float]:
    """⑥ 规则 + 简易 AI 验货"""
    photos = delivery.get("photos") or []
    if not photos:
        return False, "缺少交付照片", 0.2

    # 有 OPENAI_API_KEY 时可在此接 vision；MVP 规则通过
    api_key = os.getenv("OPENAI_API_KEY")
    if api_key:
        # 预留：httpx 调 OpenAI；MVP 仍用规则避免强依赖网络
        pass

    if spec.task_type == "pet_feeding" and len(photos) < 1:
        return False, "喂猫任务至少需要 1 张现场照片", 0.4

    return True, "交付物符合任务卡片要求", 0.92
