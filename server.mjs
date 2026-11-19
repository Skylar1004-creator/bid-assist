import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lookupNotices } from "./js/lookup.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5179);
const DECISIONS_PATH = path.join(__dirname, "data", "decisions.json");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function ensureDecisions() {
  try {
    await fs.access(DECISIONS_PATH);
  } catch {
    await fs.writeFile(DECISIONS_PATH, "[]", "utf8");
  }
}

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      return send(res, 200, JSON.stringify({ ok: true }), TYPES[".json"]);
    }

    if (req.method === "GET" && url.pathname === "/api/lookup") {
      const q = url.searchParams.get("q") || "";
      const result = await lookupNotices(q);
      return send(res, 200, JSON.stringify(result), TYPES[".json"]);
    }

    if (req.method === "GET" && url.pathname === "/api/decisions") {
      await ensureDecisions();
      const raw = await fs.readFile(DECISIONS_PATH, "utf8");
      return send(res, 200, raw, TYPES[".json"]);
    }

    if (req.method === "POST" && url.pathname === "/api/decisions") {
      await ensureDecisions();
      const body = JSON.parse(await readBody(req));
      if (!body?.amount || !body?.noticeId) {
        return send(res, 400, JSON.stringify({ error: "invalid" }), TYPES[".json"]);
      }
      const prev = JSON.parse(await fs.readFile(DECISIONS_PATH, "utf8"));
      prev.unshift({
        ...body,
        savedAt: body.savedAt || new Date().toISOString(),
      });
      await fs.writeFile(DECISIONS_PATH, JSON.stringify(prev.slice(0, 200), null, 2), "utf8");
      return send(res, 200, JSON.stringify({ ok: true }), TYPES[".json"]);
    }

    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";
    const filePath = path.normalize(path.join(__dirname, pathname));
    if (!filePath.startsWith(__dirname)) {
      return send(res, 403, "Forbidden");
    }

    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    return send(res, 200, data, TYPES[ext] || "application/octet-stream");
  } catch (err) {
    if (err?.code === "ENOENT") return send(res, 404, "Not found");
    console.error(err);
    return send(res, 500, "Server error");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`투찰 구간 보조: http://localhost:${PORT}`);
});
