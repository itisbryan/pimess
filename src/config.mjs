import os from "node:os";
import { basename, join } from "node:path";

const agentDir = process.env.PI_CODING_AGENT_DIR || join(os.homedir(), ".pi", "agent");
const stateDir = join(agentDir, "pimess");

export function config() {
  const chatId = process.env.PIMESS_CHAT_ID;
  return {
    alias: process.env.PIMESS_ALIAS || basename(process.cwd()).toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 32) || "pi",
    chatId: chatId ? Number(chatId) : null,
    to: process.env.PIMESS_TO || null,
    socketPath: process.env.PIMESS_SOCKET || join(stateDir, "router.sock"),
    statePath: process.env.PIMESS_STATE || join(stateDir, "state.json"),
    routerPath: join(stateDir, "router.pid"),
    forwardSettled: /^(1|true|yes|on)$/i.test(process.env.PIMESS_FORWARD_SETTLED || ""),
  };
}
