"""端到端演示六步闭环。先启动 API: uvicorn app.main:app --reload"""

import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8000"


def req(method: str, path: str, data: dict | None = None) -> dict:
    url = f"{BASE}{path}"
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={"Content-Type": "application/json"} if body else {},
    )
    try:
        with urllib.request.urlopen(r) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read().decode())
        raise


def main():
    print("=== AutoDo 六步闭环演示 ===\n")

    print("0. 初始化演示用户")
    seed = req("POST", "/dev/seed")
    employer_id = seed["employer_id"]
    worker_id = seed["worker_id"]

    print("   雇员上线听单")
    req("POST", f"/workers/{worker_id}/online", {"lat": 39.9225, "lng": 116.4440})

    print("\n①② 雇主一句话发布（缺门禁 → 澄清）")
    raw = "明天早上8点帮我到朝阳区XX小区喂一下猫，猫粮在桌子上"
    task = req(
        "POST",
        "/tasks",
        {"employer_id": employer_id, "raw_input": raw},
    )
    print("   状态:", task["status"])
    if task.get("clarify_questions"):
        print("   AI 追问:", task["clarify_questions"])

    print("\n② 雇主补充澄清")
    task = req(
        "POST",
        f"/tasks/{task['id']}/clarify",
        {
            "answers": {
                "access_code": "门禁密码 8866",
                "building_detail": "3号楼2单元501",
            }
        },
    )
    print("   状态:", task["status"], "| 可执行:", task["spec"]["executable_ready"])

    print("\n③ 雇主确认付款（mock 托管）→ ④ 自动派单")
    task = req("POST", f"/tasks/{task['id']}/confirm-payment", {})
    print("   状态:", task["status"], "| 已推送:", task["push_sent_to"])

    print("\n④⑤ 雇员 inbox（模拟 Push）")
    inbox = req("GET", f"/workers/{worker_id}/inbox")
    print("   收到", len(inbox), "条推送:", inbox[0]["title"] if inbox else "无")

    card = req("GET", f"/workers/{worker_id}/tasks/{task['id']}/card")
    print("   任务卡片步骤:", card["card"]["steps"])

    print("\n⑤ 雇员接单并执行提交")
    task = req("POST", f"/workers/{worker_id}/tasks/{task['id']}/accept")
    print("   状态:", task["status"])

    result = req(
        "POST",
        f"/workers/{worker_id}/tasks/{task['id']}/submit",
        {"photos": ["https://example.com/cat-bowl.jpg"], "notes": "已完成喂猫"},
    )
    print("\n⑥ 验货与结算")
    print("   通过:", result["verified"], "| 放款(分):", result["payout_cents"])

    wallet = req("GET", f"/workers/{worker_id}/wallet")
    print("   雇员钱包余额(分):", wallet["balance_cents"])
    print("\n=== 演示完成：零聊天、零逛大厅 ===")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.URLError:
        print("请先启动服务: cd backend && uvicorn app.main:app --reload", file=sys.stderr)
        sys.exit(1)
