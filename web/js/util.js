// util.js — 날짜/버킷/색/문자열 유틸 (docs/06, docs/12)

export const NO_LABEL = "(no label)";

export const BUCKETS = ["overdue", "today", "thisWeek", "later", "none"];
export const BUCKET_LABEL = {
  overdue: "지남", today: "오늘", thisWeek: "이번주", later: "이후", none: "마감일 없음",
};
export const BUCKET_RANK = { overdue: 0, today: 1, thisWeek: 2, later: 3, none: 4 };

export function pad(n) { return String(n).padStart(2, "0"); }

export function todayDate() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function parseDate(s) {
  if (!s) return null;
  const m = String(s).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function fmtDate(d) {
  if (!d) return "";
  const dd = (d instanceof Date) ? d : parseDate(d);
  if (!dd) return "";
  return `${dd.getMonth() + 1}/${dd.getDate()}`;
}

export function fmtDateFull(s) {
  const d = parseDate(s);
  if (!d) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fmtDateTime(s) {
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d)) return String(s);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

export function weekRange(today, weekStart = "monday") {
  const wd = today.getDay(); // 0=Sun..6=Sat
  let offset;
  if (weekStart === "sunday") offset = wd;
  else offset = (wd + 6) % 7; // Monday start
  const start = new Date(today); start.setDate(today.getDate() - offset);
  const end = new Date(start); end.setDate(start.getDate() + 6);
  return [start, end];
}

export function bucketOf(duedate, today = todayDate(), weekStart = "monday") {
  const d = parseDate(duedate);
  if (!d) return "none";
  if (d < today) return "overdue";
  if (d.getTime() === today.getTime()) return "today";
  const [ws, we] = weekRange(today, weekStart);
  if (d >= ws && d <= we) return "thisWeek";
  return "later";
}

const LABEL_PALETTE = [
  "#7c6cff", "#36d399", "#f5a623", "#4c8dff", "#ff5d6c",
  "#34c3a8", "#d570ff", "#e8b04b", "#5aa9e6", "#9aa3b2",
];
export function labelColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return LABEL_PALETTE[h % LABEL_PALETTE.length];
}

export function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function statusCategoryClass(cat) {
  if (cat === "done") return "st-done";
  if (cat === "indeterminate") return "st-progress";
  return "st-new";
}

// 저장된 그룹 순서(이름 배열)대로 그룹 배열을 재정렬.
// order에 있는 이름이 먼저(그 순서대로), 나머지는 기존 순서 유지, NO_LABEL은 항상 맨 끝.
export function applyGroupOrder(groups, order) {
  if (!Array.isArray(order) || !order.length) return groups;
  const pos = new Map(order.map((n, i) => [n, i]));
  return groups.slice().sort((a, b) => {
    const an = a.name === NO_LABEL, bn = b.name === NO_LABEL;
    if (an !== bn) return an ? 1 : -1;            // NO_LABEL 은 항상 뒤로
    const pa = pos.has(a.name) ? pos.get(a.name) : Infinity;
    const pb = pos.has(b.name) ? pos.get(b.name) : Infinity;
    if (pa === pb) return 0;                        // 동률 → 안정정렬로 기존 순서 유지
    return pa - pb;
  });
}
