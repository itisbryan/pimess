import { Spectrum, markdown as spectrumMarkdown, richlink as spectrumRichlink } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";

const MAX_INLINE_ATTACHMENT_BYTES = 700 * 1024;

export class PhotonTransport {
  constructor({ projectId, projectSecret, target }) {
    this.projectId = projectId;
    this.projectSecret = projectSecret;
    this.target = target;
    this.app = null;
    this.im = null;
    this.running = false;
    this.spaces = new Map();
  }

  async start(onMessage) {
    this.app = await Spectrum({
      projectId: this.projectId,
      projectSecret: this.projectSecret,
      providers: [imessage.config()],
      options: { flattenGroups: true },
    });
    this.im = imessage(this.app);
    this.running = true;
    this.#consume(onMessage);
  }

  async send(value) {
    const space = await this.#resolveSpace(this.target);
    try {
      const sent = await space.send(outboundContent(value));
      return { guid: sent?.id || null, chat_id: this.target };
    } catch (error) {
      if (/target not allowed/i.test(error.message)) {
        throw new Error("Photon shared lines can only reply after the target texts the assigned Photon line; text it first, then retry");
      }
      throw error;
    }
  }

  async stop() {
    this.running = false;
    if (this.app) await this.app.stop();
    this.app = null;
    this.im = null;
  }

  async #resolveSpace(target) {
    if (this.spaces.has(target)) return this.spaces.get(target);
    const space = /^any;-;/.test(target)
      ? await this.im.space.get(target)
      : await this.im.space.create(target);
    this.spaces.set(target, space);
    if (space.id) this.spaces.set(space.id, space);
    return space;
  }

  #rememberInboundSpace(space, message) {
    const ids = [space?.id, message?.space?.id];
    for (const id of ids) {
      if (typeof id !== "string" || !id) continue;
      this.spaces.set(id, space);
      const match = /^any;-;(.+)$/.exec(id);
      if (match) this.spaces.set(match[1], space);
    }
  }

  async #consume(onMessage) {
    try {
      for await (const [space, message] of this.app.messages) {
        if (!this.running) return;
        if (message?.direction && message.direction !== "inbound") continue;
        this.#rememberInboundSpace(space, message);
        const content = await normalizeContent(message?.content);
        const value = textFromContent(content);
        if (!space?.id || !value) continue;
        onMessage({
          guid: message.id || null,
          reply_to_guid: message.parentId || message.replyTo?.id || message.replyToId || null,
          chat_id: space.id,
          text: value,
          content,
          is_from_me: false,
        });
      }
    } catch (error) {
      if (this.running) console.error(`pimess Photon inbound stream stopped: ${error.message}`);
    }
  }
}

function outboundContent(value) {
  const text = String(value).trim();
  return /^https?:\/\/\S+$/.test(text) ? spectrumRichlink(text) : spectrumMarkdown(value);
}

async function normalizeContent(content) {
  if (!content || typeof content !== "object") return { type: "unknown" };
  if (content.type === "text") return { type: "text", text: String(content.text || "") };
  if (content.type === "richlink") return { type: "richlink", url: String(content.url || "") };
  if (content.type === "attachment" || content.type === "voice") {
    const normalized = {
      type: content.type,
      id: content.id || null,
      name: content.name || null,
      mimeType: content.mimeType || null,
      size: typeof content.size === "number" ? content.size : null,
    };
    if (typeof content.read === "function") {
      try {
        const bytes = Buffer.from(await content.read());
        if (bytes.length <= MAX_INLINE_ATTACHMENT_BYTES) {
          normalized.data = bytes.toString("base64");
          normalized.encoding = "base64";
        }
      } catch (error) {
        console.error(`pimess Photon attachment read failed: ${error.message}`);
      }
    }
    return normalized;
  }
  if (content.type === "group") {
    return {
      type: "group",
      items: await Promise.all((content.items || []).map(async (item) => ({
        id: item?.id || null,
        content: await normalizeContent(item?.content),
      }))),
    };
  }
  return { type: content.type || "unknown" };
}

function textFromContent(content) {
  if (!content || typeof content !== "object") return "";
  if (content.type === "text") return String(content.text || "");
  if (content.type === "richlink") return String(content.url || "");
  if (content.type === "group") {
    return (content.items || []).map((item) => textFromContent(item?.content)).filter(Boolean).join("\n");
  }
  const label = content.name || content.id || "attachment";
  return `[Photon ${content.type || "message"} received: ${label}]`;
}
