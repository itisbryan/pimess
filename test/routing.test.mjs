import test from "node:test";
import assert from "node:assert/strict";
import { formatOutbound, parseAlias, routeInbound } from "../src/routing.mjs";

const sessions = new Map([
  ["api", { alias: "api", sessionId: "session-api", connected: true }],
  ["docs", { alias: "docs", sessionId: "session-docs", connected: true }],
]);

const records = new Map([
  ["guid-api", { alias: "api", sessionId: "session-api", chatId: 42 }],
]);

test("routes an inline reply by message GUID", () => {
  assert.deepEqual(
    routeInbound(
      { guid: "reply-1", reply_to_guid: "guid-api", chat_id: 42, text: "fix it" },
      { sessions, records, chatId: 42 },
    ),
    { kind: "deliver", alias: "api", text: "fix it" },
  );
});

test("routes an explicit alias prefix", () => {
  assert.deepEqual(parseAlias(" docs: update the README "), {
    alias: "docs",
    text: "update the README",
  });
});

test("refuses an ambiguous unthreaded reply", () => {
  assert.deepEqual(
    routeInbound(
      { guid: "reply-2", chat_id: 42, text: "please continue" },
      { sessions, records, chatId: 42 },
    ),
    { kind: "ambiguous", aliases: ["api", "docs"] },
  );
});

test("does not fall through when the target session is offline", () => {
  const offline = new Map([
    ["api", { alias: "api", sessionId: "session-api", connected: false }],
    ["docs", { alias: "docs", sessionId: "session-docs", connected: true }],
  ]);
  assert.deepEqual(
    routeInbound(
      { guid: "reply-3", reply_to_guid: "guid-api", chat_id: 42, text: "hello" },
      { sessions: offline, records, chatId: 42 },
    ),
    { kind: "offline", alias: "api" },
  );
});

test("labels outbound text with its agent alias", () => {
  assert.equal(formatOutbound("api", "Tests passed."), "[api] Tests passed.");
});
