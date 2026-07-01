// reorder.js — 그룹 순서 조정 모달 (로컬 보기 설정, docs/05·docs/12)
import { state, setUiState, isLabelHidden } from "./state.js";
import { saveUiState } from "./data.js";
import { toast } from "./actions.js";
import { labelColor, applyGroupOrder } from "./util.js";

const $ = (s) => document.querySelector(s);

let currentOrder = [];
let draggedItem = null;

export function openReorderModal() {
  const snap = state.snapshot;
  if (!snap || !snap.labelGroups || snap.labelGroups.length === 0) {
    alert("조정할 그룹이 없습니다.");
    return;
  }

  // 현재 적용된 순서(저장된 그룹 순서 반영)대로 모달에 표시
  currentOrder = applyGroupOrder(snap.labelGroups, state.ui.groupOrder)
    .map(g => ({ name: g.name, count: g.count, hidden: isLabelHidden(g.name) }));

  renderReorderList();
  $("#reorder-modal").style.display = "flex";
}

export function closeReorderModal() {
  $("#reorder-modal").style.display = "none";
  currentOrder = [];
  draggedItem = null;
}

function renderReorderList() {
  const list = $("#reorder-list");
  list.innerHTML = currentOrder.map((g, idx) => {
    const color = labelColor(g.name);
    return `
      <div class="reorder-item${g.hidden ? " is-hidden" : ""}" draggable="true" data-idx="${idx}">
        <span class="reorder-handle">⋮⋮</span>
        <span class="reorder-label">
          <span class="label-chip" style="background:${color};"></span>
          ${escapeHtml(g.name)}
        </span>
        <span class="reorder-count">${g.count}개</span>
        <button class="reorder-vis" data-vis="${idx}" title="${g.hidden ? "대시보드에 표시" : "대시보드에서 숨기기"}">${g.hidden ? "🙈 숨김" : "👁 표시"}</button>
      </div>
    `;
  }).join("");

  // 드래그 이벤트 핸들러
  list.querySelectorAll(".reorder-item").forEach(item => {
    item.addEventListener("dragstart", handleDragStart);
    item.addEventListener("dragend", handleDragEnd);
    item.addEventListener("dragover", handleDragOver);
    item.addEventListener("drop", handleDrop);
    item.addEventListener("dragleave", handleDragLeave);
  });
  // 숨김/표시 토글 (드래그와 무관하게 클릭)
  list.querySelectorAll(".reorder-vis").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const i = parseInt(btn.dataset.vis, 10);
      currentOrder[i].hidden = !currentOrder[i].hidden;
      renderReorderList();
    });
  });
}

function handleDragStart(e) {
  draggedItem = this;
  this.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/html", this.innerHTML);
}

function handleDragEnd(e) {
  this.classList.remove("dragging");
  document.querySelectorAll(".reorder-item").forEach(item => {
    item.classList.remove("drag-over");
  });
}

function handleDragOver(e) {
  if (e.preventDefault) e.preventDefault();
  e.dataTransfer.dropEffect = "move";

  if (this !== draggedItem) {
    this.classList.add("drag-over");
  }
  return false;
}

function handleDragLeave(e) {
  this.classList.remove("drag-over");
}

function handleDrop(e) {
  if (e.stopPropagation) e.stopPropagation();

  if (draggedItem !== this) {
    const fromIdx = parseInt(draggedItem.dataset.idx);
    const toIdx = parseInt(this.dataset.idx);

    // 배열 재정렬
    const [movedItem] = currentOrder.splice(fromIdx, 1);
    currentOrder.splice(toIdx, 0, movedItem);

    renderReorderList();
  }

  return false;
}

function saveReorderChanges() {
  // (no label) 제외한 순서 + 숨긴 라벨을 보기 설정으로 저장
  const groupOrder = currentOrder
    .map(g => g.name)
    .filter(name => name !== "(no label)");
  const hiddenLabels = currentOrder.filter(g => g.hidden).map(g => g.name);

  setUiState({ groupOrder, hiddenLabels });   // 메모리 반영 + 즉시 재렌더(emit)
  saveUiState();                              // 서버 data/ui-state.json 에 영속화 (fire-and-forget)
  const n = hiddenLabels.length;
  toast(n ? `그룹 순서 저장 · 숨긴 라벨 ${n}개` : "그룹 순서를 저장했습니다.", "ok");
  closeReorderModal();
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

export function initReorderModal() {
  $("#f-reorder").addEventListener("click", openReorderModal);
  $("#reorder-close").addEventListener("click", closeReorderModal);
  $("#reorder-cancel").addEventListener("click", closeReorderModal);
  $("#reorder-save").addEventListener("click", saveReorderChanges);

  // 모달 배경 클릭 시 닫기
  $("#reorder-modal").addEventListener("click", (e) => {
    if (e.target.id === "reorder-modal") {
      closeReorderModal();
    }
  });

  // ESC 키로 닫기
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("#reorder-modal").style.display !== "none") {
      closeReorderModal();
    }
  });
}
