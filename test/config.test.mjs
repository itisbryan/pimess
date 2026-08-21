import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPimessConfig, savePimessConfig } from "../src/config.mjs";

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
