#!/usr/bin/env node

import process from "node:process";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { stdin as input, stdout as output } from "node:process";
import { MY_DUCK_ASCII, renderMyDuckAscii } from "./ascii.js";
import { loadConfig, saveConfig } from "./config.js";
import {
  DUCK_SYSTEM_PROMPT,
  detectLanguage,
  enforceQuestionOnly,
  localDuckQuestion,
  looksLikeSolutionRequest,
  refusalQuestion
} from "./policy.js";
import {
  askCliProvider,
  detectAvailableCliProviders,
  runCliProviderLogin
} from "./cli-provider.js";

const PROVIDER_LABELS = {
  "claude-cli": "Claude CLI",
  "codex-cli": "Codex CLI"
};

const LOCAL_DAEMON_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "local-daemon.js");
const LOCAL_BACKEND_SOCKET = process.env.MYDUCKD_SOCKET || path.join(os.tmpdir(), "myduckd.sock");
const BACKEND_CHAT_TIMEOUT_MS = parsePositiveInt(process.env.MYDUCK_BACKEND_TIMEOUT_MS, 190000);
const THINKING_DUCK_YELLOW = "\x1b[38;5;226m";
const THINKING_DUCK_ORANGE = "\x1b[38;5;208m";
const THINKING_DUCK_BLACK = "\x1b[30m";
const THINKING_DUCK_RESET = "\x1b[0m";
const THINKING_DUCK_SOURCE_LINES = normalizeThinkingDuckLines([
  "                         :--                      ",
  "                      -:::----                    ",
  "                     -:::::----     +             ",
  "                    -::::::-O----+++              ",
  "                    -:::::::-----==+              ",
  "                    --::::::-----=+               ",
  "                    ----:--------                 ",
  "                     -----------                  ",
  "                       ---------                  ",
  "          .::          -----------                ",
  "          :::::  -------:::----------             ",
  "          ::::--------::::::---------:            ",
  "          -::::----:::::::::----------:           ",
  "          -::::::::::-----------------::          ",
  "           ::::::::::::::--------------:          ",
  "           :::::::::::::::::-----------           ",
  "             ::::::::::---------------            ",
  "               .-------------------:              "
]);
const THINKING_DUCK_LINES = downscaleThinkingDuck(THINKING_DUCK_SOURCE_LINES, 2);

async function main() {
  const command = String(process.argv[2] || "").trim().toLowerCase();

  if (command === "login" || command === "connect" || command === "login-provider") {
    await runLoginCommand();
    return;
  }

  if (command === "logout") {
    await runLogoutCommand();
    return;
  }

  await runChat();
}

async function runLoginCommand() {
  printSplash();

  const rl = createReadline();
  const config = await loadConfig();

  try {
    const availableProviders = await detectAvailableCliProviders();
    if (availableProviders.length === 0) {
      console.log("[My Duck] No local CLI providers found. Install Claude CLI or Codex CLI first.");
      return;
    }

    const preferred = normalizeCliProvider(process.env.MYDUCK_CLI_PROVIDER || config.cliProvider || config.lastProvider);
    const provider = await selectProvider(rl, preferred, availableProviders);

    console.log(`\nProvider selected: ${PROVIDER_LABELS[provider]}`);
    console.log("Launching provider CLI login flow...");

    try {
      await runCliProviderLogin(provider);
    } catch (error) {
      console.log(`[My Duck] ${PROVIDER_LABELS[provider]} login failed: ${error.message}`);
      return;
    }

    const saved = await saveConfig({
      ...config,
      authMode: "cli",
      cliProvider: provider,
      lastProvider: provider,
      remoteBaseUrl: "",
      remoteAccessToken: ""
    });

    if (!saved) {
      console.log("[My Duck] CLI login succeeded but config could not be saved.");
      return;
    }

    console.log(`\n[My Duck] ${PROVIDER_LABELS[provider]} connected via CLI.`);
  } finally {
    rl.close();
  }
}

async function runLogoutCommand() {
  const config = await loadConfig();

  const saved = await saveConfig({
    ...config,
    authMode: "cli",
    cliProvider: "",
    remoteBaseUrl: "",
    remoteAccessToken: ""
  });

  if (!saved) {
    console.log("[My Duck] Could not persist logout, but session cleared in memory.");
    return;
  }

  console.log("[My Duck] CLI provider session cleared.");
}

async function runChat() {
  printSplash();

  const rl = createReadline();
  const config = await loadConfig();
  const availableProviders = await detectAvailableCliProviders();

  if (availableProviders.length === 0) {
    console.log("[My Duck] No local CLI providers found.");
    console.log("Install one of these and login first:");
    console.log("- claude (then run: claude auth)");
    console.log("- codex (then run: codex login)");
    rl.close();
    return;
  }

  const localBackendReady = await ensureLocalBackendRunning();

  try {
    const preferred = normalizeCliProvider(process.env.MYDUCK_CLI_PROVIDER || config.cliProvider || config.lastProvider);
    const provider = await selectProvider(rl, preferred, availableProviders);

    const saved = await saveConfig({
      ...config,
      authMode: "cli",
      cliProvider: provider,
      lastProvider: provider
    });

    if (!saved) {
      console.log("[My Duck] Could not persist config. Continuing without saved preferences.");
    }

    const messages = [{ role: "system", content: DUCK_SYSTEM_PROMPT }];

    while (true) {
      const userInput = (await safeQuestion(rl, "You> ")).trim();
      if (!userInput) {
        if (!input.isTTY) {
          break;
        }
        continue;
      }

      if (/^\/?(exit|quit|q)$/i.test(userInput)) {
        console.log("\nDuck> Coin Coin. See you soon.\n");
        break;
      }

      messages.push({ role: "user", content: userInput });

      let answer = "";
      const language = detectLanguage(userInput);
      if (looksLikeSolutionRequest(userInput)) {
        answer = refusalQuestion(language);
      } else {
        const stopThinking = startThinkingAnimation();
        try {
          answer = await askDuckQuestion({ provider, messages, userInput, localBackendReady, language });
        } finally {
          stopThinking();
        }
      }

      messages.push({ role: "assistant", content: answer });
      trimHistory(messages, 16);

      console.log(`\nDuck> ${answer}\n`);
    }
  } finally {
    rl.close();
  }
}

async function askDuckQuestion({ provider, messages, userInput, localBackendReady, language }) {
  if (localBackendReady) {
    try {
      return await askLocalBackend({ provider, messages, userInput, language });
    } catch (error) {
      console.log(`\n[My Duck] Local backend unavailable: ${error.message}`);
    }
  }

  try {
    const prompt = buildCliBridgePrompt(messages, userInput, language);
    const modelText = await askCliProvider({
      provider,
      prompt,
      systemPrompt: buildDuckCliSystemPrompt(language)
    });
    return enforceQuestionOnly(modelText, userInput, language);
  } catch (error) {
    console.log(`\n[My Duck] CLI provider unavailable: ${error.message}`);
    return localDuckQuestion(userInput, language);
  }
}

function startThinkingAnimation() {
  if (!output.isTTY) {
    return () => {};
  }

  const lineCount = THINKING_DUCK_LINES.length;
  const duckWidth = THINKING_DUCK_LINES.reduce((max, line) => Math.max(max, line.length), 0);
  const termWidth = Math.max(duckWidth + 2, Number(output.columns || 80));
  const maxOffset = Math.max(0, Math.min(16, termWidth - duckWidth - 2));
  let offset = 0;
  let direction = 1;
  let didRender = false;

  const render = () => {
    if (didRender) {
      output.write(`\x1b[${lineCount}A`);
    }
    for (const line of THINKING_DUCK_LINES) {
      output.write(`\x1b[2K\r${renderThinkingDuckLine(line, offset)}\n`);
    }
    didRender = true;

    if (maxOffset === 0) {
      return;
    }
    offset += direction;
    if (offset >= maxOffset || offset <= 0) {
      direction *= -1;
    }
  };

  render();
  const timer = setInterval(render, 120);

  return () => {
    clearInterval(timer);
    if (!didRender) {
      return;
    }
    output.write(`\x1b[${lineCount}A`);
    for (let i = 0; i < lineCount; i += 1) {
      output.write("\x1b[2K\r\n");
    }
    output.write(`\x1b[${lineCount}A`);
  };
}

function renderThinkingDuckLine(line, offset) {
  const padding = " ".repeat(Math.max(0, offset));
  let content = "";
  let activeColor = "";

  for (const char of line) {
    if (char === " ") {
      if (activeColor) {
        content += THINKING_DUCK_RESET;
        activeColor = "";
      }
      content += " ";
      continue;
    }

    const nextColor = isThinkingDuckEye(char)
      ? THINKING_DUCK_BLACK
      : (isThinkingDuckBeak(char) ? THINKING_DUCK_ORANGE : THINKING_DUCK_YELLOW);
    if (activeColor !== nextColor) {
      content += nextColor;
      activeColor = nextColor;
    }
    content += "█";
  }

  if (activeColor) {
    content += THINKING_DUCK_RESET;
  }

  return `${padding}${content}`;
}

function normalizeThinkingDuckLines(lines) {
  const trimmedRight = lines.map((line) => String(line || "").replace(/\s+$/g, ""));
  const nonEmpty = trimmedRight.filter((line) => line.trim().length > 0);
  if (nonEmpty.length === 0) {
    return [""];
  }

  const minIndent = nonEmpty.reduce((min, line) => {
    const match = line.match(/^ */);
    const indent = match ? match[0].length : 0;
    return Math.min(min, indent);
  }, Number.MAX_SAFE_INTEGER);

  return trimmedRight.map((line) => line.slice(minIndent));
}

function downscaleThinkingDuck(lines, factor) {
  const safeFactor = Number.isFinite(factor) && factor > 1 ? Math.floor(factor) : 1;
  if (safeFactor <= 1) {
    return lines;
  }

  const width = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const reduced = [];

  for (let row = 0; row < lines.length; row += safeFactor) {
    const rowBlock = lines.slice(row, row + safeFactor);
    let nextLine = "";

    for (let column = 0; column < width; column += safeFactor) {
      let hasBody = false;
      let hasBeak = false;
      let hasEye = false;

      for (const sourceLine of rowBlock) {
        for (let x = 0; x < safeFactor; x += 1) {
          const char = sourceLine[column + x] || " ";
          if (char === " ") {
            continue;
          }
          hasBody = true;
          if (isThinkingDuckEye(char)) {
            hasEye = true;
          }
          if (isThinkingDuckBeak(char)) {
            hasBeak = true;
          }
        }
      }

      if (!hasBody) {
        nextLine += " ";
      } else if (hasEye) {
        nextLine += "O";
      } else if (hasBeak) {
        nextLine += "+";
      } else {
        nextLine += "-";
      }
    }

    reduced.push(nextLine.replace(/\s+$/g, ""));
  }

  return normalizeThinkingDuckLines(reduced);
}

function isThinkingDuckBeak(char) {
  return char === "+" || char === "=" || char === "*";
}

function isThinkingDuckEye(char) {
  return char === "O";
}

function createReadline() {
  return readline.createInterface({
    input,
    output,
    terminal: Boolean(input.isTTY && output.isTTY)
  });
}

async function ensureLocalBackendRunning() {
  if (await isLocalBackendHealthy()) {
    return true;
  }

  try {
    const child = spawn(process.execPath, [LOCAL_DAEMON_PATH], {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        MYDUCKD_SOCKET: LOCAL_BACKEND_SOCKET
      }
    });
    child.unref();
  } catch {
    return false;
  }

  for (let i = 0; i < 25; i += 1) {
    await sleep(100);
    if (await isLocalBackendHealthy()) {
      return true;
    }
  }

  return false;
}

async function isLocalBackendHealthy() {
  try {
    const res = await requestLocalBackend({
      method: "GET",
      path: "/health",
      timeoutMs: 800
    });
    if (res.statusCode < 200 || res.statusCode > 299) {
      return false;
    }
    const data = parseJsonSafe(res.body);
    return Boolean(data?.ok);
  } catch {
    return false;
  }
}

async function askLocalBackend({ provider, messages, userInput, language }) {
  const res = await requestLocalBackend({
    method: "POST",
    path: "/v1/chat/completions",
    timeoutMs: BACKEND_CHAT_TIMEOUT_MS,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      provider,
      messages,
      userInput,
      language,
      auth: {
        mode: "cli",
        cliProvider: provider
      }
    })
  });

  if (res.statusCode < 200 || res.statusCode > 299) {
    throw new Error(`Local backend error ${res.statusCode}: ${res.body.slice(0, 200)}`);
  }

  const data = parseJsonSafe(res.body);
  return String(data?.choices?.[0]?.message?.content || "");
}

function printSplash() {
  const orange = "\x1b[38;5;209m";
  const reset = "\x1b[0m";

  const banner = renderBanner("Welcome to My Duck.");
  const logo = output.isTTY ? renderMyDuckAscii({ color: true }) : MY_DUCK_ASCII;

  if (!output.isTTY) {
    console.log(banner);
    console.log(logo);
    return;
  }

  console.log(`${orange}${banner}${reset}`);
  console.log(logo);
  console.log("");
}

function renderBanner(text) {
  const message = `* ${text}`;
  const horizontal = "-".repeat(message.length + 2);
  return [`+${horizontal}+`, `| ${message} |`, `+${horizontal}+`].join("\n");
}

async function selectProvider(rl, preferredProvider, availableProviders) {
  const fallback = availableProviders.includes(preferredProvider) ? preferredProvider : availableProviders[0];

  if (availableProviders.length === 1) {
    return fallback;
  }

  console.log("Choose your provider:");
  availableProviders.forEach((provider, index) => {
    const mark = provider === fallback ? " (default)" : "";
    console.log(`  ${index + 1}) ${PROVIDER_LABELS[provider]}${mark}`);
  });

  const answer = (await safeQuestion(rl, `Provider [1-${availableProviders.length}]: `)).trim();
  if (!answer) {
    return fallback;
  }

  if (/^[1-9]\d*$/.test(answer)) {
    const index = Number(answer) - 1;
    if (availableProviders[index]) {
      return availableProviders[index];
    }
  }

  const normalized = normalizeCliProvider(answer);
  if (normalized && availableProviders.includes(normalized)) {
    return normalized;
  }

  console.log("Invalid selection. Using default provider.");
  return fallback;
}

function trimHistory(messages, keepLast) {
  if (messages.length <= keepLast + 1) {
    return;
  }

  const system = messages[0];
  const tail = messages.slice(-keepLast);
  messages.length = 0;
  messages.push(system, ...tail);
}

async function requestLocalBackend({ method, path: requestPath, headers, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method,
        socketPath: LOCAL_BACKEND_SOCKET,
        path: requestPath,
        headers: headers || {}
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: Number(res.statusCode || 500),
            body: Buffer.concat(chunks).toString("utf8")
          });
        });
      }
    );

    req.setTimeout(timeoutMs || 2000, () => {
      req.destroy(new Error("Request timed out"));
    });

    req.on("error", (error) => reject(error));

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new Error("Local backend returned invalid JSON.");
  }
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function normalizeCliProvider(value) {
  const candidate = String(value || "").trim().toLowerCase();
  if (candidate === "claude" || candidate === "claude-cli") {
    return "claude-cli";
  }
  if (candidate === "codex" || candidate === "codex-cli") {
    return "codex-cli";
  }
  return "";
}

function buildCliBridgePrompt(messages, userInput, language) {
  const history = messages
    .filter((message) => message.role !== "system")
    .slice(-10)
    .map((message) => `${message.role.toUpperCase()}: ${String(message.content || "").trim()}`)
    .join("\n");

  return [
    `Target language: ${language === "fr" ? "French" : "English"}`,
    "Conversation context:",
    history,
    "",
    `Latest user message: ${userInput}`,
    "Respond now with 1-2 short questions only."
  ].join("\n");
}

function buildDuckCliSystemPrompt(language) {
  const langRule = language === "fr"
    ? "- Always answer in French."
    : "- Always answer in English.";

  return [
    "You are My Duck, a rubber duck for developers.",
    "Non-negotiable behavior:",
    "- Never provide direct solutions.",
    "- Never provide final copy/paste code.",
    "- Ask concise, useful questions only.",
    "- Keep your reply short.",
    "- End with at least one question.",
    langRule
  ].join("\n");
}

async function safeQuestion(rl, label) {
  try {
    return await rl.question(label);
  } catch {
    return "";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(`[My Duck] Fatal error: ${error.message}`);
  process.exitCode = 1;
});
