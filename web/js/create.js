// create.js — 새 티켓 생성 모달 (docs/03, docs/11 create_issue)
// 입력을 모아 create_issue 명령을 큐로 보낸다. 실제 생성은 Claude Code가 MCP로 수행.
import { state } from "./state.js";
import { actions, runAction, toast } from "./actions.js";

const $ = (s) => document.querySelector(s);

const COMMON_TYPES = ["Task", "Bug", "Story", "Epic", "Sub-task"];
const COMMON_PRIOS = ["Highest", "High", "Medium", "Low", "Lowest"];

const distinct = (arr) => [...new Set(arr.filter(Boolean))];

function projectOptions(snap) {
  const fromCfg = (snap && snap.config && snap.config.projects) || [];
  if (fromCfg.length) return fromCfg;
  // 폴백: 로드된 이슈 키 접두사에서 추출
  return distinct((snap && snap.issues || []).map((it) => (it.key || "").split("-")[0]));
}
function typeOptions(snap) {
  return distinct([...(snap && snap.issues || []).map((it) => it.issuetype), ...COMMON_TYPES]);
}
function prioOptions(snap) {
  return distinct([...(snap && snap.issues || []).map((it) => it.priority), ...COMMON_PRIOS]);
}

function escapeHtml(t) { const d = document.createElement("div"); d.textContent = t == null ? "" : t; return d.innerHTML; }
function opt(v, sel) { return `<option value="${escapeHtml(v)}"${v === sel ? " selected" : ""}>${escapeHtml(v)}</option>`; }

function renderForm() {
  const snap = state.snapshot;
  const projects = projectOptions(snap);
  const me = (snap && snap.config && snap.config.currentUser) || "";
  $("#create-form").innerHTML = `
    <div class="d-field"><label>Slack 스레드 링크 (선택 — 넣으면 제목·설명을 스레드 요약으로 자동 생성)</label>
      <input id="cf-slack" type="text" placeholder="https://….slack.com/archives/C…/p…"></div>
    <div class="cf-row">
      <div class="d-field"><label>프로젝트 *</label>
        <select id="cf-project">${projects.map((p) => opt(p)).join("")}</select></div>
      <div class="d-field"><label>유형 *</label>
        <select id="cf-type">${typeOptions(snap).map((t) => opt(t, "Task")).join("")}</select></div>
      <div class="d-field"><label>우선순위</label>
        <select id="cf-priority"><option value="">(기본)</option>${prioOptions(snap).map((p) => opt(p)).join("")}</select></div>
    </div>
    <div class="d-field"><label>제목 (Slack 링크 없으면 필수)</label>
      <input id="cf-summary" type="text" placeholder="요약/제목 — Slack 링크를 넣으면 비워도 됨"></div>
    <div class="d-field"><label>담당자 (username/email)</label>
      <input id="cf-assignee" type="text" value="${escapeHtml(me)}" placeholder="예: hogeun.kim (비우면 프로젝트 기본값)"></div>
    <div class="d-field"><label>설명</label>
      <textarea id="cf-description" rows="4" placeholder="설명 (선택, Jira wiki markup)"></textarea></div>
    <div class="cf-row">
      <div class="d-field"><label>마감일</label>
        <input id="cf-duedate" type="date"></div>
      <div class="d-field"><label>라벨 (쉼표 구분)</label>
        <input id="cf-labels" type="text" placeholder="frontend, urgent"></div>
      <div class="d-field"><label>상위 이슈 (Sub-task)</label>
        <input id="cf-parent" type="text" placeholder="예: UNIFY-7792"></div>
    </div>`;
}

export function openCreateModal() {
  if (!state.snapshot) { alert("스냅샷이 아직 로드되지 않았습니다."); return; }
  renderForm();
  $("#create-modal").style.display = "flex";
  setTimeout(() => { const s = $("#cf-summary"); if (s) s.focus(); }, 0);
}

export function closeCreateModal() { $("#create-modal").style.display = "none"; }

function submitCreate() {
  const project = $("#cf-project").value;
  const issueType = $("#cf-type").value;
  const summary = ($("#cf-summary").value || "").trim();
  const slackUrl = ($("#cf-slack").value || "").trim();
  if (!project || !issueType) {
    toast("프로젝트·유형은 필수입니다.", "warn");
    return;
  }
  if (!summary && !slackUrl) {
    toast("제목을 입력하거나 Slack 스레드 링크를 넣어주세요.", "warn");
    return;
  }
  if (slackUrl && !/\/archives\/[A-Z0-9]+\/p\d+/.test(slackUrl)) {
    toast("Slack 스레드 링크 형식이 아닙니다 (…/archives/C…/p…).", "warn");
    return;
  }
  const cmd = { project, issueType };
  if (summary) cmd.summary = summary;       // 비우면 Claude Code가 스레드 요약으로 생성 (docs/11)
  if (slackUrl) cmd.slackUrl = slackUrl;
  const description = ($("#cf-description").value || "").trim();
  if (description) cmd.description = description;
  const priority = $("#cf-priority").value;
  if (priority) cmd.priority = priority;
  const duedate = $("#cf-duedate").value;
  if (duedate) cmd.duedate = duedate;
  const labels = ($("#cf-labels").value || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (labels.length) cmd.labels = labels;
  const parent = ($("#cf-parent").value || "").trim();
  if (parent) cmd.parent = parent;
  const assignee = ($("#cf-assignee").value || "").trim();
  if (assignee) cmd.assignee = assignee;

  const label = summary || (slackUrl ? "(Slack 스레드 요약)" : "");
  runAction(actions.createIssue(cmd), `새 티켓 생성: [${project}/${issueType}] ${label}`);
  closeCreateModal();
}

export function initCreateModal() {
  $("#f-new").addEventListener("click", openCreateModal);
  $("#create-close").addEventListener("click", closeCreateModal);
  $("#create-cancel").addEventListener("click", closeCreateModal);
  $("#create-submit").addEventListener("click", submitCreate);
  $("#create-modal").addEventListener("click", (e) => { if (e.target.id === "create-modal") closeCreateModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("#create-modal").style.display !== "none") closeCreateModal();
  });
}
