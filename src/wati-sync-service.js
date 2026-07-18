const crypto = require("crypto");
const { upsertRows } = require("./supabase-client");
const { watiClient } = require("./wati-summary-service");

function syncConfig() {
  return {
    contactLimit: clamp(Number(process.env.WATI_SYNC_CONTACT_LIMIT || 15), 1, 50),
    messageLimit: clamp(Number(process.env.WATI_SYNC_MESSAGE_LIMIT || 10), 1, 50)
  };
}

async function syncWatiToSupabase({ client = watiClient(), config = syncConfig() } = {}) {
  if (!client.isConfigured()) {
    const error = new Error("WATI_BASE_URL and WATI_API_TOKEN are required.");
    error.code = "WATI_NOT_CONFIGURED";
    throw error;
  }

  const contacts = await fetchContacts(client, config.contactLimit);
  const conversationRows = [];
  const messageRows = [];
  const failures = [];

  for (const contact of contacts) {
    const waId = contact.wa_id || contact.wAid || contact.phone || contact.whatsappNumber;
    if (!waId) continue;

    const conversationId = String(waId);
    const baseConversation = normalizeContactConversation(contact, conversationId, waId);
    const messageResult = await fetchMessages(client, waId, config.messageLimit).catch((error) => {
      failures.push({
        waId: maskWaId(waId),
        error: error.code || error.message,
        failures: error.failures || []
      });
      return null;
    });

    const messages = extractMessages(messageResult ? messageResult.data : null);
    const normalizedMessages = messages.map((message) => normalizeMessage(message, conversationId, waId, contact));
    messageRows.push(...normalizedMessages);
    conversationRows.push(mergeConversationSignals(baseConversation, normalizedMessages));
  }

  await upsertRows("wati_conversations", conversationRows, "id");
  if (messageRows.length) await upsertRows("wati_messages", messageRows, "id");

  return {
    ok: true,
    mode: "wati-temporary-sync",
    contactsSeen: contacts.length,
    conversationsUpserted: conversationRows.length,
    messagesUpserted: messageRows.length,
    failures: failures.slice(0, 10),
    generatedAt: new Date().toISOString()
  };
}

async function fetchContacts(client, limit) {
  const tenantless = client.baseUrl.replace(/\/\d+$/, "");
  const v3Endpoint = `/api/ext/v3/contacts?page_number=1&page_size=${limit}`;
  try {
    const response = await client.request(v3Endpoint, { exactUrl: `${tenantless}${v3Endpoint}` });
    return extractArray(response.data, ["contact_list", "contacts", "data", "result"]).slice(0, limit);
  } catch {
    const endpoint = `/api/v1/getContacts?pageSize=${limit}&pageNumber=1`;
    const response = await client.request(endpoint, { exactUrl: `${client.baseUrl}${endpoint}` });
    return extractArray(response.data, ["contact_list", "contacts", "data", "result"]).slice(0, limit);
  }
}

async function fetchMessages(client, waId, limit) {
  const endpoint = `/api/v1/getMessages/${encodeURIComponent(waId)}?pageSize=${limit}&pageNumber=1`;
  return client.request(endpoint, { exactUrl: `${client.baseUrl}${endpoint}` });
}

function normalizeContactConversation(contact, conversationId, waId) {
  const name = firstPresent(contact, ["name", "fullName", "displayName", "firstName", "username"]);
  const teams = normalizeTags(firstPresent(contact, ["teams"]));
  const customAttributes = normalizeCustomAttributes(firstPresent(contact, ["custom_params", "customParams", "customAttributes"]));
  const tags = [
    ...new Set([
      ...teams,
      ...normalizeTags(firstPresent(contact, ["segments", "tags", "labels"])),
      ...normalizeTags(customAttributes.tags),
      ...Object.values(customAttributes).filter((value) => typeof value === "string")
    ])
  ];

  return {
    id: conversationId,
    wa_id: String(waId),
    student_name: name || "Unknown",
    team_id: null,
    program: inferProgram({ tags, customAttributes, text: JSON.stringify(customAttributes) }),
    status: firstPresent(contact, ["contact_status", "status"]) || "open",
    tags,
    custom_attributes: customAttributes,
    first_seen_at: parseDate(firstPresent(contact, ["created", "createdAt"])),
    raw: { source: "wati-contact-sync", contact },
    updated_at: new Date().toISOString()
  };
}

function normalizeMessage(message, conversationId, waId, contact) {
  const id =
    firstPresent(message, ["id", "localMessageId", "whatsappMessageId", "messageId"]) ||
    stableId({ conversationId, waId, message });
  const direction = inferDirection(message);
  const createdAt = parseDate(firstPresent(message, ["created", "createdAt", "timestamp", "messageCreatedAt"]));

  return {
    id: String(id),
    conversation_id: conversationId,
    ticket_id: firstPresent(message, ["ticketId"]),
    wa_id: String(waId),
    sender_name: firstPresent(contact, ["name", "fullName", "displayName", "firstName", "username"]) || null,
    operator_name: firstPresent(message, ["operatorName", "assignedOperatorName"]),
    operator_email: firstPresent(message, ["operatorEmail", "assignedOperatorEmail"]),
    direction,
    message_type: firstPresent(message, ["type", "messageType", "eventType"]) || "message",
    text: firstPresent(message, ["text", "body", "messageText"]),
    message_created_at: createdAt,
    raw: message
  };
}

function mergeConversationSignals(conversation, messages) {
  const incoming = latest(messages.filter((message) => message.direction === "incoming").map((message) => message.message_created_at));
  const outgoing = latest(messages.filter((message) => message.direction === "outgoing").map((message) => message.message_created_at));
  const latestMessage = latest(messages.map((message) => message.message_created_at));
  const latestMessageRow = messages
    .filter((message) => message.message_created_at)
    .sort((a, b) => new Date(b.message_created_at).getTime() - new Date(a.message_created_at).getTime())[0];
  const isWaitingOnNearpeer = Boolean(latestMessageRow && latestMessageRow.direction === "incoming");
  const inferredStatus = isWaitingOnNearpeer ? "open" : "resolved";

  return {
    ...conversation,
    status: inferredStatus,
    last_customer_message_at: incoming || latestMessage || conversation.first_seen_at,
    last_agent_reply_at: outgoing,
    session_expires_at: incoming ? new Date(new Date(incoming).getTime() + 24 * 60 * 60000).toISOString() : null
  };
}

function extractMessages(value) {
  const direct = extractArray(value, ["items", "messages", "data", "result"]);
  if (direct.length) return direct;
  if (value && value.messages) return extractArray(value.messages, ["items", "messages", "data", "result"]);
  return [];
}

function extractArray(value, keys) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function firstPresent(source, keys) {
  for (const key of keys) {
    if (source && source[key] !== undefined && source[key] !== null && source[key] !== "") return source[key];
  }
  return null;
}

function normalizeTags(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => (typeof item === "string" ? item : item.name || item.title || item.id)).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function normalizeCustomAttributes(value) {
  if (!value) return {};
  if (Array.isArray(value)) {
    return value.reduce((output, item) => {
      if (!item || typeof item !== "object") return output;
      const key = firstPresent(item, ["name", "key", "paramName", "fieldName", "title"]);
      const val = firstPresent(item, ["value", "paramValue", "fieldValue", "text"]);
      if (key && val !== null) output[key] = val;
      return output;
    }, {});
  }
  if (typeof value === "object") return value;
  return {};
}

function inferProgram({ tags, customAttributes, text }) {
  const explicit = firstPresent(customAttributes, ["program", "Program", "course", "Course", "category", "Category", "leadType"]);
  if (explicit) return explicit;
  const haystack = [...tags, text].filter(Boolean).join(" ").toLowerCase();
  for (const program of ["CSS", "MDCAT", "CA", "Access", "Support", "Payment", "Refund"]) {
    if (haystack.includes(program.toLowerCase())) return program;
  }
  return "General";
}

function inferDirection(message) {
  if (message.owner === true || message.fromMe === true) return "outgoing";
  if (message.owner === false || message.fromMe === false) return "incoming";
  const raw = String(firstPresent(message, ["direction", "eventType", "statusString", "type"]) || "").toLowerCase();
  if (/sent|delivered|read|out|template|operator|agent/.test(raw)) return "outgoing";
  return "incoming";
}

function parseDate(value) {
  if (!value) return null;
  if (/^\d+$/.test(String(value))) {
    const numeric = Number(value);
    return new Date(String(value).length === 10 ? numeric * 1000 : numeric).toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function latest(values) {
  const dates = values.filter(Boolean).map((value) => new Date(value)).filter((date) => !Number.isNaN(date.getTime())).sort((a, b) => b.getTime() - a.getTime());
  return dates[0] ? dates[0].toISOString() : null;
}

function stableId(value) {
  return crypto.createHash("sha1").update(JSON.stringify(value)).digest("hex");
}

function maskWaId(value) {
  const raw = String(value || "");
  return raw.length <= 4 ? "****" : `${raw.slice(0, 3)}***${raw.slice(-2)}`;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

module.exports = {
  syncWatiToSupabase
};
