const { json, client } = require("./_shared");

exports.handler = async () =>
  json({
    ok: true,
    watiConfigured: client().isConfigured(),
    generatedAt: new Date().toISOString()
  });
