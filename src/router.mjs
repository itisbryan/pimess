import { createConnection, createServer } from "node:net";
import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { loadState, saveState, upsertRecord } from "./store.mjs";
import { formatOutbound, routeInbound } from "./routing.mjs";

function sendLine(socket, value) {
  if (!socket.destroyed) socket.write(`${JSON.stringify(value)}\n`);
}

function validateAlias(alias) {
  return typeof alias === "string" && /^[a-z0-9][a-z0-9_-]{0,31}$/i.test(alias);
}

export class PimessRouter {
  constructor({ transport, socketPath, statePath, chatId }) {
    this.transport = transport;
    this.socketPath = socketPath;
    this.statePath = statePath;
    this.chatId = chatId == null ? null : chatId;
    this.state = loadState(statePath);
    this.sessions = new Map();
    this.server = null;
    this.stopping = false;
  }

  async start() {
    mkdirSync(dirname(this.socketPath), { recursive: true, mode: 0o700 });
    if (existsSync(this.socketPath)) {
      const active = await new Promise((resolve) => {
        const probe = createConnection(this.socketPath);
        const finish = (value) => {
          probe.destroy();
          resolve(value);
        };
        probe.setTimeout(250, () => finish(false));
        probe.once("connect", () => finish(true));
        probe.once("error", () => finish(false));
      });
      if (active) throw new Error("pimess router is already running");
      unlinkSync(this.socketPath);
    }

    this.server = createServer((socket) => this.#attach(socket));
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.socketPath, () => {
        this.server.off("error", reject);
        chmodSync(this.socketPath, 0o600);
        resolve();
      });
    });

    if (this.transport?.start) await this.transport.start((message) => this.#inbound(message));
    return this.socketPath;
  }

  async stop() {
    this.stopping = true;
    for (const session of this.sessions.values()) session.socket.destroy();
    this.sessions.clear();
    await this.transport?.stop?.();
    if (this.server) {
      await new Promise((resolve) => this.server.close(() => resolve()));
      this.server = null;
    }
    if (existsSync(this.socketPath)) unlinkSync(this.socketPath);
  }

  #attach(socket) {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > 1024 * 1024) {
        socket.destroy();
        return;
      }
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline === -1) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        try {
          this.#request(socket, JSON.parse(line));
        } catch (error) {
          sendLine(socket, { ok: false, error: `invalid request: ${error.message}` });
        }
      }
    });
    socket.on("close", () => {
      for (const [alias, session] of this.sessions) {
        if (session.socket === socket) {
          session.connected = false;
          session.socket = null;
          this.sessions.set(alias, session);
        }
      }
    });
  }

  async #request(socket, request) {
    const id = request?.id;
    try {
      if (request?.op === "register") {
        if (!validateAlias(request.alias)) throw new Error("alias must be 1-32 lowercase letters, numbers, _ or -");
        const alias = request.alias.toLowerCase();
        const current = this.sessions.get(alias);
        if (current?.connected && current.socket !== socket) throw new Error(`alias is already active: ${alias}`);
        this.sessions.set(alias, {
          alias,
          sessionId: String(request.sessionId || "").slice(0, 200),
          project: String(request.project || "").slice(0, 200),
          cwd: String(request.cwd || "").slice(0, 1000),
          socket,
          connected: true,
          enabled: request.enabled !== false,
          lastSeenAt: new Date().toISOString(),
        });
        sendLine(socket, { id, ok: true });
        return;
      }

      const session = [...this.sessions.values()].find((candidate) => candidate.socket === socket && candidate.connected);
      if (!session) throw new Error("register this Pi session first");
      session.lastSeenAt = new Date().toISOString();

      if (request?.op === "send") {
        const text = String(request.text || "").trim();
        if (!text) throw new Error("text is required");
        if (text.length > 8000) throw new Error("text is too long (max 8000 characters)");
        const result = await this.transport.send(formatOutbound(session.alias, text));
        if (result?.guid) {
          upsertRecord(this.state, {
            messageGuid: result.guid,
            messageId: result.id ?? null,
            chatId: result.chat_id ?? this.chatId,
            alias: session.alias,
            sessionId: session.sessionId,
            sentAt: new Date().toISOString(),
          });
          saveState(this.statePath, this.state);
        }
        sendLine(socket, { id, ok: true, guid: result?.guid ?? null, messageId: result?.id ?? null });
        return;
      }

      if (request?.op === "status") {
        sendLine(socket, {
          id,
          ok: true,
          alias: session.alias,
          sessions: [...this.sessions.values()].filter((candidate) => candidate.connected).map(({ alias, project, sessionId, enabled }) => ({ alias, project, sessionId, enabled })),
          records: this.state.records.length,
        });
        return;
      }

      throw new Error(`unknown operation: ${request?.op || ""}`);
    } catch (error) {
      sendLine(socket, { id, ok: false, error: error.message });
    }
  }

  async #inbound(message) {
    if (message?.is_from_me) return;
    const records = new Map(this.state.records.map((record) => [record.messageGuid, record]));
    const result = routeInbound(message, { sessions: this.sessions, records, chatId: this.chatId });
    if (result.kind === "deliver") {
      const session = this.sessions.get(result.alias);
      sendLine(session.socket, { event: "message", message });
      return;
    }
    if (result.kind === "ambiguous") {
      await this.transport.send(`[pimess] Ambiguous reply. Use ${result.aliases.map((alias) => `${alias}: ...`).join(" or ")}.`);
      return;
    }
    if (result.kind === "offline") {
      await this.transport.send(`[pimess] ${result.alias} is offline; your message was not routed.`);
      return;
    }
    if (result.kind === "unknown") {
      await this.transport.send(`[pimess] Unknown agent alias: ${result.alias}.`);
    }
  }
}
