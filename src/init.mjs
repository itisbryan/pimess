const PHONE = /^\+\d{6,15}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateRecipient(value) {
  return typeof value === "string" && (PHONE.test(value.trim()) || EMAIL.test(value.trim()));
}

export function findChatId(chats, recipient) {
  const target = String(recipient || "").trim().toLowerCase();
  for (const chat of chats || []) {
    const identifier = String(chat.identifier || "").trim().toLowerCase();
    if (identifier === target && Number.isInteger(chat.id)) return chat.id;
    const participants = Array.isArray(chat.participants) ? chat.participants : [];
    if (participants.some((participant) => String(participant).trim().toLowerCase() === target) && Number.isInteger(chat.id)) {
      return chat.id;
    }
  }
  return null;
}

export async function initializeChat(rpc, recipient, save, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  const sent = await rpc.send("PiMess initialized. Reply here to reach this Pi session.");
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const listed = await rpc.request("chats.list", { limit: 100 });
    const chatId = Number.isInteger(sent?.chat_id) ? sent.chat_id : findChatId(listed?.chats, recipient);
    if (chatId) {
      save({ chatId, recipient });
      return chatId;
    }
    await wait(250);
  }
  throw new Error("Messages accepted the initialization message but imsg did not return its chat ID");
}
