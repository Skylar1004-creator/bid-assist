/**
 * 나라장터 OpenAPI → data/history.json
 *
 * 필요:
 *  - 공공데이터포털 인증키 (Decoding)
 *  - 입찰공고정보서비스 + 낙찰정보서비스 활용신청
 *
 * 사용: npm run sync -- --days 90 --keyword 석면
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inferKind, inferNoticeKey, inferRegion } from "./js/calc.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, "data", "history.json");

const AWARD_BASE = "https://apis.data.go.kr/1230000/as/ScsbidInfoService";

function loadEnvFile() {
  return fs
    .readFile(path.join(__dirname, ".env"), "utf8")
    .then((text) => {
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        const key = m[1];
        let val = m[2].replace(/^['"]|['"]$/g, "");
        if (!process.env[key]) process.env[key] = val;
      }
    })
    .catch(() => {});
}

function parseArgs(argv) {
  const out = { days: 90, keyword: "석면", sleepMs: 220 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--days") out.days = Number(argv[++i]) || out.days;
    else if (a === "--keyword") out.keyword = argv[++i] || out.keyword;
    else if (a === "--sleep") out.sleepMs = Number(argv[++i]) || out.sleepMs;
  }
  return out;
}

function fmtDt(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
}

function* windows(days, size = 7) {
  const end = new Date();
  end.setMinutes(59, 0, 0);
  let cursor = new Date(end);
  cursor.setDate(cursor.getDate() - days);
  cursor.setHours(0, 0, 0, 0);
  while (cursor < end) {
    const from = new Date(cursor);
    const to = new Date(cursor);
    to.setDate(to.getDate() + size);
    if (to > end) to.setTime(end.getTime());
    yield { from, to };
    cursor = new Date(to);
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

function itemsOf(payload) {
  const body = payload?.response?.body;
  if (!body) return { total: 0, items: [] };
  const raw = body.items?.item ?? body.item ?? [];
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return { total: Number(body.totalCount || items.length), items };
}

async function fetchAllPages(buildUrl, { sleepMs }) {
  const firstUrl = buildUrl(1);
  const first = await fetchJson(firstUrl);
  const { total, items } = itemsOf(first);
  const all = [...items];
  const pageSize = 100;
  const pages = Math.ceil(total / pageSize) || 1;
  for (let page = 2; page <= pages; page++) {
    await sleep(sleepMs);
    const next = await fetchJson(buildUrl(page));
    all.push(...itemsOf(next).items);
  }
  return all;
}

function num(v) {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function toDateStr(v) {
  if (!v) return null;
  const s = String(v).replace(/\D/g, "");
  if (s.length < 8) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function mapAward(row) {
  const title = row.bidNtceNm || row.ntceNm || "";
  const agency = row.dminsttNm || row.ntceInsttNm || "";
  const base =
    num(row.bssamt) ||
    num(row.presmptPrce) ||
    num(row.bdgtAmt) ||
    num(row.totPrdprcNum) ||
    null;
  const awardAmt = num(row.sucsfbidAmt) || num(row.bidwinnrAmt);
  const rateRaw = num(row.sucsfbidRate) || num(row.bidprcrt);
  const rate =
    rateRaw != null
      ? rateRaw > 2
        ? rateRaw / 100
        : rateRaw
      : base && awardAmt
        ? awardAmt / base
        : null;

  return {
    id: `${row.bidNtceNo || "x"}-${row.bidNtceOrd || "0"}-${row.bidClsfcNo || "0"}`,
    bidNtceNo: row.bidNtceNo || null,
    title,
    agency,
    base,
    award: awardAmt,
    rate,
    kind: inferKind(title),
    region: inferRegion(agency, row.prtcptLmtRgnNm || ""),
    awardedAt: toDateStr(row.opengDate || row.fnlSucsfDate || row.rgstDt),
    noticeKey: inferNoticeKey(title, agency),
    failed: false,
    rawMethod: row.bidMethdNm || row.cntrctCnclsMthdNm || null,
  };
}

async function syncAwards({ key, days, keyword, sleepMs }) {
  const collected = [];
  for (const { from, to } of windows(days, 7)) {
    const buildUrl = (pageNo) => {
      const q = new URLSearchParams({
        serviceKey: key,
        pageNo: String(pageNo),
        numOfRows: "100",
        inqryDiv: "1",
        type: "json",
        inqryBgnDt: fmtDt(from),
        inqryEndDt: fmtDt(to),
      });
      if (keyword) q.set("bidNtceNm", keyword);
      // PPSSrch는 공고명 검색 지원. 기본 목록 API는 기간만.
      return `${AWARD_BASE}/getScsbidListSttusServcPPSSrch?${q}`;
    };

    try {
      const rows = await fetchAllPages(buildUrl, { sleepMs });
      for (const row of rows) {
        const title = row.bidNtceNm || "";
        if (keyword && !title.includes(keyword)) continue;
        const mapped = mapAward(row);
        if (!mapped.base || mapped.award == null) continue;
        if (!mapped.kind.includes("석면") && keyword === "석면") continue;
        collected.push(mapped);
      }
      console.log(`award ${fmtDt(from).slice(0, 8)}~${fmtDt(to).slice(0, 8)} → +${rows.length}`);
    } catch (err) {
      console.warn(`award window failed: ${err.message}`);
      // fallback without PPSSrch
      try {
        const buildUrl = (pageNo) => {
          const q = new URLSearchParams({
            serviceKey: key,
            pageNo: String(pageNo),
            numOfRows: "100",
            inqryDiv: "1",
            type: "json",
            inqryBgnDt: fmtDt(from),
            inqryEndDt: fmtDt(to),
          });
          return `${AWARD_BASE}/getScsbidListSttusServc?${q}`;
        };
        const rows = await fetchAllPages(buildUrl, { sleepMs });
        for (const row of rows) {
          const title = row.bidNtceNm || "";
          if (keyword && !title.includes(keyword)) continue;
          const mapped = mapAward(row);
          if (!mapped.base || mapped.award == null) continue;
          collected.push(mapped);
        }
        console.log(`award(fallback) ${fmtDt(from).slice(0, 8)} → +${rows.length}`);
      } catch (err2) {
        console.warn(`award fallback failed: ${err2.message}`);
      }
    }
    await sleep(sleepMs);
  }
  return collected;
}

async function syncFailing({ key, days, keyword, sleepMs }) {
  const collected = [];
  for (const { from, to } of windows(days, 7)) {
    const buildUrl = (pageNo) => {
      const q = new URLSearchParams({
        serviceKey: key,
        pageNo: String(pageNo),
        numOfRows: "100",
        inqryDiv: "1",
        type: "json",
        inqryBgnDt: fmtDt(from),
        inqryEndDt: fmtDt(to),
      });
      return `${AWARD_BASE}/getOpengResultListInfoFailing?${q}`;
    };
    try {
      const rows = await fetchAllPages(buildUrl, { sleepMs });
      for (const row of rows) {
        const title = row.bidNtceNm || "";
        if (keyword && !title.includes(keyword)) continue;
        const agency = row.dminsttNm || "";
        const base = num(row.bssamt) || num(row.presmptPrce);
        collected.push({
          id: `fail-${row.bidNtceNo || "x"}-${row.bidNtceOrd || "0"}`,
          bidNtceNo: row.bidNtceNo || null,
          title,
          agency,
          base,
          award: null,
          rate: null,
          kind: inferKind(title),
          region: inferRegion(agency, ""),
          awardedAt: toDateStr(row.opengDate || row.rgstDt),
          noticeKey: inferNoticeKey(title, agency),
          failed: true,
        });
      }
    } catch (err) {
      console.warn(`failing window skipped: ${err.message}`);
    }
    await sleep(sleepMs);
  }
  return collected;
}

function mergeById(items) {
  const map = new Map();
  for (const item of items) {
    if (!item.id) continue;
    map.set(item.id, item);
  }
  return [...map.values()].sort((a, b) => String(b.awardedAt).localeCompare(String(a.awardedAt)));
}

async function main() {
  await loadEnvFile();
  const args = parseArgs(process.argv.slice(2));
  const key = process.env.DATA_GO_KR_SERVICE_KEY || process.env.SERVICE_KEY;
  if (!key) {
    console.error("DATA_GO_KR_SERVICE_KEY 가 없습니다. tools/bid-assist/.env 를 만드세요.");
    process.exit(1);
  }

  console.log(`동기화 시작 · ${args.days}일 · keyword=${args.keyword}`);
  const awards = await syncAwards({ key, ...args });
  const failing = await syncFailing({ key, ...args });
  const items = mergeById([...awards, ...failing]);

  const doc = {
    source: "openapi",
    syncedAt: new Date().toISOString(),
    asOf: new Date().toISOString().slice(0, 10),
    query: args,
    items,
  };
  await fs.writeFile(DATA_PATH, JSON.stringify(doc, null, 2), "utf8");
  console.log(`저장: ${DATA_PATH} (${items.length}건)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
