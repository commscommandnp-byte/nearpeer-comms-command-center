const { json } = require("./_shared");
const { syncWatiToSupabase } = require("../../src/wati-sync-service");

exports.handler = async (event) => {
  if (!["GET", "POST"].includes(event.httpMethod)) {
    return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  }

  const secret = process.env.WATI_SYNC_SECRET;
  if (secret) {
    const provided = event.headers["x-sync-secret"] || event.queryStringParameters?.secret;
    if (provided !== secret) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
  }

  try {
    return json(await syncWatiToSupabase());
  } catch (error) {
    return json({
      ok: false,
      error: error.code || error.message,
      details: error.body || error.failures || null
    }, 500);
  }
};
