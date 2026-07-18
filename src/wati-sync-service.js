const crypto = require("crypto");
const { upsertRows } = require("./supabase-client");
const { watiClient } = require("./wati-summary-service");
const { deriveTagInsights } = require("./wati-taxonomy");

function syncConfig() {
  return {
    contactLimit: clamp(Number(process.env.WATI_SYNC_CONTACT_LIMIT || 100), 1, 200),
    messageLimit: clamp(Number(process.env.WATI_SYNC_MESSAGE_LIMIT || 10), 1, 50)
  };
}

async function syncWatiToSupabase({ client = watiClient(), config = syncConfig() } = {}) {
  if (!client.isConfigured()) {
    const error = new Error("WATI_BASE_URL and WATI_API_TOKEN are required.");
    error.code = "WATI_NOT_CONFIGURED";
    throw error;
  }

  const [contacts, operators] = await Promise.all([
    fetchContacts(client, config.contactLimit),
    fetchOperators(client).catch(() => [])
  ]);
  const conversationRows = [];
  const messageRows = [];
  const failures = [];
  const operatorIndex = buildOperatorIndex(operators);

  for (const contact of contacts) {
    const waId = contact.wa_id || contact.wAid || contact.phone || contact.whatsappNumber;
    if (!waId) continue;

    const conversationId = String(waId);
    const baseConversation = normalizeContactConversation(contact, conversationId, waId, operatorIndex);
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
    conversationRows.push(mergeConversationSignals(baseConversation, normalizedMessages, operatorIndex));
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
  const batches = [];
  try {
    batches.push(...await fetchV3Contacts(client, limit));
  } catch {}

  try {
    batches.push(...await fetchV1Contacts(client, limit));
  } catch (error) {
    if (!batches.length) throw error;
  }

  return mergeContacts(batches).slice(0, limit);
}

async function fetchV3Contacts(client, limit) {
  const tenantless = client.baseUrl.replace(/\/\d+$/, "");
  const pageSize = Math.min(50, limit);
  const contacts = [];
  for (let page = 1; contacts.length < limit; page += 1) {
    const endpoint = `/api/ext/v3/contacts?page_number=${page}&page_size=${pageSize}`;
    const response = await client.request(endpoint, { exactUrl: `${tenantless}${endpoint}` });
    const batch = extractArray(response.data, ["contact_list", "contacts", "data", "result"]).map((contact) => ({ ...contact, _watiSource: "v3" }));
    contacts.push(...batch);
    if (batch.length < pageSize) break;
  }
  return contacts.slice(0, limit);
}

async function fetchV1Contacts(client, limit) {
  const pageSize = Math.min(50, limit);
  const contacts = [];
  for (let page = 1; contacts.length < limit; page += 1) {
    const endpoint = `/api/v1/getContacts?pageSize=${pageSize}&pageNumber=${page}`;
    const response = await client.request(endpoint, { exactUrl: `${client.baseUrl}${endpoint}` });
    const batch = extractArray(response.data, ["contact_list", "contacts", "data", "result"]).map((contact) => ({ ...contact, _watiSource: "v1" }));
    contacts.push(...batch);
    if (batch.length < pageSize) break;
  }
  return contacts.slice(0, limit);
}

async function fetchOperators(client) {
  const endpoint = "/api/v1/operators";
  const response = await client.request(endpoint, { exactUrl: `${client.baseUrl}${endpoint}` });
  return extractArray(response.data, ["result", "operators", "data", "items"]);
}

function mergeContacts(contacts) {
  const map = new Map();
  for (const contact of contacts) {
    const id = String(contact.wa_id || contact.wAid || contact.phone || contact.whatsappNumber || contact.id || "");
    if (!id) continue;
    const existing = map.get(id) || {};
    map.set(id, deepMerge(existing, contact));
  }
  return Array.from(map.values());
}

function deepMerge(left, right) {
  const output = { ...left, ...right };
  for (const key of ["custom_params", "customParams", "customAttributes"]) {
    output[key] = mergeCustomValue(left[key], right[key]);
  }
  for (const key of ["teams", "segments", "tags", "labels", "scopedUsers", "teamIds"]) {
    output[key] = uniqueValues([...normalizeArray(left[key]), ...normalizeArray(right[key])]);
  }
  output._watiSource = uniqueValues([...normalizeArray(left._watiSource), ...normalizeArray(right._watiSource)]).join("+");
  return output;
}

function mergeCustomValue(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) return [...normalizeArray(left), ...normalizeArray(right)];
  return {
    ...(left && typeof left === "object" ? left : {}),
    ...(right && typeof right === "object" ? right : {})
  };
}

function buildOperatorIndex(operators) {
  const map = new Map();
  for (const operator of operators) {
    const normalized = {
      id: firstPresent(operator, ["id", "_id", "userId"]),
      name: firstPresent(operator, ["fullName", "name", "firstName", "displayName", "email"]),
      email: firstPresent(operator, ["email", "operatorEmail"]),
      teamIds: normalizeArray(firstPresent(operator, ["teamIds", "teams"])),
      raw: operator
    };
    for (const key of [normalized.id, normalized.email, normalized.name]) {
      if (key) map.set(String(key).toLowerCase(), normalized);
    }
  }
  return map;
}

function findOperator(value, operatorIndex) {
  for (const item of normalizeArray(value)) {
    if (!item) continue;
    if (typeof item === "object") {
      const direct = {
        id: firstPresent(item, ["id", "_id", "userId"]),
        name: firstPresent(item, ["fullName", "name", "firstName", "displayName", "email"]),
        email: firstPresent(item, ["email", "operatorEmail"]),
        raw: item
      };
      return operatorIndex.get(String(direct.id || "").toLowerCase()) || operatorIndex.get(String(direct.email || "").toLowerCase()) || operatorIndex.get(String(direct.name || "").toLowerCase()) || direct;
    }
    const match = operatorIndex.get(String(item).toLowerCase());
    if (match) return match;
  }
  return null;
}

async function fetchMessages(client, waId, limit) {
  const endpoint = `/api/v1/getMessages/${encodeURIComponent(waId)}?pageSize=${limit}&pageNumber=1`;
  return client.request(endpoint, { exactUrl: `${client.baseUrl}${endpoint}` });
}

function normalizeContactConversation(contact, conversationId, waId, operatorIndex) {
  const name = firstPresent(contact, ["name", "fullName", "displayName", "firstName", "username"]);
  const teams = normalizeTags(firstPresent(contact, ["teams"]));
  const customAttributes = normalizeCustomAttributes(firstPresent(contact, ["custom_params", "customParams", "customAttributes"]));
  const scopedOperator = findOperator(firstPresent(contact, ["scopedUsers", "assignedUsers", "operators"]), operatorIndex);
  const directOperatorName = firstPresent(contact, ["assignedOperatorName", "operatorName", "assignedTo", "assigneeName"]);
  const directOperatorEmail = firstPresent(contact, ["assignedOperatorEmail", "operatorEmail", "assigneeEmail"]);
  const tags = [
    ...new Set([
      ...teams,
      ...normalizeTags(firstPresent(contact, ["segments", "tags", "labels"])),
      ...normalizeTags(customAttributes.tags),
      ...Object.values(customAttributes).filter((value) => typeof value === "string")
    ])
  ];
  const insights = deriveTagInsights(tags, customAttributes);
  const enrichedAttributes = {
    ...customAttributes,
    counselor: insights.counselor || customAttributes.counselor,
    stage: insights.stage || customAttributes.stage,
    issueCategory: insights.issueCategory || customAttributes.issueCategory,
    ownerRole: insights.ownerRole || customAttributes.ownerRole,
    ownerName: insights.ownerName || customAttributes.ownerName,
    assignedTo: scopedOperator?.name || directOperatorName || insights.ownerName || customAttributes.assignedTo,
    assignedEmail: scopedOperator?.email || directOperatorEmail || customAttributes.assignedEmail,
    operatorName: scopedOperator?.name || directOperatorName || customAttributes.operatorName,
    operatorEmail: scopedOperator?.email || directOperatorEmail || customAttributes.operatorEmail,
    teamName: teams[0] || customAttributes.teamName,
    team: teams[0] || insights.ownerRole || customAttributes.team,
    teamIds: normalizeArray(firstPresent(contact, ["teamIds"])),
    dataConfidence: {
      contactSource: contact._watiSource || "unknown",
      hasScopedOperator: Boolean(scopedOperator),
      hasDirectOperator: Boolean(directOperatorName || directOperatorEmail),
      hasTags: tags.length > 0,
      assignmentTimeIsInferred: true
    }
  };

  return {
    id: conversationId,
    wa_id: String(waId),
    student_name: name || "Unknown",
    team_id: null,
    program: insights.program || inferProgram({ tags, customAttributes, text: JSON.stringify(customAttributes) }),
    status: firstPresent(contact, ["contact_status", "status"]) || "open",
    tags: insights.normalizedTags,
    custom_attributes: enrichedAttributes,
    first_seen_at: parseDate(firstPresent(contact, ["created", "createdAt"])),
    assigned_at: parseDate(firstPresent(contact, ["last_updated", "lastUpdated", "updatedAt", "created", "createdAt"])),
    raw: { source: "wati-contact-sync", contact, scopedOperator },
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

function mergeConversationSignals(conversation, messages, operatorIndex) {
  const incoming = latest(messages.filter((message) => message.direction === "incoming").map((message) => message.message_created_at));
  const outgoing = latest(messages.filter((message) => message.direction === "outgoing").map((message) => message.message_created_at));
  const latestMessage = latest(messages.map((message) => message.message_created_at));
  const latestMessageRow = messages
    .filter((message) => message.message_created_at)
    .sort((a, b) => new Date(b.message_created_at).getTime() - new Date(a.message_created_at).getTime())[0];
  const isWaitingOnNearpeer = Boolean(latestMessageRow && latestMessageRow.direction === "incoming");
  const inferredStatus = isWaitingOnNearpeer ? "open" : "resolved";
  const latestOperator = latestOutgoingOperator(messages, operatorIndex);
  const customAttributes = {
    ...conversation.custom_attributes,
    operatorName: conversation.custom_attributes.operatorName || latestOperator?.name,
    operatorEmail: conversation.custom_attributes.operatorEmail || latestOperator?.email,
    assignedTo: conversation.custom_attributes.assignedTo || latestOperator?.name,
    assignedEmail: conversation.custom_attributes.assignedEmail || latestOperator?.email,
    dataConfidence: {
      ...(conversation.custom_attributes.dataConfidence || {}),
      hasMessageOperator: Boolean(latestOperator),
      statusIsInferredFromLatestMessage: true
    }
  };

  return {
    ...conversation,
    status: inferredStatus,
    custom_attributes: customAttributes,
    last_customer_message_at: incoming || latestMessage || conversation.first_seen_at,
    last_agent_reply_at: outgoing,
    session_expires_at: incoming ? new Date(new Date(incoming).getTime() + 24 * 60 * 60000).toISOString() : null
  };
}

function latestOutgoingOperator(messages, operatorIndex) {
  const message = messages
    .filter((item) => item.direction === "outgoing" && (item.operator_name || item.operator_email))
    .sort((a, b) => new Date(b.message_created_at || 0).getTime() - new Date(a.message_created_at || 0).getTime())[0];
  if (!message) return null;
  return findOperator([message.operator_email, message.operator_name], operatorIndex) || { name: message.operator_name, email: message.operator_email };
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

function normalizeArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((item) => item !== undefined && item !== null && item !== "");
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [value];
}

function uniqueValues(values) {
  return [...new Set(values.filter((item) => item !== undefined && item !== null && item !== ""))];
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
