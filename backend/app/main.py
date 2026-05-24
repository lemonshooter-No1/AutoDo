import json
import uuid
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, HTTPException
from sqlalchemy.orm import Session

from app.database import Base, engine, get_db
from app.models import Task, User, WorkerInbox, utcnow
from app.schemas import (
    ClarifyRequest,
    ConfirmPaymentRequest,
    CreateTaskRequest,
    SubmitDeliveryRequest,
    TaskResponse,
    TaskSpec,
    TaskStatus,
    WalletResponse,
    WorkerGoOnlineRequest,
    WorkerInboxItem,
)
from app.services import ai_service, dispatch_service, escrow_service
from app.services.ai_service import clarify_questions

app = FastAPI(
    title="AutoDo API",
    description="极简众包：AI 发布 → 推送 → 接单 → 验货 → 放款。无聊天、无逛大厅。",
    version="0.2.0",
)


@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)


def _load_spec(task: Task) -> TaskSpec:
    return TaskSpec.model_validate(json.loads(task.spec_json or "{}"))


def _save_spec(task: Task, spec: TaskSpec) -> None:
    task.spec_json = spec.model_dump_json()


def _task_response(task: Task) -> TaskResponse:
    return TaskResponse(
        id=task.id,
        status=TaskStatus(task.status),
        employer_id=task.employer_id,
        worker_id=task.worker_id,
        raw_input=task.raw_input,
        spec=_load_spec(task),
        clarifications=json.loads(task.clarifications_json or "{}"),
        escrow_cents=task.escrow_cents,
        push_sent_to=json.loads(task.push_sent_json or "[]"),
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


# --- 雇主：发布（①②）---

@app.post("/tasks", response_model=dict)
def create_task(body: CreateTaskRequest, db: Session = Depends(get_db)):
    """雇主一句话发布 → AI 解析；若缺信息进入 clarifying。"""
    employer = db.get(User, body.employer_id)
    if not employer or employer.role != "employer":
        raise HTTPException(404, "雇主不存在")

    spec = ai_service.parse_employer_input(body.raw_input)
    task = Task(
        id=str(uuid.uuid4()),
        status="clarifying" if not spec.executable_ready else "awaiting_payment",
        employer_id=body.employer_id,
        raw_input=body.raw_input,
        spec_json=spec.model_dump_json(),
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    resp = _task_response(task)
    out = resp.model_dump()
    if not spec.executable_ready:
        out["clarify_questions"] = clarify_questions(spec.missing_fields)
    return out


@app.post("/tasks/{task_id}/clarify", response_model=dict)
def clarify_task(task_id: str, body: ClarifyRequest, db: Session = Depends(get_db)):
    """② 雇主回答 AI 追问（非聊天）。"""
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "任务不存在")
    if task.status not in ("clarifying", "parsing"):
        raise HTTPException(400, f"当前状态不可澄清: {task.status}")

    clar = json.loads(task.clarifications_json or "{}")
    clar.update(body.answers)
    task.clarifications_json = json.dumps(clar, ensure_ascii=False)

    spec = _load_spec(task)
    spec = ai_service.apply_clarifications(spec, clar)
    _save_spec(task, spec)

    if spec.executable_ready:
        task.status = "awaiting_payment"
    else:
        task.status = "clarifying"
    task.updated_at = utcnow()
    db.commit()

    resp = _task_response(task)
    out = resp.model_dump()
    if not spec.executable_ready:
        out["clarify_questions"] = clarify_questions(spec.missing_fields)
    return out


@app.post("/tasks/{task_id}/confirm-payment", response_model=TaskResponse)
def confirm_payment(
    task_id: str,
    body: ConfirmPaymentRequest,
    db: Session = Depends(get_db),
):
    """③ 雇主确认并托管 → 进入待派发池 → 自动派单。"""
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "任务不存在")
    if task.status != "awaiting_payment":
        raise HTTPException(400, f"当前状态不可付款: {task.status}")

    spec = _load_spec(task)
    if not spec.executable_ready:
        raise HTTPException(400, "任务尚未达到可执行标准，请继续澄清")

    employer = db.get(User, task.employer_id)
    amount = body.amount_cents or spec.suggested_price_cents
    escrow_service.mock_escrow_hold(db, task, employer, amount)

    pushed = dispatch_service.dispatch_task(db, task)
    return _task_response(task)


@app.get("/tasks/{task_id}", response_model=TaskResponse)
def get_task(task_id: str, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "任务不存在")
    return _task_response(task)


# --- 雇员：听单（④⑤）---

@app.post("/workers/{worker_id}/online")
def worker_go_online(
    worker_id: str,
    body: WorkerGoOnlineRequest,
    db: Session = Depends(get_db),
):
    worker = db.get(User, worker_id)
    if not worker or worker.role != "worker":
        raise HTTPException(404, "雇员不存在")
    worker.is_online = True
    worker.lat = body.lat
    worker.lng = body.lng
    if body.skills:
        worker.skills = body.skills
    db.commit()
    return {"worker_id": worker_id, "is_online": True, "skills": worker.skills}


@app.post("/workers/{worker_id}/offline")
def worker_go_offline(worker_id: str, db: Session = Depends(get_db)):
    worker = db.get(User, worker_id)
    if not worker:
        raise HTTPException(404, "雇员不存在")
    worker.is_online = False
    db.commit()
    return {"worker_id": worker_id, "is_online": False}


@app.get("/workers/{worker_id}/inbox", response_model=list[WorkerInboxItem])
def worker_inbox(worker_id: str, db: Session = Depends(get_db)):
    """模拟 App Push 收件箱 — 无任务大厅浏览。"""
    rows = (
        db.query(WorkerInbox)
        .filter(WorkerInbox.worker_id == worker_id, WorkerInbox.accepted.is_(False))
        .order_by(WorkerInbox.pushed_at.desc())
        .all()
    )
    items: list[WorkerInboxItem] = []
    for row in rows:
        task = db.get(Task, row.task_id)
        if not task or task.status in ("completed", "cancelled"):
            continue
        spec = _load_spec(task)
        items.append(
            WorkerInboxItem(
                task_id=task.id,
                title=spec.title,
                summary=spec.summary[:120],
                suggested_price_cents=spec.suggested_price_cents,
                pushed_at=row.pushed_at,
            )
        )
    return items


@app.get("/workers/{worker_id}/tasks/{task_id}/card")
def worker_task_card(worker_id: str, task_id: str, db: Session = Depends(get_db)):
    """标准化任务卡片（接单前查看）。"""
    inbox = (
        db.query(WorkerInbox)
        .filter(WorkerInbox.worker_id == worker_id, WorkerInbox.task_id == task_id)
        .first()
    )
    if not inbox:
        raise HTTPException(404, "未收到该任务推送")
    task = db.get(Task, task_id)
    spec = _load_spec(task)
    return {
        "task_id": task_id,
        "status": task.status,
        "card": spec.model_dump(),
        "note": "按卡片执行，无需联系雇主",
    }


@app.post("/workers/{worker_id}/tasks/{task_id}/accept", response_model=TaskResponse)
def accept_task(worker_id: str, task_id: str, db: Session = Depends(get_db)):
    """⑤ 抢单：先接先得。"""
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "任务不存在")
    if task.worker_id and task.worker_id != worker_id:
        raise HTTPException(409, "已被他人接单")
    if task.status not in ("dispatching", "escrowed"):
        raise HTTPException(400, f"不可接单: {task.status}")

    inbox = (
        db.query(WorkerInbox)
        .filter(WorkerInbox.worker_id == worker_id, WorkerInbox.task_id == task_id)
        .first()
    )
    if not inbox:
        raise HTTPException(403, "你未收到此任务推送")

    task.worker_id = worker_id
    task.status = "in_progress"
    inbox.accepted = True
    task.updated_at = utcnow()
    db.commit()
    return _task_response(task)


@app.post("/workers/{worker_id}/tasks/{task_id}/submit", response_model=dict)
def submit_delivery(
    worker_id: str,
    task_id: str,
    body: SubmitDeliveryRequest,
    db: Session = Depends(get_db),
):
    """⑤⑥ 提交交付 → 验货 → 自动结算。"""
    task = db.get(Task, task_id)
    if not task or task.worker_id != worker_id:
        raise HTTPException(404, "任务不存在或未指派给你")
    if task.status != "in_progress":
        raise HTTPException(400, f"当前状态不可提交: {task.status}")

    delivery = {"photos": body.photos, "notes": body.notes}
    task.delivery_json = json.dumps(delivery, ensure_ascii=False)
    task.status = "submitted"
    task.updated_at = utcnow()
    db.commit()

    spec = _load_spec(task)
    ok, reason, confidence = ai_service.verify_delivery(spec, delivery)
    if not ok:
        task.status = "in_progress"
        db.commit()
        raise HTTPException(400, detail={"verified": False, "reason": reason, "confidence": confidence})

    worker = db.get(User, worker_id)
    payout = escrow_service.release_to_worker(db, task, worker)
    task.status = "completed"
    task.updated_at = utcnow()
    db.commit()

    return {
        "verified": True,
        "reason": reason,
        "confidence": confidence,
        "payout_cents": payout,
        "task": _task_response(task),
    }


@app.get("/workers/{worker_id}/wallet", response_model=WalletResponse)
def worker_wallet(worker_id: str, db: Session = Depends(get_db)):
    worker = db.get(User, worker_id)
    if not worker:
        raise HTTPException(404, "雇员不存在")
    return WalletResponse(worker_id=worker_id, balance_cents=worker.wallet_balance_cents)


# Seed endpoint removed.
