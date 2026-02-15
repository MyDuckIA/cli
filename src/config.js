import os from "node:os";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const configBase = process.env.MYDUCK_HOME || os.homedir();
const configDir = path.join(configBase, ".myduck");
const configPath = path.join(configDir, "config.json");

export async function loadConfig() {
  try {
    const raw = await readFile(configPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function saveConfig(config) {
  try {
    await mkdir(configDir, { recursive: true });
    await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}
