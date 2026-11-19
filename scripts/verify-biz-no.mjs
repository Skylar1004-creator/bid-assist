import {
  bizNoMatch,
  looksLikeBizNo,
  normalizeBizNo,
  splitBizNo,
} from "../js/biz-no.js";

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL", msg);
    process.exitCode = 1;
  } else console.log("ok", msg);
}

const full = "2026LNF007647040-01";
assert(looksLikeBizNo(full), "full LNF recognized");
assert(looksLikeBizNo("2026LNF007647040"), "core LNF recognized");
assert(looksLikeBizNo("47040"), "suffix recognized");
assert(looksLikeBizNo("R26BK01578429"), "R-number recognized");
assert(!looksLikeBizNo("청소"), "title not biz no");

assert(splitBizNo(full).core === "2026LNF007647040", "split core");
assert(splitBizNo(full).ord === "01", "split ord");

assert(bizNoMatch(full, full), "exact");
assert(bizNoMatch("2026LNF007647040", full), "core vs full");
assert(bizNoMatch(full, "47040"), "suffix 47040 matches full");
assert(bizNoMatch("2026LNF007647040-01", "7647040"), "longer suffix");
assert(!bizNoMatch("R26BK01578429", "47040"), "suffix not match other notice");

assert(normalizeBizNo(" 2026lnf007647040-01 ") === "2026LNF007647040-01", "normalize");

if (process.exitCode) process.exit(1);
console.log("biz-no PASSED");
