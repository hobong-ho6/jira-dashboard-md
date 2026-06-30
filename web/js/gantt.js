// gantt.js — Due date 간트 타임라인 (docs/06, docs/07)
import { state, isCollapsed, toggleGroup, select } from "./state.js";
import {
  parseDate, todayDate, daysBetween, weekRange, bucketOf, fmtDate,
  escapeHtml, BUCKET_LABEL,
} from "./util.js";

const LABEL_W = 300, HEAD_H = 44, ROW_H = 36, GROUP_H = 36, MIN_BAR = 12;

function depTypes() {
  const c = (state.snapshot && state.snapshot.config) || {};
  return new Set(c.ganttDependencyLinkTypes || ["Finish-to-Start link (WBSGantt)", "Blocks"]);
}

// 링크 한 개 -> {pred, succ} (선행 -> 후행) 또는 null
function depEdge(issueKey, link) {
  const t = link.type || "";
  const isWBS = t.startsWith("Finish-to-Start");
  const isBlocks = t === "Blocks";
  if (!isWBS && !isBlocks) return null;
  // outward: 이 이슈가 선행. inward: 상대가 선행.
  if (link.direction === "outward") return { pred: issueKey, succ: link.key };
  return { pred: link.key, succ: issueKey };
}

export function renderGantt(root, groups, byKey, weekStart) {
  root.innerHTML = "";
  const today = todayDate();

  // 날짜 범위: D-1 ~ D+5 (7일 고정)
  let rangeStart = new Date(today); rangeStart.setDate(today.getDate() - 1);
  let rangeEnd = new Date(today); rangeEnd.setDate(today.getDate() + 5);

  // 범위 안/밖 분리. 가시 이슈(완료 숨김·검색·상태 필터 반영된 groups)만 대상으로 한다.
  // groups 는 app.js visibleGroups() 결과라 이미 필터링돼 있다 → 범위 밖 칩도 동일 필터 존중.
  const visibleKeys = new Set();
  for (const g of groups) for (const k of g.keys) visibleKeys.add(k);

  const outOfRangeIssues = [];
  const inRangeKeys = new Set();
  for (const key of visibleKeys) {
    const it = byKey.get(key);
    if (!it) continue;
    const due = parseDate(it.duedate);
    if (!due || due < rangeStart || due > rangeEnd) {
      outOfRangeIssues.push(it);
    } else {
      inRangeKeys.add(it.key);
    }
  }

  // 가시 이슈 수집(레이아웃은 그룹/접힘 반영) - 범위 내 이슈만
  const layout = [];
  const issueGeomKeys = new Set();
  let y = 0;
  for (const g of groups) {
    // 그룹 내 범위 내 이슈만 필터링
    const inRangeGroupKeys = g.keys.filter(k => inRangeKeys.has(k));
    if (inRangeGroupKeys.length === 0) continue; // 빈 그룹 제외

    layout.push({ type: "group", name: g.name, count: inRangeGroupKeys.length, y, h: GROUP_H, keys: inRangeGroupKeys });
    y += GROUP_H;
    if (!isCollapsed(g.name)) {
      for (const key of inRangeGroupKeys) {
        layout.push({ type: "issue", key, y, h: ROW_H });
        y += ROW_H;
      }
    }
  }
  const totalRowsH = Math.max(y, ROW_H);

  const numDays = 7; // 고정 7일

  // 반응형 너비 계산: 전체 너비에서 라벨 너비를 뺀 나머지
  const ganttContainer = root.closest('.gantt-host');
  const availableWidth = ganttContainer ? ganttContainer.clientWidth - LABEL_W - 2 : 800; // 2px for borders
  const DAY_W = Math.max(60, Math.floor(availableWidth / numDays)); // 최소 60px, 창에 맞춰 증가
  const timelineW = numDays * DAY_W;
  const x = (date) => daysBetween(rangeStart, date) * DAY_W;

  // ----- DOM 골격 -----
  const wrap = el("div", "gantt");
  const labels = el("div", "gantt-labels");
  const scroll = el("div", "gantt-tscroll");
  const inner = el("div", "gantt-tinner");
  inner.style.width = timelineW + "px";
  inner.style.height = (HEAD_H + totalRowsH) + "px";
  wrap.append(labels, scroll);
  scroll.append(inner);

  // 라벨 컬럼 헤더 + 셀
  const lhead = el("div", "glabel-head");
  lhead.textContent = "라벨 · 이슈";
  labels.append(lhead);
  const lbody = el("div", "glabel-body");
  labels.append(lbody);

  // ----- 배경(주말/이번주/오늘) -----
  const bg = el("div", "gantt-bg");
  bg.style.top = HEAD_H + "px";
  bg.style.height = totalRowsH + "px";
  bg.style.width = timelineW + "px";
  for (let i = 0; i < numDays; i++) {
    const d = new Date(rangeStart); d.setDate(rangeStart.getDate() + i);
    const wd = d.getDay();
    if (wd === 0 || wd === 6) {
      const stripe = el("div", "g-weekend");
      stripe.style.left = (i * DAY_W) + "px";
      stripe.style.width = DAY_W + "px";
      bg.append(stripe);
    }
  }
  const [ws, we] = weekRange(today, weekStart);
  const band = el("div", "g-weekband");
  band.style.left = x(ws) + "px";
  band.style.width = ((daysBetween(ws, we) + 1) * DAY_W) + "px";
  bg.append(band);
  const todayLine = el("div", "g-today");
  todayLine.style.left = (x(today) + DAY_W / 2) + "px";
  bg.append(todayLine);
  inner.append(bg);

  // ----- 헤더 눈금 -----
  const head = el("div", "gantt-thead");
  head.style.width = timelineW + "px";
  let lastMonth = -1;
  for (let i = 0; i < numDays; i++) {
    const d = new Date(rangeStart); d.setDate(rangeStart.getDate() + i);
    const cell = el("div", "g-tick");
    cell.style.left = (i * DAY_W) + "px";
    cell.style.width = DAY_W + "px";
    const isToday = d.getTime() === today.getTime();
    if (isToday) cell.classList.add("is-today");
    if (d.getDay() === 0 || d.getDay() === 6) cell.classList.add("is-weekend");
    const mm = d.getMonth();
    const monthTag = (mm !== lastMonth) ? `<span class="g-mon">${mm + 1}월</span>` : "";
    lastMonth = mm;
    cell.innerHTML = `${monthTag}<span class="g-day">${d.getDate()}</span>`;
    head.append(cell);
  }
  inner.append(head);

  // ----- 막대 레이어 -----
  const bars = el("div", "gantt-bars");
  bars.style.top = HEAD_H + "px";
  const geom = new Map(); // key -> {left,right,yMid}
  const labelBars = []; // {bar,left} - 라벨을 가시영역 시작으로 클램프하기 위한 목록

  for (const row of layout) {
    if (row.type === "group") {
      // 그룹 요약 막대(옅게): 그룹 내 min start ~ max due
      let s = null, e = null;
      for (const k of row.keys) {
        const it = byKey.get(k); if (!it) continue;
        const ds = parseDate(it.startDate), dd = parseDate(it.duedate);
        if (ds && (!s || ds < s)) s = ds;
        if (dd && (!e || dd > e)) e = dd;
      }
      if (s && e) {
        const gb = el("div", "g-groupbar");
        gb.style.left = x(s) + "px";
        gb.style.top = (row.y + GROUP_H / 2 - 3) + "px";
        gb.style.width = Math.max(MIN_BAR, (daysBetween(s, e) + 1) * DAY_W) + "px";
        bars.append(gb);
      }
      continue;
    }
    const it = byKey.get(row.key);
    if (!it) continue;
    const due = parseDate(it.duedate);
    if (!due) {
      const at = parseDate(it.startDate) || today;
      const pill = el("div", "g-nodue");
      pill.style.left = x(at) + "px";
      pill.style.top = (row.y + ROW_H / 2 - 9) + "px";
      pill.textContent = "마감일 없음";
      pill.dataset.key = it.key;
      bars.append(pill);
      continue;
    }
    let s = parseDate(it.startDate) || due;
    if (s > due) s = due;
    const left = x(s);
    const width = Math.max(MIN_BAR, (daysBetween(s, due) + 1) * DAY_W);
    const bk = bucketOf(it.duedate, today, weekStart);
    const bar = el("div", "g-bar bk-" + bk);
    bar.style.left = left + "px";
    bar.style.top = (row.y + ROW_H / 2 - 9) + "px";
    bar.style.width = width + "px";
    bar.dataset.key = it.key;
    bar.title = `${it.key} · ${it.summary} · ~${it.duedate}`;
    bar.innerHTML = `<span class="g-bar-key">${escapeHtml(it.key)}</span><span class="g-bar-sum">${escapeHtml(it.summary)}</span>`;
    if (state.selectedKey === it.key) bar.classList.add("sel");
    bars.append(bar);
    labelBars.push({ bar, left });
    if (!geom.has(it.key)) geom.set(it.key, { left, right: left + width, yMid: HEAD_H + row.y + ROW_H / 2 });
    issueGeomKeys.add(it.key);
  }
  inner.append(bars);

  // ----- 의존성 화살표 -----
  if (state.filters.showDeps) {
    const dt = depTypes();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "gantt-arrows");
    svg.setAttribute("width", timelineW);
    svg.setAttribute("height", HEAD_H + totalRowsH);
    svg.innerHTML = `<defs><marker id="ah" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6 Z" fill="var(--dep)"/></marker></defs>`;
    const drawn = new Set();
    for (const key of issueGeomKeys) {
      const it = byKey.get(key); if (!it) continue;
      for (const link of (it.links || [])) {
        if (!dt.has(link.type)) continue;
        const edge = depEdge(key, link);
        if (!edge) continue;
        const tag = edge.pred + ">" + edge.succ;
        if (drawn.has(tag)) continue;
        const a = geom.get(edge.pred), b = geom.get(edge.succ);
        if (!a || !b) continue;
        drawn.add(tag);
        const x1 = a.right, y1 = a.yMid, x2 = b.left, y2 = b.yMid;
        const midx = Math.max(x1 + 12, (x1 + x2) / 2);
        const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        p.setAttribute("d", `M${x1},${y1} C${midx},${y1} ${midx},${y2} ${x2},${y2}`);
        p.setAttribute("class", "dep-path");
        p.setAttribute("marker-end", "url(#ah)");
        svg.append(p);
      }
    }
    inner.append(svg);
  }

  // ----- 라벨 컬럼 채우기 -----
  for (const row of layout) {
    if (row.type === "group") {
      const gh = el("div", "glabel-group");
      gh.style.height = GROUP_H + "px";
      gh.innerHTML = `<span class="caret">${isCollapsed(row.name) ? "▸" : "▾"}</span>
        <span class="glabel-name">${escapeHtml(row.name)}</span>
        <span class="glabel-count">${row.count}</span>`;
      gh.addEventListener("click", () => toggleGroup(row.name));
      lbody.append(gh);
    } else {
      const it = byKey.get(row.key);
      const c = el("div", "glabel-issue");
      c.style.height = ROW_H + "px";
      c.dataset.key = row.key;
      c.innerHTML = `<span class="gi-key">${escapeHtml(row.key)}</span>
        <span class="gi-sum">${escapeHtml(it ? it.summary : "")}</span>`;
      c.addEventListener("click", () => select(row.key));
      lbody.append(c);
    }
  }

  // 막대/노듀 클릭 -> 상세
  bars.addEventListener("click", (e) => {
    const t = e.target.closest("[data-key]");
    if (t) select(t.dataset.key);
  });

  // 라벨 컬럼 헤더 높이 = 타임라인 헤더 높이
  lhead.style.height = HEAD_H + "px";
  labels.style.flex = `0 0 ${LABEL_W}px`;

  // 막대가 가시영역 왼쪽 밖에서 시작하면 라벨(번호+제목)을 보이는 시작 지점으로 밀어 넣는다.
  // 막대 content 시작을 max(막대 left, 현재 스크롤 위치)로 맞춰, 가로 스크롤에도 라벨이 따라온다.
  const BASE_PAD = 7; // .g-bar 의 좌우 padding(7px)과 일치
  const clampLabels = () => {
    const sx = scroll.scrollLeft;
    for (const { bar, left } of labelBars) {
      bar.style.paddingLeft = Math.max(BASE_PAD, sx - left + BASE_PAD) + "px";
    }
  };

  // 세로 스크롤 동기화 (타임라인 -> 라벨) + 스크롤 위치 보존 + 라벨 클램프
  scroll.addEventListener("scroll", () => {
    lbody.style.transform = `translateY(${-scroll.scrollTop}px)`;
    state._gx = scroll.scrollLeft;
    clampLabels();
  });

  root.append(wrap);

  // 스크롤 복원: 이전 위치가 있으면 유지, 없으면 오늘 중심
  requestAnimationFrame(() => {
    scroll.scrollLeft = (state._gx != null) ? state._gx : Math.max(0, x(today) - 120);
    clampLabels();
  });

  // ----- 범위 밖 티켓을 별도 컨테이너에 렌더링 -----
  renderOutOfRangeSection(outOfRangeIssues, rangeStart, rangeEnd);
}

function renderOutOfRangeSection(issues, rangeStart, rangeEnd) {
  const section = document.getElementById("out-of-range-section");
  const container = document.getElementById("out-of-range");

  if (!section || !container) return;

  if (issues.length === 0) {
    section.style.display = "none";
    return;
  }

  section.style.display = "block";
  container.innerHTML = "";

  // 날짜별로 그룹화
  const beforeRange = [];
  const afterRange = [];
  const noDue = [];

  for (const it of issues) {
    const due = parseDate(it.duedate);
    if (!due) {
      noDue.push(it);
    } else if (due < rangeStart) {
      beforeRange.push(it);
    } else if (due > rangeEnd) {
      afterRange.push(it);
    }
  }

  // 날짜순 정렬
  beforeRange.sort((a, b) => parseDate(a.duedate) - parseDate(b.duedate));
  afterRange.sort((a, b) => parseDate(a.duedate) - parseDate(b.duedate));

  // 모든 티켓을 하나의 리스트로 합치기 (이전 + 이후 + 마감일 없음)
  const allIssues = [...beforeRange, ...afterRange, ...noDue];

  // 날짜별로 그룹화하여 렌더링
  const byDate = new Map();
  for (const it of allIssues) {
    const dateKey = it.duedate || "마감일 없음";
    if (!byDate.has(dateKey)) {
      byDate.set(dateKey, []);
    }
    byDate.get(dateKey).push(it);
  }

  // 날짜 순서대로 표시
  const sortedDates = Array.from(byDate.keys()).sort((a, b) => {
    if (a === "마감일 없음") return 1;
    if (b === "마감일 없음") return -1;
    return a.localeCompare(b);
  });

  for (const dateKey of sortedDates) {
    const items = byDate.get(dateKey);

    const dateGroup = el("div", "oor-date-group");
    const dateHeader = el("div", "oor-date-header");
    dateHeader.textContent = dateKey === "마감일 없음" ? dateKey : fmtDate(parseDate(dateKey));
    dateGroup.append(dateHeader);

    const itemsContainer = el("div", "oor-items");
    for (const it of items) {
      const item = createSimpleIssueItem(it);
      itemsContainer.append(item);
    }
    dateGroup.append(itemsContainer);
    container.append(dateGroup);
  }
}

function createSimpleIssueItem(it) {
  const item = el("div", "oor-simple-item");
  item.dataset.key = it.key;
  item.textContent = `${it.key}`;
  item.title = `${it.summary} (${it.status.name})`;
  item.addEventListener("click", () => select(it.key));
  return item;
}

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
