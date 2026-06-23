// actions.js — 변경 의도를 큐로 전송 (docs/03, docs/11)
// 서버가 있으면 POST /api/commands, 없으면 클립보드 폴백.

function newId() {
  return "c_" + Math.floor(Date.now() / 1000) + "_" + Math.random().toString(16).slice(2, 6);
}

async function enqueue(cmd) {
  const payload = { id: newId(), ts: new Date().toISOString(), status: "pending", ...cmd };
  try {
    const res = await fetch("/api/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return { ok: true, mode: "queued", cmd: payload };
  } catch (err) {
    // 폴백: 클립보드에 명령 JSON 복사 -> 사용자가 Claude Code 에 붙여넣기
    const line = JSON.stringify(payload);
    try { await navigator.clipboard.writeText(line); } catch (_) {}
    return { ok: false, mode: "clipboard", cmd: payload, line, error: String(err) };
  }
}

export const actions = {
  sync: (jql) => enqueue({ action: "sync", jql }),
  transition: (issueKey, to, comment = null) => enqueue({ action: "transition", issueKey, to, comment }),
  setDuedate: (issueKey, duedate) => enqueue({ action: "set_duedate", issueKey, duedate }),
  addComment: (issueKey, body) => enqueue({ action: "add_comment", issueKey, body }),
  loadComments: (issueKey) => enqueue({ action: "load_comments", issueKey }),
  loadTransitions: (issueKey) => enqueue({ action: "load_transitions", issueKey }),
  setLabels: (issueKey, labels) => enqueue({ action: "set_labels", issueKey, labels }),
  createLink: (inward, type, outward) => enqueue({ action: "create_link", inward, type, outward }),
  reorderGroups: (labelOrder) => enqueue({ action: "reorder_groups", labelOrder }),
};

// 간단한 토스트
let toastEl = null;
export function toast(msg, kind = "info") {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "toast";
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.dataset.kind = kind;
  toastEl.classList.add("show");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove("show"), 3200);
}

// 읽기 전용 액션 목록 (Jira 변경하지 않음)
const READ_ONLY_ACTIONS = new Set(['load_comments', 'load_transitions', 'sync', 'reorder_groups']);

export async function runAction(promise, okMsg, actionType = null) {
  const r = await promise;
  if (r.ok) {
    // 읽기 전용 액션은 Jira를 바꾸지 않지만, 반영은 다른 액션과 동일하게 'process' 때 일어난다.
    // (서버는 Jira를 호출하지 않는다 — docs/01 신뢰 경계, docs/13.)
    const isReadOnly = actionType && READ_ONLY_ACTIONS.has(actionType);
    const how = isReadOnly
      ? " — 대기열에 추가됨. 다음 'process' 때 자동 반영됩니다."
      : " — 대기열에 추가됨. Claude Code에서 'process'로 반영하세요.";
    toast(okMsg + how, "ok");
  } else if (r.mode === "clipboard") {
    toast("서버 미연결: 명령을 클립보드에 복사했습니다. Claude Code에 붙여넣어 실행하세요.", "warn");
  } else {
    toast("실패: " + (r.error || "unknown"), "err");
  }
  return r;
}
