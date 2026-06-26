// create.js — 새 티켓 생성 모달 (docs/03, docs/11 create_issue)
// 입력을 모아 create_issue 명령을 큐로 보낸다. 실제 생성은 Claude Code가 MCP로 수행.
import { state } from "./state.js";
import { actions, runAction, toast } from "./actions.js";
import { labelColor, NO_LABEL } from "./util.js";

const $ = (s) => document.querySelector(s);

const COMMON_TYPES = ["Task", "Bug", "Story", "Epic", "Sub-task"];
const COMMON_PRIOS = ["Highest", "High", "Medium", "Low", "Lowest"];
const NEW_LABEL_OPT = "__new__";

const distinct = (arr) => [...new Set(arr.filter(Boolean))];

// 이 모달 세션에서 선택된 라벨들(칩). openCreateModal 마다 초기화한다.
let selectedLabels = [];

// 현재 대시보드에 보이는 라벨들(이슈 라벨 ∪ 라벨 그룹명, NO_LABEL 제외) — 이름 오름차순.
function existingLabels(snap) {
  const set = new Set();
  for (const it of (snap && snap.issues || [])) for (const l of (it.labels || [])) if (l) set.add(l);
  for (const g of (snap && snap.labelGroups || [])) if (g.name && g.name !== NO_LABEL) set.add(g.name);
  return [...set].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

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
    <div class="cf-row cf-row-2">
      <div class="d-field"><label>마감일</label>
        <input id="cf-duedate" type="date"></div>
      <div class="d-field"><label>상위 이슈 (Sub-task)</label>
        <input id="cf-parent" type="text" placeholder="예: UNIFY-7792"></div>
    </div>
    <div class="d-field"><label>라벨</label>
      <div id="cf-label-chips" class="cf-label-chips"></div>
      <div class="cf-label-add">
        <select id="cf-label-select" title="대시보드 라벨에서 선택하거나 새 라벨 추가"></select>
        <input id="cf-label-new" type="text" placeholder="새 라벨 입력 후 Enter" style="display:none;">
      </div></div>`;
  renderLabelOptions();
  renderLabelChips();
  wireLabelPicker();
}

// ---- 라벨 피커 (드롭다운: 기존 라벨 선택 + "새 라벨" 직접 입력, 다중 선택 칩) ----

function renderLabelOptions() {
  const sel = $("#cf-label-select");
  if (!sel) return;
  const avail = existingLabels(state.snapshot).filter((l) => !selectedLabels.includes(l));
  const parts = [
    `<option value="">＋ 라벨 추가…</option>`,
    `<option value="${NEW_LABEL_OPT}">＋ 새 라벨 직접 입력…</option>`,
  ];
  if (avail.length) parts.push(`<optgroup label="대시보드 라벨">${avail.map((l) => opt(l)).join("")}</optgroup>`);
  sel.innerHTML = parts.join("");
  sel.value = "";
}

function renderLabelChips() {
  const host = $("#cf-label-chips");
  if (!host) return;
  host.innerHTML = selectedLabels.map((l) =>
    `<span class="cf-label-chip" style="--lc:${labelColor(l)}">${escapeHtml(l)}` +
    `<button type="button" data-rm="${escapeHtml(l)}" aria-label="${escapeHtml(l)} 제거" title="제거">×</button></span>`
  ).join("");
}

// 쉼표 구분 다중 입력 지원. 이미 선택된 라벨은 무시(중복 방지).
function addLabels(raw) {
  const parts = String(raw || "").split(",").map((s) => s.trim()).filter(Boolean);
  let added = false;
  for (const p of parts) if (!selectedLabels.includes(p)) { selectedLabels.push(p); added = true; }
  if (added) { renderLabelChips(); renderLabelOptions(); }
}

function removeLabel(name) {
  const i = selectedLabels.indexOf(name);
  if (i >= 0) { selectedLabels.splice(i, 1); renderLabelChips(); renderLabelOptions(); }
}

function wireLabelPicker() {
  const sel = $("#cf-label-select");
  const neu = $("#cf-label-new");
  sel.addEventListener("change", () => {
    const v = sel.value;
    if (v === NEW_LABEL_OPT) { sel.value = ""; neu.style.display = ""; neu.focus(); }
    else if (v) addLabels(v); // renderLabelOptions가 value를 ""로 되돌림
  });
  neu.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addLabels(neu.value); neu.value = ""; neu.style.display = "none"; sel.focus();
    } else if (e.key === "Escape") {
      e.preventDefault(); e.stopPropagation(); // 모달 전체 ESC 닫힘 방지
      neu.value = ""; neu.style.display = "none"; sel.focus();
    }
  });
  neu.addEventListener("blur", () => {
    if (neu.value.trim()) addLabels(neu.value);
    neu.value = ""; neu.style.display = "none";
  });
  $("#cf-label-chips").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-rm]");
    if (btn) removeLabel(btn.dataset.rm);
  });
}

export function openCreateModal() {
  if (!state.snapshot) { alert("스냅샷이 아직 로드되지 않았습니다."); return; }
  selectedLabels = [];
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
  // 라벨: 칩으로 선택된 것 + 새 라벨 입력칸에 남은 미확정 텍스트
  const pending = $("#cf-label-new");
  if (pending && pending.value.trim()) addLabels(pending.value);
  if (selectedLabels.length) cmd.labels = [...selectedLabels];
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
