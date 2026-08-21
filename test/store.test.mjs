import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findRecord, loadState, saveState, upsertRecord } from "../src/store.mjs";

test("persists and reloads message routing records", () => {
  const dir = mkdtempSync(join(tmpdir(), "pimess-store-"));
  const file = join(dir, "state.json");
  try {
    const state = loadState(file);
    upsertRecord(state, {
      messageGuid: "guid-api",
      alias: "api",
      sessionId: "session-api",
      chatId: 42,
      sentAt: "2026-08-21T00:00:00.000Z",
    });
    saveState(file, state);

    const reloaded = loadState(file);
    assert.deepEqual(findRecord(reloaded, "guid-api"), {
      messageGuid: "guid-api",
      alias: "api",
      sessionId: "session-api",
      chatId: 42,
      sentAt: "2026-08-21T00:00:00.000Z",
    });
    assert.equal(JSON.parse(readFileSync(file, "utf8")).records.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
