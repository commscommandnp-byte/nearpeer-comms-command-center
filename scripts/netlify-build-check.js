const fs = require("fs");
const path = require("path");

const required = ["index.html", "app.js", "styles.css"];
const publicDir = path.join(process.cwd(), "public");
const missing = required.filter((file) => !fs.existsSync(path.join(publicDir, file)));

if (missing.length) {
  console.error(`Missing public assets: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("Netlify build check passed.");
