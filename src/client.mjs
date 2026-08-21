import { createConnection } from "node:net";

export class PimessClient {
  constructor(socketPath, onMessage = () => {}) {
    this.socketPath = socketPath;
    this.onMessage = onMessage;
    this.socket = null;
    this.buffer = "";
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.socket = await new Promise((resolve, reject) => {
      const socket = createConnection(this.socketPath);
      socket.once("connect", () => resolve(socket));
      socket.once("error", reject);
    });
    this.socket.setEncoding("utf8");
    this.socket.on("data", (chunk) => this.#read(chunk));
    this.socket.on("close", () => this.#fail(new Error("pimess router disconnected")));
    return this;
  }

  request(op, params = {}) {
    if (!this.socket || this.socket.destroyed) return Promise.reject(new Error("pimess router is not connected"));
    const id = this.nextId++;
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.socket.write(`${JSON.stringify({ id, op, ...params })}\n`);
    return result;
  }

  close() {
    this.socket?.destroy();
    this.socket = null;
    this.#fail(new Error("pimess client closed"));
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
      if (message.event === "message") {
        this.onMessage(message.message || {});
        continue;
      }
      if (message.id == null) continue;
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      if (message.ok === false) pending.reject(new Error(message.error || "pimess request failed"));
      else pending.resolve(message);
    }
  }

  #fail(error) {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }
}
