const {
  extractRecords,
  getWatiSummary,
  metricConfig,
  watiClient
} = require("../../src/wati-summary-service");

function json(body, statusCode = 200) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

module.exports = {
  client: watiClient,
  config: metricConfig,
  extractRecords,
  getWatiSummary,
  json
};
