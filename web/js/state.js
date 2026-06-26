// state.js — 클라이언트 상태 + 간단한 pub/sub (docs/12)

export const state = {
  snapshot: null,
  collapsed: new Set(),        // "group:라벨명" -> 접힘
  selectedKey: null,           // 상세 패널 대상
  filters: {
    search: "",
    statusCategory: "all",     // all | new | indeterminate | done
    hideDone: true,
    showDeps: true,
    bucket: "all",             // all | overdue | today | thisWeek (상태줄 카운트 클릭 필터)
  },
  byKey: new Map(),            // key -> issue (스냅샷 갱신 시 재구성)
  ui: { groupOrder: [], collapsed: [], sectionOrder: [] }, // 로컬 보기 설정(서버 data/ui-state.json 에 영속, docs/12)
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit() { for (const fn of listeners) fn(); }

// UI 보기설정(접힘·그룹순서·영역순서) 영속화 훅. app.js 가 saveUiState 를 등록한다(순환 import 회피).
let uiPersister = null;
export function setUiPersister(fn) { uiPersister = fn; }
function persistUi() { if (uiPersister) { try { uiPersister(); } catch (_) { /* 영속 실패해도 메모리는 반영됨 */ } } }
function mirrorCollapsed() { state.ui.collapsed = [...state.collapsed]; }

export function setSnapshot(snap) {
  state.snapshot = snap;
  state.byKey = new Map((snap.issues || []).map((it) => [it.key, it]));
  emit();
}

export function groupKey(name) { return "group:" + name; }
export function isCollapsed(name) { return state.collapsed.has(groupKey(name)); }
export function toggleGroup(name) {
  const k = groupKey(name);
  if (state.collapsed.has(k)) state.collapsed.delete(k);
  else state.collapsed.add(k);
  mirrorCollapsed(); emit(); persistUi();
}
export function collapseAll(names, val) {
  for (const n of names) {
    const k = groupKey(n);
    if (val) state.collapsed.add(k); else state.collapsed.delete(k);
  }
  mirrorCollapsed(); emit(); persistUi();
}

export function select(key) { state.selectedKey = key; emit(); }
export function clearSelection() { state.selectedKey = null; emit(); }

export function setFilter(patch) { Object.assign(state.filters, patch); emit(); }

export function setUiState(patch) { Object.assign(state.ui, patch); emit(); persistUi(); }
