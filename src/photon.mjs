import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export class PhotonTransport {
  constructor({ projectId, projectSecret, target, port = 8790, sidecarDir }) {
    this.projectId = projectId;
    this.projectSecret = projectSecret;
    this.target = target;
    this.port = port;
    this.sidecarDir = sidecarDir;
    this.token = randomBytes(24).toString("hex");
    this.child = null;
    this.abort = null;
  }

  async start(onMessage) {
    const entry = join(this.sidecarDir, "index.mjs");
    if (!existsSync(entry)) throw new Error(`Photon sidecar missing: ${entry}`);
    this.child = spawn(process.execPath, [entry], {
      env: {
        ...process.env,
        SPECTRUM_PROJECT_ID: this.projectId,
        SPECTRUM_PROJECT_SECRET: this.projectSecret,
        PHOTON_SIDECAR_PORT: String(this.port),
        PHOTON_SIDECAR_TOKEN: this.token,
        PHOTON_SIDECAR_WATCH_STDIN: "1",
      },
      stdio: ["pipe", "ignore", "inherit"],
    });
    this.child.once("error", (error) => console.error(`pimess Photon sidecar: ${error.message}`));
    await this.#waitForHealth();
    this.abort = new AbortController();
    this.#readInbound(onMessage, this.abort.signal).catch((error) => {
      if (error.name !== "AbortError") console.error(`pimess Photon inbound: ${error.message}`);
    });
  }

  async send(text) {
    const response = await fetch(`http://127.0.0.1:${this.port}/send`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-pimess-photon-token": this.token },
      body: JSON.stringify({ spaceId: this.target, text }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || `Photon returned HTTP ${response.status}`);
    return { guid: result.guid, chat_id: this.target };
  }

  async stop() {
    this.abort?.abort();
    if (this.child) {
      try {
        await fetch(`http://127.0.0.1:${this.port}/shutdown`, {
          method: "POST",
          headers: { "x-pimess-photon-token": this.token },
          body: "{}",
        });
      } catch {}
      this.child.kill();
      this.child = null;
    }
  }

  async #waitForHealth() {
    let lastError;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${this.port}/health`, {
          headers: { "x-pimess-photon-token": this.token },
        });
        if (response.ok) return;
        lastError = new Error(`health returned ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Photon sidecar did not become ready: ${lastError?.message || "unknown error"}`);
  }

  async #readInbound(onMessage, signal) {
    while (!signal.aborted) {
      const response = await fetch(`http://127.0.0.1:${this.port}/inbound`, {
        headers: { "x-pimess-photon-token": this.token },
        signal,
      });
      if (!response.ok || !response.body) throw new Error(`inbound returned ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (;;) {
          const newline = buffer.indexOf("\n");
          if (newline === -1) break;
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) onMessage(JSON.parse(line));
        }
      }
    }
  }
}
