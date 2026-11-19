import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inferKind, inferNoticeKey, inferRegion } from "./calc.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CACHE_DIR = path.join(ROOT, "data", "cache");
const CATALOG_PATH = path.join(ROOT, "data", "catalog.json");

function num(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function wonToNumber(text) {
  if (!text) return null;
  const t = String(text).replace(/\s+/g, "");
  // 1,368만원 / 1368만원
  const man = t.match(/([\d,.]+)\s*만\s*원?/);
  if (man) return Math.round(num(man[1]) * 10_000);
  return num(t);
}

function pick(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function normalizeBizNo(raw) {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; BidAssist/1.0; +internal-research)",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

function parseJodaln(html, refNo) {
  const text = stripHtml(html);
  const title =
    pick(text, [
      /입찰공고명\s+([^\n]+?)\s+입찰공고번호/,
      /#\s*([^\n]+?석면[^\n]+)/,
    ]) ||
    pick(html, [/<h1[^>]*>([^<]+)<\/h1>/i]);

  const agency =
    pick(text, [
      /수요기관\s+([^\n]+?)\s+담당자/,
      /공고기관\s+([^\n]+?)\s+수요기관/,
      /([가-힣A-Za-z0-9 ·]+교육지원청)/,
    ]) || null;

  const budget =
    wonToNumber(pick(text, [/배정예산금액\s+([\d,]+원)/, /예산금액\s+([\d,.]+만원)/])) ||
    wonToNumber(pick(text, [/사업금액\s+([\d,.]+만원)/, /예산\s+([\d,.]+만)/]));

  const estimate =
    wonToNumber(pick(text, [/추정가격\s+([\d,]+원)/, /추정가격\s+([\d,.]+만원)/])) || null;

  const floorRaw = pick(text, [/낙찰하한율\s+([\d.]+)\s*%/]);
  const floorRate = floorRaw != null ? Number(floorRaw) / 100 : null;

  let method =
    pick(text, [
      /낙찰방법\s+(소액수의견적)/,
      /계약체결방법\s+(수의계약|일반경쟁|제한경쟁|지명경쟁)/,
      /낙찰방법\s+(적격심사|최저가|종합심사|추첨)/,
    ]) || "수의";
  method = method.replace(/\s+/g, " ").trim().slice(0, 20);

  // HTML 메타에서 예산·추정 재확인
  const budgetMeta = wonToNumber(pick(html, [/예산금액[^0-9]*([\d,]+)/, /"budget"[^0-9]*([\d,]+)/]));
  const estimateMeta = wonToNumber(pick(html, [/추정가격[^0-9]*([\d,]+)/]));

  if (!title && !budget && !budgetMeta) return null;

  const baseAmount = budget || budgetMeta || estimate || estimateMeta;
  const cleanTitle = (title || `공고 ${refNo}`).replace(/\s+/g, " ").trim().slice(0, 120);
  const cleanAgency = (agency || "-").replace(/\s+/g, " ").trim().slice(0, 80);

  return {
    title: cleanTitle,
    agency: cleanAgency,
    method,
    baseAmount,
    floorRate: floorRate ?? 0.8785,
    region: inferRegion(cleanAgency),
    kind: inferKind(cleanTitle),
    noticeKey: inferNoticeKey(cleanTitle, cleanAgency) || refNo,
    refNo,
    bidNtceNo: null,
    source: "jodaln",
    presmptPrce: estimate || estimateMeta,
  };
}

async function fetchFromJodaln(refNo) {
  const url = `https://jodaln.com/bid/${refNo}/000`;
  const html = await fetchText(url);
  if (/페이지를 찾을 수 |Not Found|404/i.test(html) && !/입찰공고명|예산금액|추정가격/.test(html)) {
    throw new Error("jodaln 404");
  }
  const parsed = parseJodaln(html, refNo);
  if (!parsed?.baseAmount && !parsed?.title) throw new Error("jodaln parse fail");
  return parsed;
}

async function fetchFromCraftspace(refNo) {
  const url = `https://jodal.craftspace.co.kr/tender/${refNo}`;
  const html = await fetchText(url);
  const text = stripHtml(html);
  const title = pick(text, [/#\s*([^\n]+)/, /([가-힣A-Za-z0-9 ·]+석면[^\n]{0,40})/]);
  const agency = pick(text, [/수요기관\s+([^\n]+)/, /([가-힣]+교육지원청)/]);
  const budget =
    wonToNumber(pick(text, [/예산\s+([\d,.]+만)/, /기초금액\s+([\d,]+원)/])) ||
    wonToNumber(pick(text, [/배정예산\s+([\d,]+원)/]));
  const floorRaw = pick(text, [/낙찰하한율\s+([\d.]+)\s*%/]);
  if (!title && !budget) throw new Error("craftspace parse fail");
  return {
    title: (title || `공고 ${refNo}`).trim(),
    agency: (agency || "-").trim(),
    method: "수의",
    baseAmount: budget,
    floorRate: floorRaw != null ? Number(floorRaw) / 100 : 0.8785,
    region: inferRegion(agency || ""),
    kind: inferKind(title || ""),
    noticeKey: inferNoticeKey(title || "", agency || "") || refNo,
    refNo,
    bidNtceNo: null,
    source: "craftspace",
  };
}

async function writeCache(notice) {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const file = path.join(CACHE_DIR, `${notice.refNo}.json`);
    await fs.writeFile(file, JSON.stringify(notice, null, 2), "utf8");
  } catch {
    /* 서버리스 등 읽기전용 파일시스템 */
  }
}

async function appendCatalog(notice) {
  try {
    let list = [];
    try {
      list = JSON.parse(await fs.readFile(CATALOG_PATH, "utf8"));
    } catch {
      list = [];
    }
    const idx = list.findIndex((x) => normalizeBizNo(x.refNo) === normalizeBizNo(notice.refNo));
    const row = {
      title: notice.title,
      agency: notice.agency,
      method: notice.method,
      baseAmount: notice.baseAmount,
      floorRate: notice.floorRate,
      region: notice.region,
      kind: notice.kind,
      refNo: notice.refNo,
      noticeKey: notice.noticeKey,
    };
    if (idx >= 0) list[idx] = { ...list[idx], ...row };
    else list.unshift(row);
    await fs.writeFile(CATALOG_PATH, JSON.stringify(list, null, 2), "utf8");
  } catch {
    /* 서버리스 등 읽기전용 파일시스템 */
  }
}

async function readCache(refNo) {
  try {
    const raw = await fs.readFile(path.join(CACHE_DIR, `${refNo}.json`), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 사업번호로 공개 공고를 가져와 캐시·카탈로그에 저장
 */
export async function scrapeByBizNo(raw) {
  const refNo = normalizeBizNo(raw);
  if (!/^R\d{2}[A-Z0-9]+$/i.test(refNo)) {
    return null;
  }

  const cached = await readCache(refNo);
  if (cached?.baseAmount) return { ...cached, source: cached.source || "cache" };

  const errors = [];
  for (const fn of [fetchFromJodaln, fetchFromCraftspace]) {
    try {
      const notice = await fn(refNo);
      if (notice?.baseAmount || notice?.title) {
        await writeCache(notice);
        await appendCatalog(notice);
        return notice;
      }
    } catch (err) {
      errors.push(String(err.message || err));
    }
  }
  throw new Error(errors.join(" | ") || "공개 공고를 찾지 못했습니다.");
}
