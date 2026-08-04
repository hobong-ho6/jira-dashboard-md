// cards.js — 라벨 그룹별 티켓 카드 (docs/09)
import { state, isCollapsed, toggleGroup, select, toggleLabelHidden } from "./state.js";
import { copyKey } from "./actions.js";
import {
  bucketOf, fmtDate, fmtDateFull, escapeHtml, labelColor, todayDate,
  BUCKET_LABEL, BUCKET_RANK, statusCategoryClass, parentOf,
} from "./util.js";

// 같은 라벨 그룹 내 클러스터가 여러 개일 때 서로 다른 outline 색으로 구분 (docs/09)
const CLUSTER_COLORS = [
  "var(--accent)", "var(--cat-design)", "var(--cat-code)",
  "var(--cat-chat)", "var(--bk-overdue)", "var(--dep)",
];

export function renderCards(root, groups, byKey, weekStart) {
  root.innerHTML = "";
  const today = todayDate();

  for (const g of groups) {
    const section = el("div", "cgroup");
    const header = el("div", "cgroup-head");
    header.innerHTML = `<span class="caret">${isCollapsed(g.name) ? "▸" : "▾"}</span>
      <span class="cgroup-dot" style="background:${labelColor(g.name)}"></span>
      <span class="cgroup-name">${escapeHtml(g.name)}</span>
      <span class="cgroup-count">${g.keys.length}</span>
      <button class="cgroup-hide" title="이 라벨 숨기기 (그룹 순서 조정에서 복원)">🙈 숨김</button>`;
    header.addEventListener("click", (e) => {
      if (e.target.closest(".cgroup-hide")) { e.stopPropagation(); toggleLabelHidden(g.name); return; }
      toggleGroup(g.name);
    });
    section.append(header);

    if (!isCollapsed(g.name)) {
      const grid = el("div", "cgrid");
      const sorted = [...g.keys].map((k) => byKey.get(k)).filter(Boolean).sort((a, b) => {
        const ra = BUCKET_RANK[bucketOf(a.duedate, today, weekStart)];
        const rb = BUCKET_RANK[bucketOf(b.duedate, today, weekStart)];
        if (ra !== rb) return ra - rb;
        return String(a.duedate || "9999").localeCompare(String(b.duedate || "9999"));
      });
      const clusterOf = linkClusters(g.keys, byKey);
      const clusterColor = new Map(); // 클러스터(Set) → 배정된 색 (그룹 내 여러 클러스터 구분용)
      for (const it of sorted) {
        const cluster = clusterOf.get(it.key);
        if (cluster && !clusterColor.has(cluster)) {
          clusterColor.set(cluster, CLUSTER_COLORS[clusterColor.size % CLUSTER_COLORS.length]);
        }
      }
      const rendered = new Set();
      for (const it of sorted) {
        if (rendered.has(it.key)) continue;
        const cluster = clusterOf.get(it.key);
        if (cluster) {
          const box = el("div", "ccluster");
          box.style.setProperty("--ccluster-color", clusterColor.get(cluster));
          const cp = clusterParent(cluster, byKey);
          const parentInfo = cp
            ? ` · ↳ 상위 <span class="cp-key">${escapeHtml(cp.key)}</span>${cp.summary ? ` <span class="ccluster-psum">${escapeHtml(cp.summary)}</span>` : ""}`
            : "";
          box.innerHTML = `<div class="ccluster-head">🔗 연결된 티켓 <span class="ccluster-count">${cluster.size}</span>${parentInfo}</div>`;
          const inner = el("div", "cgrid");
          for (const m of sorted) {
            if (!cluster.has(m.key)) continue;
            inner.append(card(m, today, weekStart, byKey));
            rendered.add(m.key);
          }
          box.append(inner);
          grid.append(box);
        } else {
          grid.append(card(it, today, weekStart, byKey));
          rendered.add(it.key);
        }
      }
      section.append(grid);
    }
    root.append(section);
  }
}

// 그룹 내부에서 links(+parent)로 서로 연결된 티켓들의 연결 컴포넌트를 계산.
// 반환: key → Set(같은 클러스터의 key들). 2개 이상 묶인 클러스터만 포함.
function linkClusters(keys, byKey) {
  const inGroup = new Set(keys);
  const adj = new Map();
  const connect = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b);
    adj.get(b).add(a);
  };
  for (const k of keys) {
    const it = byKey.get(k);
    if (!it) continue;
    for (const ln of it.links || []) {
      if (ln.key && inGroup.has(ln.key) && ln.key !== k) connect(k, ln.key);
    }
    const p = parentOf(it, byKey);
    if (p && inGroup.has(p.key)) connect(k, p.key);
  }
  const clusterOf = new Map();
  for (const k of adj.keys()) {
    if (clusterOf.has(k)) continue;
    const comp = new Set();
    const stack = [k];
    while (stack.length) {
      const x = stack.pop();
      if (comp.has(x)) continue;
      comp.add(x);
      for (const n of adj.get(x) || []) stack.push(n);
    }
    for (const m of comp) clusterOf.set(m, comp);
  }
  return clusterOf;
}

// 클러스터의 대표 상위 티켓: 멤버들이 parent 로 가장 많이 참조하는 티켓.
// (Hierarchy 링크가 상호 참조로 사이클을 만들 수 있어 참조 수로 판별한다.)
// 반환: {key, summary} 또는 상위 관계가 없으면 null.
function clusterParent(cluster, byKey) {
  const refs = new Map();
  for (const k of cluster) {
    const p = parentOf(byKey.get(k), byKey);
    if (p) refs.set(p.key, { n: (refs.get(p.key) || { n: 0 }).n + 1, summary: p.summary });
  }
  let best = null;
  for (const [key, v] of refs) {
    if (!best || v.n > best.n) best = { key, n: v.n, summary: v.summary };
  }
  return best ? { key: best.key, summary: best.summary } : null;
}

function card(it, today, weekStart, byKey) {
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

  const p = parentOf(it, byKey);
  const parentLine = p
    ? `<div class="card-parent" data-parent="${escapeHtml(p.key)}" title="상위 티켓 ${escapeHtml(p.key)}${p.summary ? " · " + escapeHtml(p.summary) : ""}">↳ 상위 <span class="cp-key">${escapeHtml(p.key)}</span>${p.summary ? `<span class="cp-sum">${escapeHtml(p.summary)}</span>` : ""}</div>`
    : "";

  const due = it.duedate
    ? `<span class="due bk-${bk}">${BUCKET_LABEL[bk]} · ${escapeHtml(it.duedate)}</span>`
    : `<span class="due bk-none">마감일 없음</span>`;

  const assignee = it.assignee
    ? `<span class="assignee">${escapeHtml(it.assignee.displayName || it.assignee.name || "")}</span>`
    : `<span class="assignee none">미배정</span>`;

  c.innerHTML = `
    <div class="card-top">
      <span class="card-key">${escapeHtml(it.key)}</span>
      <button class="key-copy" data-copy="${escapeHtml(it.key)}" title="티켓 번호 복사" aria-label="티켓 번호 복사">⧉</button>
      ${it.issuetype ? `<span class="itype">${escapeHtml(it.issuetype)}</span>` : ""}
      <span class="pill ${statusCategoryClass(it.status && it.status.category)}">${escapeHtml(it.status ? it.status.name : "")}</span>
      <span class="prio prio-${escapeHtml((it.priority || "").toLowerCase())}">${escapeHtml(it.priority || "")}</span>
    </div>
    <div class="card-sum">${escapeHtml(it.summary)}</div>
    ${parentLine}
    <div class="card-meta">${due}${assignee}</div>
    ${labelChips ? `<div class="card-chips">${labelChips}</div>` : ""}
    ${linkChips ? `<div class="card-chips">${linkChips}</div>` : ""}
    ${rel}
  `;

  c.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-url],[data-label],[data-parent],[data-copy]");
    if (chip) {
      e.stopPropagation();
      if (chip.dataset.copy) copyKey(chip.dataset.copy);
      else if (chip.dataset.url) window.open(chip.dataset.url, "_blank", "noopener");
      else if (chip.dataset.label) document.dispatchEvent(new CustomEvent("labelfilter", { detail: chip.dataset.label }));
      else if (chip.dataset.parent) {
        const pk = chip.dataset.parent;
        if (byKey && byKey.has(pk)) select(pk);
        else window.open(`${state.snapshot.jiraBaseUrl}/browse/${pk}`, "_blank", "noopener");
      }
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
