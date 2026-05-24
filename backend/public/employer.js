import {
  api,
  formatPrice,
  formatTime,
  STATUS_LABEL,
  TYPE_LABEL,
  statusClass,
  toast,
} from "./common.js";

let employerId = "demo-employer";
let currentTaskId = null;
let allTasks = [];
let filter = "all";

const $ = (id) => document.getElementById(id);

function renderSpecCard(el, spec) {
  el.innerHTML = `
    <div class="spec-title">${spec.title}</div>
    <div class="spec-price">${formatPrice(spec.suggested_price_cents)}</div>
    <p class="meta">${spec.summary || ""}</p>
  `;
}

function showStep(step) {
  $("employer-clarify").classList.toggle("hidden", step !== "clarify");
  $("employer-spec").classList.toggle("hidden", step !== "spec");
}

function renderClarifyForm(questions) {
  const form = $("clarify-form");
  form.innerHTML = "";
  for (const q of questions || []) {
    const div = document.createElement("div");
    div.className = "clarify-field";
    div.innerHTML = `<label>${q.label}</label><input name="${q.field}" required />`;
    form.appendChild(div);
  }
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

  const el = $("modal-body");
  el.innerHTML = `
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
    ${task.worker_id ? `<p style="margin-top:0.8rem;font-size:0.85rem"><strong>接单人：</strong>${task.worker_id}</p>` : ""}
    ${task.push_sent_to?.length ? `<p style="font-size:0.85rem;color:var(--dim)">已推送给 ${task.push_sent_to.length} 名雇员</p>` : ""}
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

function renderTaskList() {
  const list = $("employer-tasks");
  const empty = $("employer-empty");
  list.innerHTML = "";

  const filtered = allTasks.filter((t) => {
    if (filter === "done") return t.completed;
    if (filter === "active") return !t.completed && t.status !== "clarifying" && t.status !== "awaiting_payment";
    return true;
  });

  if (!filtered.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  for (const t of filtered) {
    const row = document.createElement("div");
    row.className = "task-row";
    row.style.cursor = "pointer";
    const doneMark = t.completed ? '<span class="done-check">✓ 已完成</span>' : "";
    row.innerHTML = `
      <div class="task-row-top">
        <span class="pill">${TYPE_LABEL[t.task_type] || "任务"}</span>
        <span class="status-chip ${statusClass(t.status)}">${STATUS_LABEL[t.status] || t.status}</span>
      </div>
      <h3>${t.title}</h3>
      <p class="task-row-meta">${formatPrice(t.price_cents)} · ${formatTime(t.updated_at)}</p>
      <p class="task-row-desc">${t.summary}</p>
      ${t.worker_id ? `<p class="task-row-desc">接单人：${t.worker_id}</p>` : "<p class=\"task-row-desc\">等待雇员接单</p>"}
      ${t.push_count ? `<p class="task-row-desc">已推送给 ${t.push_count} 人</p>` : ""}
      ${doneMark}
    `;
    row.addEventListener("click", () => openTaskDetail(t.id));
    list.appendChild(row);
  }
}

async function loadMyTasks() {
  const data = await api("GET", `/employers/${employerId}/tasks`);
  allTasks = data.items;
  renderTaskList();
}

$("btn-publish").addEventListener("click", async () => {
  const raw = $("employer-input").value.trim();
  if (!raw) return toast("请输入任务描述");
  try {
    const res = await fetch("/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employer_id: employerId, raw_input: raw }),
    });
    const task = await res.json();
    if (!res.ok) throw new Error(task.error);
    currentTaskId = task.id;
    if (task.clarify_questions?.length) {
      renderClarifyForm(task.clarify_questions);
      showStep("clarify");
    } else {
      renderSpecCard($("spec-preview"), task.spec);
      showStep("spec");
    }
    toast("已创建任务");
  } catch (e) {
    toast(e.message);
  }
});

$("btn-clarify").addEventListener("click", async () => {
  const answers = {};
  $("clarify-form").querySelectorAll("input").forEach((i) => {
    answers[i.name] = i.value.trim();
  });
  try {
    const res = await fetch(`/tasks/${currentTaskId}/clarify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers }),
    });
    const task = await res.json();
    if (!res.ok) throw new Error(task.error);
    if (task.clarify_questions?.length) {
      renderClarifyForm(task.clarify_questions);
    } else {
      renderSpecCard($("spec-preview"), task.spec);
      showStep("spec");
    }
  } catch (e) {
    toast(e.message);
  }
});

$("btn-pay").addEventListener("click", async () => {
  try {
    const res = await fetch(`/tasks/${currentTaskId}/confirm-payment`, { method: "POST" });
    const task = await res.json();
    if (!res.ok) throw new Error(task.error);
    $("employer-input").value = "";
    showStep(null);
    $("employer-spec").classList.add("hidden");
    toast("已付款并派单");
    await loadMyTasks();
  } catch (e) {
    toast(e.message);
  }
});

document.querySelectorAll(".filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    filter = btn.dataset.filter;
    renderTaskList();
  });
});

$("btn-refresh-list").addEventListener("click", () => loadMyTasks().catch((e) => toast(e.message)));

$("modal-close")?.addEventListener("click", () => $("task-detail-modal").close());
$("task-detail-modal")?.addEventListener("click", (e) => {
  if (e.target === $("task-detail-modal")) $("task-detail-modal").close();
});

async function init() {
  await loadMyTasks();
  setInterval(() => loadMyTasks().catch(() => {}), 8000);
}

init();
