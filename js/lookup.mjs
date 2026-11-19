import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inferKind, inferNoticeKey, inferRegion } from "./calc.js";
import { scrapeByBizNo } from "./scrape-notice.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const BID_BASE = "https://apis.data.go.kr/1230000/ad/BidPublicInfoService";

async function loadEnv() {
  try {
    const text = await fs.readFile(path.join(ROOT, ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      const val = m[2].replace(/^['"]|['"]$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* no .env */
  }
}

function num(v) {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function itemsOf(payload) {
  const body = payload?.response?.body;
  if (!body) return [];
  const raw = body.items?.item ?? body.item ?? [];
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}

function looksLikeBizNo(q) {
  return /^[A-Za-z]\d{2}[A-Za-z]{0,3}\d{5,}$/i.test(q.replace(/\s/g, "")) || /^R\d+/i.test(q);
}

function mapNotice(row, extra = {}) {
  const title = row.bidNtceNm || row.ntceNm || extra.title || "";
  const agency = row.dminsttNm || row.ntceInsttNm || extra.agency || "";
  const base =
    num(row.bssamt) ||
    num(row.presmptPrce) ||
    num(row.asignBdgtAmt) ||
    num(extra.base) ||
    null;
  const floorRateRaw = num(row.rsrvtnPrceRngBgnRate) || num(extra.floorRate);
  const method = row.cntrctCnclsMthdNm || row.bidMethdNm || extra.method || "추첨";
  return {
    bidNtceNo: row.bidNtceNo || extra.bidNtceNo || null,
    bidNtceOrd: row.bidNtceOrd || "00",
    refNo: row.refNo || extra.refNo || null,
    title,
    agency,
    method,
    baseAmount: base,
    floorRate: floorRateRaw != null ? (floorRateRaw > 1 ? floorRateRaw / 100 : floorRateRaw) : null,
    region: inferRegion(agency, row.prtcptLmtRgnNm || ""),
    kind: inferKind(title),
    noticeKey: inferNoticeKey(title, agency),
    source: extra.source || "openapi",
  };
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchBaseAmount(key, bidNtceNo) {
  if (!bidNtceNo) return null;
  const q = new URLSearchParams({
    serviceKey: key,
    pageNo: "1",
    numOfRows: "10",
    inqryDiv: "2",
    type: "json",
    bidNtceNo,
  });
  try {
    const data = await fetchJson(`${BID_BASE}/getBidPblancListInfoServcBsisAmount?${q}`);
    const item = itemsOf(data)[0];
    return item ? num(item.bssamt) || num(item.presmptPrce) : null;
  } catch {
    return null;
  }
}

async function searchOpenApi(key, query) {
  const q = query.trim();
  const params = new URLSearchParams({
    serviceKey: key,
    pageNo: "1",
    numOfRows: "20",
    inqryDiv: "1",
    type: "json",
  });

  // 최근 90일 창을 7일씩 나눠 검색 (API 기간 제한)
  const end = new Date();
  const collected = [];
  for (let i = 0; i < 13 && collected.length < 20; i++) {
    const to = new Date(end);
    to.setDate(to.getDate() - i * 7);
    const from = new Date(to);
    from.setDate(from.getDate() - 7);
    const p = (d) => {
      const x = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}${x(d.getMonth() + 1)}${x(d.getDate())}${x(d.getHours())}${x(d.getMinutes())}`;
    };
    const local = new URLSearchParams(params);
    local.set("inqryBgnDt", p(from));
    local.set("inqryEndDt", p(to));
    if (looksLikeBizNo(q)) local.set("refNo", q.replace(/\s/g, ""));
    else local.set("bidNtceNm", q);

    try {
      const data = await fetchJson(`${BID_BASE}/getBidPblancListInfoServcPPSSrch?${local}`);
      for (const row of itemsOf(data)) {
        const title = row.bidNtceNm || "";
        const ref = row.refNo || "";
        if (looksLikeBizNo(q)) {
          if (!ref.includes(q.replace(/\s/g, "")) && !String(row.bidNtceNo || "").includes(q)) continue;
        } else if (!title.includes(q) && !q.split(/\s+/).every((t) => t.length < 2 || title.includes(t))) {
          // 부분 일치: 쿼리 전체가 제목에 있거나, 긴 토큰이 포함
          const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
          if (!tokens.some((t) => title.includes(t))) continue;
        }
        collected.push(row);
      }
    } catch {
      /* window skip */
    }
  }

  const uniq = new Map();
  for (const row of collected) {
    const id = `${row.bidNtceNo}-${row.bidNtceOrd || "00"}`;
    if (!uniq.has(id)) uniq.set(id, row);
  }

  const mapped = [];
  for (const row of uniq.values()) {
    const m = mapNotice(row);
    if (!m.baseAmount && m.bidNtceNo) {
      m.baseAmount = await fetchBaseAmount(key, m.bidNtceNo);
    }
    mapped.push(m);
  }
  return mapped;
}

async function searchLocal(query) {
  const q = query.trim().toLowerCase();
  const catalogPath = path.join(ROOT, "data", "catalog.json");
  const historyPath = path.join(ROOT, "data", "history.json");
  let rows = [];
  try {
    rows = rows.concat(JSON.parse(await fs.readFile(catalogPath, "utf8")));
  } catch {
    /* optional */
  }
  try {
    const hist = JSON.parse(await fs.readFile(historyPath, "utf8"));
    for (const item of hist.items || []) {
      rows.push({
        title: item.title,
        agency: item.agency,
        method: "추첨",
        baseAmount: item.base,
        floorRate: 0.8785,
        region: item.region,
        kind: item.kind,
        noticeKey: item.noticeKey,
        refNo: item.refNo || null,
        bidNtceNo: item.bidNtceNo || null,
        source: "local",
      });
    }
  } catch {
    /* optional */
  }

  const scored = rows
    .map((r) => {
      const title = (r.title || "").toLowerCase();
      const ref = String(r.refNo || r.bidNtceNo || "").toLowerCase();
      let score = 0;
      if (ref && (ref === q || ref.includes(q))) score += 100;
      if (title === q) score += 90;
      if (title.includes(q)) score += 50;
      for (const t of q.split(/\s+/).filter((x) => x.length >= 2)) {
        if (title.includes(t)) score += 8;
      }
      return { ...r, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);

  return scored.map((r) =>
    mapNotice(
      {
        bidNtceNm: r.title,
        dminsttNm: r.agency,
        cntrctCnclsMthdNm: r.method,
        bssamt: r.baseAmount,
        bidNtceNo: r.bidNtceNo,
        refNo: r.refNo,
      },
      { ...r, source: r.source || "local" },
    ),
  );
}

export async function lookupNotices(query) {
  await loadEnv();
  const q = String(query || "").trim();
  if (!q) return { query: q, results: [], source: "none" };

  const local = await searchLocal(q);
  if (local.length) {
    return {
      query: q,
      results: local.slice(0, 20),
      source: "local",
      hasApiKey: Boolean(process.env.DATA_GO_KR_SERVICE_KEY || process.env.SERVICE_KEY),
    };
  }

  // 로컬에 없으면 사업번호로 공개 페이지에서 가져옴
  let scraped = [];
  let scrapeWarning = null;
  if (looksLikeBizNo(q)) {
    try {
      const notice = await scrapeByBizNo(q);
      if (notice) scraped = [notice];
    } catch (err) {
      scrapeWarning = String(err.message || err);
    }
  }

  const key = process.env.DATA_GO_KR_SERVICE_KEY || process.env.SERVICE_KEY;
  let remote = [];
  if (!scraped.length && key) {
    try {
      remote = await searchOpenApi(key, q);
    } catch (err) {
      scrapeWarning = [scrapeWarning, String(err.message || err)].filter(Boolean).join(" | ");
    }
  }

  const merged = new Map();
  for (const r of [...scraped, ...remote, ...local]) {
    const id = r.bidNtceNo || r.refNo || r.title;
    if (!merged.has(id)) merged.set(id, r);
  }

  let source = "none";
  if (scraped.length) source = "scrape";
  else if (remote.length) source = "openapi";
  else if (local.length) source = "local";

  return {
    query: q,
    results: [...merged.values()].slice(0, 20),
    source,
    hasApiKey: Boolean(key),
    warning: scrapeWarning,
  };
}
