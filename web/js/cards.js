// cards.js — 라벨 그룹별 티켓 카드 (docs/09)
import { state, isCollapsed, toggleGroup, select } from "./state.js";
import {
  bucketOf, fmtDate, fmtDateFull, escapeHtml, labelColor, todayDate,
  BUCKET_LABEL, BUCKET_RANK, statusCategoryClass,
} from "./util.js";

export function renderCards(root, groups, byKey, weekStart) {
  root.innerHTML = "";
  const today = todayDate();

  for (const g of groups) {
    const section = el("div", "cgroup");
    const header = el("div", "cgroup-head");
    header.innerHTML = `<span class="caret">${isCollapsed(g.name) ? "▸" : "▾"}</span>
      <span class="cgroup-dot" style="background:${labelColor(g.name)}"></span>
      <span class="cgroup-name">${escapeHtml(g.name)}</span>
      <span class="cgroup-count">${g.keys.length}</span>`;
    header.addEventListener("click", () => toggleGroup(g.name));
    section.append(header);

    if (!isCollapsed(g.name)) {
      const grid = el("div", "cgrid");
      const sorted = [...g.keys].map((k) => byKey.get(k)).filter(Boolean).sort((a, b) => {
        const ra = BUCKET_RANK[bucketOf(a.duedate, today, weekStart)];
        const rb = BUCKET_RANK[bucketOf(b.duedate, today, weekStart)];
        if (ra !== rb) return ra - rb;
        return String(a.duedate || "9999").localeCompare(String(b.duedate || "9999"));
      });
      for (const it of sorted) grid.append(card(it, today, weekStart));
      section.append(grid);
    }
    root.append(section);
  }
}

function card(it, today, weekStart) {
  const bk = bucketOf(it.duedate, today, weekStart);
  const c = el("div", "card bd-" + bk);
  c.dataset.key = it.key;
  if (state.selectedKey === it.key) c.classList.add("sel");

  const labelChips = (it.labels || []).map((l) =>
    `<button class="chip lab" data-label="${escapeHtml(l)}" style="--lc:${labelColor(l)}">${escapeHtml(l)}</button>`
  ).join("");

  const descLinkChips = (it.descriptionLinks || []).map((ln) =>
    `<button class="chip cat-${escapeHtml(ln.category)}" data-url="${escapeHtml(ln.url)}" title="${escapeHtml(ln.text)} — ${escapeHtml(ln.url)}">${escapeHtml(ln.label)}</button>`
  ).join("");
  const cmtLinkChips = (it.commentLinks || []).map((ln) =>
    `<button class="chip cat-${escapeHtml(ln.category)}" data-url="${escapeHtml(ln.url)}" title="코멘트 링크 — ${escapeHtml(ln.text)} — ${escapeHtml(ln.url)}">💬 ${escapeHtml(ln.label)}</button>`
  ).join("");
  const linkChips = descLinkChips + cmtLinkChips;

  const rel = (it.links || []).length
    ? `<div class="card-rel">🔗 ${it.links.length}개 연결</div>` : "";

  const due = it.duedate
    ? `<span class="due bk-${bk}">${BUCKET_LABEL[bk]} · ${escapeHtml(it.duedate)}</span>`
    : `<span class="due bk-none">마감일 없음</span>`;

  const assignee = it.assignee
    ? `<span class="assignee">${escapeHtml(it.assignee.displayName || it.assignee.name || "")}</span>`
    : `<span class="assignee none">미배정</span>`;

  c.innerHTML = `
    <div class="card-top">
      <span class="card-key">${escapeHtml(it.key)}</span>
      ${it.issuetype ? `<span class="itype">${escapeHtml(it.issuetype)}</span>` : ""}
      <span class="pill ${statusCategoryClass(it.status && it.status.category)}">${escapeHtml(it.status ? it.status.name : "")}</span>
      <span class="prio prio-${escapeHtml((it.priority || "").toLowerCase())}">${escapeHtml(it.priority || "")}</span>
    </div>
    <div class="card-sum">${escapeHtml(it.summary)}</div>
    <div class="card-meta">${due}${assignee}</div>
    ${labelChips ? `<div class="card-chips">${labelChips}</div>` : ""}
    ${linkChips ? `<div class="card-chips">${linkChips}</div>` : ""}
    ${rel}
  `;

  c.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-url],[data-label]");
    if (chip) {
      e.stopPropagation();
      if (chip.dataset.url) window.open(chip.dataset.url, "_blank", "noopener");
      else if (chip.dataset.label) document.dispatchEvent(new CustomEvent("labelfilter", { detail: chip.dataset.label }));
      return;
    }
    select(it.key);
  });
  return c;
}

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
