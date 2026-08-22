import os from "node:os";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const agentDir = process.env.PI_CODING_AGENT_DIR || join(os.homedir(), ".pi", "agent");
const stateDir = join(agentDir, "pimess");
const configPath = join(stateDir, "config.json");

export function loadPhotonConfig(file = join(stateDir, "photon.json")) {
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    return {
      ...(typeof value.projectId === "string" && value.projectId ? { projectId: value.projectId } : {}),
      ...(typeof value.projectSecret === "string" && value.projectSecret ? { projectSecret: value.projectSecret } : {}),
      ...(typeof value.target === "string" && value.target ? { target: value.target } : {}),
      ...(typeof value.assignedPhone === "string" && value.assignedPhone ? { assignedPhone: value.assignedPhone } : {}),
      ...(typeof value.dashboardToken === "string" && value.dashboardToken ? { dashboardToken: value.dashboardToken } : {}),
    };
  } catch {
    return {};
  }
}

export function loadPimessConfig(file = configPath) {
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    const chatId = Number.isInteger(value.chatId) && value.chatId > 0 ? { chatId: value.chatId } : {};
    const recipient = typeof value.recipient === "string" && value.recipient ? { recipient: value.recipient } : {};
    const target = typeof value.target === "string" && value.target ? { target: value.target } : {};
    if (!Object.keys(chatId).length && !Object.keys(target).length) return {};
    return { ...chatId, ...recipient, ...target };
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
  const savedPhoton = loadPhotonConfig();
  const envChatId = Number(process.env.PIMESS_CHAT_ID);
  return {
    alias: process.env.PIMESS_ALIAS || basename(process.cwd()).toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 32) || "pi",
    transport: (process.env.PIMESS_TRANSPORT || "photon").toLowerCase(),
    chatId: Number.isInteger(envChatId) && envChatId > 0 ? envChatId : saved.chatId || null,
    to: process.env.PIMESS_TO || saved.recipient || null,
    target: process.env.PHOTON_TARGET || process.env.PHOTON_HOME_CHANNEL || saved.target || savedPhoton.target || null,
    projectId: process.env.SPECTRUM_PROJECT_ID || savedPhoton.projectId || null,
    projectSecret: process.env.SPECTRUM_PROJECT_SECRET || savedPhoton.projectSecret || null,
    configPath,
    photonConfigPath: join(stateDir, "photon.json"),
    socketPath: process.env.PIMESS_SOCKET || join(stateDir, "router.sock"),
    statePath: process.env.PIMESS_STATE || join(stateDir, "state.json"),
    forwardSettled: /^(1|true|yes|on)$/i.test(process.env.PIMESS_FORWARD_SETTLED || ""),
  };
}
