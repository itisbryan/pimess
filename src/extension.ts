import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawn } from "node:child_process";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { config, isTransportConfigured } from "./config.mjs";
import { PimessClient } from "./client.mjs";

const routerEntry = fileURLToPath(new URL("../bin/pimess.mjs", import.meta.url));

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runInit(recipient: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [routerEntry, "init", recipient], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function photonUserContent(message: any): any {
  const text = typeof message.text === "string" ? message.text.trim() : "";
  const parts: any[] = text ? [{ type: "text", text }] : [];
  const visit = (content: any) => {
    if (!content || typeof content !== "object") return;
    if (content.type === "group") {
      for (const item of content.items || []) visit(item?.content);
      return;
    }
    if (content.type !== "attachment" || !content.data || !String(content.mimeType || "").startsWith("image/")) return;
    parts.push({
      type: "image",
      mimeType: content.mimeType,
      data: content.data,
    });
  };
  visit(message.content);
  return parts.length ? parts : null;
}

function assistantText(ctx: ExtensionContext): string | null {
  const entries = ctx.sessionManager.getBranch() as Array<any>;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const message = entries[index]?.message;
    if (message?.role !== "assistant") continue;
    const text = Array.isArray(message.content)
      ? message.content.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n")
      : typeof message.content === "string" ? message.content : "";
    if (text.trim()) return text.trim();
  }
  return null;
}

export default function pimess(pi: ExtensionAPI) {
  let settings = config();
  let client: PimessClient | null = null;
  let alias = settings.alias;
  let enabled = /^(1|true|yes|on)$/i.test(process.env.PIMESS_ENABLED || "");
  let forwardSettled = settings.forwardSettled;
  let lastForwarded = "";
  let sessionId = "";
  let project = basename(process.cwd());

  async function connect(ctx: ExtensionContext) {
    if (!isTransportConfigured(settings)) {
      throw new Error(settings.transport === "photon"
        ? "Photon is not configured; set SPECTRUM_PROJECT_ID, SPECTRUM_PROJECT_SECRET, and PHOTON_TARGET"
        : "pimess chat is not initialized; run /pimess init <phone-or-apple-id>");
    }
    if (client) return client;
    let lastError: unknown;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        client = await new PimessClient(settings.socketPath, async (message) => {
          const content = photonUserContent(message);
          if (!content) return;
          try {
            await pi.sendUserMessage(content, { deliverAs: "followUp" });
          } catch (error) {
            ctx.ui.notify(`pimess could not deliver inbound message: ${error}`, "error");
          }
        }).connect();
        await client.request("register", { alias, sessionId, project, cwd: ctx.cwd, enabled });
        return client;
      } catch (error) {
        lastError = error;
        client?.close();
        client = null;
        if (attempt === 0) {
          const child = spawn(process.execPath, [routerEntry, "router"], {
            detached: true,
            stdio: "ignore",
            env: process.env,
          });
          child.unref();
        }
        await sleep(100 + attempt * 100);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async function register(ctx: ExtensionContext) {
    const active = await connect(ctx);
    await active.request("register", { alias, sessionId, project, cwd: ctx.cwd, enabled });
  }

  pi.on("session_start", async (_event, ctx) => {
    sessionId = ctx.sessionManager.getSessionId();
    project = basename(ctx.cwd);
    if (!isTransportConfigured(settings)) {
      ctx.ui.notify(settings.transport === "photon"
        ? "Photon is not configured; set SPECTRUM_PROJECT_ID, SPECTRUM_PROJECT_SECRET, and PHOTON_TARGET"
        : "pimess is not initialized; run /pimess init <phone-or-apple-id>", "info");
      return;
    }
    try {
      await register(ctx);
    } catch (error) {
      ctx.ui.notify(`pimess unavailable: ${error}`, "warning");
    }
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (!enabled || !forwardSettled) return;
    const text = assistantText(ctx);
    if (!text || text === lastForwarded) return;
    try {
      await (await connect(ctx)).request("send", { text });
      lastForwarded = text;
    } catch (error) {
      ctx.ui.notify(`pimess notification failed: ${error}`, "error");
    }
  });

  pi.on("session_shutdown", async () => {
    client?.close();
    client = null;
  });

  pi.registerTool({
    name: "send_imessage",
    label: "Send iMessage",
    description: "Send an explicitly requested iMessage through pimess.",
    parameters: Type.Object({
      text: Type.String({ description: "The exact text to send" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const ok = await ctx.ui.confirm("Send iMessage?", params.text);
      if (!ok) return { content: [{ type: "text", text: "iMessage cancelled." }], details: {} };
      try {
        const result = await (await connect(ctx)).request("send", { text: params.text });
        return { content: [{ type: "text", text: `iMessage sent (${result.guid || "accepted"}).` }], details: result };
      } catch (error) {
        return { content: [{ type: "text", text: `iMessage failed: ${error}` }], details: {}, isError: true };
      }
    },
  });

  pi.registerCommand("pimess", {
    description: "Control pimess iMessage routing",
    handler: async (args, ctx) => {
      const [command, value] = (args || "").trim().split(/\s+/, 2);
      try {
        if (command === "init") {
          if (!value) throw new Error("usage: /pimess init <phone-number, Apple ID, or Photon space>");
          const ok = await ctx.ui.confirm(settings.transport === "photon" ? "Set Photon target?" : "Initialize iMessage chat?", `Recipient: ${value}`);
          if (!ok) return;
          const result = await runInit(value);
          if (result.code !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || "chat initialization failed");
          settings = config();
          client?.close();
          client = null;
          ctx.ui.notify(result.stdout.trim() || "pimess chat initialized; run /pimess on", "info");
          return;
        }
        if (command === "status" && !isTransportConfigured(settings)) {
          ctx.ui.notify(settings.transport === "photon"
            ? "Photon is not configured; set SPECTRUM_PROJECT_ID, SPECTRUM_PROJECT_SECRET, and PHOTON_TARGET"
            : "pimess is not initialized; run /pimess init <phone-or-apple-id>", "info");
          return;
        }
        if (command === "alias") {
          if (!value) throw new Error("usage: /pimess alias <name>");
          alias = value.toLowerCase();
          await register(ctx);
          ctx.ui.notify(`pimess alias: ${alias}`, "info");
          return;
        }
        if (command === "on" || command === "off") {
          enabled = command === "on";
          if (command === "on" && value === "forward") forwardSettled = true;
          await register(ctx);
          ctx.ui.notify(`pimess ${enabled ? "enabled" : "disabled"} for ${alias}${forwardSettled && enabled ? "; forwarding on" : ""}`, "info");
          return;
        }
        if (command === "forward" && (value === "on" || value === "off")) {
          forwardSettled = value === "on";
          ctx.ui.notify(`pimess settled-reply forwarding: ${forwardSettled ? "on" : "off"}`, "info");
          return;
        }
        const result = await (await connect(ctx)).request("status");
        ctx.ui.notify(`pimess ${alias}: ${enabled ? "on" : "off"}; active: ${result.sessions?.map((item: any) => item.alias).join(", ") || "none"}; records: ${result.records}`, "info");
      } catch (error) {
        ctx.ui.notify(`pimess: ${error}`, "error");
      }
    },
  });
}
