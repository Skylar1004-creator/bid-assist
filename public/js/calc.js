/** 산정 기준 3안 — 지역 표본이 부족하면 전국·유사종류로 넓힘
 * 사정률(투찰률) = 낙찰가 ÷ 예정가격 (나라장터 표시와 동일, 기초금액 대비 아님)
 */

/** 나라장터 사정률 재현: 낙찰 ÷ 예정가 */
export function officialBidRate(award, planned) {
  if (award == null || planned == null || !(planned > 0)) return null;
  return award / planned;
}

/** 투찰·구간 기준 금액: 예정가 우선, 없으면 기초 */
export function bidReferenceAmount(notice) {
  if (notice.plannedAmount != null && notice.plannedAmount > 0) return notice.plannedAmount;
  if (notice.planned != null && notice.planned > 0) return notice.planned;
  return notice.baseAmount > 0 ? notice.baseAmount : 0;
}

/** 이력 행 사정률을 예정가 대비로 맞춤 */
export function normalizeHistoryRate(c) {
  if (c.failed) return c;
  if (c.award != null && c.planned != null && c.planned > 0) {
    return {
      ...c,
      rate: officialBidRate(c.award, c.planned),
      rateBasis: c.rateBasis === "추정예정가" ? "추정예정가" : "예정가",
    };
  }
  return c;
}

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
  return history
    .map(normalizeHistoryRate)
    .filter((c) => c.award != null && c.rate != null && c.base > 0);
}

/** 자주 쓰는 종류 제안(직접 입력도 가능) */
export const KIND_OPTIONS = [
  "청소",
  "석면농도·비산측정",
  "석면해체전측정",
  "안전진단",
  "시설물유지·보수",
  "경비·보안",
  "조경",
  "폐기물·환경",
  "정보시스템·IT",
  "교육·연수",
  "설계·감리",
  "공사",
  "물품",
  "기타용역",
  "기타",
];

/** 종류 계열 — 서로 다른 종류는 표본을 섞지 않음(석면 세부만 예외) */
export function kindFamily(kind = "") {
  const k = String(kind || "").trim();
  if (!k || k === "기타") return "other";
  if (k.includes("석면")) return "asbestos";
  if (/청소|미화/.test(k)) return "cleaning";
  if (/안전진단|정밀안전|내진/.test(k)) return "safety";
  if (/시설물|유지|보수|점검/.test(k) && !/안전진단|석면/.test(k)) return "facility";
  if (/경비|보안|청원경찰/.test(k)) return "security";
  if (/조경|수목/.test(k)) return "landscape";
  if (/폐기물|환경|음식물/.test(k)) return "waste";
  if (/정보|시스템|IT|소프트웨어|유지관리\s*용역/.test(k)) return "it";
  if (/교육|연수|강의/.test(k)) return "edu";
  if (/설계|감리/.test(k)) return "design";
  if (k === "공사" || /공사$/.test(k)) return "construction";
  if (k === "물품" || /구매|납품/.test(k)) return "goods";
  return `solo:${k}`;
}

export function sameKindFamily(a, b) {
  const fa = kindFamily(a);
  const fb = kindFamily(b);
  if (fa === "other" || fb === "other") return String(a) === String(b);
  return fa === fb;
}

/**
 * 이력 건이 이번 공고 종류에 속하는지 — 저장된 kind만 신뢰(제목 추정으로 편입 금지).
 * 석면만 농도↔해체 계열 허용. 청소·안전진단·기타는 종류 문자열 완전 일치만.
 */
export function matchesNoticeKind(c, noticeKind) {
  const want = noticeKind || "기타";
  const got = c?.kind || "기타";
  const family = kindFamily(want);
  if (family === "other") return got === "기타";
  if (family === "asbestos") return kindFamily(got) === "asbestos";
  return got === want;
}

/** 표본 누수 차단: 다른 계열이 한 건이라도 있으면 전부 제외 */
export function guardKindCases(cases, noticeKind) {
  return (cases || []).filter((c) => matchesNoticeKind(c, noticeKind));
}

/**
 * 공고명 단서가 있으면 공고명 우선. 없으면 사용자가 고른/적은 종류 그대로(직접 입력 허용).
 */
export function resolveNoticeKind(title = "", selected = "") {
  const fromTitle = inferKind(title);
  if (fromTitle !== "기타") return fromTitle;
  const sel = String(selected || "").trim();
  return sel || "기타";
}

function pickScoped(steps, notice, asOf) {
  const kind = notice.kind || "기타";
  for (const step of steps) {
    const cases = guardKindCases(step.cases, kind);
    if (cases.length >= 3) {
      return { scope: step.label, cases: withSimilarity(notice, cases, asOf) };
    }
  }
  for (const step of steps) {
    const cases = guardKindCases(step.cases, kind);
    if (cases.length >= 1) {
      return {
        scope: `${step.label}(표본적음)`,
        cases: withSimilarity(notice, cases, asOf),
      };
    }
  }
  return { scope: `${kind} 표본 없음`, cases: [] };
}

/** 1안: 지역·동일종류 → 전국·동일종류 → (석면만) 전국 석면계열 */
export function sameKindCases(notice, history, asOf = new Date()) {
  const pool = awarded(history);
  const region = notice.region || "경기";
  const kind = notice.kind || "기타";
  const family = kindFamily(kind);

  const steps = [
    {
      label: `${region}·${kind}`,
      cases: pool.filter((c) => c.region === region && c.kind === kind),
    },
    {
      label: `전국·${kind}`,
      cases: pool.filter((c) => c.kind === kind),
    },
  ];

  // 석면만 세부종류 사이를 넓힘. 그 외 계열은 절대 교차하지 않음.
  if (family === "asbestos") {
    steps.push({
      label: "전국·석면계열",
      cases: pool.filter((c) => kindFamily(c.kind) === "asbestos"),
    });
  }

  return pickScoped(steps, notice, asOf);
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

/** 2안: 같은 종류만 · 지역 1년 → 전국 1년 (다른 계열 혼입 금지) */
export function yearHighProbBand(notice, history, asOf = new Date()) {
  const region = notice.region || "경기";
  const kind = notice.kind || "기타";
  const pool = awarded(history).filter(
    (c) => matchesNoticeKind(c, kind) && c.awardedAt && withinLastYear(asOf, c.awardedAt),
  );

  const steps = [
    {
      label: `${region}·${kind} 1년`,
      cases: pool.filter((c) => c.region === region && c.kind === kind),
    },
    {
      label: `${region}·동계열 1년`,
      cases: pool.filter((c) => c.region === region),
    },
    {
      label: `전국·${kind} 1년`,
      cases: pool.filter((c) => c.kind === kind),
    },
    { label: `전국·동계열 1년`, cases: pool },
  ];

  for (const step of steps) {
    const cases = guardKindCases(step.cases, kind);
    if (cases.length >= 3) {
      const band = rateBand(cases);
      if (band.band) {
        return { scope: step.label, yearCases: cases, ...band };
      }
    }
  }

  for (const step of steps) {
    const cases = guardKindCases(step.cases, kind);
    if (cases.length >= 1) {
      const rates = cases.map((c) => c.rate).sort((a, b) => a - b);
      const p50 = quantile(rates, 0.5);
      const p25 = quantile(rates, 0.25) ?? p50;
      const p75 = quantile(rates, 0.75) ?? p50;
      return {
        scope: `${step.label}(중앙값)`,
        yearCases: cases,
        band: [p25, p75],
        midRate: p50,
        count: cases.length,
        share: 1,
        bucketCases: cases,
      };
    }
  }

  return {
    scope: `${kind} 1년 표본 없음`,
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

/** 3안: 동일공고(같은 종류만) → 없으면 유사·같은 종류 */
export function sameNoticeHistory(notice, history) {
  const kind = notice.kind || "기타";
  const all = history.map(normalizeHistoryRate);
  const exact = all
    .filter((c) => {
      if (!matchesNoticeKind(c, kind)) return false;
      if (notice.noticeKey && c.noticeKey && notice.noticeKey === c.noticeKey) return true;
      if (notice.refNo && c.refNo && notice.refNo === c.refNo) return true;
      return false;
    })
    .sort((a, b) => new Date(b.awardedAt || 0) - new Date(a.awardedAt || 0));

  if (exact.length) return { scope: "동일·재공고", cases: guardKindCases(exact, kind) };

  const tokens = coreTokens(notice.title);
  const similar = awarded(history)
    .filter((c) => {
      if (!matchesNoticeKind(c, kind)) return false;
      const title = c.title || "";
      if (titlesLikelySame(notice.title, title)) return true;
      if (tokens.length && tokens.some((tok) => title.includes(tok))) return true;
      if (notice.baseAmount > 0 && c.base > 0) {
        const diff = Math.abs(c.base - notice.baseAmount) / notice.baseAmount;
        return diff <= 0.4;
      }
      return false;
    })
    .sort((a, b) => new Date(b.awardedAt || 0) - new Date(a.awardedAt || 0));

  const guarded = guardKindCases(similar, kind);
  return { scope: guarded.length ? `유사·${kind} 낙찰` : "없음", cases: guarded };
}

export function calcPlans(notice, history, { cost = 0, minMarginPct = 0, asOf = new Date() } = {}) {
  const resolvedKind = resolveNoticeKind(notice.title, notice.kind);
  notice = { ...notice, kind: resolvedKind };

  const floor = notice.baseAmount > 0 && notice.floorRate > 0 ? notice.baseAmount * notice.floorRate : 0;
  const minOk = cost * (1 + minMarginPct / 100);
  const ref = bidReferenceAmount(notice);
  const usedPlanned = Boolean(
    (notice.plannedAmount != null && notice.plannedAmount > 0) ||
      (notice.planned != null && notice.planned > 0)
  );

  const kindPack = sameKindCases(notice, history, asOf);
  const kindCases = guardKindCases(kindPack.cases, resolvedKind);
  const kindRates = kindCases.map((c) => c.rate).sort((a, b) => a - b);
  const kindP25 = quantile(kindRates, 0.25);
  const kindP50 = quantile(kindRates, 0.5);
  const kindP75 = quantile(kindRates, 0.75);
  const kindOk = kindCases.length >= 1 && kindP50 != null && ref > 0;
  const bidA = kindOk ? ref * kindP50 : null;
  const rangeA =
    kindOk && kindP25 != null && kindP75 != null
      ? [ref * kindP25, ref * kindP75]
      : kindOk
        ? [bidA * 0.99, bidA * 1.01]
        : null;

  const yearRaw = yearHighProbBand(notice, history, asOf);
  const yearCases = guardKindCases(yearRaw.yearCases, resolvedKind);
  const year = { ...yearRaw, yearCases };
  const bandOk = year.midRate != null && year.band != null && ref > 0 && yearCases.length >= 1;
  const bidB = bandOk ? ref * year.midRate : null;
  const rangeB = bandOk ? [ref * year.band[0], ref * year.band[1]] : null;

  const samePack = sameNoticeHistory(notice, history);
  const sameAll = guardKindCases(samePack.cases, resolvedKind);
  const same = sameAll.filter((c) => c.award != null && c.rate != null);
  const sameRates = same.map((c) => c.rate).sort((a, b) => a - b);
  const sameP50 = quantile(sameRates, 0.5);
  const sameOk = same.length >= 1 && sameP50 != null && ref > 0;
  const latest = same[0];
  const bidC = sameOk
    ? same.length === 1
      ? ref * latest.rate
      : ref * sameP50
    : null;
  const rangeC = sameOk
    ? same.length === 1
      ? [bidC * 0.995, bidC * 1.005]
      : [ref * sameRates[0], ref * sameRates[sameRates.length - 1]]
    : null;

  const pct = (n) => `${(n * 100).toFixed(2)}%`;
  const rateNote = usedPlanned ? "예정가×사정률" : "기초×사정률(예정가 미입력)";

  const flag = (bid) => {
    if (bid == null) return { kind: "warn", text: "표본 부족 · 참고 불가" };
    if (floor > 0 && bid < floor) return { kind: "danger", text: "공고 하한 미만 · 무효 위험" };
    if (cost > 0 && bid < minOk) return { kind: "warn", text: "최소 수용 마진 미달" };
    return { kind: "ok", text: "하한·원가 조건 충족" };
  };

  return {
    floor,
    minOk,
    refAmount: ref,
    usedPlanned,
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
          ? `${kindPack.scope} ${kindCases.length}건 · 사정률(예정가 대비) 중앙값 ${pct(kindP50)} · ${rateNote}`
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
          ? `${year.scope} ${year.yearCases.length}건 · 구간 ${pct(year.band[0])}~${pct(year.band[1])} · ${rateNote}`
          : `최근 1년 ${notice.kind || "해당 종류"} 표본이 없습니다.`,
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
              ? `동일 공고 직전 낙찰 사정률(예정가 대비) ${pct(latest.rate)} (${latest.awardedAt || "-"}) · ${rateNote}`
              : `동일·재공고 낙찰 ${same.length}건 중앙값 ${pct(sameP50)} · ${rateNote}`
            : `유사 측정 낙찰 ${same.length}건 사정률 중앙값 ${pct(sameP50)} · ${rateNote}`
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
  const t = String(title || "");
  if (/청소|미화|위생관리|청사\s*관리|건물관리/.test(t) && !t.includes("석면")) return "청소";
  if (/안전진단|정밀안전|내진성능|시설물\s*안전/.test(t)) return "안전진단";
  if (t.includes("석면") && t.includes("해체")) return "석면해체전측정";
  if (t.includes("해체") && /석면|해체전/.test(t)) return "석면해체전측정";
  if (t.includes("석면")) return "석면농도·비산측정";
  if (/경비|보안|청원경찰|시설경비/.test(t)) return "경비·보안";
  if (/조경|수목|잔디/.test(t)) return "조경";
  if (/폐기물|음식물|생활폐기|환경정화/.test(t)) return "폐기물·환경";
  if (/정보시스템|소프트웨어|전산|홈페이지|유지보수\s*용역|시스템\s*유지/.test(t)) {
    return "정보시스템·IT";
  }
  if (/교육|연수|강의|워크숍/.test(t)) return "교육·연수";
  if (/설계|감리/.test(t) && !/시공/.test(t)) return "설계·감리";
  if (/유지\s*보수|시설\s*관리|수선|점검\s*용역/.test(t)) return "시설물유지·보수";
  if (/공사|건설|토목|건축/.test(t) && !/용역/.test(t)) return "공사";
  if (/물품|구매|납품|장비\s*구입/.test(t)) return "물품";
  if (/용역/.test(t)) return "기타용역";
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
