import crypto from "node:crypto";
import http from "node:http";
import { once } from "node:events";

const projectId = process.env.SPECTRUM_PROJECT_ID;
const projectSecret = process.env.SPECTRUM_PROJECT_SECRET;
const port = Number(process.env.PHOTON_SIDECAR_PORT || 8790);
const bind = "127.0.0.1";
const token = process.env.PHOTON_SIDECAR_TOKEN;

if (!projectId || !projectSecret || !token) {
  console.error("pimess Photon: SPECTRUM_PROJECT_ID, SPECTRUM_PROJECT_SECRET, and PHOTON_SIDECAR_TOKEN are required");
  process.exit(2);
}

let Spectrum;
let imessage;
let spectrumText;
try {
  ({ Spectrum, text: spectrumText } = await import("spectrum-ts"));
  ({ imessage } = await import("spectrum-ts/providers/imessage"));
} catch (error) {
  console.error(`pimess Photon: spectrum-ts is not installed: ${error.message}`);
  process.exit(3);
}

const app = await Spectrum({
  projectId,
  projectSecret,
  providers: [imessage.config()],
  options: { flattenGroups: true },
});
const im = imessage(app);
let consumer = null;
const waiters = [];
const spaces = new Map();

function tokenMatches(value) {
  if (typeof value !== "string") return false;
  const left = Buffer.from(value);
  const right = Buffer.from(token);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function phoneFromSpaceId(value) {
  if (/^\+\d{6,}$/.test(value || "")) return value;
  const match = /^any;-;(\+\d{6,})$/.exec(value || "");
  return match?.[1] || null;
}

async function resolveSpace(spaceId) {
  if (spaces.has(spaceId)) return spaces.get(spaceId);
  const phone = phoneFromSpaceId(spaceId);
  const space = phone ? await im.space.create(phone) : await im.space.get(spaceId);
  spaces.set(spaceId, space);
  if (phone) spaces.set(phone, space);
  if (space?.id) spaces.set(space.id, space);
  return space;
}

function waitForConsumer() {
  if (consumer) return Promise.resolve();
  return new Promise((resolve) => waiters.push(resolve));
}

function setConsumer(response) {
  consumer = response;
  while (waiters.length) waiters.shift()();
}

async function deliver(event) {
  for (;;) {
    await waitForConsumer();
    if (!consumer) continue;
    try {
      if (!consumer.write(`${JSON.stringify(event)}\n`)) await once(consumer, "drain");
      return;
    } catch {
      consumer = null;
    }
  }
}

function textFromContent(content) {
  if (!content || typeof content !== "object") return "";
  if (content.type === "text") return String(content.text || "");
  if (content.type === "richlink") return String(content.url || "");
  if (content.type === "group") {
    return (content.items || []).map((item) => textFromContent(item?.content)).filter(Boolean).join("\n");
  }
  return `[Photon ${content.type || "message"} received]`;
}

(async () => {
  for (;;) {
    try {
      for await (const [space, message] of app.messages) {
        if (message?.direction && message.direction !== "inbound") continue;
        const spaceId = space?.id || message?.space?.id || null;
        const text = textFromContent(message?.content);
        if (!spaceId || !text) continue;
        await deliver({
          guid: message?.id || null,
          reply_to_guid: message?.replyTo?.id || message?.replyTo?.guid || message?.replyToId || null,
          chat_id: spaceId,
          text,
          is_from_me: false,
        });
      }
    } catch (error) {
      console.error(`pimess Photon inbound stream restarted: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
})();

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("request body too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function json(response, status, value) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(value));
}

const server = http.createServer(async (request, response) => {
  if (!tokenMatches(request.headers["x-pimess-photon-token"])) return json(response, 401, { ok: false, error: "unauthorized" });
  if (request.method === "GET" && request.url === "/inbound") {
    response.statusCode = 200;
    response.setHeader("content-type", "application/x-ndjson");
    response.setHeader("cache-control", "no-store");
    setConsumer(response);
    request.on("close", () => { if (consumer === response) consumer = null; });
    return;
  }
  if (request.method !== "POST") return json(response, 405, { ok: false, error: "method not allowed" });
  if (request.url === "/health") return json(response, 200, { ok: true });
  if (request.url === "/shutdown") {
    json(response, 200, { ok: true });
    setTimeout(() => shutdown("http"), 25);
    return;
  }
  try {
    const input = await body(request);
    if (request.url !== "/send") return json(response, 404, { ok: false, error: "not found" });
    if (!input.spaceId || typeof input.text !== "string" || !input.text.trim()) return json(response, 400, { ok: false, error: "spaceId and text are required" });
    const space = await resolveSpace(String(input.spaceId));
    const sent = await space.send(spectrumText(input.text));
    return json(response, 200, { ok: true, guid: sent?.id || null });
  } catch (error) {
    console.error(`pimess Photon send failed: ${error.message}`);
    return json(response, 500, { ok: false, error: "Photon send failed" });
  }
});

server.listen(port, bind, () => console.error(`pimess Photon sidecar listening on ${bind}:${port}`));

let stopping = false;
async function shutdown(reason) {
  if (stopping) return;
  stopping = true;
  console.error(`pimess Photon sidecar stopping (${reason})`);
  try { await Promise.race([app.stop(), new Promise((resolve) => setTimeout(resolve, 3000))]); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 500).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
if (process.env.PHOTON_SIDECAR_WATCH_STDIN === "1") {
  process.stdin.resume();
  process.stdin.on("end", () => shutdown("parent exited"));
}
