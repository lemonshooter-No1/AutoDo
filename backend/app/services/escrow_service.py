"""③ 托管（MVP mock）：预扣至平台，完成后转雇员钱包。"""

from sqlalchemy.orm import Session

from app.models import Task, User, utcnow


def mock_escrow_hold(db: Session, task: Task, employer: User, amount_cents: int) -> None:
    if employer.wallet_balance_cents < amount_cents:
        # MVP：允许雇主无余额，仅记 escrow 账目
        pass
    else:
        employer.wallet_balance_cents -= amount_cents
    task.escrow_cents = amount_cents
    task.status = "escrowed"
    task.updated_at = utcnow()
    db.commit()


def release_to_worker(db: Session, task: Task, worker: User, platform_fee_rate: float = 0.15) -> int:
    fee = int(task.escrow_cents * platform_fee_rate)
    payout = task.escrow_cents - fee
    worker.wallet_balance_cents += payout
    task.updated_at = utcnow()
    db.commit()
    return payout
