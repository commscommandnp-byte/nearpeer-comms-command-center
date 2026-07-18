function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").replace(/\/+$/, "");
}

function normalizeToken(token) {
  return String(token || "").trim().replace(/^Bearer\s+/i, "");
}

function buildCandidateUrls(baseUrl, endpoint) {
  const cleanBase = normalizeBaseUrl(baseUrl);
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const candidates = new Set();

  candidates.add(`${cleanBase}${cleanEndpoint}`);
  if (!cleanBase.includes("/api")) candidates.add(`${cleanBase}/api/v1${cleanEndpoint}`);
  if (!cleanBase.includes("/api")) candidates.add(`${cleanBase}/api/v2${cleanEndpoint}`);
  if (!cleanBase.includes("/api")) candidates.add(`${cleanBase}/api/v3${cleanEndpoint}`);

  return Array.from(candidates);
}

class WatiClient {
  constructor({ baseUrl, token, fetchImpl = fetch }) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.token = normalizeToken(token);
    this.fetch = fetchImpl;
  }

  isConfigured() {
    return Boolean(this.baseUrl && this.token && !this.token.includes("replace_with"));
  }

  async request(endpoint, options = {}) {
    if (!this.isConfigured()) {
      const error = new Error("WATI_BASE_URL and WATI_API_TOKEN are required.");
      error.code = "WATI_NOT_CONFIGURED";
      throw error;
    }

    const urls = options.exactUrl ? [options.exactUrl] : buildCandidateUrls(this.baseUrl, endpoint);
    const failures = [];

    for (const url of urls) {
      const response = await this.fetch(url, {
        method: options.method || "GET",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          ...(options.headers || {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
      });

      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { raw: text };
      }

      if (response.ok) {
        return {
          ok: true,
          url,
          status: response.status,
          data
        };
      }

      failures.push({
        url,
        status: response.status,
        body: data
      });

      if (![404, 405].includes(response.status)) break;
    }

    const error = new Error(`WATI request failed for ${endpoint}`);
    error.code = "WATI_REQUEST_FAILED";
    error.failures = failures;
    throw error;
  }

  async discover() {
    const endpoints = [
      { name: "v3 contacts", endpoint: "/api/ext/v3/contacts?page_number=1&page_size=10", exactPath: true },
      { name: "v1 contacts", endpoint: "/api/v1/getContacts?pageSize=10&pageNumber=1", exactPath: true },
      { name: "v1 messages", endpoint: "/api/v1/getMessages?pageSize=10&pageNumber=1", exactPath: true },
      { name: "operators", endpoint: "/api/v1/operators", exactPath: true },
      { name: "teams", endpoint: "/api/v1/teams", exactPath: true },
      { name: "tickets", endpoint: "/api/v1/tickets", exactPath: true },
      { name: "conversations", endpoint: "/api/v1/conversations", exactPath: true }
    ];

    const results = [];
    for (const item of endpoints) {
      try {
        const response = await this.request(item.endpoint, item.exactPath ? { exactUrl: `${this.baseUrl}${item.endpoint}` } : {});
        results.push({
          ...item,
          ok: true,
          url: response.url,
          status: response.status,
          shape: describeShape(response.data),
          sample: sanitizeSample(response.data)
        });
      } catch (error) {
        results.push({
          ...item,
          ok: false,
          error: error.code || error.message,
          failures: error.failures || []
        });
      }
    }

    return results;
  }
}

function describeShape(value) {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value && typeof value === "object") {
    return `object(${Object.keys(value).slice(0, 12).join(", ")})`;
  }
  return typeof value;
}

function sanitizeSample(value) {
  const seen = new WeakSet();
  const scrub = (input, depth = 0) => {
    if (depth > 2) return "[truncated]";
    if (Array.isArray(input)) return input.slice(0, 2).map((item) => scrub(item, depth + 1));
    if (input && typeof input === "object") {
      if (seen.has(input)) return "[circular]";
      seen.add(input);

      const output = {};
      for (const [key, item] of Object.entries(input).slice(0, 20)) {
        if (/token|authorization|secret|password|key/i.test(key)) {
          output[key] = "[redacted]";
        } else {
          output[key] = scrub(item, depth + 1);
        }
      }
      return output;
    }
    return input;
  };

  return scrub(value);
}

module.exports = {
  WatiClient,
  buildCandidateUrls,
  sanitizeSample
};
