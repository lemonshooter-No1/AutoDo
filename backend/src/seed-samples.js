/** 演示用已发布任务（任务列表页展示） */
import { upsertTask } from "./store.js";

const ago = (hours) => new Date(Date.now() - hours * 3600000).toISOString();

const SAMPLES = [
  {
    id: "sample-feed-cat",
    status: "dispatching",
    raw_input: "明天早上8点朝阳区望京西园喂猫",
    escrow_cents: 8500,
    spec: {
      task_type: "pet_feeding",
      title: "上门喂猫",
      summary: "望京西园 3 号楼，猫粮在玄关柜，需换水并拍照片",
      time_window: { start: "明天 08:00", end: "明天 09:00" },
      location: { address: "北京朝阳区望京西园", lat: 39.998, lng: 116.47, access_notes: "门禁 8866" },
      skills: ["pet_care"],
      suggested_price_cents: 8500,
      steps: ["按门禁进入", "喂食换水", "拍摄猫和食盆照片"],
      is_online: false,
    },
  },
  {
    id: "sample-feed-dog",
    status: "dispatching",
    raw_input: "周末上午海淀区上门喂狗遛狗",
    escrow_cents: 12000,
    spec: {
      task_type: "pet_feeding",
      title: "上门喂狗 + 遛狗 30 分钟",
      summary: "中型犬柯基，狗粮在厨房，需遛狗半小时",
      time_window: { start: "周六 10:00", end: "周六 11:30" },
      location: { address: "北京海淀区中关村大街", lat: 39.983, lng: 116.316, access_notes: "前台代收钥匙" },
      skills: ["pet_care"],
      suggested_price_cents: 12000,
      steps: ["取钥匙进门", "喂食", "遛狗 30 分钟", "拍照反馈"],
      is_online: false,
    },
  },
  {
    id: "sample-errand",
    status: "dispatching",
    raw_input: "从国贸取件送到朝阳区三里屯",
    escrow_cents: 5500,
    spec: {
      task_type: "errand",
      title: "同城取件送达",
      summary: "国贸商城 A 座前台取小型文件袋，送至三里屯 SOHO",
      time_window: { start: "今天 14:00", end: "今天 16:00" },
      location: { address: "北京朝阳区国贸 → 三里屯", lat: 39.909, lng: 116.455, access_notes: "" },
      skills: ["errand"],
      suggested_price_cents: 5500,
      steps: ["国贸取件", "打车/地铁送达", "收件人签收拍照"],
      is_online: false,
    },
  },
  {
    id: "sample-queue",
    status: "dispatching",
    raw_input: "协和医院东区排队取号",
    escrow_cents: 15000,
    spec: {
      task_type: "queue",
      title: "医院排队取号",
      summary: "早上 7 点前到医院排队，取内科号条拍照发我",
      time_window: { start: "明天 06:30", end: "明天 08:00" },
      location: { address: "北京东城区协和医院东院", lat: 39.912, lng: 116.424, access_notes: "" },
      skills: ["errand"],
      suggested_price_cents: 15000,
      steps: ["现场排队", "取号", "拍照发送号条"],
      is_online: false,
    },
  },
  {
    id: "sample-grocery",
    status: "in_progress",
    raw_input: "超市代购蔬菜水果送到家门口",
    escrow_cents: 6000,
    spec: {
      task_type: "errand",
      title: "超市代购送达",
      summary: "按清单购买蔬菜水果（清单已私信），送到小区门口",
      time_window: { start: "今天 18:00", end: "今天 20:00" },
      location: { address: "北京丰台区某小区", lat: 39.858, lng: 116.287, access_notes: "" },
      skills: ["errand"],
      suggested_price_cents: 6000,
      steps: ["按清单采购", "小票拍照", "送达门口"],
      is_online: false,
    },
  },
  {
    id: "sample-digital",
    status: "dispatching",
    raw_input: "线下门店拍照 15 家",
    escrow_cents: 20000,
    spec: {
      task_type: "digital",
      title: "门店门头拍照",
      summary: "按给定列表拍摄 15 家门店门头照，上传网盘",
      time_window: { start: "本周内", end: "本周日" },
      location: { address: "远程", lat: null, lng: null, access_notes: "" },
      skills: ["digital_labor"],
      suggested_price_cents: 20000,
      steps: ["按列表逐家拍摄", "整理文件夹", "上传分享链接"],
      is_online: true,
    },
  },
];

export function seedSampleBounties(state) {
  let added = 0;
  if (!state.inbox) state.inbox = [];

  SAMPLES.forEach((s, i) => {
    if (state.tasks[s.id]) return;
    const pushedAt = ago(i + 1);
    upsertTask(state, {
      id: s.id,
      status: s.status,
      employer_id: "employer-demo",
      worker_id: s.status === "in_progress" ? "worker-demo" : null,
      raw_input: s.raw_input,
      spec: { ...s.spec, executable_ready: true, missing_fields: [], deliverables: [] },
      clarifications: {},
      escrow_cents: s.escrow_cents,
      push_sent_to: ["worker-demo"],
      delivery: null,
      created_at: ago(i + 2),
      updated_at: pushedAt,
    });
    const exists = state.inbox.some(
      (row) => row.worker_id === "worker-demo" && row.task_id === s.id
    );
    if (!exists) {
      state.inbox.push({
        worker_id: "worker-demo",
        task_id: s.id,
        accepted: s.status === "in_progress",
        pushed_at: pushedAt,
      });
    }
    added++;
  });
  return added;
}
