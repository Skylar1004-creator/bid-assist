import fs from "fs";
import { calcPlans } from "../js/calc.js";
import { buildVerdict } from "../js/recommend.js";

const hist = JSON.parse(
  fs.readFileSync(new URL("../data/history.json", import.meta.url), "utf8"),
).items;

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL", msg);
    process.exitCode = 1;
  } else console.log("ok", msg);
}

const asOf = new Date("2026-11-19");

// 1) 표본 없는 청소 → blocked (추천 금지)
{
  const notice = {
    title: "학교 청소용역",
    kind: "청소",
    baseAmount: 20_000_000,
    floorRate: 0.88,
    region: "경기",
    method: "전자입찰(최저가)",
  };
  const calc = calcPlans(notice, hist, { asOf });
  const v = buildVerdict(notice, calc, {});
  assert(v.status === "blocked", "청소·근거없음 → blocked");
  assert(v.bid == null, "blocked면 bid 없음");
  assert(v.evidence?.length >= 1, "blocked에도 차단 근거 문구");
}

// 2) 석면·예정가 확보 → ready + 객관 근거 + 하한 이상
{
  const notice = {
    title: "김해동광초 석면농도",
    kind: "석면농도·비산측정",
    baseAmount: 13_684_000,
    plannedAmount: 13_909_925,
    floorRate: 0.9,
    region: "경남",
    method: "전자입찰(최저가)",
    noticeKey: "gimhae-donggwang-asbestos",
  };
  const calc = calcPlans(notice, hist, { asOf, cost: 11_000_000, minMarginPct: 4 });
  const v = buildVerdict(notice, calc, { cost: 11_000_000, minMarginPct: 4 });
  assert(v.status === "ready", "석면 근거 있으면 ready");
  assert(v.bid > 0, "투찰가 산출");
  assert(v.evidence?.length >= 1, "객관 근거 필수");
  assert(v.evidence.every((e) => e.text), "근거 문구 전부 존재");
  assert(v.hardFloor > 0 && v.bid + 0.5 >= v.hardFloor, "실질하한 이상");
  assert(v.planId === "AI" || v.planId === "Σ" || ["A", "B", "C", "D"].includes(v.planId), "AI/취합 id");
  assert(v.aggregation?.ok, "취합 성공");
  assert(v.ai?.ok, "AI 판정 성공");
  assert(v.judgment, "판정 문장");
  assert(v.aggregation.vsBaseLabel, "기초 대비 ± 라벨");
  console.log("verdict", v.planId, v.bid, v.confidence, v.judgment);
}

// 3) 원가수용선이 과도하면 해당 후보 탈락 또는 blocked
{
  const notice = {
    title: "김해동광초 석면농도",
    kind: "석면농도·비산측정",
    baseAmount: 13_684_000,
    plannedAmount: 13_909_925,
    floorRate: 0.9,
    region: "경남",
    method: "전자입찰(최저가)",
  };
  const cost = 20_000_000;
  const calc = calcPlans(notice, hist, { asOf, cost, minMarginPct: 10 });
  const v = buildVerdict(notice, calc, { cost, minMarginPct: 10 });
  assert(v.status === "ready", "원가 미달이어도 선정 금액은 표시");
  assert(v.ai?.costRisk || v.bid < cost * 1.1, "적자 경고 표기");
  console.log("cost-gate", v.status, v.bid, "costRisk", v.ai?.costRisk);
}

if (process.exitCode) {
  console.error("recommend FAILED");
  process.exit(1);
}
console.log("recommend PASSED");
