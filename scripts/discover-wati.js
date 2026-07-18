const { loadDotEnv } = require("../src/env");
const { WatiClient } = require("../src/wati-client");

loadDotEnv();

async function main() {
  const client = new WatiClient({
    baseUrl: process.env.WATI_BASE_URL,
    token: process.env.WATI_API_TOKEN
  });

  if (!client.isConfigured()) {
    console.error("WATI is not configured. Copy .env.example to .env and add WATI_BASE_URL and WATI_API_TOKEN.");
    process.exit(1);
  }

  const results = await client.discover();
  for (const result of results) {
    const status = result.ok ? "OK" : "NO";
    console.log(`${status} ${result.name} ${result.url || ""}`);
    if (result.ok) {
      console.log(`   shape: ${result.shape}`);
      console.log(`   sample: ${JSON.stringify(result.sample).slice(0, 700)}`);
    } else {
      const firstFailure = result.failures && result.failures[0];
      if (firstFailure) console.log(`   first failure: ${firstFailure.status} ${firstFailure.url}`);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
