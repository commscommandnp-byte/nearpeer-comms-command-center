function parseDate(value) {
  if (!value) return null;
  if (/^\d+$/.test(String(value))) {
    const numeric = Number(value);
    return new Date(String(value).length === 10 ? numeric * 1000 : numeric);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function minutesBetween(from, to = new Date()) {
  const date = parseDate(from);
  if (!date) return null;
  return Math.max(0, Math.round((to.getTime() - date.getTime()) / 60000));
}

function firstPresent(source, keys) {
  for (const key of keys) {
    if (source && source[key] !== undefined && source[key] !== null && source[key] !== "") {
      return source[key];
    }
  }
  return null;
}

function normalizeConversation(raw, config = {}) {
  const tags = normalizeTags(firstPresent(raw, ["tags", "tag", "labels", "customTags"]));
  const customAttributes = firstPresent(raw, ["customAttributes", "customParams", "attributes"]) || {};
  const assignedTo =
    firstPresent(raw, ["operatorName", "assignedOperatorName", "assignedTo", "assigneeName"]) ||
    firstPresent(customAttributes, ["operatorName", "assignedTo", "counselor"]);
  const assignedEmail =
    firstPresent(raw, ["operatorEmail", "assignedOperatorEmail", "assigneeEmail"]) ||
    firstPresent(customAttributes, ["operatorEmail", "assignedEmail"]);
  const team =
    firstPresent(raw, ["teamName", "team", "assignedTeamName", "department"]) ||
    firstPresent(customAttributes, ["team", "department"]);
  const lastCustomerMessageAt = firstPresent(raw, [
    "lastCustomerMessageAt",
    "lastIncomingMessageAt",
    "lastUserMessageTime",
    "lastMessageReceivedTime",
    "created",
    "timestamp"
  ]);
  const lastAgentReplyAt = firstPresent(raw, [
    "lastAgentReplyAt",
    "lastOutgoingMessageAt",
    "lastOperatorMessageTime",
    "lastMessageSentTime"
  ]);
  const lastCustomerDate = parseDate(lastCustomerMessageAt);
  const lastAgentDate = parseDate(lastAgentReplyAt);
  const hasPendingCustomerReply = Boolean(lastCustomerDate && (!lastAgentDate || lastCustomerDate.getTime() > lastAgentDate.getTime()));
  const assignedAt = firstPresent(raw, ["assignedAt", "assignedTime", "operatorAssignedAt", "created"]);
  const status = firstPresent(raw, ["status", "statusString", "ticketStatus", "conversationStatus"]) || "open";
  const program =
    firstPresent(raw, ["program", "course", "category", "leadType"]) ||
    inferProgram({ tags, customAttributes, team, text: firstPresent(raw, ["text", "lastMessage"]) }, config);

  return {
    id: firstPresent(raw, ["conversationId", "ticketId", "id", "_id"]),
    studentName: firstPresent(raw, ["senderName", "name", "contactName", "fullName"]) || "Unknown",
    phone: firstPresent(raw, ["waId", "phone", "phoneNumber", "whatsappNumber"]),
    team: team || "Unmapped",
    assignedTo: assignedTo || null,
    assignedEmail,
    counselor: firstPresent(customAttributes, ["counselor", "counselorName"]) || assignedTo || null,
    program,
    tags,
    status,
    lastCustomerMessageAt,
    lastAgentReplyAt,
    hasPendingCustomerReply,
    assignedAt,
    createdAt: firstPresent(raw, ["created", "createdAt", "timestamp"]),
    waitingMinutes: hasPendingCustomerReply ? minutesBetween(lastCustomerMessageAt) : 0,
    replyDelayMinutes: hasPendingCustomerReply ? minutesBetween(lastCustomerMessageAt) : 0,
    assignedAgeMinutes: minutesBetween(assignedAt),
    sessionAgeMinutes: minutesBetween(lastCustomerMessageAt),
    raw
  };
}

function normalizeTags(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((tag) => (typeof tag === "string" ? tag : tag.name || tag.title || tag.value)).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((tag) => tag.trim()).filter(Boolean);
  }
  return [];
}

function inferProgram({ tags, customAttributes, team, text }, config = {}) {
  const explicit = firstPresent(customAttributes, ["program", "course", "category", "leadType"]);
  if (explicit) return explicit;

  const haystack = [team, text, ...tags].filter(Boolean).join(" ").toLowerCase();
  for (const program of config.programTags || []) {
    if (haystack.includes(program.toLowerCase())) return program;
  }
  return "General";
}

function summarize(conversations, config = {}) {
  const now = new Date();
  const replySla = config.replySlaMinutes || 15;
  const unassignedSla = config.unassignedSlaMinutes || 5;
  const expiryWarning = config.expiryWarningMinutes || 120;
  const expiryCritical = config.expiryCriticalMinutes || 30;
  const adminTeams = new Set((config.adminTeamNames || ["Admin"]).map((item) => item.toLowerCase()));

  const normalized = conversations.map((item) => normalizeConversation(item, config));
  const open = normalized.filter((item) => !/closed|resolved/i.test(String(item.status)));
  const unassigned = open.filter((item) => item.hasPendingCustomerReply && !item.assignedTo && !item.assignedEmail);
  const adminHeld = open.filter((item) => adminTeams.has(String(item.team).toLowerCase()) || /admin/i.test(String(item.assignedTo || "")));
  const delayed = open.filter((item) => item.hasPendingCustomerReply && (item.waitingMinutes || 0) >= replySla);
  const unassignedBreaches = unassigned.filter((item) => (item.waitingMinutes || 0) >= unassignedSla);
  const aboutToExpire = open.filter((item) => {
    if (item.sessionAgeMinutes === null) return false;
    const remaining = 24 * 60 - item.sessionAgeMinutes;
    return remaining <= expiryWarning && remaining > 0;
  });
  const criticalExpiry = open.filter((item) => {
    if (item.sessionAgeMinutes === null) return false;
    const remaining = 24 * 60 - item.sessionAgeMinutes;
    return remaining <= expiryCritical && remaining > 0;
  });

  return {
    generatedAt: now.toISOString(),
    totals: {
      open: open.length,
      unassigned: unassigned.length,
      adminHeld: adminHeld.length,
      delayedReplies: delayed.length,
      unassignedBreaches: unassignedBreaches.length,
      aboutToExpire: aboutToExpire.length,
      criticalExpiry: criticalExpiry.length,
      oldestAssignedMinutes: max(open.filter((item) => item.assignedTo).map((item) => item.assignedAgeMinutes)),
      oldestUnassignedMinutes: max(unassigned.map((item) => item.waitingMinutes)),
      lastAssignedAt: latest(open.map((item) => item.assignedAt))
    },
    teams: groupBy(open, "team", replySla),
    agents: groupBy(open, "assignedTo", replySla),
    programs: groupBy(open, "program", replySla),
    actionRequired: open
      .map((item) => ({
        ...item,
        expiryRemainingMinutes: item.sessionAgeMinutes === null ? null : 24 * 60 - item.sessionAgeMinutes,
        risk: riskLevel(item, { replySla, unassignedSla, expiryCritical })
      }))
      .filter((item) => item.risk !== "normal")
      .sort((a, b) => riskWeight(b.risk) - riskWeight(a.risk) || (b.waitingMinutes || 0) - (a.waitingMinutes || 0))
      .slice(0, 50)
  };
}

function groupBy(items, key, replySla) {
  const groups = new Map();
  for (const item of items) {
    const name = item[key] || "Unassigned";
    if (!groups.has(name)) {
      groups.set(name, {
        name,
        open: 0,
        unassigned: 0,
        delayedReplies: 0,
        aboutToExpire: 0,
        oldestWaitingMinutes: 0,
        lastAssignedAt: null
      });
    }

    const group = groups.get(name);
    group.open += 1;
    if (!item.assignedTo && !item.assignedEmail) group.unassigned += 1;
    if (item.hasPendingCustomerReply && (item.waitingMinutes || 0) >= replySla) group.delayedReplies += 1;
    if (item.sessionAgeMinutes !== null && 24 * 60 - item.sessionAgeMinutes <= 120) group.aboutToExpire += 1;
    group.oldestWaitingMinutes = Math.max(group.oldestWaitingMinutes, item.waitingMinutes || 0);
    group.lastAssignedAt = latest([group.lastAssignedAt, item.assignedAt]);
  }

  return Array.from(groups.values()).sort((a, b) => b.open - a.open);
}

function riskLevel(item, config) {
  const wait = item.waitingMinutes || 0;
  const remaining = item.sessionAgeMinutes === null ? Infinity : 24 * 60 - item.sessionAgeMinutes;
  if (!item.hasPendingCustomerReply) return "normal";
  if (!item.assignedTo && wait >= config.unassignedSla) return "critical";
  if (remaining <= config.expiryCritical) return "critical";
  if (wait >= config.replySla * 2) return "critical";
  if (wait >= config.replySla) return "warning";
  return "normal";
}

function riskWeight(risk) {
  return { critical: 3, warning: 2, normal: 1 }[risk] || 0;
}

function max(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  return clean.length ? Math.max(...clean) : null;
}

function latest(values) {
  const dates = values.map(parseDate).filter(Boolean).sort((a, b) => b.getTime() - a.getTime());
  return dates[0] ? dates[0].toISOString() : null;
}

module.exports = {
  normalizeConversation,
  summarize
};
