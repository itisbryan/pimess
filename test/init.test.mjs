import test from "node:test";
import assert from "node:assert/strict";
import { findChatId, initializeChat, validateRecipient } from "../src/init.mjs";

test("finds the initialized direct chat by recipient", () => {
  assert.equal(
    findChatId([
      { id: 7, identifier: "+15550000000", participants: ["+15550000000"] },
      { id: 42, identifier: "+15551234567", participants: ["+15551234567"] },
    ], "+15551234567"),
    42,
  );
});

test("rejects recipients that are not phone numbers or Apple IDs", () => {
  assert.equal(validateRecipient("not a recipient"), false);
  assert.equal(validateRecipient("+15551234567"), true);
  assert.equal(validateRecipient("me@example.com"), true);
});

test("initializes a chat using ordinary send without the private bridge", async () => {
  const calls = [];
  const rpc = {
    async send(text) {
      calls.push(["send", text]);
      return {};
    },
    async request(method, params) {
      calls.push([method, params]);
      return { chats: [{ id: 42, identifier: "+15551234567", participants: ["+15551234567"] }] };
    },
  };
  let saved;
  const result = await initializeChat(rpc, "+15551234567", (value) => { saved = value; });
  assert.equal(result, 42);
  assert.equal(saved.chatId, 42);
  assert.equal(calls[0][0], "send");
  assert.equal(calls[1][0], "chats.list");
});
