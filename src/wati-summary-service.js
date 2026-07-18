const { csv, number } = require("./env");
const { WatiClient } = require("./wati-client");
const { summarize } = require("./wati-metrics");
const { isSupabaseConfigured, supabaseRequest } = require("./supabase-client");

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
  if (supabase.ok && supabase.summary.totals.open > 0) return supabase;

  if (!client.isConfigured()) {
    return {
      ok: true,
      mode: "sample",
      note: "Add WATI credentials to switch this screen to live data.",
      summary: summarize(sampleConversations(), config)
    };
  }

  try {
    const discovery = await client.discover();
    const usable = discovery.find((item) => item.ok && ["conversations", "tickets", "messages", "contacts"].includes(item.name));
    if (!usable) {
      return {
        ok: false,
        mode: "sample",
        error: "No usable WATI list endpoint found yet.",
        discovery,
        summary: summarize(sampleConversations(), config)
      };
    }

    const response = await client.request(usable.endpoint);
    const records = extractRecords(response.data);
    return {
      ok: true,
      mode: "live-discovery",
      source: usable.name,
      summary: summarize(records.length ? records : sampleConversations(), config),
      discovery
    };
  } catch (error) {
    return {
      ok: false,
      mode: "sample",
      error: error.code || error.message,
      summary: summarize(sampleConversations(), config)
    };
  }
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
    syncedConversations: rows.length
  };
}

function mapSupabaseConversation(row) {
  return {
    conversationId: row.id,
    ticketId: row.ticket_id,
    waId: row.wa_id,
    senderName: row.student_name,
    teamName: row.team_id || "Unmapped",
    operatorName: row.assigned_agent_id,
    program: row.program,
    status: row.status || "open",
    tags: row.tags || [],
    customAttributes: row.custom_attributes || {},
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

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60000).toISOString();
}

function sampleConversations() {
  return [
    {
      conversationId: "sample-001",
      senderName: "Ali Raza",
      waId: "923001111111",
      teamName: "Admin",
      operatorName: "",
      tags: ["CSS"],
      text: "I paid but nobody assigned my lead",
      created: minutesAgo(18),
      lastCustomerMessageAt: minutesAgo(18)
    },
    {
      conversationId: "sample-002",
      senderName: "Maham Khan",
      waId: "923002222222",
      teamName: "Access",
      operatorName: "Danish Access",
      operatorEmail: "danish@nearpeer.org",
      tags: ["Access", "MDCAT"],
      lastCustomerMessageAt: minutesAgo(42),
      lastAgentReplyAt: minutesAgo(71),
      assignedAt: minutesAgo(76)
    },
    {
      conversationId: "sample-003",
      senderName: "Usman Tariq",
      waId: "923003333333",
      teamName: "Counseling",
      operatorName: "Hamza CSS",
      operatorEmail: "hamza@nearpeer.org",
      tags: ["CSS"],
      lastCustomerMessageAt: minutesAgo(8),
      lastAgentReplyAt: minutesAgo(20),
      assignedAt: minutesAgo(27)
    },
    {
      conversationId: "sample-004",
      senderName: "Hira Shah",
      waId: "923004444444",
      teamName: "Counseling",
      operatorName: "Fatima CA",
      tags: ["CA"],
      lastCustomerMessageAt: minutesAgo(1418),
      lastAgentReplyAt: minutesAgo(1435),
      assignedAt: minutesAgo(1440)
    },
    {
      conversationId: "sample-005",
      senderName: "Bilal Ahmed",
      waId: "923005555555",
      teamName: "Admin",
      operatorName: "Admin Account",
      tags: ["MDCAT", "Payment"],
      lastCustomerMessageAt: minutesAgo(31),
      assignedAt: minutesAgo(29)
    }
  ];
}

module.exports = {
  extractRecords,
  getWatiSummary,
  getSupabaseSummary,
  metricConfig,
  sampleConversations,
  watiClient
};
