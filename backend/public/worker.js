import {
  api,
  formatPrice,
  formatTime,
  STATUS_LABEL,
  TYPE_LABEL,
  statusClass,
  toast,
} from "./common.js";

let workerId = "demo-worker";
let activeTaskId = null;
let inboxPoll = null;
let seenPushIds = new Set();
let hasShownInitial = false;
let isOnline = false;

const $ = (id) => document.getElementById(id);

function renderWorkerCard(el, spec) {
  el.innerHTML = `
    <div class="spec-title">${spec.title}</div>
    <div class="spec-price">${formatPrice(spec.suggested_price_cents)}</div>
    <p class="meta">${spec.summary || ""}</p>
    <ul>${(spec.steps || []).map((s) => `<li>${s}</li>`).join("")}</ul>
  `;
}

const DETAIL_STATUS_LABELS = {
  clarifying: "待补充",
  awaiting_payment: "待付款",
  escrowed: "已托管",
  dispatching: "招募中",
  in_progress: "进行中",
  submitted: "验收中",
  completed: "已完成",
};

function renderTaskDetail(task) {
  const spec = task.spec || {};
  const loc = spec.location || {};
  const steps = (spec.steps || []).map((s) => `<li>${s}</li>`).join("");
  const typeLabel = TYPE_LABEL[spec.task_type] || spec.task_type;
  const price = task.escrow_cents || spec.suggested_price_cents || 0;
  const statusLabel = DETAIL_STATUS_LABELS[task.status] || task.status;

  $("modal-body").innerHTML = `
    <span class="pill">${typeLabel}</span>
    <span style="margin-left:8px;font-size:0.78rem;color:var(--muted)">${statusLabel}</span>
    <h2 style="margin:0.4rem 0 0.2rem">${spec.title || "任务"}</h2>
    <p class="bounty-price-lg" style="margin:0 0 0.6rem">${formatPrice(price)}</p>
    <p style="color:var(--muted);margin:0 0 0.6rem;line-height:1.6">${spec.summary || task.raw_input || ""}</p>
    <div class="location-summary">
      <div class="location-summary-label">地点</div>
      <div class="location-summary-value">${loc.address || "—"}</div>
    </div>
    ${spec.time_window?.start ? `<p style="font-size:0.85rem;color:var(--dim);margin:0.5rem 0">⏱ ${spec.time_window.start}${spec.time_window.end && spec.time_window.end !== spec.time_window.start ? ' ~ ' + spec.time_window.end : ''}</p>` : ""}
    ${spec.location?.access_notes ? `<p style="font-size:0.85rem;color:var(--dim)">🔑 ${spec.location.access_notes}</p>` : ""}
    ${steps ? `<ul style="margin:0.6rem 0 0;padding-left:1.2rem;font-size:0.85rem;color:var(--muted)">${steps}</ul>` : ""}
  `;
  $("task-detail-modal").showModal();
}

async function openTaskDetail(taskId) {
  try {
    const task = await api("GET", `/tasks/${taskId}`);
    renderTaskDetail(task);
  } catch (e) {
    toast(e.message);
  }
}

function showPushNotification(taskId, title, summary, price, typeLabel) {
  const existing = document.querySelector(".push-notify");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.className = "push-overlay";
  overlay.innerHTML = `
    <div class="push-card">
      <div class="push-badge">📬 新任务推送</div>
      <h2>${title}</h2>
      <p class="push-summary">${summary?.slice(0, 80) || ""}</p>
      <p class="push-meta">${typeLabel || ""} · ${formatPrice(price)}</p>
      <div class="push-actions">
        <button class="btn primary" id="push-accept">查看详情</button>
        <button class="btn text" id="push-dismiss">稍后</button>
      </div>
    </div>
  `;
  overlay.querySelector("#push-accept").addEventListener("click", () => {
    overlay.remove();
    openTaskDetail(taskId);
  });
  overlay.querySelector("#push-dismiss").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.frequency.value = 800;
  osc.type = "sine";
  gain.gain.value = 0.05;
  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
  osc.stop(audioCtx.currentTime + 0.15);

  setTimeout(() => { if (document.body.contains(overlay)) overlay.remove(); }, 12000);
}

async function loadPushes() {
  const data = await api("GET", `/workers/${workerId}/pushes`);
  const list = $("push-list");
  const empty = $("push-empty");
  list.innerHTML = "";

  const currentIds = new Set(data.items.map((p) => p.task_id));

  if (!data.items.length) {
    empty.classList.remove("hidden");
    seenPushIds = currentIds;
    return;
  }
  empty.classList.add("hidden");

  if (isOnline && !hasShownInitial) {
    hasShownInitial = true;
    for (const p of data.items) {
      showPushNotification(p.task_id, p.title, p.summary, p.price_cents, TYPE_LABEL[p.task_type] || "");
      await new Promise((r) => setTimeout(r, 800));
    }
  } else if (isOnline) {
    for (const p of data.items) {
      if (!seenPushIds.has(p.task_id)) {
        showPushNotification(p.task_id, p.title, p.summary, p.price_cents, "");
      }
    }
  }

  seenPushIds = currentIds;

  for (const p of data.items) {
    const row = document.createElement("div");
    row.className = "task-row";
    row.style.cursor = "pointer";
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
      ${p.can_accept ? '<button type="button" class="btn primary sm" style="pointer-events:auto">接单</button>' : ""}
    `;
    row.addEventListener("click", () => openTaskDetail(p.task_id));
    const btn = row.querySelector("button");
    if (btn) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        acceptTask(p.task_id);
      });
    }
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
    row.style.cursor = "pointer";
    row.innerHTML = `
      <div class="task-row-top">
        <h3>${t.title}</h3>
        <span class="status-chip ${statusClass(t.status)}">${STATUS_LABEL[t.status]}</span>
      </div>
      <p class="task-row-meta">${formatPrice(t.price_cents)} · ${formatTime(t.updated_at)}</p>
    `;
    row.addEventListener("click", () => openTaskDetail(t.id));
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
    isOnline = true;
    hasShownInitial = false;
    seenPushIds = new Set();
    toast("听单已开启 · 正在推送任务...");
    await loadPushes();
    if (!inboxPoll) inboxPoll = setInterval(refreshAll, 5000);
  } catch (e) {
    toast(e.message);
  }
});

$("btn-offline").addEventListener("click", () => {
  $("btn-online").classList.remove("hidden");
  $("btn-offline").classList.add("hidden");
  isOnline = false;
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

$("modal-close")?.addEventListener("click", () => $("task-detail-modal").close());
$("task-detail-modal")?.addEventListener("click", (e) => {
  if (e.target === $("task-detail-modal")) $("task-detail-modal").close();
});

async function refreshAll() {
  await loadPushes();
  await loadAssignments();
  await refreshWallet();
}

async function init() {
  await refreshAll();
}

init();
