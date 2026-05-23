import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let cached = null;

export function getMatchingConfig() {
  if (!cached) {
    const filePath = path.join(__dirname, "../../config/matching.json");
    cached = JSON.parse(readFileSync(filePath, "utf8"));
  }
  return cached;
}
