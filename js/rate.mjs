/**
 * 나라장터 투찰률·사정률 재현
 * 공식: 투찰(낙찰)금액 ÷ 예정가격
 * (기초금액 대비가 아님)
 */

export function toRate(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 2 ? n / 100 : n;
}

/** 이력 한 건에서 공식 투찰률(예정가 대비) */
export function officialBidRate(item) {
  if (!item) return null;
  const fromField = toRate(item.bidRate ?? item.sucsfbidRate ?? item.officialRate);
  if (fromField != null) return fromField;

  const award = Number(item.award);
  const planned = Number(item.planned ?? item.plannedPrice ?? item.yega);
  if (award > 0 && planned > 0) return award / planned;
  return null;
}

/** 예정가격 ÷ 기초금액 (복수예가 후 예가 수준) */
export function plannedOverBase(item) {
  const base = Number(item.base ?? item.baseAmount);
  const planned = Number(item.planned ?? item.plannedPrice ?? item.yega);
  if (base > 0 && planned > 0) return planned / base;
  return null;
}

export function withOfficialRate(item) {
  const rate = officialBidRate(item);
  const planned =
    Number(item.planned ?? item.plannedPrice ?? item.yega) ||
    (rate && item.award ? Number(item.award) / rate : null);
  return {
    ...item,
    planned: planned || item.planned || null,
    rate,
    rateBasis: rate != null ? "예정가" : null,
  };
}

/**
 * 투찰률 r, 예정/기초 k 로 이번 공고 투찰가 추정
 * 투찰가 ≈ 기초 × k × r
 */
export function bidFromOfficialRate(baseAmount, bidRate, plannedRatio = 1) {
  if (!(baseAmount > 0) || bidRate == null) return null;
  const k = plannedRatio > 0 ? plannedRatio : 1;
  return baseAmount * k * bidRate;
}

/** 추정 낙찰하한(금액) ≈ 기초 × k × 하한율 */
export function floorFromOfficial(baseAmount, floorRate, plannedRatio = 1) {
  if (!(baseAmount > 0) || !(floorRate > 0)) return 0;
  const k = plannedRatio > 0 ? plannedRatio : 1;
  return baseAmount * k * floorRate;
}
