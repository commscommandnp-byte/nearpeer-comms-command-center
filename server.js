const http = require("http");
const fs = require("fs");
const path = require("path");
const { loadDotEnv } = require("./src/env");
const { getWatiSummary, watiClient } = require("./src/wati-summary-service");

loadDotEnv();

const port = Number(process.env.PORT || 5058);
const publicDir = path.join(__dirname, "public");
const client = watiClient();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/health") {
      return json(res, {
        ok: true,
        watiConfigured: client.isConfigured(),
        generatedAt: new Date().toISOString()
      });
    }

    if (url.pathname === "/api/wati/discover") {
      if (!client.isConfigured()) return json(res, { ok: false, error: "WATI_NOT_CONFIGURED" }, 400);
      return json(res, { ok: true, results: await client.discover() });
    }

    if (url.pathname === "/api/wati/summary") {
      return json(res, await getWatiSummary({ client }));
    }

    return serveStatic(url.pathname, res);
  } catch (error) {
    return json(res, { ok: false, error: error.message }, 500);
  }
});

function serveStatic(pathname, res) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const target = path.normalize(path.join(publicDir, cleanPath));
  if (!target.startsWith(publicDir)) return notFound(res);
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) return notFound(res);

  const ext = path.extname(target).toLowerCase();
  const type = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  }[ext] || "application/octet-stream";

  res.writeHead(200, { "Content-Type": type });
  fs.createReadStream(target).pipe(res);
}

function json(res, body, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function notFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

server.listen(port, () => {
  console.log(`Nearpeer Comms Command Center running at http://localhost:${port}`);
});
