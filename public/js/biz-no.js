/** 나라장터 사업번호·공고번호 정규화/매칭 */

export function normalizeBizNo(raw) {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

/**
 * 2026LNF007647040-01 → { full, core: 2026LNF007647040, ord: 01 }
 * R26BK01578429 → { full, core, ord: null }
 */
export function splitBizNo(raw) {
  const full = normalizeBizNo(raw);
  const m = full.match(/^(.+)-(\d{1,2})$/);
  if (m) {
    return { full, core: m[1], ord: m[2].padStart(2, "0") };
  }
  return { full, core: full, ord: null };
}

/**
 * 인식 대상:
 * - R26BK… 사업번호
 * - 2026LNF007647040 / 2026LNF007647040-01 공고번호(+차수)
 * - 숫자 5자리 이상 뒷자리(예: 47040)
 */
export function looksLikeBizNo(raw) {
  const { core } = splitBizNo(raw);
  if (!core) return false;
  if (/^R\d{2}[A-Z0-9]{5,}$/i.test(core)) return true;
  if (/^\d{4}[A-Z]{2,5}\d{5,}$/i.test(core)) return true;
  if (/^[A-Z]\d{2}[A-Z]{1,4}\d{5,}$/i.test(core)) return true;
  if (/^\d{5,}$/.test(core)) return true;
  return false;
}

/** 후보 번호가 검색어와 같은 공고인지 */
export function bizNoMatch(candidate, query) {
  const a = splitBizNo(candidate);
  const b = splitBizNo(query);
  if (!a.core || !b.core) return false;
  if (a.full === b.full) return true;
  if (a.core === b.core) {
    if (a.ord && b.ord) return a.ord === b.ord;
    return true;
  }
  if (a.core.includes(b.core) || b.core.includes(a.core)) return true;
  // 뒷자리: 쿼리 5자 이상일 때만 (오탐 완화)
  if (b.core.length >= 5 && a.core.endsWith(b.core)) return true;
  if (a.core.length >= 5 && b.core.endsWith(a.core)) return true;
  return false;
}

/** OpenAPI/스크래핑에 넣을 핵심 번호들 */
export function bizNoSearchKeys(raw) {
  const { full, core, ord } = splitBizNo(raw);
  const keys = new Set();
  if (full) keys.add(full);
  if (core) keys.add(core);
  if (core && ord) keys.add(`${core}-${ord}`);
  return [...keys];
}
