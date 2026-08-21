import test from "node:test";
import assert from "node:assert/strict";
import { findChatId, validateRecipient } from "../src/init.mjs";

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
