import { calcPlans, inferKind, inferNoticeKey, inferRegion } from "./calc.js";

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
  floorRateInput: document.getElementById("floorRateInput"),
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
  autoInfer: true,
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
  const floorPct = Number(els.floorRateInput.value);
  const floorRate = Number.isFinite(floorPct) && floorPct > 0 ? floorPct / 100 : 0;
  const region = els.regionInput.value || inferRegion(agency);
  const kind = els.kindInput.value || inferKind(title);
  const noticeKey =
    (els.noticeKeyInput.value || "").trim() || inferNoticeKey(title, agency) || null;

  return {
    id: "user-notice",
    title: title || "(공고명 미입력)",
    agency: agency || "-",
    method,
    baseAmount,
    floorRate,
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

function renderNoticeLive(notice) {
  const floorAmt = notice.baseAmount * notice.floorRate;
  els.noticeDetail.innerHTML = `
    <div class="metric"><span class="label">적용 지역</span><span class="value">${notice.region}</span></div>
    <div class="metric"><span class="label">적용 종류</span><span class="value">${notice.kind}</span></div>
    <div class="metric"><span class="label">하한 금액</span><span class="value">${
      notice.baseAmount && notice.floorRate ? won(floorAmt) : "-"
    }</span></div>
    <div class="metric"><span class="label">동일공고 키</span><span class="value">${
      notice.noticeKey || "공고명 유사 매칭"
    }</span></div>
  `;
}

function rowsForTab(calc, notice) {
  if (state.historyTab === "year") {
    return {
      summary: `${notice.region} 석면 용역 · 최근 1년 ${calc.year.yearCases.length}건 (최빈 구간 강조)`,
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
    <div class="metric"><span class="label">1안 중앙 사정률</span><span class="value">${
      calc.stats.kindP50 == null ? "-" : pct(calc.stats.kindP50)
    }</span></div>
    <div class="metric"><span class="label">2안 1년 표본</span><span class="value">${calc.stats.yearN}건 · ${
      calc.stats.yearScope || "-"
    }</span></div>
    <div class="metric"><span class="label">3안 범위</span><span class="value">${
      calc.stats.sameScope || "-"
    } ${calc.stats.sameN}건</span></div>
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
      const tabMap = { A: "kind", B: "year", C: "same" };
      state.historyTab = tabMap[input.value] || state.historyTab;
      syncFinalFromSource();
      renderPlans(state.plans);
      if (state.calc) renderHistory(state.calc, readNotice());
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
    floorRate: els.floorRateInput.value,
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
    els.floorRateInput.value = d.floorRate ?? "";
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
  const kind = inferKind(title);
  if (kind !== "기타") els.kindInput.value = kind;
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

  renderNoticeLive(notice);
  renderHistory(calc, notice);
  renderPlans(calc.plans);
  if (els.decisionSource.value !== "custom") syncFinalFromSource();

  const n = state.history.length;
  const src = state.historyMeta.source === "openapi" ? "OpenAPI" : "샘플";
  const synced = state.historyMeta.syncedAt
    ? ` · ${new Date(state.historyMeta.syncedAt).toLocaleString("ko-KR")}`
    : "";
  els.syncLabel.textContent = `${src} ${n}건${synced}`;
}

function normalizeBizNo(raw) {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

function looksLikeBizNo(raw) {
  const q = normalizeBizNo(raw);
  return /^R\d{2}[A-Z0-9]{6,}$/i.test(q) || /^[A-Z]\d{2}[A-Z]{1,3}\d{5,}$/i.test(q);
}

function applyNotice(n) {
  state.autoInfer = false;
  els.titleInput.value = n.title || "";
  els.agencyInput.value = n.agency || "";
  els.methodInput.value = n.method || "추첨";
  els.baseInput.value = n.baseAmount != null ? String(Math.round(n.baseAmount)) : "";
  els.floorRateInput.value =
    n.floorRate != null ? String(Number((n.floorRate * 100).toFixed(2))) : "87.85";
  if (n.region) els.regionInput.value = n.region;
  if (n.kind && [...els.kindInput.options].some((o) => o.value === n.kind)) {
    els.kindInput.value = n.kind;
  }
  els.noticeKeyInput.value = n.noticeKey || n.refNo || n.bidNtceNo || "";
  delete els.noticeKeyInput.dataset.manual;
  // 새 공고를 불러오면 원가도 기초의 85%로 다시 맞춤
  if (n.baseAmount != null) {
    els.costInput.value = String(Math.round(n.baseAmount * 0.85));
  }
  if (!els.minMarginInput.value) els.minMarginInput.value = "4";
  if (n.refNo) els.lookupInput.value = n.refNo;
  els.lookupResults.hidden = true;
  els.lookupResults.innerHTML = "";
  els.lookupMsg.textContent = n.baseAmount != null
    ? `채움 완료 · 기초·추정 ${won(n.baseAmount)} (${n.source || "조회"})`
    : "공고는 찾았지만 기초금액이 없어 직접 확인해 주세요.";
  state.autoInfer = true;
  refresh();
}

function lookupFromCatalog(q) {
  const needle = normalizeBizNo(q);
  const hits = (state.catalog || []).filter((r) => {
    const ref = normalizeBizNo(r.refNo || r.bidNtceNo || "");
    return ref && (ref === needle || ref.includes(needle) || needle.includes(ref));
  });
  return hits.map((r) => ({
    title: r.title,
    agency: r.agency,
    method: r.method || "추첨",
    baseAmount: r.baseAmount,
    floorRate: r.floorRate ?? 0.8785,
    region: r.region || "경기",
    kind: r.kind || "석면농도·비산측정",
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
    els.lookupMsg.textContent = "사업번호를 입력해 주세요. 예: R26BK01839679";
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
  els.lookupInput.value = "R26BK01839679";
  els.titleInput.value = "";
  els.agencyInput.value = "";
  els.methodInput.value = "추첨";
  els.baseInput.value = "";
  els.floorRateInput.value = "87.85";
  els.regionInput.value = "경기";
  els.kindInput.value = "석면농도·비산측정";
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
    "floorRateInput",
    "regionInput",
    "kindInput",
    "noticeKeyInput",
    "costInput",
    "minMarginInput",
  ];

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
      const tabMap = { A: "kind", B: "year", C: "same" };
      state.historyTab = tabMap[state.selectedPlan] || state.historyTab;
    }
    syncFinalFromSource();
    renderPlans(state.plans);
    if (state.calc) renderHistory(state.calc, readNotice());
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
    const payload = {
      noticeId: notice.noticeKey || notice.title,
      title: notice.title,
      agency: notice.agency,
      baseAmount: notice.baseAmount,
      source: els.decisionSource.value,
      amount,
      memo: els.decisionMemo.value.trim(),
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
