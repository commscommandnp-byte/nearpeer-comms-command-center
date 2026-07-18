const { csv } = require("./env");
const { normalizeConversation } = require("./wati-metrics");

const PROGRAM_LANES = ["CSS", "MDCAT", "CA"];

function opsConfig() {
  return {
    activeCounselors: new Set(csv("WATI_ACTIVE_COUNSELORS", []).map((name) => normalizeName(name))),
    adminNames: csv("WATI_ADMIN_OWNER_NAMES", ["Admin Team", "Admin Account", "Admin"]).map((name) => normalizeName(name)),
    accessRoles: ["Access", "Support"]
  };
}

function buildOpsLanes(conversations, metricConfig = {}, config = opsConfig()) {
  const normalized = conversations.map((item) => normalizeConversation(item, metricConfig));
  const open = normalized.filter((item) => !/closed|resolved|solved|blocked/i.test(String(item.status)));
  const admin = buildAdminLane(open, config);
  const programs = PROGRAM_LANES.map((program) => buildProgramLane(open, program, config));
  const access = buildAccessLane(open, config);

  return {
    generatedAt: new Date().toISOString(),
    admin,
    programs,
    access,
    activeCounselorsConfigured: config.activeCounselors.size > 0
  };
}

function buildAdminLane(items, config) {
  const adminItems = items.filter((item) => isAdminItem(item, config));
  const pendingDispatch = adminItems.filter((item) => item.hasPendingCustomerReply && !hasRealOwner(item, config));
  const activeExpiring = adminItems.filter((item) => isExpiring(item));

  return {
    name: "Admin dispatch",
    assignedToAdmin: adminItems.length,
    pendingDispatch: pendingDispatch.length,
    activeExpiring: activeExpiring.length,
    firstPendingAt: earliest(pendingDispatch.map((item) => item.lastCustomerMessageAt || item.createdAt)),
    lastPendingAt: latest(pendingDispatch.map((item) => item.lastCustomerMessageAt || item.createdAt)),
    oldestWaitingMinutes: max(pendingDispatch.map((item) => item.waitingMinutes)),
    rows: pendingDispatch.slice(0, 8).map(toLaneRow)
  };
}

function buildProgramLane(items, program, config) {
  const laneItems = items.filter((item) => normalizeProgram(item.program) === program);
  const waiting = laneItems.filter((item) => item.hasPendingCustomerReply);
  const catered = laneItems.filter((item) => !item.hasPendingCustomerReply);
  const assignedToActive = laneItems.filter((item) => isActiveCounselor(item.counselor, config));
  const assignedToInactive = config.activeCounselors.size
    ? laneItems.filter((item) => item.counselor && !isActiveCounselor(item.counselor, config))
    : [];

  return {
    name: program,
    assigned: laneItems.length,
    waiting: waiting.length,
    catered: catered.length,
    firstAssignedAt: earliest(laneItems.map((item) => item.assignedAt || item.createdAt || item.lastCustomerMessageAt)),
    lastAssignedAt: latest(laneItems.map((item) => item.assignedAt || item.createdAt || item.lastCustomerMessageAt)),
    oldestWaitingMinutes: max(waiting.map((item) => item.waitingMinutes)),
    activeCounselorAssigned: assignedToActive.length,
    inactiveCounselorAssigned: assignedToInactive.length,
    activeCounselorsKnown: config.activeCounselors.size > 0,
    rows: waiting.slice(0, 8).map(toLaneRow)
  };
}

function buildAccessLane(items, config) {
  const laneItems = items.filter((item) => {
    const attrs = item.raw?.customAttributes || item.raw?.custom_attributes || {};
    const issue = String(attrs.issueCategory || "").toLowerCase();
    const role = String(attrs.ownerRole || item.team || "").toLowerCase();
    return config.accessRoles.some((entry) => role.includes(entry.toLowerCase())) || /access|login|technical|support/.test(issue);
  });
  const waiting = laneItems.filter((item) => item.hasPendingCustomerReply);
  const catered = laneItems.filter((item) => !item.hasPendingCustomerReply);

  return {
    name: "Access & Support",
    assigned: laneItems.length,
    waiting: waiting.length,
    catered: catered.length,
    firstAssignedAt: earliest(laneItems.map((item) => item.assignedAt || item.createdAt || item.lastCustomerMessageAt)),
    lastAssignedAt: latest(laneItems.map((item) => item.assignedAt || item.createdAt || item.lastCustomerMessageAt)),
    issueBreakdown: issueBreakdown(laneItems),
    rows: waiting.slice(0, 8).map(toLaneRow)
  };
}

function toLaneRow(item) {
  return {
    studentName: item.studentName,
    phone: item.phone,
    program: item.program,
    team: item.team,
    owner: item.assignedTo || "Unassigned",
    counselor: item.counselor || "-",
    waitingMinutes: item.waitingMinutes,
    lastCustomerMessageAt: item.lastCustomerMessageAt
  };
}

function issueBreakdown(items) {
  const map = new Map();
  for (const item of items) {
    const attrs = item.raw?.customAttributes || item.raw?.custom_attributes || {};
    const name = attrs.issueCategory || "General";
    map.set(name, (map.get(name) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function isAdminItem(item, config) {
  const team = normalizeName(item.team);
  const owner = normalizeName(item.assignedTo);
  return /admin/.test(team) || config.adminNames.some((name) => owner.includes(name) || team.includes(name));
}

function hasRealOwner(item, config) {
  const owner = normalizeName(item.assignedTo);
  if (!owner) return false;
  return !config.adminNames.some((name) => owner.includes(name));
}

function isExpiring(item) {
  if (item.sessionAgeMinutes === null || item.sessionAgeMinutes === undefined) return false;
  const remaining = 24 * 60 - item.sessionAgeMinutes;
  return remaining > 0 && remaining <= 120;
}

function isActiveCounselor(name, config) {
  if (!name || !config.activeCounselors.size) return false;
  return config.activeCounselors.has(normalizeName(name));
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeProgram(value) {
  const raw = String(value || "").toUpperCase();
  if (raw.includes("MDCAT")) return "MDCAT";
  if (raw.includes("CSS") || raw.includes("PMS")) return "CSS";
  if (raw === "CA" || raw.includes("ACCA")) return "CA";
  return raw || "GENERAL";
}

function max(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  return clean.length ? Math.max(...clean) : null;
}

function earliest(values) {
  return sortDates(values).reverse()[0]?.toISOString() || null;
}

function latest(values) {
  return sortDates(values)[0]?.toISOString() || null;
}

function sortDates(values) {
  return values
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());
}

module.exports = {
  buildOpsLanes,
  opsConfig
};
