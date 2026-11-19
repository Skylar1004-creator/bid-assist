/** 산정 기준 3안 — 지역 표본이 부족하면 전국·유사종류로 넓힘 */

export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  if (next === undefined) return sorted[base];
  return sorted[base] + rest * (next - sorted[base]);
}

export function daysBetween(asOf, dateStr) {
  const d = new Date(dateStr);
  return (asOf - d) / (1000 * 60 * 60 * 24);
}

export function withinLastYear(asOf, dateStr) {
  const days = daysBetween(asOf, dateStr);
  return days >= 0 && days <= 366;
}

function withSimilarity(notice, cases, asOf) {
  return cases
    .map((c) => {
      const priceDiff =
        notice.baseAmount > 0 ? Math.abs(c.base - notice.baseAmount) / notice.baseAmount : 1;
      let similarity = 60;
      if (c.region === notice.region) similarity += 15;
      if (c.kind === notice.kind) similarity += 15;
      if (priceDiff <= 0.15) similarity += 12;
      else if (priceDiff <= 0.35) similarity += 8;
      else if (priceDiff <= 0.6) similarity += 4;
      if (c.awardedAt && withinLastYear(asOf, c.awardedAt)) similarity += 5;
      return { ...c, similarity: Math.min(99, similarity) };
    })
    .sort((a, b) => b.similarity - a.similarity);
}

function awarded(history) {
  return history.filter((c) => c.award != null && c.rate != null && c.base > 0);
}

/** 1안 후보: 지역·종류 → 전국 종류 → 전국 석면 */
export function sameKindCases(notice, history, asOf = new Date()) {
  const pool = awarded(history);
  const region = notice.region || "경기";
  const kind = notice.kind;

  const steps = [
    {
      label: `${region}·동일종류`,
      cases: pool.filter((c) => c.region === region && c.kind === kind),
    },
    {
      label: `전국·동일종류`,
      cases: pool.filter((c) => c.kind === kind),
    },
    {
      label: `전국·석면용역`,
      cases: pool.filter((c) => String(c.kind || "").includes("석면") || String(c.title || "").includes("석면")),
    },
  ];

  for (const step of steps) {
    if (step.cases.length >= 3) {
      return {
        scope: step.label,
        cases: withSimilarity(notice, step.cases, asOf),
      };
    }
  }

  // 최소 1건이라도 있으면 씀
  for (const step of steps) {
    if (step.cases.length >= 1) {
      return {
        scope: `${step.label}(표본적음)`,
        cases: withSimilarity(notice, step.cases, asOf),
      };
    }
  }
  return { scope: "없음", cases: [] };
}

function rateBand(cases) {
  const step = 0.005;
  const buckets = new Map();
  for (const c of cases) {
    const key = Math.floor(c.rate / step) * step;
    const list = buckets.get(key) || [];
    list.push(c);
    buckets.set(key, list);
  }
  let bestKey = null;
  let bestList = [];
  for (const [key, list] of buckets) {
    if (list.length > bestList.length) {
      bestKey = key;
      bestList = list;
    }
  }
  if (bestKey == null) {
    return { band: null, midRate: null, count: 0, share: 0, bucketCases: [] };
  }
  const band = [bestKey, bestKey + step];
  return {
    band,
    midRate: (band[0] + band[1]) / 2,
    count: bestList.length,
    share: bestList.length / cases.length,
    bucketCases: bestList,
  };
}

/** 2안: 지역 1년 → 전국 1년 석면 */
export function yearHighProbBand(notice, history, asOf = new Date()) {
  const region = notice.region || "경기";
  const pool = awarded(history).filter(
    (c) =>
      (String(c.kind || "").includes("석면") || String(c.title || "").includes("석면")) &&
      c.awardedAt &&
      withinLastYear(asOf, c.awardedAt),
  );

  const steps = [
    { label: `${region} 1년`, cases: pool.filter((c) => c.region === region) },
    { label: "전국 1년", cases: pool },
  ];

  for (const step of steps) {
    if (step.cases.length >= 3) {
      const band = rateBand(step.cases);
      if (band.band) {
        return { scope: step.label, yearCases: step.cases, ...band };
      }
    }
  }

  for (const step of steps) {
    if (step.cases.length >= 1) {
      const rates = step.cases.map((c) => c.rate).sort((a, b) => a - b);
      const p50 = quantile(rates, 0.5);
      const p25 = quantile(rates, 0.25) ?? p50;
      const p75 = quantile(rates, 0.75) ?? p50;
      return {
        scope: `${step.label}(중앙값)`,
        yearCases: step.cases,
        band: [p25, p75],
        midRate: p50,
        count: step.cases.length,
        share: 1,
        bucketCases: step.cases,
      };
    }
  }

  return {
    scope: "없음",
    yearCases: [],
    band: null,
    midRate: null,
    count: 0,
    share: 0,
    bucketCases: [],
  };
}

function normalizeTitle(title = "") {
  return String(title)
    .replace(/\(.*?\)/g, "")
    .replace(/재공고|유찰|1차|2차|용역|수의계약|안내공고/g, "")
    .replace(/\s+/g, "")
    .trim();
}

export function titlesLikelySame(a = "", b = "") {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na.length < 6 || nb.length < 6) return false;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (longer.includes(shorter) && shorter.length >= 8) return true;
  let hit = 0;
  for (let i = 0; i <= shorter.length - 4; i += 2) {
    if (longer.includes(shorter.slice(i, i + 4))) hit += 1;
  }
  return hit >= 3;
}

/** 학교명 등 핵심 토큰 */
function coreTokens(title = "") {
  const t = String(title);
  const school = t.match(/([가-힣A-Za-z0-9]+(?:초|고|중|초등학교|중학교|고등학교|대학교))/);
  const tokens = [];
  if (school) tokens.push(school[1].replace(/등학교|학교/g, ""));
  if (t.includes("석면농도")) tokens.push("석면농도");
  if (t.includes("비산")) tokens.push("비산");
  return tokens;
}

/** 3안: 동일공고 → 없으면 유사 학교·측정 낙찰 */
export function sameNoticeHistory(notice, history) {
  const exact = history
    .filter((c) => {
      if (notice.noticeKey && c.noticeKey && notice.noticeKey === c.noticeKey) return true;
      if (notice.refNo && c.refNo && notice.refNo === c.refNo) return true;
      return titlesLikelySame(notice.title, c.title);
    })
    .sort((a, b) => new Date(b.awardedAt || 0) - new Date(a.awardedAt || 0));

  if (exact.length) return { scope: "동일·재공고", cases: exact };

  const tokens = coreTokens(notice.title);
  const similar = awarded(history)
    .filter((c) => {
      if (notice.kind && c.kind && c.kind !== notice.kind) return false;
      const title = c.title || "";
      if (!String(c.kind || title).includes("석면")) return false;
      if (tokens.length && tokens.some((tok) => title.includes(tok))) return true;
      // 금액대 ±40% 유사 측정
      if (notice.baseAmount > 0 && c.base > 0) {
        const diff = Math.abs(c.base - notice.baseAmount) / notice.baseAmount;
        return diff <= 0.4 && title.includes("측정");
      }
      return false;
    })
    .sort((a, b) => new Date(b.awardedAt || 0) - new Date(a.awardedAt || 0));

  return { scope: similar.length ? "유사측정 낙찰" : "없음", cases: similar };
}

export function calcPlans(notice, history, { cost = 0, minMarginPct = 0, asOf = new Date() } = {}) {
  const floor = notice.baseAmount > 0 && notice.floorRate > 0 ? notice.baseAmount * notice.floorRate : 0;
  const minOk = cost * (1 + minMarginPct / 100);
  const region = notice.region || "경기";

  const kindPack = sameKindCases(notice, history, asOf);
  const kindCases = kindPack.cases;
  const kindRates = kindCases.map((c) => c.rate).sort((a, b) => a - b);
  const kindP25 = quantile(kindRates, 0.25);
  const kindP50 = quantile(kindRates, 0.5);
  const kindP75 = quantile(kindRates, 0.75);
  const kindOk = kindCases.length >= 1 && kindP50 != null;
  const bidA = kindOk ? notice.baseAmount * kindP50 : null;
  const rangeA =
    kindOk && kindP25 != null && kindP75 != null
      ? [notice.baseAmount * kindP25, notice.baseAmount * kindP75]
      : kindOk
        ? [bidA * 0.99, bidA * 1.01]
        : null;

  const year = yearHighProbBand(notice, history, asOf);
  const bandOk = year.midRate != null && year.band != null;
  const bidB = bandOk ? notice.baseAmount * year.midRate : null;
  const rangeB = bandOk
    ? [notice.baseAmount * year.band[0], notice.baseAmount * year.band[1]]
    : null;

  const samePack = sameNoticeHistory(notice, history);
  const sameAll = samePack.cases;
  const same = sameAll.filter((c) => c.award != null && c.rate != null);
  const sameRates = same.map((c) => c.rate).sort((a, b) => a - b);
  const sameP50 = quantile(sameRates, 0.5);
  const sameOk = same.length >= 1 && sameP50 != null;
  const latest = same[0];
  const bidC = sameOk
    ? same.length === 1
      ? notice.baseAmount * latest.rate
      : notice.baseAmount * sameP50
    : null;
  const rangeC = sameOk
    ? same.length === 1
      ? [bidC * 0.995, bidC * 1.005]
      : [notice.baseAmount * sameRates[0], notice.baseAmount * sameRates[sameRates.length - 1]]
    : null;

  const pct = (n) => `${(n * 100).toFixed(2)}%`;

  const flag = (bid) => {
    if (bid == null) return { kind: "warn", text: "표본 부족 · 참고 불가" };
    if (floor > 0 && bid < floor) return { kind: "danger", text: "공고 하한 미만 · 무효 위험" };
    if (cost > 0 && bid < minOk) return { kind: "warn", text: "최소 수용 마진 미달" };
    return { kind: "ok", text: "하한·원가 조건 충족" };
  };

  return {
    floor,
    minOk,
    kindCases,
    year: { ...year, yearCases: year.yearCases || [] },
    sameAll,
    sameAwarded: same,
    stats: {
      kindN: kindCases.length,
      kindP50,
      kindScope: kindPack.scope,
      yearN: (year.yearCases || []).length,
      yearShare: year.share,
      yearScope: year.scope,
      sameN: sameAll.length,
      sameScope: samePack.scope,
    },
    plans: [
      {
        id: "A",
        name: "동일종류 낙찰",
        why: kindOk
          ? `${kindPack.scope} ${kindCases.length}건 · 사정률 중앙값 ${pct(kindP50)}`
          : "동일·유사 종류 낙찰 표본이 없습니다.",
        bid: bidA,
        range: rangeA,
        flag: flag(bidA),
        disabled: !kindOk,
      },
      {
        id: "B",
        name: "1년 고확률 구간",
        why: bandOk
          ? `${year.scope} ${year.yearCases.length}건 · 구간 ${pct(year.band[0])}~${pct(year.band[1])}`
          : "최근 1년 석면 용역 표본이 없습니다.",
        bid: bidB,
        range: rangeB,
        flag: flag(bidB),
        disabled: !bandOk,
      },
      {
        id: "C",
        name: "동일·유사 공고 이력",
        why: sameOk
          ? samePack.scope === "동일·재공고"
            ? same.length === 1
              ? `동일 공고 직전 낙찰 사정률 ${pct(latest.rate)} (${latest.awardedAt || "-"})`
              : `동일·재공고 낙찰 ${same.length}건 중앙값 ${pct(sameP50)}`
            : `유사 측정 낙찰 ${same.length}건 사정률 중앙값 ${pct(sameP50)}`
          : "동일·유사 공고 낙찰 이력이 없습니다.",
        bid: bidC,
        range: rangeC,
        flag: flag(bidC),
        disabled: !sameOk,
      },
    ],
  };
}

export function inferKind(title = "") {
  if (title.includes("해체")) return "석면해체전측정";
  if (title.includes("석면")) return "석면농도·비산측정";
  return "기타";
}

export function inferRegion(agency = "", regionName = "") {
  const text = `${agency} ${regionName}`;
  if (/경기|수원|고양|성남|용인|부천|안산|안양|남양주|화성|평택|의정부|시흥|파주|김포|광명|광주|군포|하남|오산|이천|양주|구리|안성|포천|의왕|여주|동두천|과천|가평|연천/.test(text)) {
    return "경기";
  }
  if (text.includes("서울")) return "서울";
  if (text.includes("인천")) return "인천";
  if (/경남|창원|김해|양산|진주|거제|통영|사천|밀양|함안|창녕|고성|하동|합천|거창|함양|산청|의령|남해/.test(text)) {
    return "경남";
  }
  return "기타";
}

export function inferNoticeKey(title = "", agency = "") {
  const t = title.replace(/\s+/g, "");
  if (t.includes("경기도청") && t.includes("옛청사") && t.includes("석면")) return "gg-old-hall-asbestos";
  if (agency.includes("수원") && t.includes("석면") && t.includes("해체")) return "suwon-asbestos-pre";
  if (t.includes("김해동광") && t.includes("석면")) return "gimhae-donggwang-asbestos";
  return null;
}

// 하위 호환 export
export const gyeonggiSameKindCases = (notice, history, asOf) =>
  sameKindCases(notice, history, asOf).cases;
export const gyeonggiYearBand = (history, asOf, region) =>
  yearHighProbBand({ region }, history, asOf);
