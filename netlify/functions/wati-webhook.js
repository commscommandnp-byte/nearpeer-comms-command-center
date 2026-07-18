const { json } = require("./_shared");
const { upsertRows } = require("../../src/supabase-client");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  }

  let payload;
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return json({ ok: false, error: "INVALID_JSON" }, 400);
  }

  try {
    const normalized = normalizeWebhookPayload(payload);
    await upsertRows("wati_conversations", normalized.conversation, "id");
    if (normalized.message) await upsertRows("wati_messages", normalized.message, "id");

    return json({
      ok: true,
      conversationId: normalized.conversation.id,
      messageId: normalized.message ? normalized.message.id : null
    });
  } catch (error) {
    return json({
      ok: false,
      error: error.code || error.message,
      details: error.body || null
    }, 500);
  }
};

function normalizeWebhookPayload(payload) {
  const eventType = firstPresent(payload, ["eventType", "event", "type", "webhookEvent"]) || "wati.webhook";
  const waId = firstPresent(payload, ["waId", "wAid", "whatsappNumber", "phone", "sender", "source"]) || nested(payload, ["contact", "wAid"]) || nested(payload, ["contact", "phone"]);
  const messageId = firstPresent(payload, ["messageId", "id", "localMessageId", "wamid"]) || nested(payload, ["message", "id"]);
  const conversationId =
    firstPresent(payload, ["conversationId", "ticketId", "chatId"]) ||
    nested(payload, ["conversation", "id"]) ||
    waId ||
    messageId ||
    `wati-${Date.now()}`;
  const messageCreatedAt = parseDate(firstPresent(payload, ["created", "createdAt", "timestamp", "messageCreatedAt"]) || nested(payload, ["message", "created"]));
  const direction = inferDirection(payload);
  const text = firstPresent(payload, ["text", "messageText", "body"]) || nested(payload, ["message", "text"]) || nested(payload, ["message", "body"]);
  const assignedTo = firstPresent(payload, ["operatorName", "assignedOperatorName", "assignedTo"]) || nested(payload, ["operator", "fullName"]);
  const operatorEmail = firstPresent(payload, ["operatorEmail", "assignedOperatorEmail"]) || nested(payload, ["operator", "email"]);
  const studentName = firstPresent(payload, ["senderName", "fullName", "contactName", "name"]) || nested(payload, ["contact", "fullName"]) || nested(payload, ["contact", "name"]);

  return {
    conversation: {
      id: String(conversationId),
      ticket_id: firstPresent(payload, ["ticketId"]),
      wa_id: waId ? String(waId) : null,
      student_name: studentName || null,
      status: firstPresent(payload, ["status", "chatStatus"]) || "open",
      custom_attributes: firstPresent(payload, ["customAttributes", "customParams"]) || {},
      last_customer_message_at: direction === "incoming" ? messageCreatedAt : null,
      last_agent_reply_at: direction === "outgoing" ? messageCreatedAt : null,
      session_expires_at: direction === "incoming" && messageCreatedAt ? new Date(new Date(messageCreatedAt).getTime() + 24 * 60 * 60000).toISOString() : null,
      raw: { eventType, payload },
      updated_at: new Date().toISOString()
    },
    message: messageId
      ? {
          id: String(messageId),
          conversation_id: String(conversationId),
          ticket_id: firstPresent(payload, ["ticketId"]),
          wa_id: waId ? String(waId) : null,
          sender_name: studentName || null,
          operator_name: assignedTo || null,
          operator_email: operatorEmail || null,
          direction,
          message_type: firstPresent(payload, ["messageType", "type"]) || eventType,
          text: text || null,
          message_created_at: messageCreatedAt,
          raw: payload
        }
      : null
  };
}

function inferDirection(payload) {
  const raw = String(firstPresent(payload, ["direction", "messageDirection", "eventType", "event", "type"]) || "").toLowerCase();
  if (/out|sent|agent|operator/.test(raw)) return "outgoing";
  return "incoming";
}

function firstPresent(source, keys) {
  for (const key of keys) {
    if (source && source[key] !== undefined && source[key] !== null && source[key] !== "") return source[key];
  }
  return null;
}

function nested(source, keys) {
  return keys.reduce((value, key) => (value && value[key] !== undefined ? value[key] : null), source);
}

function parseDate(value) {
  if (!value) return new Date().toISOString();
  if (/^\d+$/.test(String(value))) {
    const numeric = Number(value);
    return new Date(String(value).length === 10 ? numeric * 1000 : numeric).toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
