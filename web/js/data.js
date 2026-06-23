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
