import {
  resolveNoticeAmounts,
  bidFromBase,
  filterByBaseSimilarity,
} from "../js/base-amount.js";
import { calcPlans } from "../js/calc.js";
import { buildVerdict } from "../js/recommend.js";
import { critiqueCalc } from "../js/critique.js";
import fs from "fs";

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL", msg);
    process.exitCode = 1;
  } else console.log("ok", msg);
}

// 1) bssamt 우선, 추정·예산과 분리
{
  const a = resolveNoticeAmounts({
    bssamt: 10_000_000,
    presmptPrce: 8_500_000,
    asignBdgtAmt: 12_000_000,
  });
  assert(a.baseAmount === 10_000_000, "bssamt가 기초");
  assert(a.estimateAmount === 8_500_000, "추정 분리");
  assert(a.budgetAmount === 12_000_000, "예산 분리");
  assert(!a.baseIsProxy, "진짜 기초는 proxy 아님");
}

// 2) 기초 없으면 추정은 proxy
{
  const a = resolveNoticeAmounts({ presmptPrce: 8_500_000, asignBdgtAmt: 12_000_000 });
  assert(a.baseAmount === 8_500_000, "추정 대리 채움");
  assert(a.baseIsProxy && a.baseSource === "estimate", "proxy=estimate");
}

// 3) 인포식 투찰가 = 기초 × 예가 × 투찰률
{
  const bid = bidFromBase(10_000_000, 0.9, 1.01);
  assert(Math.round(bid) === 9_090_000, "기초×1.01×0.9");
}

// 4) 기초 유사 표본 필터
{
  const cases = [
    { base: 10_000_000, rate: 0.9 },
    { base: 10_500_000, rate: 0.91 },
    { base: 11_000_000, rate: 0.89 },
    { base: 50_000_000, rate: 0.88 },
  ];
  const f = filterByBaseSimilarity(cases, 10_000_000, { tight: 0.3, minN: 3 });
  assert(f.cases.length === 3, "±30% 3건");
  assert(!f.cases.some((c) => c.base === 50_000_000), "규모 다른 건 제외");
}

const hist = JSON.parse(
  fs.readFileSync(new URL("../data/history.json", import.meta.url), "utf8"),
).items;
const asOf = new Date("2026-11-19");

// 5) proxy 기초 → 신 판정 blocked + 이의 danger
{
  const notice = {
    title: "김해동광초 석면농도",
    kind: "석면농도·비산측정",
    baseAmount: 13_684_000,
    baseIsProxy: true,
    baseSource: "estimate",
    plannedAmount: 13_909_925,
    floorRate: 0.9,
    region: "경남",
    method: "전자입찰(최저가)",
  };
  const calc = calcPlans(notice, hist, { asOf });
  const v = buildVerdict(notice, calc, {});
  assert(v.status === "blocked", "proxy 기초 → blocked");
  const c = critiqueCalc(notice, calc, { finalBid: 12_000_000, source: "D" });
  assert(
    c.issues.some((i) => i.code === "BASE_PROXY"),
    "이의 BASE_PROXY",
  );
}

// 6) 진짜 기초 → ready, 금액은 기초×예가×…
{
  const notice = {
    title: "김해동광초 석면농도",
    kind: "석면농도·비산측정",
    baseAmount: 13_684_000,
    baseSource: "bssamt",
    baseIsProxy: false,
    plannedAmount: 13_909_925,
    floorRate: 0.9,
    region: "경남",
    method: "전자입찰(최저가)",
  };
  const calc = calcPlans(notice, hist, { asOf });
  const v = buildVerdict(notice, calc, {});
  assert(v.status === "ready", "진짜 기초 → ready");
  assert(v.evidence.some((e) => e.type === "base"), "근거에 기초금액");
  const yega = 13_909_925 / 13_684_000;
  const expectFloor = Math.round(13_684_000 * yega * 0.9);
  assert(v.bid + 0.5 >= expectFloor, "도출가 ≥ 기초×예가×하한");
  assert(v.aggregation?.ok, "취합 ok");
  assert(typeof v.aggregation.vsBaseWon === "number", "기초 대비 ±원");
  console.log(
    "verdict",
    v.planId,
    v.bid,
    "floor",
    expectFloor,
    v.aggregation.vsBaseLabel,
  );
}

if (process.exitCode) {
  console.error("base-amount FAILED");
  process.exit(1);
}
console.log("base-amount PASSED");
