function supabaseConfig() {
  return {
    url: String(process.env.SUPABASE_URL || "").replace(/\/+$/, ""),
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || ""
  };
}

function isSupabaseConfigured(config = supabaseConfig()) {
  return Boolean(config.url && config.serviceRoleKey);
}

async function supabaseRequest(path, options = {}) {
  const config = supabaseConfig();
  if (!isSupabaseConfigured(config)) {
    const error = new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
    error.code = "SUPABASE_NOT_CONFIGURED";
    throw error;
  }

  const response = await fetch(`${config.url}/rest/v1${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=minimal",
      ...(options.headers || {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(`Supabase request failed: ${response.status}`);
    error.code = "SUPABASE_REQUEST_FAILED";
    error.status = response.status;
    error.body = data;
    throw error;
  }

  return data;
}

async function upsertRows(table, rows, onConflict) {
  const list = Array.isArray(rows) ? rows : [rows];
  if (!list.length) return null;
  const conflict = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : "";
  return supabaseRequest(`/${table}${conflict}`, {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: list
  });
}

module.exports = {
  isSupabaseConfigured,
  supabaseConfig,
  supabaseRequest,
  upsertRows
};
