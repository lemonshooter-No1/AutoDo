import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "..", "data", "store.json");

const defaultState = () => ({
  users: {},
  tasks: {},
  inbox: [],
});

function load() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) return defaultState();
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function save(state) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), "utf8");
}

export const db = {
  read: load,
  write: save,
};

export function upsertUser(state, user) {
  state.users[user.id] = user;
}

export function getUser(state, id) {
  return state.users[id];
}

export function upsertTask(state, task) {
  state.tasks[task.id] = task;
}

export function getTask(state, id) {
  return state.tasks[id];
}
