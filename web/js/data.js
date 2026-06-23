// data.js — 스냅샷 로드 + 폴링 (docs/12)
import { setSnapshot, state } from "./state.js";

let lastGeneratedAt = undefined;
let timer = null;

export async function loadSnapshot({ force = false } = {}) {
  try {
    const res = await fetch("/api/snapshot", { cache: "no-store" });
    if (!res.ok) throw new Error("snapshot HTTP " + res.status);
    const snap = await res.json();
    if (!force && snap.generatedAt && snap.generatedAt === lastGeneratedAt) {
      return false; // 변경 없음
    }
    lastGeneratedAt = snap.generatedAt;
    setSnapshot(snap);
    return true;
  } catch (err) {
    // 서버 미기동/네트워크 오류
    if (!state.snapshot) {
      setSnapshot({ generatedAt: null, issues: [], labelGroups: [], _error: String(err) });
    }
    return false;
  }
}

export function startPolling(ms = 7000) {
  stopPolling();
  timer = setInterval(() => loadSnapshot(), ms);
  window.addEventListener("focus", () => loadSnapshot());
}
export function stopPolling() { if (timer) { clearInterval(timer); timer = null; } }

export function lastSynced() { return lastGeneratedAt; }

// 로컬 보기 설정(그룹 순서 등) — 서버 data/ui-state.json 에 영속 (docs/12)
export async function loadUiState() {
  try {
    const res = await fetch("/api/ui-state", { cache: "no-store" });
    if (!res.ok) return;
    const ui = await res.json();
    if (ui && typeof ui === "object") Object.assign(state.ui, ui);
  } catch (_) { /* 서버 미연결 시 기본값 유지 */ }
}

export async function saveUiState() {
  try {
    await fetch("/api/ui-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.ui),
    });
  } catch (_) { /* 영속화 실패해도 메모리 상태는 이미 반영됨 */ }
}
