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
  },
  byKey: new Map(),            // key -> issue (스냅샷 갱신 시 재구성)
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit() { for (const fn of listeners) fn(); }

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
  emit();
}
export function collapseAll(names, val) {
  for (const n of names) {
    const k = groupKey(n);
    if (val) state.collapsed.add(k); else state.collapsed.delete(k);
  }
  emit();
}

export function select(key) { state.selectedKey = key; emit(); }
export function clearSelection() { state.selectedKey = null; emit(); }

export function setFilter(patch) { Object.assign(state.filters, patch); emit(); }
