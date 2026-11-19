/**
 * AI 최종 판정 — 취합·근거를 받아 “이 금액으로 간다” 한 값을 확정한다.
 *
 * 고도화 포인트
 * - 이상치 제거(IQR)
 * - 합의 구간(밀도 클러스터) 탐색
 * - 방식별 전략(선정형=하한밀착+틱, 적격=합의 중앙)
 * - 경쟁 밀도(최빈 점유)로 하한 밀착 강도 조절
 * - 후보 합의율로 신뢰도 보정
 */

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const i = Math.floor(pos);
  const f = pos - i;
  const next = sorted[i + 1];
  if (next === undefined) return sorted[i];
  return sorted[i] + f * (next - sorted[i]);
}

/** IQR로 이상치 제거 */
export function rejectOutliers(values) {
  const sorted = [...values].filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length < 4) return { kept: sorted, dropped: [] };
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  const kept = [];
  const dropped = [];
  for (const v of sorted) {
    if (v < lo || v > hi) dropped.push(v);
    else kept.push(v);
  }
  return { kept: kept.length ? kept : sorted, dropped };
}

/**
 * 가장 촘촘한 금액 구간(상대폭)을 찾는다.
 * @returns {{ center: number, lo: number, hi: number, count: number, widthPct: number }|null}
 */
export function densestCluster(values, { maxWidthPct = 0.008, minCount = 2 } = {}) {
  const sorted = [...values].filter((v) => v > 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  if (sorted.length === 1) {
    return {
      center: sorted[0],
      lo: sorted[0],
      hi: sorted[0],
      count: 1,
      widthPct: 0,
    };
  }

  let best = null;
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i; j < sorted.length; j++) {
      const lo = sorted[i];
      const hi = sorted[j];
      const mid = (lo + hi) / 2;
      const widthPct = mid > 0 ? (hi - lo) / mid : 1;
      if (widthPct > maxWidthPct) break;
      const count = j - i + 1;
      if (count < minCount && sorted.length >= minCount) continue;
      const score = count * 100 - widthPct * 1000;
      if (!best || score > best.score) {
        best = { center: mid, lo, hi, count, widthPct, score };
      }
    }
  }
  if (!best) {
    const mid = quantile(sorted, 0.5);
    return {
      center: mid,
      lo: sorted[0],
      hi: sorted[sorted.length - 1],
      count: sorted.length,
      widthPct: (sorted[sorted.length - 1] - sorted[0]) / mid,
    };
  }
  const { score, ...rest } = best;
  void score;
  return rest;
}

/**
 * 선정형: 하한 바로 위 전략 틱.
 * 경쟁 세면(점유 높음) → 틱 작게, 합의 흩어지면 → 틱 작게(무효 회피 우선)
 */
export function strategicTick({
  hardFloor,
  ref,
  competitionShare = 0.3,
  agreement = 0.5,
  mode = "low",
}) {
  if (!(hardFloor > 0) || !(ref > 0)) return 0;
  if (mode !== "low") return Math.round(ref * 0.002);

  // 기본 틱: 기준액의 0.02%~0.12%
  const tight = clamp(competitionShare, 0, 1); // 높을수록 경쟁 밀집
  const agree = clamp(agreement, 0, 1);
  const pct = 0.0012 - tight * 0.0007 - (1 - agree) * 0.0003;
  const tick = Math.max(1, Math.round(ref * clamp(pct, 0.00015, 0.0015)));
  return tick;
}

/**
 * 후보들이 얼마나 비슷한지 (0~1)
 */
export function agreementScore(bids, ref) {
  const list = (bids || []).filter((b) => b > 0);
  if (list.length < 2 || !(ref > 0)) return list.length === 1 ? 0.7 : 0;
  const sorted = [...list].sort((a, b) => a - b);
  const spread = (sorted[sorted.length - 1] - sorted[0]) / ref;
  if (spread <= 0.003) return 1;
  if (spread <= 0.008) return 0.85;
  if (spread <= 0.015) return 0.65;
  if (spread <= 0.03) return 0.4;
  return 0.2;
}

/**
 * @param {{
 *   base: number,
 *   ref: number,
 *   yega: number,
 *   hardFloor: number,
 *   mode: "low"|"qualify",
 *   competitionShare?: number,
 *   planBids: number[],
 *   histBids: number[],
 *   anchorBid?: number,
 *   floorHugBid?: number,
 *   usedPlanned?: boolean,
 *   sameExactN?: number,
 * }} input
 */
export function aiFinalize(input) {
  const {
    base,
    ref,
    hardFloor,
    mode = "low",
    competitionShare = 0.3,
    planBids = [],
    histBids = [],
    anchorBid = null,
    floorHugBid = null,
    usedPlanned = false,
    sameExactN = 0,
  } = input;

  const reasons = [];
  const poolRaw = [...planBids, ...histBids].filter((b) => b > 0);
  const aboveFloor = poolRaw.filter((b) => !(hardFloor > 0) || b + 0.5 >= hardFloor);
  const { kept, dropped } = rejectOutliers(aboveFloor.length ? aboveFloor : poolRaw);
  if (dropped.length) {
    reasons.push(`이상치 ${dropped.length}건 제거(IQR)`);
  }

  const planKept = planBids.filter((b) => kept.includes(b) || (hardFloor > 0 && Math.abs(b - hardFloor) < 1));
  const agree = agreementScore(planBids.length ? planBids : kept, ref || base);
  reasons.push(`후보 합의율 ${(agree * 100).toFixed(0)}%`);

  const cluster = densestCluster(kept, {
    maxWidthPct: mode === "low" ? 0.006 : 0.012,
    minCount: Math.min(2, kept.length),
  });

  let raw;
  if (mode === "low") {
    // 선정형 핵심: 하한밀착 + 전략 틱, 합의 클러스터가 하한 근처면 그 쪽
    const tick = strategicTick({
      hardFloor,
      ref: ref || base,
      competitionShare,
      agreement: agree,
      mode,
    });
    const hug = hardFloor > 0 ? Math.ceil(hardFloor) + tick : null;
    const clusterLow = cluster ? Math.round(cluster.lo) : null;

    if (hug != null && clusterLow != null) {
      // 클러스터 하한이 허그보다 많이 높으면 허그 채택(선정 실패 방지)
      const gap = (clusterLow - hug) / (ref || base);
      if (gap > 0.015) {
        raw = hug;
        reasons.push(`합의구간이 하한에서 +${(gap * 100).toFixed(2)}%p → 하한밀착+틱 채택`);
      } else if (gap < -0.002) {
        raw = hug;
        reasons.push("합의 하한이 실질하한 아래 → 하한밀착+틱");
      } else {
        // 합의와 허그 사이 가중
        raw = Math.round(hug * 0.65 + clusterLow * 0.35);
        reasons.push(`하한밀착+틱과 합의하한 혼합 (틱 ${tick.toLocaleString("ko-KR")}원)`);
      }
    } else if (hug != null) {
      raw = hug;
      reasons.push(`하한밀착+전략틱 ${tick.toLocaleString("ko-KR")}원`);
    } else if (cluster) {
      raw = Math.round(cluster.lo);
      reasons.push("합의 구간 하한 채택");
    } else if (anchorBid) {
      raw = Math.round(anchorBid);
      reasons.push("앵커 후보 채택");
    } else {
      return { ok: false, reason: "판정 재료 부족", reasons };
    }

    // 최빈 점유 높으면 더 붙인다
    if (hardFloor > 0 && competitionShare >= 0.45 && raw > hardFloor) {
      const tighter = Math.ceil(hardFloor) + Math.max(1, Math.round(tick * 0.4));
      if (tighter < raw) {
        raw = tighter;
        reasons.push(`경쟁 밀집(점유 ${(competitionShare * 100).toFixed(0)}%) → 틱 축소`);
      }
    }
  } else {
    // 적격: 합의 중앙, 없으면 앵커
    if (cluster) {
      raw = Math.round(cluster.center);
      reasons.push(`적격형 합의 중앙 ${cluster.count}건`);
    } else if (anchorBid) {
      raw = Math.round(anchorBid);
      reasons.push("적격형 앵커");
    } else {
      return { ok: false, reason: "판정 재료 부족", reasons };
    }
  }

  // 가드
  if (hardFloor > 0 && raw < hardFloor) {
    raw = Math.ceil(hardFloor);
    reasons.push("실질하한 미만 → 하한으로 보정");
  }
  // floorHug가 있고 선정형인데 너무 멀면 경고만 (금액은 유지)
  if (mode === "low" && floorHugBid > 0 && ref > 0) {
    const drift = Math.abs(raw - floorHugBid) / ref;
    if (drift > 0.02) {
      reasons.push(`하한산식과 ${(drift * 100).toFixed(2)}%p 괴리 · 근거 재확인 권고`);
    }
  }

  const bid = Math.round(raw);
  const vsBasePct = base > 0 ? bid / base - 1 : null;
  const vsFloorWon = hardFloor > 0 ? bid - hardFloor : null;

  // 신뢰도
  let confidence = 55;
  confidence += agree * 22;
  confidence += usedPlanned ? 8 : -6;
  confidence += sameExactN ? 10 : 0;
  confidence += cluster && cluster.count >= 3 ? 6 : 0;
  confidence += competitionShare >= 0.4 && mode === "low" ? 4 : 0;
  confidence -= dropped.length >= 2 ? 4 : 0;
  if (hardFloor > 0 && vsFloorWon != null && vsFloorWon >= 0 && vsFloorWon / (ref || base) <= 0.005) {
    confidence += 5;
  }
  confidence = Math.round(clamp(confidence, 20, 97));

  const judgment =
    mode === "low"
      ? `선정 투찰가 ${bid.toLocaleString("ko-KR")}원 · 무효 피하며 낮은 쪽. 기초 대비 ${
          vsBasePct == null ? "—" : `${(vsBasePct * 100).toFixed(3)}%`
        }, 하한 위 ${
          vsFloorWon == null ? "—" : `${Math.round(vsFloorWon).toLocaleString("ko-KR")}원`
        }.`
      : `선정 투찰가 ${bid.toLocaleString("ko-KR")}원 · 합의 중앙. 기초 대비 ${
          vsBasePct == null ? "—" : `${(vsBasePct * 100).toFixed(3)}%`
        }.`;

  return {
    ok: true,
    bid,
    confidence,
    judgment,
    reasons,
    agree,
    cluster,
    outliersDropped: dropped.length,
    vsBasePct,
    vsFloorWon,
    tick:
      mode === "low" && hardFloor > 0
        ? strategicTick({
            hardFloor,
            ref: ref || base,
            competitionShare,
            agreement: agree,
            mode,
          })
        : 0,
  };
}
