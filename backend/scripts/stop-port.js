/** 释放占用端口（Windows）。用法: node scripts/stop-port.js 8000 */
import { execSync } from "child_process";

const port = process.argv[2] || "8000";
const isWin = process.platform === "win32";

try {
  if (isWin) {
    const out = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf8" });
    const pids = new Set();
    for (const line of out.split("\n")) {
      if (!line.includes("LISTENING")) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && pid !== "0") pids.add(pid);
    }
    if (!pids.size) {
      console.log(`端口 ${port} 未被占用`);
      process.exit(0);
    }
    for (const pid of pids) {
      execSync(`taskkill /PID ${pid} /F`);
      console.log(`已结束 PID ${pid}`);
    }
  } else {
    execSync(`lsof -ti :${port} | xargs kill -9`, { stdio: "inherit" });
  }
} catch (e) {
  console.log(`端口 ${port} 未被占用或已释放`);
}
