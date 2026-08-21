import { spawn } from "node:child_process";

export class ImsgRpc {
  constructor({ command = "imsg", chatId, to } = {}) {
    this.command = command;
    this.chatId = chatId == null ? null : Number(chatId);
    this.to = to || null;
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
    this.onMessage = () => {};
  }

  async start(onMessage) {
    this.onMessage = onMessage;
    this.child = spawn(this.command, ["rpc"], { stdio: ["pipe", "pipe", "ignore"] });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.#read(chunk));
    this.child.on("error", (error) => this.#fail(error));
    this.child.on("close", (code) => this.#fail(new Error(`imsg rpc exited (${code ?? "unknown"})`)));
    await this.request("initialize", {});
    await this.request("watch.subscribe", {
      ...(this.chatId == null ? {} : { chat_id: this.chatId }),
      debounce_ms: 500,
    });
  }

  async send(text) {
    const params = { text };
    if (this.chatId != null) params.chat_id = this.chatId;
    else if (this.to) params.to = this.to;
    else throw new Error("configure PIMESS_CHAT_ID or PIMESS_TO");
    return (await this.request("send", params)) || {};
  }

  async request(method, params) {
    if (!this.child?.stdin?.writable) throw new Error("imsg rpc is not running");
    const id = this.nextId++;
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return result;
  }

  async stop() {
    if (!this.child) return;
    this.child.stdin.end();
    this.child.kill();
    this.child = null;
    this.#fail(new Error("imsg rpc stopped"));
  }

  #read(chunk) {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline === -1) return;
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.method === "message") {
        this.onMessage(message.params?.message || {});
        continue;
      }
      if (message.id == null) continue;
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || "imsg rpc error"));
      else pending.resolve(message.result);
    }
  }

  #fail(error) {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }
}
