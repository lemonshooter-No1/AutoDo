import {
  api,
  formatPrice,
  formatTime,
  STATUS_LABEL,
  statusClass,
  toast,
} from "./common.js";

let workerId = "";
let activeTaskId = null;
let inboxPoll = null;

const $ = (id) => document.getElementById(id);

function renderWorkerCard(el, spec) {
  el.innerHTML = `
    <div class="spec-title">${spec.title}</div>
    <div class="spec-price">${formatPrice(spec.suggested_price_cents)}</div>
    <p class="meta">${spec.summary || ""}</p>
    <ul>${(spec.steps || []).map((s) => `<li>${s}</li>`).join("")}</ul>
  `;
}

async function loadPushes() {
  const data = await api("GET", `/workers/${workerId}/pushes`);
  const list = $("push-list");
  const empty = $("push-empty");
  list.innerHTML = "";

  if (!data.items.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  for (const p of data.items) {
    const row = document.createElement("div");
    row.className = "task-row";
    let tag = "待接单";
    let tagClass = "active";
    if (p.accepted) {
      tag = "已接单";
      tagClass = "done";
    } else if (p.missed) {
      tag = "已被抢走";
      tagClass = "pending";
    }
    row.innerHTML = `
      <div class="task-row-top">
        <span class="status-chip ${tagClass}">${tag}</span>
        <span class="task-row-meta">${formatTime(p.pushed_at)}</span>
      </div>
      <h3>${p.title}</h3>
      <p class="task-row-desc">${p.summary}</p>
      <p class="task-row-meta">${formatPrice(p.price_cents)}</p>
      ${p.can_accept ? '<button type="button" class="btn primary sm">接单</button>' : ""}
    `;
    const btn = row.querySelector("button");
    if (btn) btn.addEventListener("click", () => acceptTask(p.task_id));
    list.appendChild(row);
  }
}

async function loadAssignments() {
  const data = await api("GET", `/workers/${workerId}/assignments`);
  const list = $("assignment-list");
  const empty = $("assignment-empty");
  list.innerHTML = "";

  const active = data.items.find((t) => t.status === "in_progress");
  if (active) {
    activeTaskId = active.id;
    const cardRes = await fetch(`/workers/${workerId}/tasks/${active.id}/card`);
    const card = await cardRes.json();
    if (cardRes.ok) {
      renderWorkerCard($("worker-card"), card.card);
      $("worker-active").classList.remove("hidden");
    }
  } else {
    $("worker-active").classList.add("hidden");
    activeTaskId = null;
  }

  if (!data.items.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  for (const t of data.items) {
    const row = document.createElement("div");
    row.className = "task-row compact";
    row.innerHTML = `
      <div class="task-row-top">
        <h3>${t.title}</h3>
        <span class="status-chip ${statusClass(t.status)}">${STATUS_LABEL[t.status]}</span>
      </div>
      <p class="task-row-meta">${formatPrice(t.price_cents)} · ${formatTime(t.updated_at)}</p>
    `;
    list.appendChild(row);
  }
}

async function refreshWallet() {
  const res = await fetch(`/workers/${workerId}/wallet`);
  const w = await res.json();
  if (res.ok) $("worker-wallet").textContent = w.balance_cents ? `余额 ${formatPrice(w.balance_cents)}` : "";
}

async function acceptTask(taskId) {
  try {
    const res = await fetch(`/workers/${workerId}/tasks/${taskId}/accept`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    toast("接单成功");
    await loadPushes();
    await loadAssignments();
  } catch (e) {
    toast(e.message);
  }
}

$("btn-online").addEventListener("click", async () => {
  try {
    const res = await fetch(`/workers/${workerId}/online`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: 39.9225, lng: 116.444 }),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    $("btn-online").classList.add("hidden");
    $("btn-offline").classList.remove("hidden");
    toast("听单已开启");
    await loadPushes();
    if (!inboxPoll) inboxPoll = setInterval(refreshAll, 5000);
  } catch (e) {
    toast(e.message);
  }
});

$("btn-offline").addEventListener("click", () => {
  $("btn-online").classList.remove("hidden");
  $("btn-offline").classList.add("hidden");
  if (inboxPoll) clearInterval(inboxPoll);
  inboxPoll = null;
});

$("btn-submit").addEventListener("click", async () => {
  if (!activeTaskId) return;
  const photo = $("delivery-photo").value.trim() || "proof.jpg";
  try {
    const res = await fetch(`/workers/${workerId}/tasks/${activeTaskId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photos: [photo] }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.reason || data.error);
    toast(`已完成，到账 ${formatPrice(data.payout_cents)}`);
    $("worker-active").classList.add("hidden");
    activeTaskId = null;
    await refreshWallet();
    await refreshAll();
  } catch (e) {
    toast(e.message);
  }
});

$("btn-refresh-pushes").addEventListener("click", () => refreshAll().catch((e) => toast(e.message)));

async function refreshAll() {
  await loadPushes();
  await loadAssignments();
  await refreshWallet();
}

const deliveryPhotoInput = $("delivery-photo");
if (deliveryPhotoInput) {
  deliveryPhotoInput.setAttribute("autocomplete", "off");
}

async function init() {
  await refreshAll();
}

init();
