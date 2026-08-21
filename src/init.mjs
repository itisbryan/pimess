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
