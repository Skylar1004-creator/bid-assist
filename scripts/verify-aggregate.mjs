import { aggregateToBid, weightedMedian } from "../js/aggregate.js";

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL", msg);
    process.exitCode = 1;
  } else console.log("ok", msg);
}

// 동일 가중 2개: 누적 ≥ 절반이 되는 첫 값(하위 중앙)
assert(weightedMedian([{ value: 10, weight: 1 }, { value: 20, weight: 1 }]) === 10, "median 2 lower");
assert(
  weightedMedian([
    { value: 10, weight: 1 },
    { value: 20, weight: 1 },
    { value: 30, weight: 1 },
  ]) === 20,
  "median 3",
);

const base = 10_000_000;
const hardFloor = 9_000_000;
const agg = aggregateToBid({
  base,
  yega: 1.0,
  hardFloor,
  mode: "low",
  candidates: [
    { id: "D", name: "하한", bid: 9_000_000, score: 80, rate: 0.9 },
    { id: "A", name: "종류", bid: 9_200_000, score: 60, rate: 0.92 },
    { id: "B", name: "최빈", bid: 9_150_000, score: 70, rate: 0.915 },
  ],
  kindCases: [
    { title: "유사1", base: 10_200_000, rate: 0.905, awardedAt: "2026-01-01" },
    { title: "유사2", base: 9_800_000, rate: 0.91, awardedAt: "2026-02-01" },
  ],
});

assert(agg.ok, "취합 ok");
assert(agg.derived >= hardFloor, "하한 이상");
assert(agg.vsBaseWon === agg.derived - base, "기초 대비 원");
assert(agg.rows.some((r) => r.source === "plan"), "plan 행");
assert(agg.rows.some((r) => r.vsBaseLabel.includes("원")), "±원 라벨");
assert(agg.summary.includes("기초 대비"), "요약에 기초대비");
console.log("derived", agg.derived, agg.vsBaseLabel, agg.summary);

// 하한 미만만 있으면 실패 또는 끌어올림
const low = aggregateToBid({
  base,
  yega: 1,
  hardFloor: 9_500_000,
  mode: "low",
  candidates: [{ id: "A", name: "낮음", bid: 9_000_000, score: 50 }],
});
assert(!low.ok || low.derived >= 9_500_000, "하한 게이트");

if (process.exitCode) {
  console.error("aggregate FAILED");
  process.exit(1);
}
console.log("aggregate PASSED");
