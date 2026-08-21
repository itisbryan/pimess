#!/usr/bin/env node
import { config } from "../src/config.mjs";
import { ImsgRpc } from "../src/imsg-rpc.mjs";
import { PimessRouter } from "../src/router.mjs";

if (process.argv[2] !== "router") {
  console.error("Usage: pimess router");
  process.exit(2);
}

const settings = config();
if (settings.chatId == null) {
  console.error("pimess: set PIMESS_CHAT_ID before starting the two-way router");
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
