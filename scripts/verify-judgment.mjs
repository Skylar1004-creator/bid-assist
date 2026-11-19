import {
  rejectOutliers,
  densestCluster,
  agreementScore,
  strategicTick,
  aiFinalize,
} from "../js/judgment.js";

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL", msg);
    process.exitCode = 1;
  } else console.log("ok", msg);
}

{
  const { kept, dropped } = rejectOutliers([10, 11, 12, 13, 100]);
  assert(dropped.includes(100) || !kept.includes(100), "이상치 100 제거");
  assert(kept.length >= 3, "정상값 유지");
}

{
  const c = densestCluster([9_000_000, 9_010_000, 9_020_000, 12_000_000], {
    maxWidthPct: 0.01,
    minCount: 2,
  });
  assert(c && c.count >= 2, "밀도 클러스터");
  assert(c.center < 10_000_000, "낮은 구간 합의");
}

assert(agreementScore([100, 100.2], 100) > 0.8, "합의 높음");
assert(agreementScore([100, 110], 100) < 0.5, "합의 낮음");

{
  const tickTight = strategicTick({
    hardFloor: 9_000_000,
    ref: 10_000_000,
    competitionShare: 0.7,
    agreement: 0.9,
    mode: "low",
  });
  const tickLoose = strategicTick({
    hardFloor: 9_000_000,
    ref: 10_000_000,
    competitionShare: 0.1,
    agreement: 0.3,
    mode: "low",
  });
  assert(tickTight > 0 && tickLoose > 0, "틱 양수");
  assert(tickTight <= tickLoose, "경쟁 세면 틱 작거나 같음");
}

{
  const ai = aiFinalize({
    base: 10_000_000,
    ref: 10_100_000,
    yega: 1.01,
    hardFloor: 9_090_000,
    mode: "low",
    minOk: 0,
    competitionShare: 0.5,
    planBids: [9_100_000, 9_200_000, 9_150_000],
    histBids: [9_120_000, 9_180_000],
    anchorBid: 9_150_000,
    floorHugBid: 9_090_000,
    usedPlanned: true,
    sameExactN: 0,
  });
  assert(ai.ok, "AI ok");
  assert(ai.bid >= 9_090_000, "하한 이상");
  assert(ai.confidence >= 40, "신뢰");
  assert(/선정/.test(ai.judgment), "선정 문장");
  console.log("ai", ai.bid, ai.confidence, ai.reasons.slice(0, 3));
}

{
  const warn = aiFinalize({
    base: 10_000_000,
    ref: 10_000_000,
    hardFloor: 9_000_000,
    mode: "low",
    minOk: 15_000_000,
    planBids: [9_100_000],
    histBids: [],
    anchorBid: 9_100_000,
  });
  assert(warn.ok && warn.costRisk, "원가선 미달해도 금액은 선정·경고");
  assert(warn.bid >= 9_000_000, "하한 이상 금액 유지");
}

if (process.exitCode) {
  console.error("judgment FAILED");
  process.exit(1);
}
console.log("judgment PASSED");
