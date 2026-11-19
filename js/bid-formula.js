/**
 * 인포21C·나라장터 실무 산식
 *
 * 용어 구분 (혼동 금지)
 * - 예가사정율 = 예정가격 ÷ 기초금액  (복수예가 분석용)
 * - 투찰률(낙찰률) = 투찰·낙찰금액 ÷ 예정가격  (나라장터 개찰 표시)
 */

/** 예가사정율 */
export function yegaRate(planned, base) {
  if (!(planned > 0) || !(base > 0)) return null;
  return planned / base;
}

/** 투찰률·낙찰률 (예정가 대비) */
export function bidRate(bid, planned) {
  if (!(bid > 0) || !(planned > 0)) return null;
  return bid / planned;
}

/**
 * 기본 하한밀착(A값 없음)
 * ≈ 기초 × 예가사정율 × 낙찰하한율
 */
export function bidFloorHug(base, yega, floorRate) {
  if (!(base > 0) || yega == null || !(floorRate > 0)) return null;
  return base * yega * floorRate;
}

/**
 * A값 적용 투찰가 (시설공사 일부 적격)
 * [(기초 × 예가사정율 − A) × 하한율] + A
 * = (예정 − A) × 하한율 + A
 */
export function bidWithAValue(base, yega, floorRate, aValue) {
  if (!(base > 0) || yega == null || !(floorRate > 0)) return null;
  const a = Number(aValue) || 0;
  const planned = base * yega;
  return (planned - a) * floorRate + a;
}

/**
 * 순공사원가 적용
 * 순공사원가 × 예가사정율 × 98%
 * (예정 중 순공사원가의 98% 미만이면 낙찰 제외 → 하한 성격)
 */
export function bidWithNetCost(netCost, yega) {
  if (!(netCost > 0) || yega == null) return null;
  return netCost * yega * 0.98;
}

/**
 * 적용 가능한 산식 중 높은 쪽(순공사 보장 등)을 고름
 */
export function pickBidCandidates({ base, yega, floorRate, aValue, netCost }) {
  const rows = [];
  const hug = bidFloorHug(base, yega, floorRate);
  if (hug != null) {
    rows.push({ id: "floorHug", name: "하한밀착(기초×예가×하한)", bid: hug });
  }
  if (aValue > 0) {
    const withA = bidWithAValue(base, yega, floorRate, aValue);
    if (withA != null) {
      rows.push({ id: "aValue", name: "A값 적용 산식", bid: withA });
    }
  }
  if (netCost > 0) {
    const net = bidWithNetCost(netCost, yega);
    if (net != null) {
      rows.push({ id: "netCost", name: "순공사원가×예가×98%", bid: net });
    }
  }
  let recommended = null;
  for (const r of rows) {
    if (!recommended || r.bid > recommended.bid) recommended = r;
  }
  return { rows, recommended };
}

/** 이력에서 예가사정율(예정÷기초) 목록 */
export function historyYegaRates(cases) {
  return (cases || [])
    .filter((c) => c.planned > 0 && c.base > 0)
    .map((c) => c.planned / c.base)
    .sort((a, b) => a - b);
}
