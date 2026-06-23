// detail.js — 티켓 상세 패널 + 코멘트 + 변경 액션 (docs/10, docs/11)
import { state, clearSelection, select } from "./state.js";
import {
  escapeHtml, fmtDateTime, fmtDateFull, bucketOf, todayDate, labelColor,
  BUCKET_LABEL, statusCategoryClass,
} from "./util.js";
import { actions, runAction } from "./actions.js";

let requestedComments = new Set();

export function renderDetail(root, byKey, weekStart) {
  const key = state.selectedKey;
  if (!key) { root.classList.remove("open"); root.innerHTML = ""; return; }
  const it = byKey.get(key);
  if (!it) { root.classList.remove("open"); root.innerHTML = ""; return; }
  root.classList.add("open");
  const today = todayDate();
  const bk = bucketOf(it.duedate, today, weekStart);

  const transitions = (state.snapshot.transitions || {})[key] || [];
  const statusOpts = transitions.length
    ? transitions.map((t) => `<option value="${escapeHtml(t.to || t.name)}">${escapeHtml(t.name)}</option>`).join("")
    : `<option value="">(전이 정보 없음 — process 때 조회)</option>`;

  const links = it.descriptionLinks || [];
  const linkChips = links.map((ln) =>
    `<button class="chip cat-${escapeHtml(ln.category)}" data-url="${escapeHtml(ln.url)}">${escapeHtml(ln.label)} · ${escapeHtml(ln.text)}</button>`
  ).join("") || `<span class="muted">없음</span>`;

  const labelChips = (it.labels || []).map((l) =>
    `<span class="chip lab" style="--lc:${labelColor(l)}">${escapeHtml(l)}</span>`).join("") || `<span class="muted">없음</span>`;

  // 연결관계: 방향/관계문구별 그룹
  const relGroups = {};
  for (const l of (it.links || [])) (relGroups[l.relation] ||= []).push(l);
  const relHtml = Object.keys(relGroups).length
    ? Object.entries(relGroups).map(([rel, arr]) => `
        <div class="rel-block"><div class="rel-rel">${escapeHtml(rel)}</div>
        ${arr.map((l) => `<button class="rel-chip" data-go="${escapeHtml(l.key)}" title="${escapeHtml(l.summary)}">${escapeHtml(l.key)} · ${escapeHtml(l.summary)} <em>${escapeHtml(l.status)}</em></button>`).join("")}
        </div>`).join("")
    : `<span class="muted">연결 없음</span>`;

  const commentsHtml = it.commentsLoaded
    ? ((it.comments || []).length
        ? it.comments.map((c) => `
            <div class="cmt"><div class="cmt-h"><b>${escapeHtml(c.author)}</b> <span class="muted">${escapeHtml(fmtDateTime(c.created))}</span></div>
            <div class="cmt-b">${escapeHtml(c.body)}</div></div>`).join("")
        : `<span class="muted">코멘트 없음</span>`)
    : `<button class="btn ghost" id="d-loadcmt">코멘트 불러오기</button>`;

  root.innerHTML = `
    <div class="d-head">
      <div class="d-title">
        <span class="d-key">${escapeHtml(it.key)}</span>
        <span class="pill ${statusCategoryClass(it.status && it.status.category)}">${escapeHtml(it.status ? it.status.name : "")}</span>
      </div>
      <button class="d-close" id="d-close" aria-label="닫기">✕</button>
    </div>
    <div class="d-sum">${escapeHtml(it.summary)}</div>

    <div class="d-grid">
      <div class="d-field"><label>상태 변경</label>
        <div class="row"><select id="d-status">${statusOpts}</select>
        <button class="btn" id="d-status-apply">적용</button></div></div>
      <div class="d-field"><label>마감일(Due date)</label>
        <div class="row"><input type="date" id="d-due" value="${escapeHtml(fmtDateFull(it.duedate))}">
        <button class="btn" id="d-due-apply">적용</button></div></div>
    </div>

    <div class="d-field"><label>담당자</label><div>${it.assignee ? escapeHtml(it.assignee.displayName || it.assignee.name) : `<span class="muted">미배정</span>`}</div></div>
    <div class="d-field"><label>라벨</label><div class="chips">${labelChips}</div></div>

    <div class="d-field"><label>설명</label><div class="d-desc">${escapeHtml(it.descriptionText || "")}</div></div>
    <div class="d-field"><label>링크</label><div class="chips">${linkChips}</div></div>

    <div class="d-field"><label>연결관계</label><div class="rels">${relHtml}</div></div>

    <div class="d-field"><label>코멘트</label><div class="cmts" id="d-cmts">${commentsHtml}</div></div>
    <div class="d-field"><label>코멘트 추가</label>
      <textarea id="d-cmt-body" rows="3" placeholder="코멘트 입력 (Markdown)"></textarea>
      <button class="btn" id="d-cmt-add">코멘트 추가</button>
      <p class="hint">기존 코멘트 편집/삭제는 현재 MCP 도구로 불가 → 새 코멘트 추가로 처리됩니다.</p>
    </div>
  `;

  // 자동 코멘트 지연 로드 (1회)
  if (!it.commentsLoaded && !requestedComments.has(key)) {
    requestedComments.add(key);
    runAction(actions.loadComments(key), `${key} 코멘트 로드 요청`, 'load_comments');
  }

  // 전이 정보가 없으면 자동으로 로드 요청
  if (transitions.length === 0 && !requestedComments.has(`${key}_transitions`)) {
    requestedComments.add(`${key}_transitions`);
    runAction(actions.loadTransitions(key), `${key} 전이 정보 로드 요청`, 'load_transitions');
  }

  root.querySelector("#d-close").addEventListener("click", clearSelection);
  root.querySelector("#d-status-apply").addEventListener("click", () => {
    const to = root.querySelector("#d-status").value;
    if (!to) return;
    runAction(actions.transition(key, to), `${key} 상태 → ${to}`);
  });
  root.querySelector("#d-due-apply").addEventListener("click", () => {
    const v = root.querySelector("#d-due").value || null;
    runAction(actions.setDuedate(key, v), `${key} 마감일 → ${v || "(제거)"}`);
  });
  root.querySelector("#d-cmt-add").addEventListener("click", () => {
    const body = root.querySelector("#d-cmt-body").value.trim();
    if (!body) return;
    runAction(actions.addComment(key, body), `${key} 코멘트 추가`);
    root.querySelector("#d-cmt-body").value = "";
  });
  const lc = root.querySelector("#d-loadcmt");
  if (lc) lc.addEventListener("click", () => {
    requestedComments.add(key);
    runAction(actions.loadComments(key), `${key} 코멘트 로드 요청`, 'load_comments');
  });

  root.querySelectorAll("[data-url]").forEach((b) =>
    b.addEventListener("click", () => window.open(b.dataset.url, "_blank", "noopener")));
  root.querySelectorAll("[data-go]").forEach((b) =>
    b.addEventListener("click", () => {
      const go = b.dataset.go;
      if (byKey.has(go)) select(go);
      else window.open(`${state.snapshot.jiraBaseUrl}/browse/${go}`, "_blank", "noopener");
    }));
}
