const ALIAS = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function parseAlias(text) {
  const match = /^\s*([a-z0-9][a-z0-9_-]{0,31})\s*:\s*(.+?)\s*$/i.exec(text ?? "");
  if (!match || !ALIAS.test(match[1].toLowerCase())) return null;
  return { alias: match[1].toLowerCase(), text: match[2] };
}

export function formatOutbound(alias, text) {
  return `[${alias}] ${text}`;
}

function sameChat(messageChatId, configuredChatId) {
  if (String(messageChatId) === String(configuredChatId)) return true;
  const configured = String(configuredChatId || "");
  return /^\+\d{6,}$/.test(configured) && String(messageChatId) === `any;-;${configured}`;
}

export function routeInbound(message, { sessions, records, chatId }) {
  if (chatId != null && !sameChat(message.chat_id, chatId)) {
    return { kind: "ignore" };
  }

  const record = message.reply_to_guid ? records.get(message.reply_to_guid) : null;
  if (record) {
    const session = sessions.get(record.alias);
    if (!session?.connected || session.enabled === false) return { kind: "offline", alias: record.alias };
    return { kind: "deliver", alias: record.alias, text: message.text ?? "" };
  }

  const explicit = parseAlias(message.text);
  if (explicit) {
    const session = sessions.get(explicit.alias);
    if (!session) return { kind: "unknown", alias: explicit.alias };
    if (!session.connected || session.enabled === false) return { kind: "offline", alias: explicit.alias };
    return { kind: "deliver", alias: explicit.alias, text: explicit.text };
  }

  const active = [...sessions.values()]
    .filter((session) => session.connected && session.enabled !== false)
    .map((session) => session.alias)
    .sort();
  if (active.length === 1) {
    return { kind: "deliver", alias: active[0], text: message.text ?? "" };
  }
  if (active.length > 1) return { kind: "ambiguous", aliases: active };
  return { kind: "unavailable" };
}
