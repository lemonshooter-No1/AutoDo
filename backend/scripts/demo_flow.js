const PORT = process.env.PORT || "8000";
const BASE = process.env.API_BASE || `http://127.0.0.1:${PORT}`;

async function req(method, path, data) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    console.error("HTTP", res.status, json);
    throw new Error(json.error || res.statusText);
  }
  return json;
}

async function main() {
  console.log("=== AutoDo 六步闭环演示 ===\n");

  const seed = await req("POST", "/dev/seed");
  await req("POST", `/workers/${seed.worker_id}/online`, {
    lat: 39.9225,
    lng: 116.444,
  });

  console.log("①② 雇主发布（缺门禁 → 澄清）");
  let task = await req("POST", "/tasks", {
    employer_id: seed.employer_id,
    raw_input: "明天早上8点帮我到朝阳区XX小区喂一下猫，猫粮在桌子上",
  });
  console.log("   状态:", task.status, task.clarify_questions || "");

  console.log("\n② 雇主补充澄清");
  task = await req("POST", `/tasks/${task.id}/clarify`, {
    answers: {
      access_code: "门禁密码 8866",
      building_detail: "3号楼2单元501",
    },
  });
  console.log("   状态:", task.status, "| 可执行:", task.spec.executable_ready);

  console.log("\n③④ 确认付款 → 派单推送");
  task = await req("POST", `/tasks/${task.id}/confirm-payment`, {});
  console.log("   推送雇员:", task.push_sent_to);

  const inbox = await req("GET", `/workers/${seed.worker_id}/inbox`);
  console.log("\n⑤ inbox:", inbox[0]?.title);

  const card = await req("GET", `/workers/${seed.worker_id}/tasks/${task.id}/card`);
  console.log("   卡片步骤:", card.card.steps);

  await req("POST", `/workers/${seed.worker_id}/tasks/${task.id}/accept`);
  const result = await req("POST", `/workers/${seed.worker_id}/tasks/${task.id}/submit`, {
    photos: ["cat-bowl.jpg"],
  });

  console.log("\n⑥ 验货放款:", result.payout_cents, "分");
  const wallet = await req("GET", `/workers/${seed.worker_id}/wallet`);
  console.log("   钱包余额:", wallet.balance_cents, "分");
  console.log("\n=== 完成：无聊天、无任务大厅 ===");
}

main().catch((e) => {
  console.error(e.message || e);
  console.error("\n请先运行: cd backend && npm install && npm start");
  process.exit(1);
});
