from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class TaskStatus(str, Enum):
    PARSING = "parsing"
    CLARIFYING = "clarifying"
    AWAITING_PAYMENT = "awaiting_payment"
    ESCROWED = "escrowed"
    DISPATCHING = "dispatching"
    ASSIGNED = "assigned"
    IN_PROGRESS = "in_progress"
    SUBMITTED = "submitted"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class LocationSpec(BaseModel):
    address: str = ""
    lat: float | None = None
    lng: float | None = None
    access_notes: str = ""


class TimeWindow(BaseModel):
    start: str = ""
    end: str = ""


class DeliverableSpec(BaseModel):
    type: str = "photo"
    description: str = ""


class TaskSpec(BaseModel):
    task_type: str = "general"
    title: str = ""
    summary: str = ""
    time_window: TimeWindow = Field(default_factory=TimeWindow)
    location: LocationSpec = Field(default_factory=LocationSpec)
    skills: list[str] = Field(default_factory=list)
    estimated_minutes: int = 30
    suggested_price_cents: int = 5000
    steps: list[str] = Field(default_factory=list)
    deliverables: list[DeliverableSpec] = Field(default_factory=list)
    executable_ready: bool = False
    missing_fields: list[str] = Field(default_factory=list)
    is_online: bool = False


class CreateTaskRequest(BaseModel):
    employer_id: str
    raw_input: str


class ClarifyRequest(BaseModel):
    answers: dict[str, str]


class ConfirmPaymentRequest(BaseModel):
    amount_cents: int | None = None


class WorkerGoOnlineRequest(BaseModel):
    lat: float
    lng: float
    skills: list[str] | None = None


class SubmitDeliveryRequest(BaseModel):
    photos: list[str] = Field(default_factory=list)
    notes: str = ""


class TaskResponse(BaseModel):
    id: str
    status: TaskStatus
    employer_id: str
    worker_id: str | None = None
    raw_input: str
    spec: TaskSpec
    clarifications: dict[str, str] = Field(default_factory=dict)
    escrow_cents: int = 0
    push_sent_to: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class WorkerInboxItem(BaseModel):
    task_id: str
    title: str
    summary: str
    suggested_price_cents: int
    distance_km: float | None = None
    pushed_at: datetime


class WalletResponse(BaseModel):
    worker_id: str
    balance_cents: int
