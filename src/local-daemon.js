#!/usr/bin/env node

import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { rmSync } from "node:fs";
import { askCliProvider } from "./cli-provider.js";
import {
  detectLanguage,
  enforceQuestionOnly,
  localDuckQuestion,
  looksLikeSolutionRequest,
  refusalQuestion
} from "./policy.js";

const SOCKET_PATH = process.env.MYDUCKD_SOCKET || path.join(os.tmpdir(), "myduckd.sock");

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return sendJson(res, 200, { ok: true, service: "myduckd", pid: process.pid });
    }

    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      const payload = await readJsonBody(req);
      const answer = await handleChatCompletion(payload);
      return sendJson(res, 200, {
        choices: [{ message: { role: "assistant", content: answer } }]
      });
    }

    return sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "Internal error" });
  }
});

try {
  rmSync(SOCKET_PATH, { force: true });
} catch {
  // Ignore stale socket cleanup errors.
}

server.listen(SOCKET_PATH);

process.on("SIGTERM", () => {
  server.close(() => {
    cleanupSocket();
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  server.close(() => {
    cleanupSocket();
    process.exit(0);
  });
});

process.on("exit", cleanupSocket);

async function handleChatCompletion(payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const auth = payload?.auth || {};
  const userInput = String(payload?.userInput || extractLastUserMessage(messages));
  const language = payload?.language === "fr" || payload?.language === "en"
    ? payload.language
    : detectLanguage(userInput);

  if (looksLikeSolutionRequest(userInput)) {
    return refusalQuestion(language);
  }

  if (auth.mode === "cli" && auth.cliProvider) {
    const cliPrompt = buildCliBridgePrompt(messages, userInput, language);
    const cliText = await askCliProvider({
      provider: auth.cliProvider,
      prompt: cliPrompt,
      systemPrompt: buildDuckCliSystemPrompt(language)
    });
    return enforceQuestionOnly(cliText, userInput, language);
  }

  return localDuckQuestion(userInput, language);
}

function extractLastUserMessage(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      return String(messages[i].content || "");
    }
  }
  return "";
}

function sendJson(res, statusCode, body) {
  const json = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json)
  });
  res.end(json);
}

function cleanupSocket() {
  try {
    rmSync(SOCKET_PATH, { force: true });
  } catch {
    // Ignore cleanup errors.
  }
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

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  const maxSize = 1024 * 1024;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxSize) {
      throw new Error("Payload too large");
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON body");
  }
}
