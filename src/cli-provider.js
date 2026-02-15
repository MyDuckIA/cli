import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";

const CLI_PROVIDER_COMMAND = {
  "claude-cli": "claude",
  "codex-cli": "codex"
};
const PROVIDER_TIMEOUT_MS = parsePositiveInt(process.env.MYDUCK_PROVIDER_TIMEOUT_MS, 180000);
const CLAUDE_MODEL = String(process.env.MYDUCK_CLAUDE_MODEL || "haiku").trim() || "haiku";

export async function detectAvailableCliProviders() {
  const providers = Object.keys(CLI_PROVIDER_COMMAND);
  const checks = await Promise.all(providers.map(async (provider) => ({
    provider,
    ok: await isCliProviderAvailable(provider)
  })));

  return checks.filter((item) => item.ok).map((item) => item.provider);
}

export async function isCliProviderAvailable(provider) {
  const command = CLI_PROVIDER_COMMAND[provider];
  if (!command) {
    return false;
  }

  try {
    await runProcess(command, ["--version"], { timeoutMs: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function runCliProviderLogin(provider) {
  if (provider === "claude-cli") {
    await runProcess("claude", ["auth"], { stdio: "inherit", timeoutMs: 0 });
    return;
  }

  if (provider === "codex-cli") {
    await runProcess("codex", ["login"], { stdio: "inherit", timeoutMs: 0 });
    return;
  }

  throw new Error(`Unsupported CLI provider: ${provider}`);
}

export async function askCliProvider({ provider, prompt, systemPrompt }) {
  if (provider === "claude-cli") {
    const args = [
      "-p",
      "--output-format",
      "text",
      "--model",
      CLAUDE_MODEL,
      "--permission-mode",
      "bypassPermissions",
      "--no-session-persistence"
    ];
    if (systemPrompt) {
      args.push("--system-prompt", systemPrompt);
    }
    args.push(prompt);

    const result = await runProcess("claude", args, {
      timeoutMs: PROVIDER_TIMEOUT_MS
    });
    return result.stdout.trim();
  }

  if (provider === "codex-cli") {
    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
    const outputPath = path.join(os.tmpdir(), `myduck-codex-last-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);

    try {
      const result = await runProcess(
        "codex",
        [
          "exec",
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
          "--output-last-message",
          outputPath,
          fullPrompt
        ],
        { timeoutMs: PROVIDER_TIMEOUT_MS }
      );

      try {
        const text = await readFile(outputPath, "utf8");
        const clean = text.trim();
        if (clean) {
          return clean;
        }
      } catch {
        // fallback to stdout
      }

      return result.stdout.trim();
    } finally {
      await rm(outputPath, { force: true }).catch(() => undefined);
    }
  }

  throw new Error(`Unsupported CLI provider: ${provider}`);
}

function runProcess(command, args, options = {}) {
  const timeoutMs = Number(options.timeoutMs ?? 60000);

  return new Promise((resolve, reject) => {
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE_SSE_PORT;
    delete cleanEnv.VSCODE_INJECTION;

    const child = spawn(command, args, {
      stdio: options.stdio || "pipe",
      env: cleanEnv
    });

    if (!options.stdio && child.stdin) {
      child.stdin.end();
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    if (!options.stdio) {
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });
    }

    let timer;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeoutMs);
    }

    child.on("error", (error) => {
      if (timer) {
        clearTimeout(timer);
      }
      reject(error);
    });

    child.on("close", (code) => {
      if (timer) {
        clearTimeout(timer);
      }

      if (timedOut) {
        reject(new Error(`${command} timed out after ${timeoutMs}ms (set MYDUCK_PROVIDER_TIMEOUT_MS to increase).`));
        return;
      }

      if (code !== 0) {
        const output = stderr.trim() || stdout.trim();
        reject(new Error(`${command} exited with code ${code}${output ? `: ${output.slice(0, 300)}` : ""}`));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}
