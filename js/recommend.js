/**
 * 입찰 신 판정 — 사용자 취향이 아니라 객관 근거로 투찰가 1개를 넘긴다.
 * 근거 없으면 추천하지 않는다(blocked).
 * 인포21C 축: 기초금액 × 예가사정율 × (투찰률|하한율).
 */

import { bidFromBase, baseSourceLabel } from "./base-amount.js";
import { aggregateToBid } from "./aggregate.js";
import { aiFinalize } from "./judgment.js";

function pct(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(3)}%`;
}

function won(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

function methodMode(method = "") {
  const m = String(method || "");
  if (/추첨|최저|수의/.test(m)) return "low"; // 낮을수록 유리
  if (/적격/.test(m)) return "qualify";
  return "low";
}

function caseCite(c) {
  if (!c) return null;
  return {
    title: c.title,
    agency: c.agency,
    awardedAt: c.awardedAt,
    rate: c.rate,
    award: c.award,
    base: c.base,
    planned: c.planned,
    refNo: c.refNo || null,
  };
}

/**
 * @param {object} notice
 * @param {object} calc calcPlans 결과
 * @param {object} [_opts] 호환용(원가 무시)
 */
export function buildVerdict(notice, calc, _opts = {}) {
  const base = notice.baseAmount > 0 ? notice.baseAmount : calc.baseAmount || 0;
  const yega = calc.yegaRate != null && calc.yegaRate > 0 ? calc.yegaRate : 1;
  const ref = calc.refAmount || (base > 0 ? base * yega : 0);
  const floorSimple = calc.floor || 0;
  const floorRate = notice.floorRate || 0;
  const mode = methodMode(notice.method);
  const rejected = [];
  const candidates = [];
  const baseProxy = Boolean(notice.baseIsProxy || calc.baseIsProxy);

  if (!(base > 0)) {
    return {
      status: "blocked",
      bid: null,
      rate: null,
      planId: null,
      confidence: 0,
      headline: "기초금액이 없어 투찰가를 넘기지 않습니다.",
      evidence: [
        {
          type: "block",
          text: "인포21C 산식의 축은 기초금액(bssamt)입니다. 추정·예산으로 대체하지 마세요.",
        },
      ],
      rejected: [],
      method: null,
      hardFloor: 0,
    };
  }

  if (baseProxy) {
    return {
      status: "blocked",
      bid: null,
      rate: null,
      planId: null,
      confidence: 0,
      headline: "기초금액이 추정·예산 대리값이라 추천하지 않습니다.",
      evidence: [
        {
          type: "block",
          text: `현재 값 ${won(base)}은 ${baseSourceLabel(
            notice.baseSource || calc.baseSource,
            true,
          )}입니다. 공고 원문·나라장터 기초금액(bssamt)을 넣고 다시 산정하세요. 인포21C와 금액이 어긋나는 주원인입니다.`,
        },
        notice.estimateAmount
          ? { type: "meta", text: `추정가격 ${won(notice.estimateAmount)}` }
          : null,
        notice.budgetAmount
          ? { type: "meta", text: `배정예산 ${won(notice.budgetAmount)}` }
          : null,
      ].filter(Boolean),
      rejected: [],
      method: null,
      hardFloor: floorSimple,
    };
  }

  const baseCite = {
    type: "base",
    text: `기초금액 ${won(base)} · ${baseSourceLabel(
      notice.baseSource || calc.baseSource || "manual",
      false,
    )} · 예가사정율 ${pct(calc.yegaRate)}`,
  };

  const hardFloor = (() => {
    const d = (calc.plans || []).find((p) => p.id === "D" && !p.disabled && p.bid != null);
    if (d) return d.bid;
    if (base > 0 && calc.yegaRate > 0 && floorRate > 0) return base * calc.yegaRate * floorRate;
    if (ref > 0 && floorRate > 0) return ref * floorRate;
    return floorSimple;
  })();

  function pushCandidate(row) {
    if (row.bid == null || !(row.bid > 0)) {
      rejected.push({ id: row.id, reason: "산출 금액 없음" });
      return;
    }
    if (hardFloor > 0 && row.bid + 0.5 < hardFloor) {
      rejected.push({
        id: row.id,
        reason: `금액 ${won(row.bid)} < 실질하한 ${won(hardFloor)} → 무효`,
      });
      return;
    }
    if (!row.evidence?.length) {
      rejected.push({ id: row.id, reason: "객관 근거 목록이 비어 추천 불가" });
      return;
    }
    row.evidence = [baseCite, ...row.evidence];
    candidates.push(row);
  }

  // —— C: 동일 공고 (가장 강한 근거) ——
  const sameExact =
    calc.stats?.sameScope === "동일·재공고" ? calc.sameAwarded || [] : [];
  if (sameExact.length >= 1 && base > 0) {
    const rates = sameExact.map((c) => c.rate).filter((r) => r != null);
    const rate =
      rates.length === 1
        ? rates[0]
        : rates.slice().sort((a, b) => a - b)[Math.floor((rates.length - 1) / 2)];
    pushCandidate({
      id: "C",
      name: "동일·재공고 실적",
      bid: bidFromBase(base, rate, yega),
      rate,
      baseWeight: 92,
      evidence: [
        {
          type: "same-notice",
          text: `동일·재공고 낙찰 ${sameExact.length}건 · 기초×예가×투찰률 ${pct(rate)}`,
        },
        ...sameExact.slice(0, 5).map((c) => ({
          type: "case",
          text: `${c.awardedAt || "-"} · ${c.title} · 기초 ${won(c.base)} · ${pct(c.rate)} · ${won(c.award)}`,
          case: caseCite(c),
        })),
      ],
    });
  } else if ((calc.sameAwarded || []).length) {
    rejected.push({
      id: "C",
      reason: `유사 공고만 ${calc.sameAwarded.length}건 — 동일 공고로 단정 불가`,
    });
  } else {
    rejected.push({ id: "C", reason: "동일·재공고 낙찰 없음" });
  }

  // —— B: 1년 최빈(고확률) — 선정에 유리한 ‘자주 나온’ 구간 ——
  const year = calc.year || {};
  if (year.midRate != null && year.band && (year.yearCases || []).length >= 3 && base > 0) {
    const share = year.share || 0;
    pushCandidate({
      id: "B",
      name: "1년 최빈 투찰률",
      bid: bidFromBase(base, year.midRate, yega),
      rate: year.midRate,
      baseWeight: 55 + Math.min(25, Math.round(share * 40)) + Math.min(10, year.yearCases.length),
      evidence: [
        {
          type: "frequency",
          text: `${year.scope || "1년"} ${year.yearCases.length}건 중 최빈 구간 ${pct(
            year.band[0],
          )}~${pct(year.band[1])} (점유 ${((share || 0) * 100).toFixed(0)}%) · 기초유사 우선`,
        },
        ...year.yearCases.slice(0, 5).map((c) => ({
          type: "case",
          text: `${c.awardedAt || "-"} · ${c.title} · 기초 ${won(c.base)} · ${pct(c.rate)}`,
          case: caseCite(c),
        })),
      ],
    });
  } else {
    rejected.push({
      id: "B",
      reason:
        (year.yearCases || []).length < 3
          ? `1년 표본 ${(year.yearCases || []).length}건 < 3건`
          : "최빈 구간 산출 실패",
    });
  }

  // —— A: 종류 통계 — 선정용은 P25(낮은 쪽), 여유 있으면 P50 ——
  const kindN = calc.stats?.kindN || 0;
  const rates = (calc.kindCases || []).map((c) => c.rate).filter((r) => r != null).sort((a, b) => a - b);
  if (kindN >= 3 && rates.length && base > 0) {
    const p25 = rates[Math.floor((rates.length - 1) * 0.25)];
    const p50 = rates[Math.floor((rates.length - 1) * 0.5)];
    const pickRate = mode === "low" ? p25 : p50;
    pushCandidate({
      id: "A",
      name: mode === "low" ? "동일종류 하위25%(선정형)" : "동일종류 중앙값",
      bid: bidFromBase(base, pickRate, yega),
      rate: pickRate,
      baseWeight: 45 + Math.min(20, kindN),
      evidence: [
        {
          type: "quantile",
          text: `${calc.stats.kindScope} ${kindN}건 · ${
            mode === "low" ? "P25" : "P50"
          } 투찰률 ${pct(pickRate)} (P50=${pct(p50)}) · 기초×예가 적용`,
        },
        ...calc.kindCases.slice(0, 5).map((c) => ({
          type: "case",
          text: `${c.awardedAt || "-"} · ${c.region || ""} · 기초 ${won(c.base)} · ${pct(c.rate)} · ${won(c.award)}`,
          case: caseCite(c),
        })),
      ],
    });
  } else {
    rejected.push({
      id: "A",
      reason: kindN < 3 ? `종류 표본 ${kindN}건 < 3건` : "투찰률 분포 없음",
    });
  }

  // —— D: 예가×하한 밀착 (무효 회피 + 최저가형 핵심) ——
  const planD = (calc.plans || []).find((p) => p.id === "D");
  if (planD && !planD.disabled && planD.bid != null && base > 0) {
    const yegaKnown = calc.yegaFromNotice != null;
    pushCandidate({
      id: "D",
      name: "하한밀착(기초×예가×하한·A/순공사)",
      bid: planD.bid,
      rate: ref > 0 ? planD.bid / ref : null,
      baseWeight: yegaKnown ? 78 : calc.stats?.yegaN >= 5 ? 58 : 28,
      evidence: [
        {
          type: "formula",
          text: planD.why,
        },
        {
          type: "formula-meta",
          text: `기초 ${won(base)} × 예가 ${pct(calc.yegaRate)} × 하한 ${pct(floorRate)}${
            calc.aValue > 0 ? ` · A값 ${won(calc.aValue)}` : ""
          }${calc.netCost > 0 ? ` · 순공사 ${won(calc.netCost)}` : ""}`,
        },
        ...(calc.formula?.rows || []).map((r) => ({
          type: "formula-row",
          text: `${r.name}: ${won(r.bid)}`,
        })),
      ],
    });
  } else {
    rejected.push({ id: "D", reason: "기초·예가사정율·하한율 부족으로 하한밀착 산식 불가" });
  }

  if (!candidates.length) {
    return {
      status: "blocked",
      bid: null,
      rate: null,
      planId: null,
      confidence: 0,
      headline: "객관 근거가 부족해 투찰가를 넘기지 않습니다.",
      evidence: [
        {
          type: "block",
          text: "동일공고·종류표본(≥3)·1년최빈(≥3)·예가×하한 산식 중 유효 근거가 없습니다.",
        },
      ],
      rejected,
      method: null,
      hardFloor,
    };
  }

  // —— 점수: 근거 가중치 + 선정 적합성(과도한 고가 감점) ——
  for (const c of candidates) {
    let score = c.baseWeight;
    // 근거 조항 수
    score += Math.min(12, c.evidence.length * 2);
    // 하한 대비 여유(너무 높으면 선정 실패 원인)
    if (hardFloor > 0 && ref > 0) {
      const above = (c.bid - hardFloor) / ref;
      if (mode === "low") {
        if (above <= 0.003) score += 18;
        else if (above <= 0.01) score += 10;
        else if (above <= 0.02) score += 4;
        else if (above >= 0.05) score -= 25;
        else if (above >= 0.03) score -= 12;
      } else {
        if (above >= 0.01 && above <= 0.04) score += 8;
      }
    }
    // 예정가 확정 가산
    if (calc.usedPlanned) score += 6;
    c.score = Math.round(score);
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  // —— 취합: 후보+이력 재계산 → 기초 대비 ± → 값 1개 ——
  const agg = aggregateToBid({
    base,
    yega,
    hardFloor,
    mode,
    candidates: candidates.map((c) => ({
      id: c.id,
      name: c.name,
      bid: c.bid,
      score: c.score,
      rate: c.rate,
    })),
    kindCases: calc.kindCases || [],
    yearCases: calc.year?.yearCases || [],
  });

  if (!agg.ok || !(agg.derived > 0)) {
    return {
      status: "blocked",
      bid: null,
      rate: null,
      planId: null,
      confidence: 0,
      headline: "취합·기초 대비 도출에 실패했습니다.",
      evidence: [
        { type: "block", text: agg.reason || "취합 표본 없음" },
        baseCite,
      ],
      rejected,
      method: null,
      hardFloor,
      aggregation: agg,
    };
  }

  const planBids = candidates.map((c) => Math.round(c.bid));
  const histBids = (agg.rows || [])
    .filter((r) => r.source === "history")
    .map((r) => r.bid);
  const floorHugBid =
    (calc.plans || []).find((p) => p.id === "D" && !p.disabled)?.bid ?? hardFloor;

  const ai = aiFinalize({
    base,
    ref,
    yega,
    hardFloor,
    mode,
    competitionShare: calc.year?.share || calc.stats?.yearShare || 0.3,
    planBids,
    histBids,
    anchorBid: best.bid,
    floorHugBid,
    usedPlanned: calc.usedPlanned,
    sameExactN: sameExact.length,
  });

  if (!ai.ok || !(ai.bid > 0)) {
    return {
      status: "blocked",
      bid: null,
      rate: null,
      planId: null,
      confidence: 0,
      headline: "AI 판정을 내리지 않았습니다.",
      evidence: [
        { type: "block", text: ai.reason || "판정 실패" },
        ...(ai.reasons || []).map((t) => ({ type: "ai", text: t })),
        baseCite,
      ],
      rejected,
      method: null,
      hardFloor,
      aggregation: agg,
      ai,
    };
  }

  const finalBid = Math.round(ai.bid);
  const confidence = ai.confidence;

  const whyNotOthers = candidates.slice(1, 4).map((c) => ({
    id: c.id,
    bid: Math.round(c.bid),
    score: c.score,
    reason: `${c.name} · AI판정 대비 ${won(Math.round(c.bid) - finalBid)}`,
  }));
  for (const r of rejected) {
    whyNotOthers.push({ id: r.id, bid: null, score: 0, reason: r.reason });
  }

  const aggEvidence = [
    { type: "ai", text: ai.judgment },
    ...(ai.reasons || []).map((t) => ({ type: "ai-step", text: t })),
    {
      type: "aggregate",
      text: agg.summary,
    },
    {
      type: "vs-base",
      text: `기초 ${won(base)} 대비 ${
        ai.vsBasePct == null
          ? "—"
          : `${ai.vsBasePct >= 0 ? "+" : ""}${(ai.vsBasePct * 100).toFixed(3)}%`
      }${
        ai.vsFloorWon != null
          ? ` · 하한 대비 ${ai.vsFloorWon >= 0 ? "+" : ""}${Math.round(ai.vsFloorWon).toLocaleString("ko-KR")}원`
          : ""
      }`,
    },
    {
      type: "band",
      text: `취합 구간 ${agg.bandLabel} · 합의율 ${(ai.agree * 100).toFixed(0)}%`,
    },
    ...agg.rows
      .filter((r) => r.source === "plan")
      .map((r) => ({
        type: "agg-row",
        text: `${r.id} ${r.name} · ${won(r.bid)} · 기초대비 ${r.vsBaseLabel}${
          r.vsFloorLabel ? ` · 하한대비 ${r.vsFloorLabel}` : ""
        }`,
      })),
  ];

  return {
    status: "ready",
    bid: finalBid,
    rate: ref > 0 ? finalBid / ref : best.rate,
    planId: "AI",
    name: "AI 판정",
    anchorPlanId: best.id,
    confidence,
    judgment: ai.judgment,
    headline: `AI 선정 ${won(finalBid)} · 신뢰 ${confidence}`,
    evidence: [baseCite, ...aggEvidence, ...best.evidence.filter((e) => e.type !== "base")],
    rejected: whyNotOthers,
    method: "AI",
    hardFloor,
    mode,
    aggregation: agg,
    ai,
    scored: candidates.map((c) => ({
      id: c.id,
      name: c.name,
      bid: Math.round(c.bid),
      score: c.score,
      rate: c.rate,
      vsBaseLabel: `${c.bid - base >= 0 ? "+" : ""}${Math.round(c.bid - base).toLocaleString("ko-KR")}원`,
    })),
  };
}
