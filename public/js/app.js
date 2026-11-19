import {
  calcPlans,
  inferKind,
  inferNoticeKey,
  inferRegion,
  resolveNoticeKind,
} from "./calc.js";
import { bizNoMatch, looksLikeBizNo, normalizeBizNo } from "./biz-no.js";
import { critiqueCalc, critiqueLevelLabel } from "./critique.js";
import { buildVerdict } from "./recommend.js";
import { baseSourceLabel } from "./base-amount.js";

const won = (n) =>
  new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(Math.round(n));

const pct = (n) => `${(n * 100).toFixed(2)}%`;

const els = {
  lookupInput: document.getElementById("lookupInput"),
  lookupBtn: document.getElementById("lookupBtn"),
  lookupMsg: document.getElementById("lookupMsg"),
  lookupResults: document.getElementById("lookupResults"),
  titleInput: document.getElementById("titleInput"),
  agencyInput: document.getElementById("agencyInput"),
  methodInput: document.getElementById("methodInput"),
  baseInput: document.getElementById("baseInput"),
  estimateInput: document.getElementById("estimateInput"),
  plannedInput: document.getElementById("plannedInput"),
  floorRateInput: document.getElementById("floorRateInput"),
  yegaHintInput: document.getElementById("yegaHintInput"),
  aValueInput: document.getElementById("aValueInput"),
  netCostInput: document.getElementById("netCostInput"),
  categoryInput: document.getElementById("categoryInput"),
  industryInput: document.getElementById("industryInput"),
  deadlineInput: document.getElementById("deadlineInput"),
  regionInput: document.getElementById("regionInput"),
  kindInput: document.getElementById("kindInput"),
  noticeKeyInput: document.getElementById("noticeKeyInput"),
  noticeDetail: document.getElementById("noticeDetail"),
  costInput: document.getElementById("costInput"),
  minMarginInput: document.getElementById("minMarginInput"),
  historySummary: document.getElementById("historySummary"),
  histStats: document.getElementById("histStats"),
  historyBody: document.getElementById("historyBody"),
  historyTabs: document.getElementById("historyTabs"),
  planGrid: document.getElementById("planGrid"),
  verdictBox: document.getElementById("verdictBox"),
  critiqueBox: document.getElementById("critiqueBox"),
  critiqueHint: document.getElementById("critiqueHint"),
  decisionSource: document.getElementById("decisionSource"),
  finalBid: document.getElementById("finalBid"),
  decisionMemo: document.getElementById("decisionMemo"),
  saveBtn: document.getElementById("saveBtn"),
  saveMsg: document.getElementById("saveMsg"),
  syncLabel: document.getElementById("syncLabel"),
};

const state = {
  history: [],
  catalog: [],
  historyMeta: { source: "sample", syncedAt: null, asOf: "2026-11-19" },
  selectedPlan: "A",
  historyTab: "kind",
  calc: null,
  plans: [],
  verdict: null,
  lockFinal: false,
  autoInfer: true,
  baseMeta: { baseSource: "manual", baseIsProxy: false, estimateAmount: null, budgetAmount: null },
  draftKey: "bid-assist-notice-draft",
  lookupTimer: null,
};

function asOfDate() {
  return new Date(state.historyMeta.asOf || Date.now());
}

function readNotice() {
  const title = (els.titleInput.value || "").trim();
  const agency = (els.agencyInput.value || "").trim();
  const method = (els.methodInput.value || "").trim() || "추첨";
  const baseAmount = Number(els.baseInput.value) || 0;
  const estimateRaw = Number(els.estimateInput?.value);
  const estimateAmount =
    Number.isFinite(estimateRaw) && estimateRaw > 0 ? estimateRaw : state.baseMeta.estimateAmount;
  const plannedRaw = Number(els.plannedInput?.value);
  const plannedAmount = Number.isFinite(plannedRaw) && plannedRaw > 0 ? plannedRaw : null;
  const floorPct = Number(els.floorRateInput.value);
  const floorRate = Number.isFinite(floorPct) && floorPct > 0 ? floorPct / 100 : 0;
  const yegaHintPct = Number(els.yegaHintInput?.value);
  const yegaRateHint =
    Number.isFinite(yegaHintPct) && yegaHintPct > 0 ? yegaHintPct / 100 : null;
  const aValue = Number(els.aValueInput?.value) || 0;
  const netCost = Number(els.netCostInput?.value) || 0;
  const region = els.regionInput.value || inferRegion(agency);
  // 공고명 단서 > 선택값 (청소인데 석면이 남는 일 차단)
  const kind = resolveNoticeKind(title, els.kindInput.value);
  const noticeKey =
    (els.noticeKeyInput.value || "").trim() || inferNoticeKey(title, agency) || null;

  // 사용자가 기초 칸을 고치면 수동으로 간주(대리값 해제)
  const typedBase = Number(els.baseInput.value) || 0;
  const stillProxy =
    state.baseMeta.baseIsProxy &&
    typedBase > 0 &&
    state.baseMeta.proxyAmount != null &&
    Math.abs(typedBase - state.baseMeta.proxyAmount) < 1;

  return {
    id: "user-notice",
    title: title || "(공고명 미입력)",
    agency: agency || "-",
    method,
    baseAmount,
    estimateAmount: estimateAmount || null,
    budgetAmount: state.baseMeta.budgetAmount || null,
    baseSource: stillProxy ? state.baseMeta.baseSource : typedBase > 0 ? "manual" : null,
    baseIsProxy: stillProxy,
    plannedAmount,
    floorRate,
    yegaRateHint,
    aValue,
    netCost,
    category: els.categoryInput?.value || "용역",
    industry: (els.industryInput?.value || "").trim() || null,
    deadline: (els.deadlineInput?.value || "").trim() || null,
    region,
    kind,
    noticeKey,
  };
}

function readInputs() {
  return {
    cost: Number(els.costInput.value) || 0,
    minMargin: Number(els.minMarginInput.value) || 0,
  };
}

function renderNoticeLive(notice, calc) {
  const yega =
    calc?.yegaFromNotice != null
      ? calc.yegaFromNotice
      : calc?.yegaRate != null
        ? calc.yegaRate
        : null;
  const floorHug = calc?.formula?.recommended?.bid;
  const baseLabel = baseSourceLabel(notice.baseSource, notice.baseIsProxy);
  const proxyWarn = notice.baseIsProxy
    ? `<div class="metric danger"><span class="label">기초 경고</span><span class="value">추정·예산 대리값 — 인포21C와 어긋남</span></div>`
    : "";
  els.noticeDetail.innerHTML = `
    ${proxyWarn}
    <div class="metric"><span class="label">기초금액</span><span class="value">${
      notice.baseAmount ? `${won(notice.baseAmount)} · ${baseLabel}` : "-"
    }</span></div>
    <div class="metric"><span class="label">추정가격(참고)</span><span class="value">${
      notice.estimateAmount ? won(notice.estimateAmount) : "-"
    }</span></div>
    <div class="metric"><span class="label">업무·업종</span><span class="value">${
      notice.category || "-"
    }${notice.industry ? ` · ${notice.industry}` : ""}</span></div>
    <div class="metric"><span class="label">적용 지역</span><span class="value">${notice.region}</span></div>
    <div class="metric"><span class="label">적용 종류</span><span class="value">${notice.kind}</span></div>
    <div class="metric"><span class="label">투찰마감</span><span class="value">${
      notice.deadline || "-"
    }</span></div>
    <div class="metric"><span class="label">예가사정율</span><span class="value">${
      yega == null ? "-" : `${(yega * 100).toFixed(3)}%`
    }</span></div>
    <div class="metric"><span class="label">하한밀착(기초×예가×하한)</span><span class="value">${
      floorHug != null ? won(floorHug) : "-"
    }</span></div>
    <div class="metric"><span class="label">예정·기준액</span><span class="value">${
      calc?.refAmount
        ? `${won(calc.refAmount)}${notice.plannedAmount ? " (예정가)" : " (기초×예가)"}`
        : "-"
    }</span></div>
    <div class="metric"><span class="label">A값 / 순공사</span><span class="value">${
      notice.aValue > 0 || notice.netCost > 0
        ? `${notice.aValue > 0 ? won(notice.aValue) : "-"} / ${
            notice.netCost > 0 ? won(notice.netCost) : "-"
          }`
        : "-"
    }</span></div>
    <div class="metric"><span class="label">동일공고 키</span><span class="value">${
      notice.noticeKey || "공고명 유사 매칭"
    }</span></div>
  `;
}

function rowsForTab(calc, notice) {
  if (state.historyTab === "year") {
    return {
      summary: `${notice.region} · ${notice.kind} · 최근 1년 ${calc.year.yearCases.length}건 (최빈 구간 강조)`,
      rows: calc.year.yearCases
        .slice()
        .sort((a, b) => new Date(b.awardedAt) - new Date(a.awardedAt))
        .map((c) => {
          const inBand =
            calc.year.band && c.rate >= calc.year.band[0] && c.rate < calc.year.band[1];
          return { ...c, similarity: inBand ? "최빈" : "-", mark: inBand };
        }),
    };
  }
  if (state.historyTab === "same") {
    return {
      summary: `동일 공고·재공고 이력 ${calc.sameAll.length}건`,
      rows: calc.sameAll.map((c) => ({
        ...c,
        similarity: c.failed ? "유찰" : "이력",
      })),
    };
  }
  return {
    summary: `${notice.region} 동일 종류(${notice.kind}) 낙찰 ${calc.kindCases.length}건`,
    rows: calc.kindCases,
  };
}

function renderHistory(calc, notice) {
  const { summary, rows } = rowsForTab(calc, notice);
  const src = state.historyMeta.source === "openapi" ? "OpenAPI" : "샘플";
  els.historySummary.textContent = `${summary} · ${src}`;
  els.histStats.innerHTML = `
    <div class="metric"><span class="label">1안 표본</span><span class="value">${calc.stats.kindN}건 · ${
      calc.stats.kindScope || "-"
    }</span></div>
    <div class="metric"><span class="label">1안 중앙 투찰률(÷예정가)</span><span class="value">${
      calc.stats.kindP50 == null ? "-" : pct(calc.stats.kindP50)
    }</span></div>
    <div class="metric"><span class="label">2안 1년 표본</span><span class="value">${calc.stats.yearN}건 · ${
      calc.stats.yearScope || "-"
    }</span></div>
    <div class="metric"><span class="label">3안 범위</span><span class="value">${
      calc.stats.sameScope || "-"
    } ${calc.stats.sameN}건</span></div>
    <div class="metric"><span class="label">예가사정율 중앙(이력)</span><span class="value">${
      calc.stats.yegaP50 == null ? "-" : pct(calc.stats.yegaP50)
    }${calc.stats.yegaN ? ` · ${calc.stats.yegaN}건` : ""}</span></div>
  `;

  els.historyTabs?.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === state.historyTab);
  });

  els.historyBody.innerHTML = rows
    .map((c) => {
      const scoreLabel =
        typeof c.similarity === "number" ? c.similarity : (c.similarity ?? "-");
      return `
      <tr class="${c.mark ? "row-mark" : ""} ${c.failed ? "row-fail" : ""}">
        <td><span class="score">${scoreLabel}</span></td>
        <td>${c.title}<div class="sub">${c.awardedAt ?? ""}</div></td>
        <td>${c.agency}</td>
        <td class="num">${won(c.base)}</td>
        <td class="num">${c.award == null ? "유찰" : won(c.award)}</td>
        <td class="num">${c.rate == null ? "-" : pct(c.rate)}</td>
      </tr>`;
    })
    .join("");
}

function renderVerdict(notice, calc) {
  if (!els.verdictBox) return;
  const inputs = readInputs();
  const v = buildVerdict(notice, calc, {
    cost: inputs.cost,
    minMarginPct: inputs.minMargin,
  });
  state.verdict = v;

  if (v.status === "blocked") {
    els.verdictBox.className = "verdict-box is-blocked";
    els.verdictBox.innerHTML = `
      <p class="verdict-bid">추천 없음</p>
      <p class="verdict-head">${v.headline}</p>
      <ul class="verdict-evidence">${v.evidence.map((e) => `<li>${e.text}</li>`).join("")}</ul>
      <ul class="verdict-rejected">${(v.rejected || [])
        .map((r) => `<li><strong>${r.id}</strong> · ${r.reason}</li>`)
        .join("")}</ul>
    `;
    return;
  }

  els.verdictBox.className = "verdict-box is-ready";
  const agg = v.aggregation;
  const aggRows = (agg?.rows || [])
    .slice(0, 14)
    .map(
      (r) => `
      <tr>
        <td>${r.id}</td>
        <td>${r.name}</td>
        <td class="num">${won(r.bid)}</td>
        <td class="num">${r.vsBaseLabel || "-"}</td>
        <td class="num">${r.vsFloorLabel || "-"}</td>
        <td class="num">${r.weight}</td>
      </tr>`,
    )
    .join("");
  const ev = v.evidence
    .map((e) => `<li><span class="tag">${e.type}</span> ${e.text}</li>`)
    .join("");
  const scored = (v.scored || [])
    .map(
      (s) =>
        `<li>${s.id} ${s.name} · ${won(s.bid)} · 기초대비 ${s.vsBaseLabel || "-"} · 점수 ${s.score}</li>`,
    )
    .join("");
  const rejected = (v.rejected || [])
    .slice(0, 8)
    .map((r) => `<li><strong>${r.id}</strong> · ${r.reason}</li>`)
    .join("");

  const applyPlan = v.anchorPlanId || "D";
  els.verdictBox.innerHTML = `
    <p class="verdict-bid">${won(v.bid)}</p>
    <p class="verdict-head">${v.headline}</p>
    <p class="verdict-meta">취합 도출 · 앵커 ${v.anchorPlanId || "-"} · 모드 ${
      v.mode === "low" ? "선정형" : "적격형"
    } · 실질하한 ${won(v.hardFloor)}${
      agg?.vsBaseLabel ? ` · 기초대비 ${agg.vsBaseLabel}` : ""
    }</p>
    <h3 class="verdict-sub">취합 · 기초 대비 ±</h3>
    <div class="table-wrap">
      <table class="agg-table" aria-label="취합 기초대비">
        <thead>
          <tr>
            <th>출처</th>
            <th>항목</th>
            <th class="num">금액</th>
            <th class="num">기초대비 ±</th>
            <th class="num">하한대비 ±</th>
            <th class="num">가중</th>
          </tr>
        </thead>
        <tbody>${aggRows}</tbody>
      </table>
    </div>
    <h3 class="verdict-sub">객관 근거 (필수)</h3>
    <ul class="verdict-evidence">${ev}</ul>
    <h3 class="verdict-sub">후보 점수</h3>
    <ul class="verdict-scored">${scored}</ul>
    <h3 class="verdict-sub">탈락·미채택 사유</h3>
    <ul class="verdict-rejected">${rejected}</ul>
    <button type="button" class="btn primary" id="applyVerdictBtn">이 금액으로 확정칸 채우기</button>
  `;

  els.verdictBox.querySelector("#applyVerdictBtn")?.addEventListener("click", () => {
    els.decisionSource.value = applyPlan;
    state.selectedPlan = applyPlan;
    els.finalBid.value = String(Math.round(v.bid));
    state.lockFinal = false;
    renderPlans(state.plans);
    renderCritique(readNotice(), state.calc);
  });

  if (!state.lockFinal && els.decisionSource.value !== "custom") {
    els.decisionSource.value = applyPlan;
    state.selectedPlan = applyPlan;
    els.finalBid.value = String(Math.round(v.bid));
  }
}

function renderCritique(notice, calc) {
  if (!els.critiqueBox) return;
  const inputs = readInputs();
  const c = critiqueCalc(notice, calc, {
    finalBid: Number(els.finalBid.value) || null,
    source: els.decisionSource.value,
    cost: inputs.cost,
    minMarginPct: inputs.minMargin,
  });
  state.critique = c;
  if (els.critiqueHint) {
    els.critiqueHint.textContent = `신뢰점수 ${c.score} · ${critiqueLevelLabel(c.tone)}`;
  }
  const list =
    c.issues.length === 0
      ? `<li>치명·주의 이의 없음. 그래도 예정가·하한·원문은 직접 대조하세요.</li>`
      : c.issues
          .map(
            (i) =>
              `<li class="lvl-${i.level === "caution" ? "warn" : i.level}"><strong>[${
                i.level === "danger" ? "위험" : i.level === "warn" ? "경고" : "주의"
              }]</strong> ${i.text}</li>`,
          )
          .join("");
  els.critiqueBox.className = `critique-box tone-${c.tone}`;
  els.critiqueBox.innerHTML = `
    <div class="critique-head">
      <span class="critique-score">${critiqueLevelLabel(c.tone)} · ${c.score}점</span>
    </div>
    ${c.headlines.map((h) => `<p class="critique-headline">${h}</p>`).join("")}
    <ul class="critique-list">${list}</ul>
    <p class="critique-rec"><strong>권고</strong> · ${c.recommendation}</p>
  `;
}

function renderPlans(plans) {
  state.plans = plans;
  els.planGrid.innerHTML = plans
    .map((p) => {
      const disabled = p.disabled || p.bid == null;
      const selected = state.selectedPlan === p.id && !disabled;
      return `
      <label class="plan ${selected ? "selected" : ""} ${disabled ? "is-disabled" : ""}">
        <input type="radio" name="plan" value="${p.id}" ${selected ? "checked" : ""} ${
          disabled ? "disabled" : ""
        } />
        <span class="plan-tag">${p.id}안</span>
        <h3>${p.name}</h3>
        <p class="price">${p.bid == null ? "—" : won(p.bid)}</p>
        <p class="range">${
          p.range ? `구간 ${won(p.range[0])} ~ ${won(p.range[1])}` : "구간 산출 불가"
        }</p>
        <p class="why">${p.why}</p>
        <span class="badge ${p.flag.kind}">${p.flag.text}</span>
      </label>`;
    })
    .join("");

  els.planGrid.querySelectorAll('input[name="plan"]').forEach((input) => {
    input.addEventListener("change", () => {
      state.selectedPlan = input.value;
      els.decisionSource.value = input.value;
      const tabMap = { A: "kind", B: "year", C: "same", D: "kind" };
      state.historyTab = tabMap[input.value] || state.historyTab;
      syncFinalFromSource();
      renderPlans(state.plans);
      if (state.calc) {
        const n = readNotice();
        renderHistory(state.calc, n);
        renderNoticeLive(n, state.calc);
        renderCritique(n, state.calc);
      }
    });
  });
}

function syncFinalFromSource() {
  const source = els.decisionSource.value;
  if (source === "custom") return;
  const plan = state.plans.find((p) => p.id === source);
  if (plan?.bid != null) els.finalBid.value = Math.round(plan.bid);
}

function firstEnabledPlan(plans) {
  return plans.find((p) => !p.disabled && p.bid != null)?.id ?? "A";
}

function saveDraft() {
  const draft = {
    lookup: els.lookupInput.value,
    title: els.titleInput.value,
    agency: els.agencyInput.value,
    method: els.methodInput.value,
    base: els.baseInput.value,
    planned: els.plannedInput?.value || "",
    floorRate: els.floorRateInput.value,
    yegaHint: els.yegaHintInput?.value || "",
    aValue: els.aValueInput?.value || "",
    netCost: els.netCostInput?.value || "",
    category: els.categoryInput?.value || "용역",
    industry: els.industryInput?.value || "",
    deadline: els.deadlineInput?.value || "",
    region: els.regionInput.value,
    kind: els.kindInput.value,
    noticeKey: els.noticeKeyInput.value,
    cost: els.costInput.value,
    minMargin: els.minMarginInput.value,
  };
  localStorage.setItem(state.draftKey, JSON.stringify(draft));
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(state.draftKey);
    if (!raw) return false;
    const d = JSON.parse(raw);
    els.lookupInput.value = d.lookup ?? "";
    els.titleInput.value = d.title ?? "";
    els.agencyInput.value = d.agency ?? "";
    els.methodInput.value = d.method ?? "추첨";
    els.baseInput.value = d.base ?? "";
    if (els.plannedInput) els.plannedInput.value = d.planned ?? "";
    els.floorRateInput.value = d.floorRate ?? "";
    if (els.yegaHintInput) els.yegaHintInput.value = d.yegaHint ?? "";
    if (els.aValueInput) els.aValueInput.value = d.aValue ?? "";
    if (els.netCostInput) els.netCostInput.value = d.netCost ?? "";
    if (els.categoryInput && d.category) els.categoryInput.value = d.category;
    if (els.industryInput) els.industryInput.value = d.industry ?? "";
    if (els.deadlineInput) els.deadlineInput.value = d.deadline ?? "";
    if (d.region) els.regionInput.value = d.region;
    if (d.kind) els.kindInput.value = d.kind;
    els.noticeKeyInput.value = d.noticeKey ?? "";
    if (d.cost) els.costInput.value = d.cost;
    if (d.minMargin) els.minMarginInput.value = d.minMargin;
    return true;
  } catch {
    return false;
  }
}

function applyInference() {
  if (!state.autoInfer) return;
  const title = els.titleInput.value || "";
  const agency = els.agencyInput.value || "";
  const kind = resolveNoticeKind(title, els.kindInput.value);
  els.kindInput.value = kind;
  const region = inferRegion(agency);
  if (region !== "기타") els.regionInput.value = region;
  const key = inferNoticeKey(title, agency);
  if (key && !els.noticeKeyInput.dataset.manual) {
    els.noticeKeyInput.value = key;
  }
}

function refresh() {
  applyInference();
  saveDraft();
  const notice = readNotice();
  const inputs = readInputs();
  const calc = calcPlans(notice, state.history, {
    cost: inputs.cost,
    minMarginPct: inputs.minMargin,
    asOf: asOfDate(),
  });
  state.calc = calc;

  const current = calc.plans.find((p) => p.id === state.selectedPlan);
  if (!current || current.disabled) {
    state.selectedPlan = firstEnabledPlan(calc.plans);
    els.decisionSource.value = state.selectedPlan;
  }

  renderNoticeLive(notice, calc);
  renderHistory(calc, notice);
  renderVerdict(notice, calc);
  renderPlans(calc.plans);
  // 신 판정이 ready면 확정칸은 renderVerdict가 채움. blocked·직접입력이면 보조안 동기화.
  if (
    state.verdict?.status !== "ready" &&
    els.decisionSource.value !== "custom" &&
    !state.lockFinal
  ) {
    syncFinalFromSource();
  }
  renderCritique(notice, calc);

  const n = state.history.length;
  const src = state.historyMeta.source === "openapi" ? "OpenAPI" : "샘플";
  const synced = state.historyMeta.syncedAt
    ? ` · ${new Date(state.historyMeta.syncedAt).toLocaleString("ko-KR")}`
    : "";
  els.syncLabel.textContent = `${src} ${n}건${synced}`;
}


function applyNotice(n) {
  state.autoInfer = false;
  els.titleInput.value = n.title || "";
  els.agencyInput.value = n.agency || "";
  els.methodInput.value = n.method || "추첨";
  els.baseInput.value = n.baseAmount != null ? String(Math.round(n.baseAmount)) : "";
  if (els.estimateInput) {
    const est = n.estimateAmount ?? n.presmptPrce ?? null;
    els.estimateInput.value = est != null && est > 0 ? String(Math.round(est)) : "";
  }
  state.baseMeta = {
    baseSource: n.baseSource || (n.baseIsProxy ? "proxy" : n.baseAmount ? "bssamt" : null),
    baseIsProxy: Boolean(n.baseIsProxy),
    estimateAmount: n.estimateAmount ?? n.presmptPrce ?? null,
    budgetAmount: n.budgetAmount ?? null,
    proxyAmount: n.baseIsProxy && n.baseAmount != null ? n.baseAmount : null,
  };
  const planned =
    n.plannedAmount ?? n.planned ?? n.yega ?? (n.awardAmount && n.awardRate ? n.awardAmount / n.awardRate : null);
  if (els.plannedInput) {
    els.plannedInput.value = planned != null && planned > 0 ? String(Math.round(planned)) : "";
  }
  els.floorRateInput.value =
    n.floorRate != null ? String(Number((n.floorRate * 100).toFixed(2))) : "87.85";
  if (n.region) els.regionInput.value = n.region;
  if (n.kind) els.kindInput.value = n.kind;
  els.noticeKeyInput.value = n.noticeKey || n.refNo || n.bidNtceNo || "";
  delete els.noticeKeyInput.dataset.manual;
  if (n.baseAmount != null && !n.baseIsProxy) {
    els.costInput.value = String(Math.round(n.baseAmount * 0.85));
  }
  if (!els.minMarginInput.value) els.minMarginInput.value = "4";
  if (n.refNo) els.lookupInput.value = n.refNo;
  els.lookupResults.hidden = true;
  els.lookupResults.innerHTML = "";
  if (n.baseIsProxy) {
    els.lookupMsg.textContent = `주의 · ${baseSourceLabel(n.baseSource, true)} ${won(
      n.baseAmount,
    )} — 원문 기초금액으로 고치세요 (${n.source || "조회"})`;
  } else if (n.baseAmount != null) {
    els.lookupMsg.textContent = `채움 완료 · 기초금액 ${won(n.baseAmount)} (${n.source || "조회"})`;
  } else {
    els.lookupMsg.textContent = "공고는 찾았지만 기초금액(bssamt)이 없어 직접 확인해 주세요.";
  }
  state.autoInfer = true;
  refresh();
}

function lookupFromCatalog(q) {
  const needle = normalizeBizNo(q);
  const hits = (state.catalog || []).filter((r) => {
    const keys = [r.refNo, r.bidNtceNo, r.noticeKey].filter(Boolean);
    return keys.some((k) => bizNoMatch(k, needle));
  });
  return hits.map((r) => ({
    title: r.title,
    agency: r.agency,
    method: r.method || "추첨",
    baseAmount: r.baseAmount,
    plannedAmount: r.plannedAmount ?? r.planned ?? null,
    awardAmount: r.awardAmount ?? null,
    awardRate: r.awardRate ?? null,
    floorRate: r.floorRate ?? 0.8785,
    region: r.region || "경기",
    kind: r.kind || inferKind(r.title || ""),
    noticeKey: r.noticeKey || r.refNo,
    refNo: r.refNo,
    bidNtceNo: r.bidNtceNo || null,
    source: "catalog",
  }));
}

function renderLookupResults(results) {
  if (!results.length) {
    els.lookupResults.hidden = true;
    els.lookupResults.innerHTML = "";
    return;
  }
  els.lookupResults.hidden = false;
  els.lookupResults.innerHTML = results
    .map((r, i) => {
      const no = r.refNo || r.bidNtceNo || "-";
      const base = r.baseAmount != null ? won(r.baseAmount) : "기초금액 미확인";
      return `
        <button type="button" class="lookup-item" data-idx="${i}">
          <span class="name">${r.title}</span>
          <span class="meta">${r.agency || "-"} · ${no} · ${base}</span>
        </button>`;
    })
    .join("");
  els.lookupResults.querySelectorAll(".lookup-item").forEach((btn) => {
    btn.addEventListener("click", () => applyNotice(results[Number(btn.dataset.idx)]));
  });
}

async function runLookup() {
  const raw = els.lookupInput.value || "";
  const q = normalizeBizNo(raw);
  if (!q) {
    els.lookupMsg.textContent =
      "사업번호·공고번호를 입력해 주세요. 예: 2026LNF007647040-01 또는 뒷자리 47040";
    return;
  }
  els.lookupInput.value = q;
    els.lookupMsg.textContent = "공개 공고에서 가져오는 중…";
  els.lookupBtn.disabled = true;

  // 1) 로컬 카탈로그 즉시 반영
  const localHits = lookupFromCatalog(q);
  if (localHits.length === 1) {
    applyNotice(localHits[0]);
    els.lookupBtn.disabled = false;
    // 서버도 비동기 확인 (API 키가 있으면 보강)
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`/api/lookup?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error("조회 실패");
    const data = await res.json();
    const results = data.results || [];
    if (!results.length) {
      if (localHits.length === 1) return;
      if (localHits.length > 1) {
        els.lookupMsg.textContent = `${localHits.length}건 찾음 · 아래에서 고르세요`;
        renderLookupResults(localHits);
        return;
      }
      els.lookupMsg.textContent = data.warning
        ? `조회 실패: ${data.warning}`
        : "일치 항목 없음. 사업번호를 확인하거나 공고명·기초금액을 직접 입력해 주세요.";
      renderLookupResults([]);
      return;
    }
    if (results.length === 1) {
      applyNotice(results[0]);
      return;
    }
    els.lookupMsg.textContent = `${results.length}건 찾음 · 아래에서 고르세요 (${data.source})`;
    renderLookupResults(results);
  } catch (err) {
    if (localHits.length === 1) return;
    if (localHits.length > 1) {
      els.lookupMsg.textContent = `${localHits.length}건 찾음 · 아래에서 고르세요`;
      renderLookupResults(localHits);
      return;
    }
    els.lookupMsg.textContent =
      err.name === "AbortError"
        ? "조회 시간이 초과됐습니다. 잠시 후 다시 시도하거나 직접 입력해 주세요."
        : String(err.message || err);
  } finally {
    els.lookupBtn.disabled = false;
  }
}

function scheduleAutoLookup() {
  clearTimeout(state.lookupTimer);
  const q = normalizeBizNo(els.lookupInput.value);
  if (!looksLikeBizNo(q)) return;
  state.lookupTimer = setTimeout(() => {
    runLookup();
  }, 350);
}

function setExample() {
  els.lookupInput.value = "2026LNF007647040-01";
  els.titleInput.value = "";
  els.agencyInput.value = "";
  els.methodInput.value = "추첨";
  els.baseInput.value = "";
  if (els.plannedInput) els.plannedInput.value = "";
  els.floorRateInput.value = "87.85";
  els.regionInput.value = "경기";
  els.kindInput.value = "";
  els.noticeKeyInput.value = "";
  els.costInput.value = "";
  els.minMarginInput.value = "4";
  delete els.noticeKeyInput.dataset.manual;
}

async function loadData() {
  const [historyRes, catalogRes] = await Promise.all([
    fetch("/data/history.json"),
    fetch("/data/catalog.json"),
  ]);
  if (!historyRes.ok) throw new Error("이력 데이터를 불러오지 못했습니다.");
  const historyDoc = await historyRes.json();
  state.history = historyDoc.items || [];
  state.historyMeta = {
    source: historyDoc.source || "sample",
    syncedAt: historyDoc.syncedAt || null,
    asOf: historyDoc.asOf || new Date().toISOString().slice(0, 10),
  };
  if (catalogRes.ok) {
    state.catalog = await catalogRes.json();
  }
}

function bind() {
  const noticeFields = [
    "titleInput",
    "agencyInput",
    "methodInput",
    "baseInput",
    "plannedInput",
    "floorRateInput",
    "yegaHintInput",
    "aValueInput",
    "netCostInput",
    "categoryInput",
    "industryInput",
    "deadlineInput",
    "regionInput",
    "kindInput",
    "noticeKeyInput",
    "costInput",
    "minMarginInput",
  ].filter((key) => els[key]);

  noticeFields.forEach((key) => {
    els[key].addEventListener("input", refresh);
    els[key].addEventListener("change", refresh);
  });

  els.lookupBtn.addEventListener("click", runLookup);
  els.lookupInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runLookup();
    }
  });
  els.lookupInput.addEventListener("input", scheduleAutoLookup);
  els.lookupInput.addEventListener("paste", () => {
    setTimeout(scheduleAutoLookup, 0);
  });
  els.lookupInput.addEventListener("change", () => {
    if (looksLikeBizNo(els.lookupInput.value)) runLookup();
  });

  els.noticeKeyInput.addEventListener("input", () => {
    els.noticeKeyInput.dataset.manual = "1";
  });

  els.historyTabs?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tab]");
    if (!btn) return;
    state.historyTab = btn.dataset.tab;
    if (state.calc) renderHistory(state.calc, readNotice());
  });

  els.decisionSource.addEventListener("change", () => {
    if (els.decisionSource.value !== "custom") {
      state.selectedPlan = els.decisionSource.value;
      const tabMap = { A: "kind", B: "year", C: "same", D: "kind" };
      state.historyTab = tabMap[state.selectedPlan] || state.historyTab;
    }
    syncFinalFromSource();
    renderPlans(state.plans);
    if (state.calc) {
      renderHistory(state.calc, readNotice());
      renderCritique(readNotice(), state.calc);
    }
  });

  els.finalBid.addEventListener("input", () => {
    state.lockFinal = true;
    els.decisionSource.value = "custom";
    if (state.calc) renderCritique(readNotice(), state.calc);
  });
  els.finalBid.addEventListener("change", () => {
    state.lockFinal = true;
    if (state.calc) renderCritique(readNotice(), state.calc);
  });

  els.saveBtn.addEventListener("click", async () => {
    const notice = readNotice();
    const amount = Number(els.finalBid.value);
    if (!notice.baseAmount) {
      els.saveMsg.textContent = "기초·추정금액을 입력해 주세요.";
      return;
    }
    if (!amount || amount <= 0) {
      els.saveMsg.textContent = "확정 투찰가를 입력해 주세요.";
      return;
    }
    if (state.calc) renderCritique(notice, state.calc);
    if (state.critique?.tone === "reject") {
      const ok = window.confirm(
        "전문가 이의제기가 ‘반려 수준’입니다.\n하한 미만·표본 없음·마진 붕괴 등이 있습니다.\n그래도 저장할까요?",
      );
      if (!ok) {
        els.saveMsg.textContent = "저장 취소 · 이의제기 항목을 먼저 고치세요.";
        return;
      }
    }
    const payload = {
      noticeId: notice.noticeKey || notice.title,
      title: notice.title,
      agency: notice.agency,
      baseAmount: notice.baseAmount,
      source: els.decisionSource.value,
      amount,
      memo: els.decisionMemo.value.trim(),
      critiqueScore: state.critique?.score ?? null,
      critiqueTone: state.critique?.tone ?? null,
      savedAt: new Date().toISOString(),
    };

    try {
      const res = await fetch("/api/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        els.saveMsg.textContent = `서버 저장 · ${won(amount)} · ${new Date().toLocaleString("ko-KR")}`;
        return;
      }
    } catch {
      /* static fallback */
    }

    const key = "bid-assist-decisions";
    const prev = JSON.parse(localStorage.getItem(key) || "[]");
    prev.unshift(payload);
    localStorage.setItem(key, JSON.stringify(prev.slice(0, 50)));
    els.saveMsg.textContent = `브라우저 저장 · ${won(amount)} · ${new Date().toLocaleString("ko-KR")}`;
  });
}

async function init() {
  try {
    await loadData();
    bind();
    const hasDraft = loadDraft();
    if (!hasDraft) setExample();
    refresh();
    if (looksLikeBizNo(els.lookupInput.value)) {
      await runLookup();
    }
  } catch (err) {
    els.syncLabel.textContent = "데이터 로드 실패";
    els.saveMsg.textContent = String(err.message || err);
  }
}

init();
