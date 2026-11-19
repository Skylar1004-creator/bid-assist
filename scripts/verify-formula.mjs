import {
  bidFloorHug,
  bidWithAValue,
  bidWithNetCost,
  pickBidCandidates,
  yegaRate,
} from "../js/bid-formula.js";
import { calcPlans } from "../js/calc.js";
import fs from "fs";

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL", msg);
    process.exitCode = 1;
  } else console.log("ok", msg);
}

assert(Math.abs(yegaRate(101, 100) - 1.01) < 1e-9, "yega 101/100");
const hug = bidFloorHug(10_000_000, 1.0, 0.8785);
assert(Math.round(hug) === 8_785_000, "floor hug");
const withA = bidWithAValue(10_000_000, 1.0, 0.8785, 500_000);
// (10M - 500k)*0.8785 + 500k
assert(Math.round(withA) === Math.round(9_500_000 * 0.8785 + 500_000), "A-value formula");
const net = bidWithNetCost(8_000_000, 1.0);
assert(Math.round(net) === 7_840_000, "net cost 98%");

const pick = pickBidCandidates({
  base: 10_000_000,
  yega: 1,
  floorRate: 0.8785,
  aValue: 500_000,
  netCost: 9_500_000,
});
assert(pick.recommended?.id === "netCost" || pick.recommended?.bid >= hug, "picks higher safeguard");

const hist = JSON.parse(
  fs.readFileSync(new URL("../data/history.json", import.meta.url), "utf8"),
).items;
const calc = calcPlans(
  {
    title: "김해동광 석면",
    kind: "석면농도·비산측정",
    baseAmount: 13_684_000,
    plannedAmount: 13_909_925,
    floorRate: 0.9,
    region: "경남",
    aValue: 0,
    noticeKey: "gimhae-donggwang-asbestos",
  },
  hist,
  { asOf: new Date("2026-11-19") },
);
const d = calc.plans.find((p) => p.id === "D");
assert(d && !d.disabled && d.bid > 0, "D plan enabled with planned");
assert(calc.yegaFromNotice != null, "yega from notice");
console.log("D bid", Math.round(d.bid), "yega", (calc.yegaRate * 100).toFixed(3) + "%");

if (process.exitCode) process.exit(1);
console.log("formula PASSED");
