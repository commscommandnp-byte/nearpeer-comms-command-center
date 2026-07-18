const { json, getWatiSummary } = require("./_shared");

exports.handler = async () => {
  return json(await getWatiSummary());
};
