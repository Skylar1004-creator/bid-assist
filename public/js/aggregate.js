/**
 * 취합 · 기초금액 대비 ± · 단일 투찰가 도출
 *
 * 1) A/B/C/D·이력 재계산액을 모은다
 * 2) 각 값을 기초금액과 비교해 ±원 / ±% 로 표기
 * 3) 가중 중앙값으로 값 1개를 뽑고, 실질하한 미만이면 끌어올린다
 */

import { bidFromBase } from "./base-amount.js";

function won(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

function signedWon(n) {
  const v = Math.round(n);
  if (v === 0) return "±0원";
  return v > 0 ? `+${v.toLocaleString("ko-KR")}원` : `${v.toLocaleString("ko-KR")}원`;
}

function signedPct(ratio) {
  if (ratio == null || Number.isNaN(ratio)) return "—";
  const p = ratio * 100;
  if (Math.abs(p) < 0.0005) return "±0%";
  const s = p > 0 ? "+" : "";
  return `${s}${p.toFixed(3)}%`;
}

function rowVsBase(base, bid, extra = {}) {
  const b = Math.round(bid);
  return {
    ...extra,
    bid: b,
    vsBaseWon: b - base,
    vsBasePct: base > 0 ? b / base - 1 : null,
    vsBaseLabel: `${signedWon(b - base)} (${signedPct(base > 0 ? b / base - 1 : null)})`,
  };
}

/** 가중 중앙값 */
export function weightedMedian(items) {
  const list = (items || [])
    .filter((i) => i.value != null && i.weight > 0)
    .map((i) => ({ value: Number(i.value), weight: Number(i.weight) }))
    .sort((a, b) => a.value - b.value);
  if (!list.length) return null;
  const total = list.reduce((s, i) => s + i.weight, 0);
  let acc = 0;
  for (const i of list) {
    acc += i.weight;
    if (acc >= total / 2) return i.value;
  }
  return list[list.length - 1].value;
}

/**
 * @param {{
 *   base: number,
 *   yega: number,
 *   hardFloor: number,
 *   mode: "low"|"qualify",
 *   candidates: {id:string,name:string,bid:number,score:number,rate?:number}[],
 *   kindCases?: object[],
 *   yearCases?: object[],
 * }} input
 */
export function aggregateToBid(input) {
  const {
    base,
    yega = 1,
    hardFloor = 0,
    mode = "low",
    candidates = [],
    kindCases = [],
    yearCases = [],
  } = input;

  if (!(base > 0)) {
    return {
      ok: false,
      reason: "기초금액 없음",
      rows: [],
      derived: null,
    };
  }

  const rows = [];

  // —— 1) 산정 후보 취합 (주 가중) ——
  for (const c of candidates) {
    if (!(c.bid > 0)) continue;
    const r = rowVsBase(base, c.bid, {
      id: c.id,
      name: c.name,
      source: "plan",
      weight: Math.max(1, c.score || 40),
      rate: c.rate ?? null,
      vsFloorWon: hardFloor > 0 ? Math.round(c.bid - hardFloor) : null,
    });
    rows.push(r);
  }

  // —— 2) 이력 낙찰을 이번 기초·예가로 재계산해 취합 (보조 가중) ——
  const histPool = [];
  const seen = new Set();
  for (const c of [...(kindCases || []), ...(yearCases || [])]) {
    if (!(c?.rate > 0) || !(c.base > 0)) continue;
    const key = `${c.awardedAt || ""}|${c.title || ""}|${c.rate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    histPool.push(c);
  }

  for (const c of histPool.slice(0, 12)) {
    const bid = bidFromBase(base, c.rate, yega);
    if (!(bid > 0)) continue;
    // 기초 규모가 너무 다르면 가중 축소
    const baseDiff = Math.abs(c.base - base) / base;
    let w = 8;
    if (baseDiff <= 0.15) w = 18;
    else if (baseDiff <= 0.3) w = 12;
    else if (baseDiff > 0.6) w = 3;
    rows.push(
      rowVsBase(base, bid, {
        id: "H",
        name: `이력재계산 · ${c.title || "낙찰"}`.slice(0, 40),
        source: "history",
        weight: w,
        rate: c.rate,
        caseBase: c.base,
        vsFloorWon: hardFloor > 0 ? Math.round(bid - hardFloor) : null,
      }),
    );
  }

  const usable = rows.filter((r) => {
    if (hardFloor > 0 && r.bid + 0.5 < hardFloor) return false;
    return true;
  });

  if (!usable.length) {
    return {
      ok: false,
      reason: "하한 통과 취합 표본 없음",
      rows,
      derived: null,
      hardFloor,
    };
  }

  // —— 3) 도출: 계획 후보 가중중앙값 우선, 없으면 전체 ——
  const planItems = usable
    .filter((r) => r.source === "plan")
    .map((r) => ({ value: r.bid, weight: r.weight }));
  const allItems = usable.map((r) => ({ value: r.bid, weight: r.weight }));

  let derived = weightedMedian(planItems.length ? planItems : allItems);

  // 선정형: 취합 하위 쪽과 중앙을 한 번 더 당김 (너무 높이면 탈락)
  if (mode === "low" && planItems.length >= 2) {
    const bids = planItems.map((i) => i.value).sort((a, b) => a - b);
    const low = bids[Math.floor((bids.length - 1) * 0.25)];
    const mid = weightedMedian(planItems);
    derived = Math.round(low * 0.55 + mid * 0.45);
  }

  derived = Math.round(derived);
  if (hardFloor > 0 && derived < hardFloor) derived = Math.ceil(hardFloor);

  const bids = usable.map((r) => r.bid).sort((a, b) => a - b);
  const band = [bids[0], bids[bids.length - 1]];

  const vsBase = rowVsBase(base, derived);
  const vsFloorWon = hardFloor > 0 ? derived - hardFloor : null;

  return {
    ok: true,
    derived,
    vsBaseWon: vsBase.vsBaseWon,
    vsBasePct: vsBase.vsBasePct,
    vsBaseLabel: vsBase.vsBaseLabel,
    vsFloorWon,
    vsFloorLabel: vsFloorWon == null ? null : signedWon(vsFloorWon),
    band,
    bandLabel: `${won(band[0])} ~ ${won(band[1])}`,
    rows: usable
      .slice()
      .sort((a, b) => a.bid - b.bid)
      .map((r) => ({
        ...r,
        vsFloorLabel: r.vsFloorWon == null ? null : signedWon(r.vsFloorWon),
      })),
    dropped: rows.filter((r) => !usable.includes(r)),
    hardFloor,
    summary: `취합 ${usable.length}건 · 기초 대비 ${vsBase.vsBaseLabel}${
      vsFloorWon != null ? ` · 하한 대비 ${signedWon(vsFloorWon)}` : ""
    } → ${won(derived)}`,
  };
}

export function formatSignedWon(n) {
  return signedWon(n);
}

export function formatSignedPct(ratio) {
  return signedPct(ratio);
}
