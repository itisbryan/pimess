import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PimessRouter } from "../src/router.mjs";

class FakeTransport {
  constructor() {
    this.sent = [];
    this.nextId = 1;
  }

  async start(onMessage) {
    this.onMessage = onMessage;
  }

  async send(text) {
    const guid = `sent-${this.nextId++}`;
    this.sent.push({ guid, text });
    return { id: this.sent.length, guid, chat_id: 42 };
  }

  async stop() {}

  emit(message) {
    this.onMessage(message);
  }
}

function connect(socketPath) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath, () => resolve(socket));
    socket.once("error", reject);
  });
}

function nextLine(socket) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      socket.off("data", onData);
      resolve(JSON.parse(buffer.slice(0, newline)));
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });
}

function send(socket, message) {
  socket.write(`${JSON.stringify(message)}\n`);
  return nextLine(socket);
}

test("registers a session, tracks sends, and routes a reply back to it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pimess-router-"));
  const transport = new FakeTransport();
  const router = new PimessRouter({
    transport,
    socketPath: join(dir, "router.sock"),
    statePath: join(dir, "state.json"),
    chatId: 42,
  });
  const socket = await router.start();
  const client = await connect(socket);

  try {
    assert.deepEqual(
      await send(client, {
        id: 1,
        op: "register",
        alias: "api",
        sessionId: "session-api",
        project: "api-project",
      }),
      { id: 1, ok: true },
    );
    assert.deepEqual(
      await send(client, { id: 2, op: "send", text: "Tests passed." }),
      { id: 2, ok: true, guid: "sent-1", messageId: 1 },
    );
    assert.deepEqual(transport.sent, [{ guid: "sent-1", text: "[api] Tests passed." }]);

    transport.emit({
      guid: "reply-1",
      reply_to_guid: "sent-1",
      chat_id: 42,
      text: "ship it",
    });
    assert.deepEqual(await nextLine(client), {
      event: "message",
      message: { guid: "reply-1", reply_to_guid: "sent-1", chat_id: 42, text: "ship it" },
    });
  } finally {
    client.destroy();
    await router.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
