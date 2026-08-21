import os from "node:os";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const agentDir = process.env.PI_CODING_AGENT_DIR || join(os.homedir(), ".pi", "agent");
const stateDir = join(agentDir, "pimess");
const configPath = join(stateDir, "config.json");

export function loadPimessConfig(file = configPath) {
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (!Number.isInteger(value.chatId) || value.chatId <= 0) return {};
    return {
      chatId: value.chatId,
      ...(typeof value.recipient === "string" && value.recipient ? { recipient: value.recipient } : {}),
    };
  } catch {
    return {};
  }
}

export function savePimessConfig(file, value) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, file);
}

export function isChatConfigured(value) {
  return Number.isInteger(value?.chatId) && value.chatId > 0;
}

export function isTransportConfigured(value) {
  if (value?.transport === "photon") {
    return Boolean(value.projectId && value.projectSecret && value.target);
  }
  return isChatConfigured(value);
}

export function config() {
  const saved = loadPimessConfig();
  const envChatId = Number(process.env.PIMESS_CHAT_ID);
  return {
    alias: process.env.PIMESS_ALIAS || basename(process.cwd()).toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 32) || "pi",
    transport: (process.env.PIMESS_TRANSPORT || "photon").toLowerCase(),
    chatId: Number.isInteger(envChatId) && envChatId > 0 ? envChatId : saved.chatId || null,
    to: process.env.PIMESS_TO || saved.recipient || null,
    target: process.env.PHOTON_TARGET || process.env.PHOTON_HOME_CHANNEL || null,
    projectId: process.env.SPECTRUM_PROJECT_ID || null,
    projectSecret: process.env.SPECTRUM_PROJECT_SECRET || null,
    photonPort: Number(process.env.PHOTON_SIDECAR_PORT || 8790),
    photonDir: process.env.PIMESS_PHOTON_DIR || null,
    configPath,
    socketPath: process.env.PIMESS_SOCKET || join(stateDir, "router.sock"),
    statePath: process.env.PIMESS_STATE || join(stateDir, "state.json"),
    forwardSettled: /^(1|true|yes|on)$/i.test(process.env.PIMESS_FORWARD_SETTLED || ""),
  };
}
