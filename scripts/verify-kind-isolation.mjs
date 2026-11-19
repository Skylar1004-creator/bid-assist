import fs from "fs";
import {
  calcPlans,
  resolveNoticeKind,
  sameKindCases,
  yearHighProbBand,
  sameNoticeHistory,
  kindFamily,
} from "../js/calc.js";

const hist = JSON.parse(
  fs.readFileSync(new URL("../data/history.json", import.meta.url), "utf8"),
).items;

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

const asOf = new Date("2026-11-19");

assert(resolveNoticeKind("학교 청소용역", "석면농도·비산측정") === "청소", "청소 제목 > 석면 선택");
assert(resolveNoticeKind("정밀안전진단", "청소") === "안전진단", "안전진단 제목 > 청소 선택");
assert(resolveNoticeKind("석면농도 측정", "청소") === "석면농도·비산측정", "석면 제목 > 청소 선택");
assert(resolveNoticeKind("일반 용역", "청소") === "기타용역", "용역 제목 → 기타용역");
assert(resolveNoticeKind("단순안내", "경비·보안") === "경비·보안", "단서 없으면 선택값 유지");
assert(resolveNoticeKind("단순안내", "우리만의종류") === "우리만의종류", "직접 입력 종류 유지");

for (const kind of ["청소", "안전진단", "기타"]) {
  const title =
    kind === "청소" ? "OO학교 청소용역" : kind === "안전진단" ? "OO 정밀안전진단" : "단순안내";
  const notice = {
    title,
    agency: "수원시",
    baseAmount: 20_000_000,
    plannedAmount: 20_200_000,
    floorRate: 0.87,
    region: "경기",
    kind,
  };

  const packs = [
    sameKindCases(notice, hist, asOf),
    yearHighProbBand(notice, hist, asOf),
    sameNoticeHistory(notice, hist),
  ];
  for (const p of packs) {
    const cases = p.cases || p.yearCases || [];
    const bad = cases.filter((c) => kindFamily(c.kind) !== kindFamily(kind));
    assert(bad.length === 0, `${kind} 수집경로 타계열 0 (n=${cases.length})`);
  }

  // 석면이 선택돼 있어도 제목이 청소/안전이면 석면 표본 금지
  const calc = calcPlans({ ...notice, kind: "석면농도·비산측정" }, hist, { asOf });
  const resolved = resolveNoticeKind(notice.title, "석면농도·비산측정");
  const all = [...calc.kindCases, ...calc.year.yearCases, ...calc.sameAll];
  const leaked = all.filter((c) => kindFamily(c.kind) !== kindFamily(resolved));
  assert(leaked.length === 0, `calcPlans ${title} → ${resolved} 누수 0`);
  if (kind === "청소" || kind === "안전진단") {
    assert(resolved === kind, `${kind}으로 resolve`);
    assert(all.every((c) => kindFamily(c.kind) === kindFamily(kind)), `${kind}만`);
    assert(calc.plans.every((p) => p.disabled), `${kind} 이력 없으면 3안 모두 비활성`);
  }
}

const asbestos = {
  title: "석면농도 측정",
  agency: "김해",
  baseAmount: 13_684_000,
  plannedAmount: 13_909_925,
  floorRate: 0.9,
  region: "경남",
  kind: "청소", // 잘못된 선택
};
const aCalc = calcPlans(asbestos, hist, { asOf });
assert(
  [...aCalc.kindCases, ...aCalc.year.yearCases, ...aCalc.sameAll].every(
    (c) => kindFamily(c.kind) === "asbestos",
  ),
  "석면 제목이면 석면 표본만",
);
assert(aCalc.kindCases.length >= 1, "석면 1안 표본 존재");

// 선택만 청소(제목 무관 단서 없음) → 석면 이력 금지
const cleanOnly = calcPlans(
  {
    title: "용역 안내",
    agency: "수원",
    baseAmount: 10_000_000,
    kind: "청소",
    region: "경기",
    floorRate: 0.87,
  },
  hist,
  { asOf },
);
assert(cleanOnly.kindCases.length === 0, "청소 선택·비스석면 제목 → 1안 0건");
assert(cleanOnly.year.yearCases.length === 0, "청소 선택 → 2안 0건");
assert(
  cleanOnly.sameAll.every((c) => c.kind === "청소"),
  "청소 선택 → 3안도 청소만",
);

if (process.exitCode) {
  console.error("kind isolation FAILED");
  process.exit(1);
}
console.log("kind isolation PASSED");
