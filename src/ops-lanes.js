const { csv } = require("./env");
const { normalizeConversation } = require("./wati-metrics");

const TEAM_ACCOUNT_LANES = [
  {
    key: "css",
    name: "CSS Counseling Team",
    programs: ["CSS"],
    accountNamesEnv: "WATI_CSS_ACCOUNT_NAMES",
    defaultAccountNames: ["CSS Counseling Team", "CSS Counselors", "CSS"]
  },
  {
    key: "mdcat",
    name: "MDCAT Team",
    programs: ["MDCAT"],
    accountNamesEnv: "WATI_MDCAT_ACCOUNT_NAMES",
    defaultAccountNames: ["MDCAT Team", "MDCAT"]
  },
  {
    key: "ca",
    name: "CA Team",
    programs: ["CA"],
    accountNamesEnv: "WATI_CA_ACCOUNT_NAMES",
    defaultAccountNames: ["CA Team", "CA"]
  },
  {
    key: "shahrukh",
    name: "Shahrukh Swati",
    programs: [],
    accountNamesEnv: "WATI_SHAHRUKH_ACCOUNT_NAMES",
    defaultAccountNames: ["Shahrukh Swati"]
  }
];

function opsConfig() {
  return {
    activeCounselors: new Set(csv("WATI_ACTIVE_COUNSELORS", []).map((name) => normalizeName(name))),
    adminNames: csv("WATI_ADMIN_OWNER_NAMES", ["Admin Team", "Admin Account", "Admin"]).map((name) => normalizeName(name)),
    accessNames: csv("WATI_ACCESS_ACCOUNT_NAMES", ["Access & Support", "Access", "Support"]).map((name) => normalizeName(name))
  };
}

function buildOpsLanes(conversations, metricConfig = {}, config = opsConfig()) {
  const normalized = conversations.map((item) => normalizeConversation(item, metricConfig));
  const open = normalized.filter((item) => !/closed|resolved|solved|blocked/i.test(String(item.status)));
  const admin = buildAdminLane(open, config);
  const programs = TEAM_ACCOUNT_LANES.map((lane) => buildTeamAccountLane(open, lane, config));
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
  const unassigned = adminItems.filter((item) => isUnassigned(item));
  const pendingDispatch = adminItems.filter((item) => item.hasPendingCustomerReply);
  const activeExpiring = adminItems.filter((item) => isExpiring(item));
  const expiredTodayItems = adminItems.filter((item) => expiredToday(item));

  return {
    name: "Admin Team",
    assignedToMe: adminItems.length,
    unassigned: unassigned.length,
    pendingDispatch: pendingDispatch.length,
    activeExpiring: activeExpiring.length,
    expiredToday: expiredTodayItems.length,
    firstPendingAt: earliest(pendingDispatch.map((item) => item.lastCustomerMessageAt || item.createdAt)),
    lastPendingAt: latest(pendingDispatch.map((item) => item.lastCustomerMessageAt || item.createdAt)),
    oldestWaitingMinutes: max(pendingDispatch.map((item) => item.waitingMinutes)),
    rows: pendingDispatch.slice(0, 8).map(toLaneRow),
    aboutToExpireRows: activeExpiring
      .map(toLaneRow)
      .sort((a, b) => (a.expiryRemainingMinutes ?? Infinity) - (b.expiryRemainingMinutes ?? Infinity))
      .slice(0, 6)
  };
}

function buildTeamAccountLane(items, lane, config) {
  const accountNames = csv(lane.accountNamesEnv, lane.defaultAccountNames).map((name) => normalizeName(name));
  const laneItems = items.filter((item) => isTeamAccountItem(item, lane, accountNames));
  const waiting = laneItems.filter((item) => item.hasPendingCustomerReply);
  const catered = laneItems.filter((item) => !item.hasPendingCustomerReply);
  const assignedToActive = laneItems.filter((item) => isActiveCounselor(item.counselor, config));
  const assignedToInactive = config.activeCounselors.size
    ? laneItems.filter((item) => item.counselor && !isActiveCounselor(item.counselor, config))
    : [];
  const assignedRows = laneItems
    .map(toLaneRow)
    .sort((a, b) => new Date(b.assignedAt || 0).getTime() - new Date(a.assignedAt || 0).getTime());

  return {
    key: lane.key,
    name: lane.name,
    assignedToMe: laneItems.length,
    waiting: waiting.length,
    catered: catered.length,
    firstAssignedAt: earliest(laneItems.map((item) => item.assignedAt || item.createdAt || item.lastCustomerMessageAt)),
    lastAssignedAt: latest(laneItems.map((item) => item.assignedAt || item.createdAt || item.lastCustomerMessageAt)),
    oldestWaitingMinutes: max(waiting.map((item) => item.waitingMinutes)),
    activeCounselorAssigned: assignedToActive.length,
    inactiveCounselorAssigned: assignedToInactive.length,
    activeCounselorsKnown: config.activeCounselors.size > 0,
    lastAssignedLead: assignedRows[0] || null,
    firstAssignedLead: assignedRows[assignedRows.length - 1] || null,
    counselorBreakdown: counselorBreakdown(laneItems, config),
    rows: waiting.slice(0, 8).map(toLaneRow)
  };
}

function buildAccessLane(items, config) {
  const laneItems = items.filter((item) => {
    const attrs = item.raw?.customAttributes || item.raw?.custom_attributes || {};
    const issue = String(attrs.issueCategory || "").toLowerCase();
    const role = normalizeName(attrs.ownerRole || item.team);
    const owner = normalizeName(attrs.ownerName || item.assignedTo);
    const tags = normalizeTagsForMatch(item.tags);
    return config.accessNames.some((entry) => matchesName(owner, entry) || matchesName(role, entry) || matchesName(tags, entry)) || /access|login|technical|support/.test(issue);
  });
  const waiting = laneItems.filter((item) => item.hasPendingCustomerReply);
  const catered = laneItems.filter((item) => !item.hasPendingCustomerReply);

  return {
    name: "Access & Support",
    assignedToMe: laneItems.length,
    waiting: waiting.length,
    catered: catered.length,
    firstAssignedAt: earliest(laneItems.map((item) => item.assignedAt || item.createdAt || item.lastCustomerMessageAt)),
    lastAssignedAt: latest(laneItems.map((item) => item.assignedAt || item.createdAt || item.lastCustomerMessageAt)),
    lastAssignedLead: latestAssignedRow(laneItems),
    firstAssignedLead: earliestAssignedRow(laneItems),
    issueBreakdown: issueBreakdown(laneItems),
    rows: waiting.slice(0, 8).map(toLaneRow)
  };
}

function toLaneRow(item) {
  const expiryRemainingMinutes = item.sessionAgeMinutes === null || item.sessionAgeMinutes === undefined ? null : 24 * 60 - item.sessionAgeMinutes;
  return {
    studentName: item.studentName,
    phone: item.phone,
    program: item.program,
    team: item.team,
    owner: item.assignedTo || "Unassigned",
    counselor: item.counselor || "-",
    waitingMinutes: item.waitingMinutes,
    assignedAt: item.assignedAt || item.createdAt || item.lastCustomerMessageAt,
    lastCustomerMessageAt: item.lastCustomerMessageAt,
    expiryRemainingMinutes
  };
}

function counselorBreakdown(items, config) {
  const map = new Map();
  for (const item of items) {
    const name = item.counselor || item.assignedTo || "No counselor";
    if (!map.has(name)) {
      map.set(name, {
        name,
        count: 0,
        waiting: 0,
        active: config.activeCounselors.size ? isActiveCounselor(name, config) : null
      });
    }
    const row = map.get(name);
    row.count += 1;
    if (item.hasPendingCustomerReply) row.waiting += 1;
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
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
  const tags = normalizeTagsForMatch(item.tags);
  return /admin/.test(team) || config.adminNames.some((name) => matchesName(owner, name) || matchesName(team, name) || matchesName(tags, name));
}

function isTeamAccountItem(item, lane, accountNames) {
  const program = normalizeProgram(item.program);
  const team = normalizeName(item.team);
  const owner = normalizeName(item.assignedTo);
  const counselor = normalizeName(item.counselor);
  const tags = normalizeTagsForMatch(item.tags);
  return (
    (lane.programs.length > 0 && lane.programs.includes(program)) ||
    accountNames.some((name) => matchesName(team, name) || matchesName(owner, name) || matchesName(counselor, name) || matchesName(tags, name))
  );
}

function isUnassigned(item) {
  const owner = normalizeName(item.assignedTo);
  const email = normalizeName(item.assignedEmail);
  return (!owner && !email) || owner === "unassigned";
}

function isExpiring(item) {
  if (item.sessionAgeMinutes === null || item.sessionAgeMinutes === undefined) return false;
  const remaining = 24 * 60 - item.sessionAgeMinutes;
  return remaining > 0 && remaining <= 120;
}

function expiredToday(item, now = new Date()) {
  if (item.sessionAgeMinutes === null || item.sessionAgeMinutes === undefined) return false;
  if (item.sessionAgeMinutes < 24 * 60) return false;
  const lastCustomer = item.lastCustomerMessageAt ? new Date(item.lastCustomerMessageAt) : null;
  if (!lastCustomer || Number.isNaN(lastCustomer.getTime())) return false;
  const expiryDate = new Date(lastCustomer.getTime() + 24 * 60 * 60000);
  return expiryDate.toDateString() === now.toDateString();
}

function latestAssignedRow(items) {
  const rows = items.map(toLaneRow).filter((item) => item.assignedAt);
  return rows.sort((a, b) => new Date(b.assignedAt).getTime() - new Date(a.assignedAt).getTime())[0] || null;
}

function earliestAssignedRow(items) {
  const rows = items.map(toLaneRow).filter((item) => item.assignedAt);
  return rows.sort((a, b) => new Date(a.assignedAt).getTime() - new Date(b.assignedAt).getTime())[0] || null;
}

function isActiveCounselor(name, config) {
  if (!name || !config.activeCounselors.size) return false;
  return config.activeCounselors.has(normalizeName(name));
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeTagsForMatch(value) {
  if (!Array.isArray(value)) return "";
  return value.map((item) => normalizeName(item)).join(" | ");
}

function matchesName(haystack, needle) {
  if (!needle) return false;
  if (needle.length <= 3) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegex(needle)}($|[^a-z0-9])`, "i").test(haystack);
  }
  return haystack.includes(needle);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
