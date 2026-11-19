import fs from "fs";

let key = "";
try {
  for (const line of fs.readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\n/)) {
    const m = line.match(/^\s*(DATA_GO_KR_SERVICE_KEY|SERVICE_KEY)\s*=\s*(.*)\s*$/);
    if (m) key = m[2].replace(/^['"]|['"]$/g, "");
  }
} catch {}
console.log("key", key ? `len ${key.length}` : "none");
if (!key) process.exit(0);

const BID = "https://apis.data.go.kr/1230000/ad/BidPublicInfoService";

function p(d) {
  const x = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${x(d.getMonth() + 1)}${x(d.getDate())}0000`;
}

async function hit(label, params) {
  const q = new URLSearchParams({
    serviceKey: key,
    pageNo: "1",
    numOfRows: "10",
    type: "json",
    ...params,
  });
  const url = `${BID}/getBidPblancListInfoServcPPSSrch?${q}`;
  const r = await fetch(url);
  const j = await r.json();
  const body = j?.response?.body;
  const items = body?.items?.item;
  const arr = Array.isArray(items) ? items : items ? [items] : [];
  console.log(label, "total", body?.totalCount, "n", arr.length, j?.response?.header?.resultMsg);
  for (const it of arr.slice(0, 5)) {
    console.log(
      " ",
      it.bidNtceNo,
      it.bidNtceOrd,
      it.refNo,
      (it.bidNtceNm || "").slice(0, 50),
    );
  }
}

const end = new Date();
const from = new Date();
from.setFullYear(from.getFullYear() - 1);

await hit("bidNtceNo exact", {
  inqryDiv: "2",
  bidNtceNo: "2026LNF007647040",
});
await hit("bidNtceNo+ord", {
  inqryDiv: "2",
  bidNtceNo: "2026LNF007647040",
  bidNtceOrd: "01",
});
await hit("refNo window", {
  inqryDiv: "1",
  inqryBgnDt: p(from),
  inqryEndDt: p(end),
  refNo: "2026LNF007647040",
});
await hit("bidNtceNm LNF", {
  inqryDiv: "1",
  inqryBgnDt: p(from),
  inqryEndDt: p(end),
  bidNtceNm: "LNF007647040",
});
