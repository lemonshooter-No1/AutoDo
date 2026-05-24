"""④ 派单：线下 5km Geo + 技能；线上全球队列。"""

import json
import math
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import Task, User, WorkerInbox, utcnow

RADIUS_KM = 5.0
PUSH_TOP_N = 5


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _spec(task: Task) -> dict:
    return json.loads(task.spec_json or "{}")


def find_candidates(db: Session, task: Task, flow: str = "A") -> list[tuple[User, float | None]]:
    spec = _spec(task)
    required_skills = set(spec.get("skills") or [])
    is_online = spec.get("is_online", False)

    workers = (
        db.query(User)
        .filter(User.role == "worker", User.is_online.is_(True))
        .all()
    )

    # Adjust radius and top_n based on flow
    radius_km = RADIUS_KM if flow == "A" else max(RADIUS_KM, 10.0)
    top_n = PUSH_TOP_N if flow == "A" else max(PUSH_TOP_N, 10)

    candidates: list[tuple[User, float | None]] = []
    for w in workers:
        if not required_skills.intersection(set(w.skills)) and required_skills:
            continue
        if is_online:
            candidates.append((w, None))
            continue
        lat, lng = spec.get("location", {}).get("lat"), spec.get("location", {}).get("lng")
        if w.lat is None or w.lng is None:
            continue
        if lat is None or lng is None:
            # 无坐标：MVP 所有在线工人都可收（开发/测试用）
            candidates.append((w, 0.0))
            continue
        dist = haversine_km(lat, lng, w.lat, w.lng)
        if dist <= radius_km:
            candidates.append((w, dist))

    candidates.sort(key=lambda x: (x[1] is None, x[1] or 9999.0))
    return candidates[:top_n]


def dispatch_task(db: Session, task: Task, flow: str = "A") -> list[str]:
    """向候选雇员写入 inbox（模拟 Push）"""
    pushed: list[str] = []
    for worker, _dist in find_candidates(db, task, flow=flow):
        exists = (
            db.query(WorkerInbox)
            .filter(WorkerInbox.worker_id == worker.id, WorkerInbox.task_id == task.id)
            .first()
        )
        if exists:
            continue
        db.add(
            WorkerInbox(
                worker_id=worker.id,
                task_id=task.id,
                pushed_at=utcnow(),
            )
        )
        pushed.append(worker.id)

    task.push_sent_json = json.dumps(pushed, ensure_ascii=False)
    task.status = "dispatching"
    task.updated_at = utcnow()
    db.commit()
    return pushed
