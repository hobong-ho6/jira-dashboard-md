// label-picker.js — 재사용 라벨 피커: 대시보드 라벨 드롭다운 선택 + "새 라벨" 직접 입력 + 다중 선택 칩.
// create(새 티켓)·detail(라벨 변경) 등에서 host 엘리먼트에 마운트해 쓴다. (docs/05 라벨 편집)
import { labelColor, NO_LABEL } from "./util.js";

const NEW_OPT = "__new__";
const esc = (t) => { const d = document.createElement("div"); d.textContent = t == null ? "" : t; return d.innerHTML; };

// 현재 대시보드에 보이는 라벨(이슈 라벨 ∪ 라벨 그룹명, NO_LABEL 제외) — 이름 오름차순.
export function existingLabels(snap) {
  const set = new Set();
  for (const it of (snap && snap.issues || [])) for (const l of (it.labels || [])) if (l) set.add(l);
  for (const g of (snap && snap.labelGroups || [])) if (g.name && g.name !== NO_LABEL) set.add(g.name);
  return [...set].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

// host 안에 라벨 피커를 렌더한다.
//   opts.initial: 초기 선택 라벨 배열
//   opts.getSnapshot(): 드롭다운 후보를 뽑을 현재 snapshot
// 반환: { getLabels(): string[] } — 현재 선택 라벨(미확정 입력 텍스트도 포함)
export function mountLabelPicker(host, { initial = [], getSnapshot }) {
  const selected = [...initial];
  host.innerHTML =
    `<div class="cf-label-chips" data-lp="chips"></div>` +
    `<div class="cf-label-add">` +
    `<select data-lp="select" title="대시보드 라벨에서 선택하거나 새 라벨 추가"></select>` +
    `<input type="text" data-lp="new" placeholder="새 라벨 입력 후 Enter" style="display:none;"></div>`;
  const chips = host.querySelector('[data-lp="chips"]');
  const sel = host.querySelector('[data-lp="select"]');
  const neu = host.querySelector('[data-lp="new"]');

  function renderChips() {
    chips.innerHTML = selected.map((l) =>
      `<span class="cf-label-chip" style="--lc:${labelColor(l)}">${esc(l)}` +
      `<button type="button" data-rm="${esc(l)}" aria-label="${esc(l)} 제거" title="제거">×</button></span>`
    ).join("");
  }
  function renderOptions() {
    const avail = existingLabels(getSnapshot()).filter((l) => !selected.includes(l));
    const parts = [
      `<option value="">＋ 라벨 추가…</option>`,
      `<option value="${NEW_OPT}">＋ 새 라벨 직접 입력…</option>`,
    ];
    if (avail.length) parts.push(`<optgroup label="대시보드 라벨">${avail.map((l) => `<option value="${esc(l)}">${esc(l)}</option>`).join("")}</optgroup>`);
    sel.innerHTML = parts.join("");
    sel.value = "";
  }
  function add(raw) {
    const parts = String(raw || "").split(",").map((s) => s.trim()).filter(Boolean);
    let added = false;
    for (const p of parts) if (!selected.includes(p)) { selected.push(p); added = true; }
    if (added) { renderChips(); renderOptions(); }
  }
  function remove(name) {
    const i = selected.indexOf(name);
    if (i >= 0) { selected.splice(i, 1); renderChips(); renderOptions(); }
  }

  sel.addEventListener("change", () => {
    const v = sel.value;
    if (v === NEW_OPT) { sel.value = ""; neu.style.display = ""; neu.focus(); }
    else if (v) add(v);
  });
  neu.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); add(neu.value); neu.value = ""; neu.style.display = "none"; sel.focus(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); neu.value = ""; neu.style.display = "none"; sel.focus(); }
  });
  neu.addEventListener("blur", () => { if (neu.value.trim()) add(neu.value); neu.value = ""; neu.style.display = "none"; });
  chips.addEventListener("click", (e) => { const b = e.target.closest("[data-rm]"); if (b) remove(b.dataset.rm); });

  renderChips();
  renderOptions();
  return {
    getLabels() {
      if (neu.value.trim()) add(neu.value);   // 미확정 입력 텍스트도 반영
      return [...selected];
    },
  };
}
