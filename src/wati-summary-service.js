const { csv, number } = require("./env");
const { WatiClient } = require("./wati-client");
const { summarize } = require("./wati-metrics");
const { isSupabaseConfigured, supabaseRequest } = require("./supabase-client");
const { buildOpsLanes } = require("./ops-lanes");

function metricConfig() {
  return {
    adminTeamNames: csv("WATI_ADMIN_TEAM_NAMES", ["Admin"]),
    programTags: csv("WATI_PROGRAM_TAGS", ["CSS", "MDCAT", "CA", "Access", "Support", "Payment", "Refund"]),
    replySlaMinutes: number("WATI_REPLY_SLA_MINUTES", 15),
    unassignedSlaMinutes: number("WATI_UNASSIGNED_SLA_MINUTES", 5),
    expiryWarningMinutes: number("WATI_EXPIRY_WARNING_MINUTES", 120),
    expiryCriticalMinutes: number("WATI_EXPIRY_CRITICAL_MINUTES", 30)
  };
}

function watiClient() {
  return new WatiClient({
    baseUrl: process.env.WATI_BASE_URL,
    token: process.env.WATI_API_TOKEN
  });
}

async function getWatiSummary({ client = watiClient(), config = metricConfig() } = {}) {
  const supabase = await getSupabaseSummary(config).catch((error) => ({
    ok: false,
    error: error.code || error.message
  }));
  if (supabase.ok) return supabase;

  if (!client.isConfigured()) {
    return {
      ok: false,
      mode: "setup-required",
      error: supabase.error || "WATI_NOT_CONFIGURED",
      note: "Configure Supabase and run WATI sync to populate real data.",
      summary: summarize([], config)
    };
  }

  return {
    ok: false,
    mode: "sync-required",
    error: supabase.error || "SUPABASE_SYNC_REQUIRED",
    note: "Run /api/wati/sync to populate real WATI data.",
    summary: summarize([], config)
  };
}

async function getSupabaseSummary(config) {
  if (!isSupabaseConfigured()) {
    const error = new Error("Supabase is not configured.");
    error.code = "SUPABASE_NOT_CONFIGURED";
    throw error;
  }

  const rows = await supabaseRequest(
    "/wati_conversations?select=id,ticket_id,wa_id,student_name,team_id,assigned_agent_id,program,status,tags,custom_attributes,first_seen_at,assigned_at,last_customer_message_at,last_agent_reply_at,session_expires_at,raw,updated_at&order=updated_at.desc&limit=500",
    { headers: { Prefer: "" } }
  );

  return {
    ok: true,
    mode: rows.length ? "supabase-sync" : "supabase-empty",
    source: "supabase",
    summary: summarize(rows.map(mapSupabaseConversation), config),
    operations: buildOpsLanes(rows.map(mapSupabaseConversation), config),
    syncedConversations: rows.length
  };
}

function mapSupabaseConversation(row) {
  const attrs = row.custom_attributes || {};
  return {
    conversationId: row.id,
    ticketId: row.ticket_id,
    waId: row.wa_id,
    senderName: row.student_name,
    teamName: row.team_id || attrs.teamName || attrs.team || attrs.ownerRole || "Unmapped",
    operatorName: row.assigned_agent_id || attrs.operatorName || attrs.assignedTo || attrs.ownerName,
    operatorEmail: attrs.operatorEmail || attrs.assignedEmail,
    program: row.program,
    status: row.status || "open",
    tags: row.tags || [],
    customAttributes: attrs,
    created: row.first_seen_at || row.updated_at,
    assignedAt: row.assigned_at,
    lastCustomerMessageAt: row.last_customer_message_at,
    lastAgentReplyAt: row.last_agent_reply_at,
    raw: row.raw || row
  };
}

function extractRecords(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["data", "items", "contacts", "messages", "tickets", "conversations", "result", "results"]) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

module.exports = {
  extractRecords,
  getWatiSummary,
  getSupabaseSummary,
  metricConfig,
  watiClient
};
