const API = "";

let employerId = "demo-employer";
let workerId = "demo-worker";
let currentTaskId = null;
let activeWorkerTaskId = null;
let inboxPoll = null;

const TASK_TYPE_LABELS = {
  pet_feeding: "宠物照料",
  errand: "同城取送",
  queue: "现场代办",
  digital: "数字任务",
  general: "通用任务",
};

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.reason || res.statusText);
  return data;
}

function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function $(id) {
  return document.getElementById(id);
}

function switchTab(tab) {
  document.querySelectorAll(".tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  document.querySelectorAll(".panel").forEach((p) => {
    p.classList.toggle("active", p.id === `panel-${tab}`);
  });
  if (tab === "worker") refreshInbox();
}

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

document.querySelectorAll("[data-role]").forEach((el) => {
  el.addEventListener("click", (e) => {
    e.preventDefault();
    switchTab(el.dataset.role);
    $("console").scrollIntoView({ behavior: "smooth" });
  });
});

$("hero-post")?.addEventListener("click", () => {
  switchTab("employer");
  $("console").scrollIntoView({ behavior: "smooth" });
  $("employer-input")?.focus();
});

$("hero-earn")?.addEventListener("click", () => {
  switchTab("worker");
  $("console").scrollIntoView({ behavior: "smooth" });
});

function duplicateMarquee() {
  const m = $("marquee");
  if (!m || m.dataset.duplicated) return;
  m.innerHTML += m.innerHTML;
  m.dataset.duplicated = "1";
}

function animateStats() {
  document.querySelectorAll("[data-count]").forEach((el) => {
    const target = Number(el.dataset.count);
    let n = 0;
    const step = Math.ceil(target / 40);
    const t = setInterval(() => {
      n += step;
      if (n >= target) {
        n = target;
        clearInterval(t);
      }
      el.textContent = n.toLocaleString();
    }, 30);
  });
}

function renderTaskSpecCard(container, spec) {
  const label = TASK_TYPE_LABELS[spec.task_type] || spec.task_type;
  const price = (spec.suggested_price_cents / 100).toFixed(2);
  const steps = (spec.steps || [])
    .map((s) => `<li>${s}</li>`)
    .join("");
  container.innerHTML = `
    <span class="pill">${label}</span>
    <div class="spec-title">${spec.title || "任务"}</div>
    <div class="spec-price">¥${price} <span style="font-weight:400;color:var(--muted);font-size:0.85rem">建议薪酬</span></div>
    <p style="margin:0 0 0.5rem;color:var(--muted);font-size:0.85rem">${spec.summary || ""}</p>
    <p style="margin:0;font-size:0.8rem;color:var(--dim)">📍 ${spec.location?.address || "—"} · ⏱ ${spec.time_window?.start || "待定"}</p>
    ${steps ? `<ul>${steps}</ul>` : ""}
  `;
}

async function init() {
  duplicateMarquee();
  animateStats();
  // Seeding removed; wallet refresh will run when workerId is set.
  if (workerId) refreshWallet();
}

function showEmployerStep(step) {
  $("card-publish").classList.toggle("hidden", step !== "publish");
  $("employer-clarify").classList.toggle("hidden", step !== "clarify");
  $("employer-spec").classList.toggle("hidden", step !== "spec");
  $("employer-status").classList.toggle("hidden", step !== "status");
}

function renderSpec(task) {
  renderTaskSpecCard($("spec-preview"), task.spec);
}

function renderClarifyForm(questions) {
  const form = $("clarify-form");
  form.innerHTML = "";
  for (const q of questions || []) {
    const div = document.createElement("div");
    div.className = "clarify-field";
    div.innerHTML = `<label>${q.label}</label><input type="text" name="${q.field}" required placeholder="请填写…" />`;
    form.appendChild(div);
  }
}

function renderEmployerStatus(task) {
  const labels = {
    clarifying: "待澄清",
    awaiting_payment: "待付款",
    escrowed: "已托管",
    dispatching: "派单中",
    in_progress: "执行中",
    submitted: "待验货",
    completed: "已完成",
  };
  $("status-badge").textContent = labels[task.status] || task.status;
  $("status-badge").className = "badge " + (task.status === "completed" ? "ok" : "wait");
  const price = (task.escrow_cents || task.spec?.suggested_price_cents || 0) / 100;
  $("status-detail").innerHTML = [
    `<strong>订单</strong> ${task.id.slice(0, 8)}…`,
    task.push_sent_to?.length
      ? `<strong>已推送</strong> ${task.push_sent_to.length} 名雇员`
      : "",
    task.worker_id
      ? `<strong>接单人</strong> ${task.worker_id}`
      : "<strong>状态</strong> 等待雇员接单",
    price ? `<strong>托管</strong> ¥${price.toFixed(2)}` : "",
  ]
    .filter(Boolean)
    .join("<br>");
}

$("btn-publish").addEventListener("click", async () => {
  const raw = $("employer-input").value.trim();
  if (!raw) return toast("请输入任务描述");
  try {
    const task = await api("POST", "/tasks", { employer_id: employerId, raw_input: raw });
    currentTaskId = task.id;
    if (task.clarify_questions?.length) {
      renderClarifyForm(task.clarify_questions);
      showEmployerStep("clarify");
    } else {
      renderSpec(task);
      showEmployerStep("spec");
    }
    toast("AI 已解析任务");
  } catch (e) {
    toast(e.message);
  }
});

$("btn-clarify").addEventListener("click", async () => {
  const answers = {};
  $("clarify-form").querySelectorAll("input").forEach((inp) => {
    answers[inp.name] = inp.value.trim();
  });
  try {
    const task = await api("POST", `/tasks/${currentTaskId}/clarify`, { answers });
    if (task.clarify_questions?.length) {
      renderClarifyForm(task.clarify_questions);
      toast("仍需补充信息");
    } else {
      renderSpec(task);
      showEmployerStep("spec");
      toast("信息已足够，可付款");
    }
  } catch (e) {
    toast(e.message);
  }
});

$("btn-pay").addEventListener("click", async () => {
  try {
    const task = await api("POST", `/tasks/${currentTaskId}/confirm-payment`, {});
    renderEmployerStatus(task);
    showEmployerStep("status");
    toast("已托管 · 正在向附近雇员推送");
    if (inboxPoll) refreshInbox();
  } catch (e) {
    toast(e.message);
  }
});

$("btn-refresh-task").addEventListener("click", async () => {
  if (!currentTaskId) return;
  const task = await api("GET", `/tasks/${currentTaskId}`);
  renderEmployerStatus(task);
});

$("btn-new-task").addEventListener("click", () => {
  $("employer-input").value = "";
  currentTaskId = null;
  $("clarify-form").innerHTML = "";
  showEmployerStep("publish");
});

async function refreshWallet() {
  try {
    const w = await api("GET", `/workers/${workerId}/wallet`);
    $("worker-wallet").textContent = `💰 钱包 ¥${(w.balance_cents / 100).toFixed(2)}`;
  } catch (_) {
    $("worker-wallet").textContent = "";
  }
}

$("btn-online").addEventListener("click", async () => {
  try {
    await api("POST", `/workers/${workerId}/online`, {
      lat: 39.9225,
      lng: 116.444,
    });
    $("btn-online").classList.add("hidden");
    $("btn-offline").classList.remove("hidden");
    toast("听单已开启 · 等待 Push");
    refreshInbox();
    if (!inboxPoll) inboxPoll = setInterval(refreshInbox, 4000);
  } catch (e) {
    toast(e.message);
  }
});

$("btn-offline").addEventListener("click", () => {
  $("btn-online").classList.remove("hidden");
  $("btn-offline").classList.add("hidden");
  if (inboxPoll) clearInterval(inboxPoll);
  inboxPoll = null;
  toast("已停止听单");
});

async function refreshInbox() {
  try {
    const items = await api("GET", `/workers/${workerId}/inbox`);
    const container = $("worker-inbox");
    const empty = $("inbox-empty");
    container.querySelectorAll(".inbox-push").forEach((n) => n.remove());
    if (!items.length) {
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");
    for (const item of items) {
      const div = document.createElement("article");
      div.className = "inbox-push";
      div.innerHTML = `
        <span class="pill">新推送</span>
        <h3>${item.title}</h3>
        <p>${item.summary}</p>
        <p class="price">¥${(item.suggested_price_cents / 100).toFixed(2)} · 先接先得</p>
        <button type="button" class="btn primary">立即接单 →</button>
      `;
      div.querySelector("button").addEventListener("click", () => acceptTask(item.task_id));
      container.appendChild(div);
    }
  } catch (_) {}
}

async function acceptTask(taskId) {
  try {
    await api("POST", `/workers/${workerId}/tasks/${taskId}/accept`);
    activeWorkerTaskId = taskId;
    const card = await api("GET", `/workers/${workerId}/tasks/${taskId}/card`);
    renderTaskSpecCard($("worker-card"), card.card);
    $("worker-active").classList.remove("hidden");
    toast("接单成功 · 按卡片执行");
    refreshInbox();
    $("worker-active").scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    toast(e.message);
  }
}

$("btn-submit").addEventListener("click", async () => {
  const photo = $("delivery-photo").value.trim() || "proof.jpg";
  try {
    const result = await api("POST", `/workers/${workerId}/tasks/${activeWorkerTaskId}/submit`, {
      photos: [photo],
    });
    $("worker-active").classList.add("hidden");
    activeWorkerTaskId = null;
    refreshWallet();
    toast(`验货通过 · 到账 ¥${(result.payout_cents / 100).toFixed(2)}`);
  } catch (e) {
    toast(e.message);
  }
});

init();
