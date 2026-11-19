import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inferKind, inferNoticeKey, inferRegion } from "./calc.js";
import { resolveNoticeAmounts } from "./base-amount.js";
import { scrapeByBizNo } from "./scrape-notice.mjs";
import { bizNoMatch, looksLikeBizNo, normalizeBizNo, splitBizNo } from "./biz-no.js";

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

function mapNotice(row, extra = {}) {
  const title = row.bidNtceNm || row.ntceNm || extra.title || "";
  const agency = row.dminsttNm || row.ntceInsttNm || extra.agency || "";
  const amounts = resolveNoticeAmounts({
    bssamt: row.bssamt ?? extra.bssamt ?? extra.base,
    labeledBase: extra.labeledBase,
    presmptPrce: row.presmptPrce ?? extra.presmptPrce ?? extra.estimate,
    asignBdgtAmt: row.asignBdgtAmt ?? extra.asignBdgtAmt ?? extra.budget,
  });
  const floorRateRaw = num(row.rsrvtnPrceRngBgnRate) || num(extra.floorRate);
  const method = row.cntrctCnclsMthdNm || row.bidMethdNm || extra.method || "추첨";
  return {
    bidNtceNo: row.bidNtceNo || extra.bidNtceNo || null,
    bidNtceOrd: row.bidNtceOrd || "00",
    refNo: row.refNo || extra.refNo || null,
    title,
    agency,
    method,
    baseAmount: amounts.baseAmount,
    estimateAmount: amounts.estimateAmount,
    budgetAmount: amounts.budgetAmount,
    baseSource: amounts.baseSource,
    baseIsProxy: amounts.baseIsProxy,
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

/** 기초금액 API — bssamt만. 추정가격으로 채우지 않음. */
async function fetchBaseAmountDetail(key, bidNtceNo) {
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
    if (!item) return null;
    return resolveNoticeAmounts({
      bssamt: item.bssamt,
      presmptPrce: item.presmptPrce,
      asignBdgtAmt: item.asignBdgtAmt,
    });
  } catch {
    return null;
  }
}

function rowMatchesQuery(row, q) {
  const keys = [row.refNo, row.bidNtceNo, row.bidNtceNo && row.bidNtceOrd
    ? `${row.bidNtceNo}-${row.bidNtceOrd}`
    : null].filter(Boolean);
  return keys.some((k) => bizNoMatch(k, q));
}

async function searchOpenApi(key, query) {
  const q = normalizeBizNo(query);
  const { core, ord } = splitBizNo(q);
  const collected = [];

  // 1) 공고번호 정확 조회 (2026LNF… / R26… 모두)
  if (looksLikeBizNo(q) && core.length >= 8) {
    const exact = new URLSearchParams({
      serviceKey: key,
      pageNo: "1",
      numOfRows: "20",
      inqryDiv: "2",
      type: "json",
      bidNtceNo: core,
    });
    if (ord) exact.set("bidNtceOrd", ord);
    try {
      const data = await fetchJson(`${BID_BASE}/getBidPblancListInfoServcPPSSrch?${exact}`);
      for (const row of itemsOf(data)) {
        if (rowMatchesQuery(row, q) || String(row.bidNtceNo || "").toUpperCase() === core) {
          collected.push(row);
        }
      }
    } catch {
      /* skip */
    }
    for (const op of [
      "getBidPblancListInfoServc",
      "getBidPblancListInfoCnstwk",
      "getBidPblancListInfoThng",
    ]) {
      try {
        const p = new URLSearchParams({
          serviceKey: key,
          pageNo: "1",
          numOfRows: "10",
          inqryDiv: "2",
          type: "json",
          bidNtceNo: core,
        });
        if (ord) p.set("bidNtceOrd", ord);
        const data = await fetchJson(`${BID_BASE}/${op}?${p}`);
        for (const row of itemsOf(data)) collected.push(row);
      } catch {
        /* skip */
      }
    }
  }

  // 2) 기간 검색: refNo / 부분번호
  const end = new Date();
  for (let i = 0; i < 13 && collected.length < 20; i++) {
    const to = new Date(end);
    to.setDate(to.getDate() - i * 7);
    const from = new Date(to);
    from.setDate(from.getDate() - 7);
    const p = (d) => {
      const x = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}${x(d.getMonth() + 1)}${x(d.getDate())}${x(d.getHours())}${x(d.getMinutes())}`;
    };
    const local = new URLSearchParams({
      serviceKey: key,
      pageNo: "1",
      numOfRows: "20",
      inqryDiv: "1",
      type: "json",
      inqryBgnDt: p(from),
      inqryEndDt: p(to),
    });
    if (looksLikeBizNo(q)) {
      // 긴 번호는 refNo, 짧은 뒷자리는 공고번호 필드에 넣어 봄
      if (core.length >= 10) local.set("refNo", core);
      else local.set("bidNtceNo", core);
    } else {
      local.set("bidNtceNm", q);
    }

    try {
      const data = await fetchJson(`${BID_BASE}/getBidPblancListInfoServcPPSSrch?${local}`);
      for (const row of itemsOf(data)) {
        const title = row.bidNtceNm || "";
        if (looksLikeBizNo(q)) {
          if (!rowMatchesQuery(row, q)) continue;
        } else {
          const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
          if (!title.includes(q) && !tokens.some((t) => title.includes(t))) continue;
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
    let m = mapNotice(row);
    if ((!m.baseAmount || m.baseIsProxy) && m.bidNtceNo) {
      const detail = await fetchBaseAmountDetail(key, m.bidNtceNo);
      if (detail?.baseAmount) {
        m = {
          ...m,
          baseAmount: detail.baseAmount,
          estimateAmount: detail.estimateAmount ?? m.estimateAmount,
          budgetAmount: detail.budgetAmount ?? m.budgetAmount,
          baseSource: detail.baseSource,
          baseIsProxy: detail.baseIsProxy,
        };
      }
    }
    mapped.push(m);
  }
  return mapped;
}

async function searchLocal(query) {
  const q = normalizeBizNo(query);
  const qLower = q.toLowerCase();
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
      const candidates = [r.refNo, r.bidNtceNo, r.noticeKey].filter(Boolean);
      let score = 0;
      if (candidates.some((c) => bizNoMatch(c, q))) score += 100;
      if (title === qLower) score += 90;
      if (title.includes(qLower)) score += 50;
      for (const t of qLower.split(/\s+/).filter((x) => x.length >= 2)) {
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
  const q = normalizeBizNo(query);
  if (!q) return { query: q, results: [], source: "none" };

  const local = await searchLocal(q);

  // 로컬에 있어도 번호 조회는 원격도 병행(최신 보강). 단 로컬만으로 충분하면 즉시 반환하지 않고 합침.
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
  if (key) {
    try {
      remote = await searchOpenApi(key, q);
    } catch (err) {
      scrapeWarning = [scrapeWarning, String(err.message || err)].filter(Boolean).join(" | ");
    }
  } else if (!scraped.length && !local.length && looksLikeBizNo(q)) {
    scrapeWarning = [
      scrapeWarning,
      "공공데이터 API 키가 없어 2026LNF… 형식 공고번호 조회가 제한됩니다. Vercel에 DATA_GO_KR_SERVICE_KEY를 넣으세요.",
    ]
      .filter(Boolean)
      .join(" | ");
  }

  const merged = new Map();
  for (const r of [...scraped, ...remote, ...local]) {
    const id = `${r.bidNtceNo || ""}-${r.bidNtceOrd || ""}-${r.refNo || r.title}`;
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
