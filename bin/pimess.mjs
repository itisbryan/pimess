#!/usr/bin/env node
import { config, savePimessConfig } from "../src/config.mjs";
import { findChatId, validateRecipient } from "../src/init.mjs";
import { ImsgRpc } from "../src/imsg-rpc.mjs";
import { PimessRouter } from "../src/router.mjs";

const command = process.argv[2];
const settings = config();

async function initChat(recipient) {
  if (!validateRecipient(recipient)) {
    throw new Error("recipient must be an E.164 phone number or Apple ID email");
  }
  const rpc = new ImsgRpc({ command: process.env.PIMESS_IMSG || "imsg", to: recipient });
  try {
    await rpc.start(() => {}, { watch: false });
    let created;
    try {
      created = await rpc.request("chats.create", {
        addresses: [recipient],
        service: "iMessage",
        name: "PiMess",
      });
    } catch (error) {
      throw new Error(`could not create the chat; run 'imsg launch' first (${error.message})`);
    }
    const directId = created?.chat_id ?? created?.chat?.id ?? null;
    const listed = await rpc.request("chats.list", { limit: 100 });
    const chatId = Number.isInteger(directId) ? directId : findChatId(listed?.chats, recipient);
    if (!chatId) throw new Error("Messages created the chat but imsg did not return its chat ID");
    savePimessConfig(settings.configPath, { chatId, recipient });
    console.log(`pimess: saved chat ${chatId} for ${recipient} to ${settings.configPath}`);
  } finally {
    await rpc.stop();
  }
}

if (command === "init") {
  try {
    await initChat(process.argv[3]);
  } catch (error) {
    console.error(`pimess: ${error.message}`);
    process.exitCode = 1;
  }
} else if (command === "router") {
  if (settings.chatId == null) {
    console.error("pimess: set PIMESS_CHAT_ID or run 'pimess init <recipient>' first");
    process.exit(2);
  }

  const transport = new ImsgRpc({
    command: process.env.PIMESS_IMSG || "imsg",
    chatId: settings.chatId,
    to: settings.to,
  });
  const router = new PimessRouter({
    transport,
    socketPath: settings.socketPath,
    statePath: settings.statePath,
    chatId: settings.chatId,
  });

  try {
    await router.start();
  } catch (error) {
    console.error(`pimess: ${error.message}`);
    process.exit(1);
  }

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
      await router.stop();
      process.exit(0);
    });
  }
} else {
  console.error("Usage: pimess init <phone-or-apple-id> | pimess router");
  process.exit(2);
}
