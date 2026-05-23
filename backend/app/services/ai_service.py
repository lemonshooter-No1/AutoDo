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
    m = re.search(
        r"([\u4e00-\u9fff]{2,8}(?:区|县|市))?[\u4e00-\u9fff\d]+(?:小区|大厦|广场|路|街|号)[^\s，,。]*",
        text,
    )
    return m.group(0) if m else ""


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
    missing: list[str] = []
    addr = spec.location.address
    if not addr or len(addr) < 4:
        missing.append("building_detail")
    if spec.task_type == "pet_feeding":
        if not re.search(r"门禁|密码|钥匙|门卫|开门", text + spec.location.access_notes):
            missing.append("access_code")
    if spec.task_type == "digital":
        return []  # 线上任务不强制门禁
    if spec.task_type != "digital" and not spec.location.lat:
        # 线下无坐标时允许仅有文字地址，但门牌要清
        if not re.search(r"\d+号|\d+栋|\d+单元|\d+室", addr):
            if "building_detail" not in missing:
                missing.append("building_detail")
    return list(dict.fromkeys(missing))


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


def parse_employer_input(raw: str) -> TaskSpec:
    """① 意图解析 → TaskSpec"""
    # If a SILICON_FLOW_API_KEY is provided, prefer the DeepSeek model for parsing
    api_key = os.getenv("SILICON_FLOW_API_KEY")
    api_base = os.getenv("SILICON_FLOW_API_BASE", "https://api.siliconflow.cn/v1")
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
        # MVP：演示用固定坐标（朝阳区中心附近）
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
    return spec


def clarify_questions(missing: list[str]) -> list[dict[str, str]]:
    return [
        {"field": f, "label": CLARIFY_LABELS.get(f, f)}
        for f in missing
    ]


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
