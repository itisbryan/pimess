import { Spectrum, text as spectrumText } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";

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
    const sent = await space.send(spectrumText(value));
    return { guid: sent?.id || null, chat_id: this.target };
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

  async #consume(onMessage) {
    try {
      for await (const [space, message] of this.app.messages) {
        if (!this.running) return;
        if (message?.direction && message.direction !== "inbound") continue;
        const value = textFromContent(message?.content);
        if (!space?.id || !value) continue;
        onMessage({
          guid: message.id || null,
          reply_to_guid: message.parentId || message.replyTo?.id || message.replyToId || null,
          chat_id: space.id,
          text: value,
          is_from_me: false,
        });
      }
    } catch (error) {
      if (this.running) console.error(`pimess Photon inbound stream stopped: ${error.message}`);
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
