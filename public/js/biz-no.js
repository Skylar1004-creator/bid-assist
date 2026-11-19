/** 나라장터·국방 등 사업번호/공고번호 — 형식에 묶이지 않고 폭넓게 인식 */

export function normalizeBizNo(raw) {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

/**
 * 다양한 차수 표기 분리
 * - 2026LNF007647040-01
 * - 2026LNF007647040-N
 * - 2026LNF007647040-N-001
 * - R26BK01578429
 */
export function splitBizNo(raw) {
  const full = normalizeBizNo(raw);
  if (!full) return { full: "", core: "", ord: null };

  let core = full;
  let ord = null;

  let m = full.match(/^(.*)-N-(\d{1,3})$/i);
  if (m) {
    core = m[1];
    ord = m[2].padStart(2, "0");
    return { full, core, ord };
  }
  m = full.match(/^(.*)-N$/i);
  if (m) {
    return { full, core: m[1], ord: null };
  }
  m = full.match(/^(.+)-(\d{1,2})$/);
  if (m && m[1].length >= 6) {
    return { full, core: m[1], ord: m[2].padStart(2, "0") };
  }
  return { full, core, ord };
}

/**
 * 사업·공고번호로 볼지 — 한글 제목은 제외, 영문·숫자 ID는 폭넓게 허용
 * 예: R26BK…, 2026LNF…-01, PS2026LNF47040, B26…, 47040
 */
export function looksLikeBizNo(raw) {
  const { core } = splitBizNo(raw);
  if (!core || core.length < 5) return false;
  if (/[가-힣]/.test(core)) return false;
  if (!/\d/.test(core)) return false;

  if (/^R\d{2}[A-Z0-9]{5,}$/i.test(core)) return true;
  if (/^\d{4}[A-Z]{2,8}\d{4,}$/i.test(core)) return true;
  if (/^[A-Z]{1,8}\d{2,}[A-Z0-9]*$/i.test(core)) return true;
  if (/^[A-Z]\d{2}[A-Z]{0,6}\d{4,}$/i.test(core)) return true;
  if (/^\d{5,}$/.test(core)) return true;
  // 그 외 영문·숫자 조합(길이 8+, 숫자 4개 이상)
  if (/^[A-Z0-9\-_]{8,}$/i.test(core)) {
    const digits = (core.match(/\d/g) || []).length;
    if (digits >= 4) return true;
  }
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
  if (b.core.length >= 5 && a.core.endsWith(b.core)) return true;
  if (a.core.length >= 5 && b.core.endsWith(a.core)) return true;
  // 참조번호 PS…47040 ↔ 공고번호 …7647040 뒷자리
  if (b.core.length >= 5 && a.full.includes(b.core)) return true;
  if (a.core.length >= 5 && b.full.includes(a.core)) return true;
  return false;
}

/** OpenAPI/스크래핑에 넣을 핵심 번호들 */
export function bizNoSearchKeys(raw) {
  const { full, core, ord } = splitBizNo(raw);
  const keys = new Set();
  if (full) keys.add(full);
  if (core) keys.add(core);
  if (core && ord) keys.add(`${core}-${ord}`);
  if (core && ord) keys.add(`${core}-N`);
  if (core && ord) keys.add(`${core}-N-${ord}`);
  return [...keys];
}
