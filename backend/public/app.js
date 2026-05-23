const API = "";

let employerId = "employer-demo";
let workerId = "worker-demo";
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
  try {
    const seed = await api("POST", "/dev/seed");
    employerId = seed.employer_id;
    workerId = seed.worker_id;
  } catch (_) {}
  refreshWallet();
}

function showEmployerStep(step) {
  $("card-publish").classList.toggle("hidden", step !== "publish");
  $("employer-clarify").classList.toggle("hidden", step !== "clarify");
  $("employer-spec").classList.toggle("hidden", step !== "spec");
  $("employer-status").classList.toggle("hidden", step !== "status");
}

function renderSpec(task) {
  // Store current task spec globally for later price editing
  window._currentTaskSpec = task.spec;
  
  renderTaskSpecCard($("spec-preview"), task.spec);
  const flow = (task.spec && task.spec.flow) || 'A';
  const payBtn = $("btn-pay");
  if (payBtn) {
    payBtn.textContent = flow === 'A' ? '确认并托管（顺手帮）' : '确认并托管（悬赏令）';
  }
  
  const preview = $("spec-preview");
  if (preview) {
    // Add price editing section
    const priceEditor = document.createElement('div');
    priceEditor.style.marginTop = '0.75rem';
    priceEditor.style.paddingTop = '0.75rem';
    priceEditor.style.borderTop = '1px solid rgba(255,255,255,0.1)';
    priceEditor.innerHTML = `
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem">
        <label style="font-size:0.85rem;color:var(--muted)">调整报价（可选）：</label>
        <input type="number" id="price-input" min="50" max="50000" step="100" value="${(task.spec.suggested_price_cents / 100).toFixed(0)}" style="width:80px;padding:0.25rem 0.5rem;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.04);color:white;font-size:0.85rem" />
        <span style="font-size:0.85rem;color:var(--muted)">元</span>
      </div>
    `;
    preview.appendChild(priceEditor);
    
    // Add flow note
    const note = document.createElement('div');
    note.className = 'flow-note';
    note.style.fontSize = '0.85rem';
    note.style.color = 'var(--muted)';
    note.style.marginTop = '0.5rem';
    note.textContent = flow === 'A' ? '推荐：顺手帮（单人、近距离小件）' : '推荐：悬赏令（多人或系列任务）';
    // remove existing note if any
    const existing = preview.querySelector('.flow-note');
    if (existing) existing.remove();
    preview.appendChild(note);
  }
}

function renderClarifyForm(questions) {
  const form = $("clarify-form");
  form.innerHTML = "";
  for (const q of questions || []) {
    const div = document.createElement("div");
    div.className = "clarify-field";
    const inputId = `clarify-${q.field}`;
    div.innerHTML = `
      <label for="${inputId}">${q.label}</label>
      <input id="${inputId}" type="text" name="${q.field}" required placeholder="请填写…" />
      <button type="button" class="btn ghost voice-trigger" data-voice-target="${inputId}">按住说话</button>
    `;
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
  const flow = task.spec?.flow || 'A';
  $("status-detail").innerHTML = [
    `<strong>订单</strong> ${task.id.slice(0, 8)}…`,
    task.push_sent_to?.length
      ? `<strong>已推送</strong> ${task.push_sent_to.length} 名雇员` : "",
    task.worker_id
      ? `<strong>接单人</strong> ${task.worker_id}` : "<strong>状态</strong> 等待雇员接单",
    price ? `<strong>托管</strong> ¥${price.toFixed(2)}` : "",
    `<strong>流程</strong> ${flow === 'A' ? '顺手帮' : '悬赏令'}`,
    flow === 'B' ? `<div style=\"margin-top:6px;color:var(--muted)\">悬赏令已发布：系统将更广泛推送并接受多名参与者。</div>` : "",
  ]
    .filter(Boolean)
    .join("<br>");
}

function removeExistingModal() {
  const existing = document.getElementById('flow-modal-root');
  if (existing) existing.remove();
}

function showFlowModal(flow, task) {
  removeExistingModal();
  const root = document.createElement('div');
  root.id = 'flow-modal-root';
  root.style.position = 'fixed';
  root.style.inset = '0';
  root.style.zIndex = '9999';
  root.style.display = 'flex';
  root.style.alignItems = 'center';
  root.style.justifyContent = 'center';

  const backdrop = document.createElement('div');
  backdrop.style.position = 'absolute';
  backdrop.style.inset = '0';
  backdrop.style.background = 'rgba(0,0,0,0.7)';
  backdrop.addEventListener('click', removeExistingModal);

  const card = document.createElement('div');
  card.style.position = 'relative';
  card.style.width = flow === 'A' ? '520px' : '760px';
  card.style.maxWidth = 'calc(100% - 32px)';
  card.style.borderRadius = '12px';
  card.style.padding = '20px';
  card.style.boxShadow = '0 24px 80px rgba(0,0,0,0.6)';
  card.style.background = flow === 'A' ? '#0b0b0b' : 'linear-gradient(180deg,#02121a,#081122)';
  card.style.border = '1px solid rgba(255,255,255,0.06)';

  const title = document.createElement('div');
  title.style.fontSize = '18px';
  title.style.fontWeight = '600';
  title.style.color = flow === 'A' ? '#bde99b' : '#8eefff';
  title.textContent = flow === 'A' ? '已托管 · 顺手帮' : '已托管 · 悬赏令已发布';

  const body = document.createElement('div');
  body.style.marginTop = '10px';
  body.style.color = '#d1d5db';
  body.style.fontSize = '14px';
  body.innerHTML = flow === 'A'
    ? `<p>感谢发布，系统正在向附近雇员推送该任务。通常数分钟内会有人接单。</p><p style="margin-top:8px;color:var(--muted)">提示：顺手帮适合单人、近距离即时履约的小任务。</p>`
    : `<p>已将悬赏令发布到更广泛的候选池，系统会推送给更多雇员并允许多人参与。</p><p style="margin-top:8px;color:var(--muted)">提示：悬赏令适合任务量大、需要多点位或更高报酬的采集工作。</p>`;

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.gap = '10px';
  actions.style.marginTop = '14px';

  const btnPrimary = document.createElement('button');
  btnPrimary.className = 'btn primary';
  btnPrimary.textContent = flow === 'A' ? '查看进度' : '查看候选人';
  btnPrimary.addEventListener('click', () => {
    removeExistingModal();
    // focus status panel
    showEmployerStep('status');
    if (currentTaskId) {
      api('GET', `/tasks/${currentTaskId}`).then((t) => renderEmployerStatus(t)).catch(() => {});
    }
  });

  const btnClose = document.createElement('button');
  btnClose.className = 'btn ghost';
  btnClose.textContent = '关闭';
  btnClose.addEventListener('click', removeExistingModal);

  actions.appendChild(btnPrimary);
  actions.appendChild(btnClose);

  card.appendChild(title);
  card.appendChild(body);
  card.appendChild(actions);

  root.appendChild(backdrop);
  root.appendChild(card);
  document.body.appendChild(root);
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
    // Read user-edited price if available
    const priceInput = $("price-input");
    const newPrice = priceInput ? parseFloat(priceInput.value) : null;
    let payload = {};
    if (newPrice && newPrice > 0 && newPrice !== (window._currentTaskSpec?.suggested_price_cents / 100)) {
      payload.suggested_price_cents = Math.round(newPrice * 100);
    }
    
    const task = await api("POST", `/tasks/${currentTaskId}/confirm-payment`, payload);
    renderEmployerStatus(task);
    showEmployerStep("status");
    const flow = task.spec?.flow || 'A';
    toast(flow === 'A' ? "已托管 · 正在向附近雇员推送（顺手帮）" : "已托管 · 悬赏令已发布，正在广泛推送（悬赏令）");
    // show A/B style modal to summarize next steps
    try { showFlowModal(flow, task); } catch (e) { console.warn('showFlowModal failed', e); }
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
