import json
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def utcnow():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    role: Mapped[str] = mapped_column(String(16))  # employer | worker
    name: Mapped[str] = mapped_column(String(128), default="")
    wallet_balance_cents: Mapped[int] = mapped_column(Integer, default=0)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    skills_json: Mapped[str] = mapped_column(Text, default="[]")
    is_online: Mapped[bool] = mapped_column(Boolean, default=False)

    @property
    def skills(self) -> list[str]:
        return json.loads(self.skills_json or "[]")

    @skills.setter
    def skills(self, value: list[str]):
        self.skills_json = json.dumps(value, ensure_ascii=False)


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    status: Mapped[str] = mapped_column(String(32), default="parsing")
    employer_id: Mapped[str] = mapped_column(String(64))
    worker_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    raw_input: Mapped[str] = mapped_column(Text, default="")
    spec_json: Mapped[str] = mapped_column(Text, default="{}")
    clarifications_json: Mapped[str] = mapped_column(Text, default="{}")
    escrow_cents: Mapped[int] = mapped_column(Integer, default=0)
    push_sent_json: Mapped[str] = mapped_column(Text, default="[]")
    delivery_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class WorkerInbox(Base):
    """模拟 Push：雇员收件箱"""

    __tablename__ = "worker_inbox"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    worker_id: Mapped[str] = mapped_column(String(64), index=True)
    task_id: Mapped[str] = mapped_column(String(64), index=True)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    accepted: Mapped[bool] = mapped_column(Boolean, default=False)
    pushed_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
