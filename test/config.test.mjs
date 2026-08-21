import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isChatConfigured, isTransportConfigured, loadPimessConfig, savePimessConfig } from "../src/config.mjs";

test("persists and reloads the initialized chat", () => {
  const dir = mkdtempSync(join(tmpdir(), "pimess-config-"));
  const file = join(dir, "config.json");
  try {
    savePimessConfig(file, { chatId: 42, recipient: "+15551234567" });
    assert.deepEqual(loadPimessConfig(file), {
      chatId: 42,
      recipient: "+15551234567",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reports whether startup can connect to a configured chat", () => {
  assert.equal(isChatConfigured({ chatId: null }), false);
  assert.equal(isChatConfigured({ chatId: 42 }), true);
});

test("recognizes a configured Photon transport", () => {
  assert.equal(isTransportConfigured({ transport: "photon", projectId: "p", projectSecret: "s", target: "+15551234567" }), true);
  assert.equal(isTransportConfigured({ transport: "photon", projectId: "p", projectSecret: "", target: "+15551234567" }), false);
});
