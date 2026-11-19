/**
 * 입찰 전문가 관점의 산정 이의제기.
 * 근거가 허술하면 돌려 말하지 않는다.
 */

function pct(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(2)}%`;
}

function won(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

function issue(level, code, text) {
  return { level, code, text };
}

function stddev(values) {
  if (!values?.length) return null;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length;
  return Math.sqrt(v);
}

/**
 * @param {object} notice
 * @param {object} calc calcPlans 결과
 * @param {{ finalBid?: number|null, source?: string, cost?: number, minMarginPct?: number }} decision
 */
export function critiqueCalc(notice, calc, decision = {}) {
  const issues = [];
  const ref = calc.refAmount || notice.baseAmount || 0;
  const floor = calc.floor || 0;
  const floorRate = notice.floorRate || 0;
  const usedPlanned = calc.usedPlanned;
  const plans = (calc.plans || []).filter((p) => !p.disabled && p.bid != null);
  const finalBid = decision.finalBid != null && decision.finalBid > 0 ? Number(decision.finalBid) : null;
  const source = decision.source || null;
  const cost = decision.cost || 0;
  const minOk = cost > 0 ? cost * (1 + (decision.minMarginPct || 0) / 100) : 0;

  // —— 입력·단위 검증 ——
  if (!(notice.baseAmount > 0)) {
    issues.push(issue("danger", "NO_BASE", "기초·추정금액이 없습니다. 이 상태의 산정은 숫자 장난입니다."));
  }
  if (!usedPlanned) {
    issues.push(
      issue(
        "warn",
        "NO_PLANNED",
        "예정가격이 비어 있습니다. 나라장터 사정률은 낙찰÷예정가인데, 지금은 기초에 곱하고 있습니다. 개찰 전 추정은 참고만 하세요.",
      ),
    );
  } else if (notice.baseAmount > 0 && notice.plannedAmount > 0) {
    const k = notice.plannedAmount / notice.baseAmount;
    if (k < 0.92 || k > 1.08) {
      issues.push(
        issue(
          "warn",
          "PLANNED_RATIO",
          `예정/기초 비율이 ${k.toFixed(3)}입니다. 보통 0.95~1.05권인데 벗어납니다. 입력 자릿수·필드를 다시 보세요.`,
        ),
      );
    }
  }
  if (!(floorRate > 0)) {
    issues.push(issue("warn", "NO_FLOOR", "낙찰하한율이 없습니다. 하한 미만 무효를 검증할 수 없습니다."));
  }
  if (notice.category === "공사" && !(Number(notice.aValue) > 0)) {
    issues.push(
      issue(
        "caution",
        "CHECK_A",
        "공사 공고입니다. 적격·A값 적용 공고면 원문에서 A값(연금·보험·안전관리비 등 합)을 확인해 D안에 넣으세요.",
      ),
    );
  }
  if (calc.yegaFromNotice == null && !(calc.stats?.yegaN > 0) && !(notice.yegaRateHint > 0)) {
    issues.push(
      issue(
        "warn",
        "NO_YEGA",
        "예가사정율(예정÷기초) 근거가 없습니다. 인포식 하한밀착(D안)은 예가 추정 없이 못 씁니다. 예정가·예상 예가사정율을 넣으세요.",
      ),
    );
  }
  if (Number(notice.netCost) > 0 && calc.formula?.rows?.length) {
    const hug = calc.formula.rows.find((r) => r.id === "floorHug");
    const net = calc.formula.rows.find((r) => r.id === "netCost");
    if (hug && net && net.bid > hug.bid * 1.001) {
      issues.push(
        issue(
          "warn",
          "NET_COST_HIGHER",
          `순공사원가 산식(${Math.round(net.bid).toLocaleString("ko-KR")}원)이 하한밀착보다 높습니다. 낮은 쪽으로 내면 순공사 98% 룰에 걸릴 수 있습니다.`,
        ),
      );
    }
  }

  // —— 표본 품질 ——
  const kindN = calc.stats?.kindN || 0;
  const yearN = calc.stats?.yearN || 0;
  const sameN = calc.sameAwarded?.length || 0;
  if (kindN === 0 && yearN === 0 && sameN === 0) {
    issues.push(
      issue(
        "danger",
        "NO_SAMPLE",
        `「${notice.kind || "해당 종류"}」 낙찰 표본이 0건입니다. 추천가를 믿지 마세요. 공고 원문·유사 실적으로 사람이 직접 잡으세요.`,
      ),
    );
  } else {
    if (kindN > 0 && kindN < 3) {
      issues.push(
        issue("warn", "THIN_A", `A안 표본 ${kindN}건뿐입니다. 중앙값은 흔들립니다. ‘경향’이지 ‘정답’이 아닙니다.`),
      );
    }
    if (yearN > 0 && yearN < 3) {
      issues.push(issue("warn", "THIN_B", `B안 1년 표본 ${yearN}건뿐입니다. 최빈 구간 신뢰도가 낮습니다.`));
    }
    if (calc.stats?.sameScope && String(calc.stats.sameScope).startsWith("유사")) {
      issues.push(
        issue(
          "warn",
          "SIMILAR_NOT_SAME",
          `C안이 「${calc.stats.sameScope}」입니다. 동일 공고 재투찰이 아닙니다. 금액·조건이 다르면 사정률을 그대로 가져오지 마세요.`,
        ),
      );
    }
  }

  const kindRates = (calc.kindCases || []).map((c) => c.rate).filter((r) => r != null);
  if (kindRates.length >= 2) {
    const spread = Math.max(...kindRates) - Math.min(...kindRates);
    if (spread >= 0.05) {
      issues.push(
        issue(
          "warn",
          "WIDE_SPREAD",
          `동일종류 사정률 폭이 ${(spread * 100).toFixed(1)}%p입니다. 한 점으로 찍기 위험합니다. 구간만 보고 보수적으로 잡으세요.`,
        ),
      );
    }
    const sd = stddev(kindRates);
    if (sd != null && sd >= 0.025) {
      issues.push(
        issue("caution", "HIGH_VOL", `사정률 표준편차 ${pct(sd)}. 시장이 들쭉날쭉합니다. A안 중앙값만 따라가면 집니다.`),
      );
    }
  }

  // —— 안 간 괴리 ——
  if (plans.length >= 2) {
    const bids = plans.map((p) => p.bid);
    const maxB = Math.max(...bids);
    const minB = Math.min(...bids);
    if (ref > 0 && (maxB - minB) / ref >= 0.02) {
      issues.push(
        issue(
          "warn",
          "PLAN_DIVERGE",
          `A/B/C 추천가 차이가 ${won(maxB - minB)}(${(((maxB - minB) / ref) * 100).toFixed(2)}%p)입니다. 안을 하나만 맹신하면 근거가 편향됩니다.`,
        ),
      );
    }
  }

  // —— 각 안 자체 검증 ——
  for (const p of calc.plans || []) {
    if (p.disabled || p.bid == null) continue;
    const rate = ref > 0 ? p.bid / ref : null;
    if (floor > 0 && p.bid < floor) {
      issues.push(
        issue("danger", `FLOOR_${p.id}`, `${p.id}안 ${won(p.bid)}은 하한 ${won(floor)} 미만입니다. 그대로 내면 무효입니다.`),
      );
    }
    if (floorRate > 0 && rate != null && rate + 1e-9 < floorRate) {
      issues.push(
        issue(
          "danger",
          `RATE_BELOW_FLOOR_${p.id}`,
          `${p.id}안 사정률 ${pct(rate)} < 하한율 ${pct(floorRate)}. 산정 로직·입력을 의심하세요.`,
        ),
      );
    }
    if (rate != null && (rate < 0.75 || rate > 1.02)) {
      issues.push(
        issue(
          "warn",
          `RATE_OUTLIER_${p.id}`,
          `${p.id}안 사정률 ${pct(rate)}은 일반 용역 체감(대략 85~100%)에서 벗어납니다. 표본 오염·예정가 오류를 먼저 의심하세요.`,
        ),
      );
    }
    if (floor > 0 && p.bid <= floor * 1.002 && p.bid >= floor) {
      issues.push(
        issue(
          "caution",
          `FLOOR_HUG_${p.id}`,
          `${p.id}안이 하한에 거의 붙어 있습니다. 추첨·동점·원가 리스크를 감수할 때만 쓰세요.`,
        ),
      );
    }
  }

  // —— 선택·확정가 검증 ——
  if (source && source !== "custom") {
    const chosen = (calc.plans || []).find((p) => p.id === source);
    if (!chosen || chosen.disabled) {
      issues.push(
        issue("danger", "BAD_SOURCE", `${source}안을 골랐지만 그 안은 비활성·산출 불가입니다. 근거 없는 선택입니다.`),
      );
    } else if (sameN >= 1 && source === "A" && calc.stats?.sameScope === "동일·재공고") {
      issues.push(
        issue(
          "warn",
          "IGNORE_SAME",
          "동일·재공고 낙찰이 있는데 A안(종류 중앙값)만 보면 근거가 약합니다. C안을 먼저 대조하세요.",
        ),
      );
    }
  }

  if (finalBid != null) {
    const finalRate = ref > 0 ? finalBid / ref : null;
    if (floor > 0 && finalBid < floor) {
      issues.push(
        issue("danger", "FINAL_FLOOR", `확정가 ${won(finalBid)}는 하한 ${won(floor)} 미만입니다. 내면 탈락·무효입니다.`),
      );
    }
    if (cost > 0 && finalBid < minOk) {
      issues.push(
        issue(
          "danger",
          "FINAL_MARGIN",
          `확정가 ${won(finalBid)}는 최소 수용선 ${won(minOk)} 아래입니다. 이기면 적자입니다.`,
        ),
      );
    } else if (cost > 0 && finalBid < cost * 1.03) {
      issues.push(
        issue("warn", "THIN_MARGIN", `확정가 마진이 원가 대비 빠듯합니다(원가 ${won(cost)}). 돌발비용 여유를 보세요.`),
      );
    }
    if (plans.length) {
      const lo = Math.min(...plans.map((p) => (p.range ? p.range[0] : p.bid)));
      const hi = Math.max(...plans.map((p) => (p.range ? p.range[1] : p.bid)));
      if (finalBid < lo * 0.98 || finalBid > hi * 1.02) {
        issues.push(
          issue(
            "warn",
            "FINAL_OUTSIDE",
            `확정가 ${won(finalBid)}가 활성 안 구간(${won(lo)}~${won(hi)}) 밖입니다. 감으로 밀고 있다면 근거를 메모에 남기세요.`,
          ),
        );
      }
    }
    if (finalRate != null && floorRate > 0 && Math.abs(finalRate - floorRate) < 0.0015) {
      issues.push(
        issue("caution", "FINAL_FLOOR_HUG", "확정가가 하한율에 거의 붙었습니다. 의도한 하한 밀착인지 확인하세요."),
      );
    }
    if (source === "custom" && plans.length >= 1) {
      issues.push(
        issue("caution", "CUSTOM", "직접 입력입니다. A/B/C와 어긋나면 ‘왜 다른지’를 한 줄이라도 적으세요."),
      );
    }
  }

  // —— 등급 ——
  const hasDanger = issues.some((i) => i.level === "danger");
  const hasWarn = issues.some((i) => i.level === "warn");
  let tone = "ok";
  if (hasDanger) tone = "reject";
  else if (hasWarn) tone = "caution";
  else if (issues.some((i) => i.level === "caution")) tone = "caution";

  let score = 80;
  for (const i of issues) {
    if (i.level === "danger") score -= 25;
    else if (i.level === "warn") score -= 12;
    else score -= 5;
  }
  if (usedPlanned) score += 5;
  if (kindN >= 5) score += 5;
  if (sameN >= 1 && calc.stats?.sameScope === "동일·재공고") score += 5;
  score = Math.max(0, Math.min(100, score));

  const headlines = [];
  if (tone === "reject") {
    headlines.push("이 산정·확정 근거로는 투찰하면 안 됩니다. 위험 항목을 먼저 고치세요.");
  } else if (tone === "caution") {
    headlines.push("쓸 수는 있으나, 아래 이의제기를 무시하면 근거가 무너집니다.");
  } else if (plans.length) {
    headlines.push("치명 오류는 안 보입니다. 그래도 표본·예정가·하한은 한 번 더 대조하세요.");
  } else {
    headlines.push("추천 안이 없습니다. 숫자 없이 감으로 가지 마세요.");
  }

  // 추천 한 줄
  let recommendation = "";
  const enabled = plans.slice().sort((a, b) => {
    // 동일공고 C 우선, 그다음 표본 많은 쪽
    const rank = { C: 0, A: 1, B: 2 };
    return (rank[a.id] ?? 9) - (rank[b.id] ?? 9);
  });
  if (hasDanger && finalBid != null && floor > 0 && finalBid < floor) {
    recommendation = `하한 ${won(floor)} 이상으로 다시 잡으세요.`;
  } else if (enabled[0]) {
    const best = enabled[0];
    recommendation = `우선 대조: ${best.id}안 ${won(best.bid)} (${best.name}). 다른 안과 ${won(
      Math.abs((enabled[1]?.bid ?? best.bid) - best.bid),
    )} 차이면 이유를 적으세요.`;
  } else {
    recommendation = "표본을 더 모으거나, 공고 원문 하한·예정가부터 확정하세요.";
  }

  return {
    tone,
    score,
    headlines,
    issues,
    recommendation,
    meta: {
      ref,
      floor,
      floorRate,
      usedPlanned,
      kindN,
      yearN,
      sameN,
      planCount: plans.length,
    },
  };
}

export function critiqueLevelLabel(tone) {
  if (tone === "reject") return "반려 수준";
  if (tone === "caution") return "주의";
  return "통과(조건부)";
}
