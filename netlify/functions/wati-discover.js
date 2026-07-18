const { json, client } = require("./_shared");

exports.handler = async () => {
  const wati = client();
  if (!wati.isConfigured()) return json({ ok: false, error: "WATI_NOT_CONFIGURED" }, 400);
  return json({ ok: true, results: await wati.discover() });
};
