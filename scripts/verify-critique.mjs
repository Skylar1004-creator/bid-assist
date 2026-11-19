import { calcPlans } from "../js/calc.js";
import { critiqueCalc } from "../js/critique.js";
import fs from "fs";

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

// 청소·표본 없음 → reject
{
  const notice = {
    title: "학교 청소용역",
    kind: "청소",
    baseAmount: 20_000_000,
    floorRate: 0.88,
    region: "경기",
  };
  const calc = calcPlans(notice, hist, { asOf });
  const c = critiqueCalc(notice, calc, { finalBid: 17_000_000, source: "A" });
  assert(c.tone === "reject", "청소 표본0+하한미달 → reject");
  assert(c.issues.some((i) => i.code === "NO_SAMPLE" || i.code === "FINAL_FLOOR"), "핵심 이의 존재");
}

// 석면+예정가+정상가 → reject 아님(최소한 caution 이하 가능)
{
  const notice = {
    title: "김해동광초 석면농도",
    kind: "석면농도·비산측정",
    baseAmount: 13_684_000,
    plannedAmount: 13_909_925,
    floorRate: 0.9,
    region: "경남",
    noticeKey: "gimhae-donggwang-asbestos",
  };
  const calc = calcPlans(notice, hist, { asOf, cost: 11_000_000, minMarginPct: 4 });
  const plan = calc.plans.find((p) => !p.disabled);
  const c = critiqueCalc(notice, calc, {
    finalBid: plan?.bid,
    source: plan?.id,
    cost: 11_000_000,
    minMarginPct: 4,
  });
  assert(c.tone !== "reject", "정상 석면 산정은 reject 아님");
  assert(c.score >= 40, "점수 하한");
  console.log("sample critique", c.tone, c.score, c.headlines[0]);
}

if (process.exitCode) {
  console.error("critique FAILED");
  process.exit(1);
}
console.log("critique PASSED");
