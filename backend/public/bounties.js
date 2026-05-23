const API = "/api";

const TYPE_LABEL = {
  pet_feeding: "宠物照料",
  errand: "同城取送",
  queue: "现场代办",
  digital: "数字任务",
  general: "通用任务",
};

const STATUS_LABEL = {
  escrowed: "已托管",
  dispatching: "招募中",
  in_progress: "进行中",
  submitted: "验收中",
  completed: "已完成",
};

let currentSort = "new";

async function parseJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      "接口返回异常（不是 JSON）。请用 npm start 启动后访问 http://127.0.0.1:8000/bounties.html"
    );
  }
}

async function loadBounties(sort = "new") {
  currentSort = sort;
  const res = await fetch(`${API}/bounties?sort=${sort}`);
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data.error || "加载失败");
  return data;
}

function formatPrice(cents) {
  return `¥${(cents / 100).toFixed(0)}`;
}

function formatDate(iso) {
  const d = new Date(iso);
  const diff = (Date.now() - d) / 1000;
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function renderCard(item) {
  const el = document.createElement("article");
  el.className = "bounty-list-card";
  el.innerHTML = `
    <div class="bounty-list-top">
      <span class="pill">${TYPE_LABEL[item.task_type] || item.task_type}</span>
      <span class="bounty-status ${item.open ? "open" : ""}">${STATUS_LABEL[item.status] || item.status}</span>
    </div>
    <h2>${item.title}</h2>
    <p class="bounty-summary">${item.summary}</p>
    <div class="bounty-list-meta">
      <span class="bounty-price">${formatPrice(item.price_cents)} <small>固定</small></span>
      <span class="bounty-loc">${item.location}</span>
    </div>
    <p class="bounty-time">${formatDate(item.created_at)}</p>
  `;
  el.addEventListener("click", () => openModal(item.id));
  return el;
}

async function openModal(id) {
  const res = await fetch(`${API}/bounties/${id}`);
  const item = await parseJson(res);
  if (!res.ok) return;

  const steps = (item.steps || []).map((s) => `<li>${s}</li>`).join("");
  document.getElementById("modal-body").innerHTML = `
    <span class="pill">${TYPE_LABEL[item.task_type] || item.task_type}</span>
    <h2>${item.title}</h2>
    <p class="bounty-price-lg">${formatPrice(item.price_cents)}</p>
    <p class="bounty-summary">${item.summary}</p>
    <p class="bounty-loc">📍 ${item.location}</p>
    ${steps ? `<ul class="bounty-steps">${steps}</ul>` : ""}
    <p class="modal-hint">${item.open ? "回首页开启听单，收到 Push 后可接单" : "该任务已被接单或已结束"}</p>
  `;

  const cta = document.getElementById("modal-cta");
  if (item.open) {
    cta.classList.remove("hidden");
    cta.href = "/";
    cta.textContent = "回首页 · 听单接单 →";
  } else {
    cta.classList.add("hidden");
  }

  document.getElementById("bounty-modal").showModal();
}

async function refresh() {
  const grid = document.getElementById("bounty-grid");
  const empty = document.getElementById("bounties-empty");
  const countEl = document.getElementById("bounties-count");

  grid.innerHTML = "";
  try {
    const { items, total } = await loadBounties(currentSort);
    countEl.textContent = total ? `共 ${total} 个任务` : "";
    if (!items.length) {
      empty.textContent = "暂无已发布任务";
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");
    items.forEach((item) => grid.appendChild(renderCard(item)));
  } catch (e) {
    empty.textContent = e.message;
    empty.classList.remove("hidden");
    countEl.textContent = "";
  }
}

async function bootstrap() {
  try {
    await fetch("/dev/seed", { method: "POST" });
  } catch (_) {}
  await refresh();
}

document.querySelectorAll(".sort-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".sort-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    refresh();
  });
});

document.getElementById("modal-close").addEventListener("click", () => {
  document.getElementById("bounty-modal").close();
});

bootstrap();
setInterval(refresh, 15000);
