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
let currentAmapMap = null;
let currentAmapMarker = null;
let currentMapLoadTimer = null;

function destroyAmapMap() {
  if (currentMapLoadTimer) {
    clearTimeout(currentMapLoadTimer);
    currentMapLoadTimer = null;
  }
  if (currentAmapMarker) {
    currentAmapMarker.setMap(null);
    currentAmapMarker = null;
  }
  if (currentAmapMap) {
    currentAmapMap.destroy();
    currentAmapMap = null;
  }
}

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
  const locationText = item.location_formatted || item.location;
  el.innerHTML = `
    <div class="bounty-list-top">
      <span class="pill">${TYPE_LABEL[item.task_type] || item.task_type}</span>
      <span class="bounty-status ${item.open ? "open" : ""}">${STATUS_LABEL[item.status] || item.status}</span>
    </div>
    <h2>${item.title}</h2>
    <p class="bounty-summary">${item.summary}</p>
    <div class="bounty-list-meta">
      <span class="bounty-price">${formatPrice(item.price_cents)} <small>固定</small></span>
      <span class="bounty-loc">${locationText}</span>
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
  const locationText = item.location_formatted || item.location;
  const hasCoords = Number.isFinite(item.location_lat) && Number.isFinite(item.location_lng);
  document.getElementById("modal-body").innerHTML = `
    <span class="pill">${TYPE_LABEL[item.task_type] || item.task_type}</span>
    <h2>${item.title}</h2>
    <p class="bounty-price-lg">${formatPrice(item.price_cents)}</p>
    <p class="bounty-summary">${item.summary}</p>
    <div class="location-summary">
      <div class="location-summary-label">任务地点</div>
      <div class="location-summary-value">${locationText}</div>
      <div class="location-summary-meta">${
        hasCoords
          ? `已解析坐标：${item.location_lat.toFixed(4)}, ${item.location_lng.toFixed(4)}`
          : "未解析坐标，按文字地址判断即可"
      }</div>
    </div>
    <div class="location-map-card">
      <div class="location-map-badge">地图交互预览</div>
      ${hasCoords ? '<div id="amap-map" class="location-map-interactive"></div><div id="amap-map-state" class="location-map-state">地图加载中…</div>' : '<div class="location-map-empty-text">当前地址暂时没有解析出坐标，先看文字地址判断即可。</div>'}
      <div class="location-map-tip">可以拖拽、缩放，帮助你判断大致距离和路线是否顺路。</div>
    </div>
    ${steps ? `<ul class="bounty-steps">${steps}</ul>` : ""}
    <p class="modal-hint">${item.open ? "回首页开启听单，收到 Push 后可接单" : "该任务已被接单或已结束"}</p>
  `;

  destroyAmapMap();

  const cta = document.getElementById("modal-cta");
  if (item.open) {
    cta.classList.remove("hidden");
    cta.href = "/";
    cta.textContent = "回首页 · 听单接单 →";
  } else {
    cta.classList.add("hidden");
  }

  document.getElementById("bounty-modal").showModal();

  if (hasCoords) {
    const mapState = document.getElementById("amap-map-state");
    const failMap = (message) => {
      if (mapState) mapState.textContent = message;
      const mapContainer = document.getElementById("amap-map");
      if (mapContainer) {
        mapContainer.classList.add("location-map-error");
        mapContainer.innerHTML = '<div class="location-map-empty-text">地图底图未加载成功，可能是 key 白名单或网络限制。</div>';
      }
    };

    if (typeof AMap === "undefined") {
      failMap("高德地图脚本未加载成功");
      return;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const mapContainer = document.getElementById("amap-map");
        if (!mapContainer) return;
        try {
          AMap.plugin(["AMap.ToolBar"], () => {
            try {
              currentAmapMap = new AMap.Map(mapContainer, {
                zoom: 15,
                center: [item.location_lng, item.location_lat],
                viewMode: "2D",
                resizeEnable: true,
              });
              currentAmapMarker = new AMap.Marker({
                position: [item.location_lng, item.location_lat],
                anchor: "bottom-center",
                title: item.title,
              });
              currentAmapMap.add(currentAmapMarker);
              currentAmapMap.addControl(new AMap.ToolBar({ position: "RB" }));
              currentAmapMap.setFitView([currentAmapMarker]);
              if (mapState) mapState.textContent = "可拖拽缩放的地图已加载";
              currentMapLoadTimer = setTimeout(() => {
                if (!currentAmapMap || !document.body.contains(mapContainer)) return;
                const size = mapContainer.getBoundingClientRect();
                if (size.width < 20 || size.height < 20) {
                  failMap("地图容器尺寸异常，无法显示底图");
                  return;
                }
                if (mapState && mapState.textContent === "地图加载中…") {
                  mapState.textContent = "地图已加载";
                }
                currentAmapMap.resize();
              }, 700);
            } catch (error) {
              console.warn(error);
              failMap("地图初始化失败，请检查 key 白名单或网络");
            }
          });
        } catch (error) {
          console.warn(error);
          failMap("地图插件加载失败");
        }
      });
    });
  }
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
  destroyAmapMap();
  document.getElementById("bounty-modal").close();
});

document.getElementById("bounty-modal").addEventListener("close", destroyAmapMap);

bootstrap();
setInterval(refresh, 15000);
