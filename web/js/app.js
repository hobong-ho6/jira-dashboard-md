// app.js — 오케스트레이터: 필터바, 가시 집합 계산, 렌더 연결
import { state, subscribe, setFilter, collapseAll, clearSelection } from "./state.js";
import { loadSnapshot, startPolling, lastSynced, loadUiState } from "./data.js";
import { renderGantt } from "./gantt.js";
import { renderCards } from "./cards.js";
import { renderDetail } from "./detail.js";
import { bucketOf, todayDate, fmtDateTime, debounce, NO_LABEL, applyGroupOrder } from "./util.js";
import { actions, runAction } from "./actions.js";
import { initReorderModal } from "./reorder.js";
import { initCreateModal } from "./create.js";

const $ = (s) => document.querySelector(s);

function weekStart() {
  return ((state.snapshot && state.snapshot.config && state.snapshot.config.weekStart) || "monday");
}

function issueVisible(it) {
  const f = state.filters;
  if (f.hideDone && it.status && it.status.category === "done") return false;
  if (f.statusCategory !== "all" && (!it.status || it.status.category !== f.statusCategory)) return false;
  if (f.search) {
    const q = f.search.toLowerCase();
    const hay = `${it.key} ${it.summary} ${(it.labels || []).join(" ")}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

// labelGroups -> 가시 이슈만 남긴 {name, keys[]} (빈 그룹 제거)
function visibleGroups() {
  const snap = state.snapshot;
  if (!snap) return [];
  const out = [];
  for (const g of (snap.labelGroups || [])) {
    const keys = (g.issueKeys || []).filter((k) => {
      const it = state.byKey.get(k);
      return it && issueVisible(it);
    });
    if (keys.length) out.push({ name: g.name, keys });
  }
  return applyGroupOrder(out, state.ui.groupOrder);
}

function currentQuery() {
  const s = state.snapshot;
  if (!s) return "";
  return s.query || (s.config && s.config.jql) || "";
}

function syncQueryBar() {
  const input = $("#q-input");
  if (!input) return;
  // 사용자가 편집 중이 아니고 비어 있을 때만 스냅샷 쿼리로 채운다
  if (document.activeElement !== input && !input.value) input.value = currentQuery();
}

function render() {
  const snap = state.snapshot;
  const status = $("#status-line");
  syncQueryBar();
  if (!snap || (snap.issues || []).length === 0) {
    let msg;
    if (snap && snap._error) {
      msg = "서버에 연결할 수 없습니다. 터미널에서 'python3 server/serve.py' 를 실행하세요.";
    } else if (!currentQuery()) {
      msg = "위 JQL 입력창에 필터링 쿼리를 입력하고 '조회 시작'을 누르세요. 그때부터 대시보드가 채워집니다.";
    } else {
      msg = "이 쿼리에 해당하는 이슈가 없습니다. Claude Code에서 'process'로 sync를 반영했는지 확인하거나 쿼리를 수정하세요.";
    }
    $("#gantt").innerHTML = `<div class="empty">${msg}</div>`;
    $("#cards").innerHTML = "";
  } else {
    const groups = visibleGroups();
    renderGantt($("#gantt"), groups, state.byKey, weekStart());
    renderCards($("#cards"), groups, state.byKey, weekStart());
  }
  renderDetail($("#detail"), state.byKey, weekStart());

  // 상태줄
  const total = snap ? (snap.issues || []).length : 0;
  const today = todayDate();
  const counts = { overdue: 0, today: 0, thisWeek: 0 };
  if (snap) for (const it of snap.issues || []) {
    const b = bucketOf(it.duedate, today, weekStart());
    if (counts[b] != null) counts[b]++;
  }
  const synced = lastSynced() ? fmtDateTime(lastSynced()) : "—";
  status.innerHTML = `이슈 ${total} · <b class="c-overdue">지남 ${counts.overdue}</b> · <b class="c-today">오늘 ${counts.today}</b> · <b class="c-week">이번주 ${counts.thisWeek}</b> · 동기화 ${synced}`;
}

function buildFilterBar() {
  // JQL 쿼리바: 대시보드의 시작점. 제출 시 sync 명령을 큐에 넣는다.
  const runQuery = () => {
    const jql = ($("#q-input").value || "").trim();
    if (!jql) { $("#q-input").focus(); return; }
    runAction(actions.sync(jql), `쿼리로 조회: ${jql}`);
  };
  $("#q-run").addEventListener("click", runQuery);
  $("#q-input").addEventListener("keydown", (e) => { if (e.key === "Enter") runQuery(); });

  $("#f-search").addEventListener("input", debounce((e) => setFilter({ search: e.target.value.trim() }), 200));
  $("#f-status").addEventListener("change", (e) => setFilter({ statusCategory: e.target.value }));
  $("#f-hidedone").addEventListener("change", (e) => setFilter({ hideDone: e.target.checked }));
  $("#f-deps").addEventListener("change", (e) => setFilter({ showDeps: e.target.checked }));
  $("#f-refresh").addEventListener("click", () => loadSnapshot({ force: true }));
  $("#f-expand").addEventListener("click", () => {
    const names = (state.snapshot.labelGroups || []).map((g) => g.name);
    collapseAll(names, false);
  });
  $("#f-collapse").addEventListener("click", () => {
    const names = (state.snapshot.labelGroups || []).map((g) => g.name);
    collapseAll(names, true);
  });
  // 카드 라벨칩 클릭 -> 검색 필터로
  document.addEventListener("labelfilter", (e) => {
    $("#f-search").value = e.detail;
    setFilter({ search: e.detail });
  });
  // ESC 로 상세 닫기
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") clearSelection(); });
}

async function main() {
  buildFilterBar();
  initReorderModal();
  initCreateModal();
  subscribe(render);
  await loadSnapshot({ force: true });
  await loadUiState();
  startPolling(7000);
  render();

  // 창 크기 변경 시 간트 차트 재렌더링 (반응형)
  let resizeTimeout;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      const snap = state.snapshot;
      if (snap && snap.issues && snap.issues.length > 0) {
        const groups = visibleGroups();
        renderGantt($("#gantt"), groups, state.byKey, weekStart());
      }
    }, 150); // 150ms 디바운스
  });
}

main();
