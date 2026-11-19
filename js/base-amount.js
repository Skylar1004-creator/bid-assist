/**
 * 인포21C 축: 기초금액(bssamt).
 * 추정가격·배정예산과 절대 같은 칸에 섞지 않는다.
 */

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * @param {{
 *   bssamt?: number|string|null,
 *   labeledBase?: number|string|null,
 *   presmptPrce?: number|string|null,
 *   asignBdgtAmt?: number|string|null,
 * }} raw
 */
export function resolveNoticeAmounts(raw = {}) {
  const baseOfficial = num(raw.labeledBase) || num(raw.bssamt);
  const estimate = num(raw.presmptPrce);
  const budget = num(raw.asignBdgtAmt);

  if (baseOfficial) {
    return {
      baseAmount: baseOfficial,
      estimateAmount: estimate,
      budgetAmount: budget,
      baseSource: "bssamt",
      baseIsProxy: false,
    };
  }

  // 진짜 기초가 없을 때만 대리값 — 반드시 proxy 표기
  if (estimate) {
    return {
      baseAmount: estimate,
      estimateAmount: estimate,
      budgetAmount: budget,
      baseSource: "estimate",
      baseIsProxy: true,
    };
  }
  if (budget) {
    return {
      baseAmount: budget,
      estimateAmount: estimate,
      budgetAmount: budget,
      baseSource: "budget",
      baseIsProxy: true,
    };
  }

  return {
    baseAmount: null,
    estimateAmount: estimate,
    budgetAmount: budget,
    baseSource: null,
    baseIsProxy: false,
  };
}

export function baseSourceLabel(source, isProxy) {
  if (source === "bssamt" && !isProxy) return "기초금액(bssamt)";
  if (source === "estimate") return "추정가격 대리(기초 아님)";
  if (source === "budget") return "배정예산 대리(기초 아님)";
  if (source === "manual") return "직접 입력";
  return "기초금액 미확인";
}

export function baseDiffRatio(noticeBase, caseBase) {
  if (!(noticeBase > 0) || !(caseBase > 0)) return Number.POSITIVE_INFINITY;
  return Math.abs(caseBase - noticeBase) / noticeBase;
}

/**
 * 기초금액 비슷한 낙찰만 우선. 인포식 대조는 규모가 같아야 의미가 있다.
 * @returns {{ cases: object[], band: number|null, scopeSuffix: string }}
 */
export function filterByBaseSimilarity(
  cases,
  baseAmount,
  { tight = 0.3, wide = 0.6, minN = 3 } = {},
) {
  const list = cases || [];
  if (!(baseAmount > 0) || !list.length) {
    return { cases: list, band: null, scopeSuffix: "" };
  }

  const tightList = list.filter((c) => baseDiffRatio(baseAmount, c.base) <= tight);
  if (tightList.length >= minN) {
    return {
      cases: tightList,
      band: tight,
      scopeSuffix: `·기초±${Math.round(tight * 100)}%`,
    };
  }

  const wideList = list.filter((c) => baseDiffRatio(baseAmount, c.base) <= wide);
  if (wideList.length >= 1) {
    return {
      cases: wideList,
      band: wide,
      scopeSuffix: `·기초±${Math.round(wide * 100)}%`,
    };
  }

  return { cases: list, band: null, scopeSuffix: "·기초유사표본없음" };
}

/**
 * 인포21C: 투찰가 ≈ 기초 × 예가사정율 × 투찰률
 * (예정가 확정이면 예정×투찰률과 동일)
 */
export function bidFromBase(baseAmount, bidRate, yega = 1) {
  if (!(baseAmount > 0) || bidRate == null) return null;
  const k = yega != null && yega > 0 ? yega : 1;
  return baseAmount * k * bidRate;
}
