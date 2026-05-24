export const API = "/api";

export const STATUS_LABEL = {
  clarifying: "待补充",
  awaiting_payment: "待付款",
  escrowed: "已付款",
  dispatching: "招募中",
  in_progress: "进行中",
  submitted: "验收中",
  completed: "已完成",
  cancelled: "已取消",
};

export const TYPE_LABEL = {
  pet_feeding: "宠物照料",
  errand: "同城取送",
  queue: "现场代办",
  digital: "数字任务",
  general: "通用任务",
};

export async function parseJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("接口异常，请确认已 npm start 并访问 http://127.0.0.1:8000");
  }
}

export async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

if (typeof window !== "undefined") {
  window.toast = window.toast || toast;
}

export function formatPrice(cents) {
  return `¥${(cents / 100).toFixed(0)}`;
}

export function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export async function ensureSeed() {
  // Seeding endpoint removed; return empty result.
  return {};
}

export function statusClass(status) {
  if (status === "completed") return "done";
  if (["dispatching", "in_progress", "submitted", "escrowed"].includes(status)) return "active";
  return "pending";
}
