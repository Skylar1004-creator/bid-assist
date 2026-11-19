import fs from "fs";
import {
  calcPlans,
  officialBidRate,
  normalizeHistoryRate,
} from "../js/calc.js";

const hist = JSON.parse(fs.readFileSync(new URL("../data/history.json", import.meta.url), "utf8")).items;
const h26 = normalizeHistoryRate(hist.find((i) => i.id === "h-26"));
const rate = officialBidRate(h26.award, h26.planned);
console.log("h-26 rate", `${(rate * 100).toFixed(3)}%`, "expect 94.539%");
console.log("recon award", Math.round(h26.planned * rate), h26.award);

const notice = {
  title: h26.title,
  agency: h26.agency,
  baseAmount: h26.base,
  plannedAmount: h26.planned,
  floorRate: 0.9,
  region: "경남",
  kind: "석면농도·비산측정",
  noticeKey: "gimhae-donggwang-asbestos",
};
const calc = calcPlans(notice, hist, { asOf: new Date("2026-11-19") });
const c = calc.plans.find((p) => p.id === "C");
console.log("C bid", Math.round(c.bid), "expect", h26.award);
console.log("C why", c.why);
if (Math.abs(Math.round(c.bid) - h26.award) > 1) process.exitCode = 1;
if (Math.abs(rate * 100 - 94.539) > 0.002) process.exitCode = 1;
