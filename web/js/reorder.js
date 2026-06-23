// reorder.js — 그룹 순서 조정 모달
import { state } from "./state.js";
import { actions, runAction } from "./actions.js";
import { labelColor } from "./util.js";

const $ = (s) => document.querySelector(s);

let currentOrder = [];
let draggedItem = null;

export function openReorderModal() {
  const snap = state.snapshot;
  if (!snap || !snap.labelGroups || snap.labelGroups.length === 0) {
    alert("조정할 그룹이 없습니다.");
    return;
  }

  currentOrder = snap.labelGroups.map(g => ({
    name: g.name,
    count: g.count,
  }));

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
      <div class="reorder-item" draggable="true" data-idx="${idx}">
        <span class="reorder-handle">⋮⋮</span>
        <span class="reorder-label">
          <span class="label-chip" style="background:${color};"></span>
          ${escapeHtml(g.name)}
        </span>
        <span class="reorder-count">${g.count}개</span>
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

async function saveReorderChanges() {
  // (no label) 제거하고 labelOrder 생성
  const labelOrder = currentOrder
    .map(g => g.name)
    .filter(name => name !== "(no label)");

  await runAction(
    actions.reorderGroups(labelOrder),
    "그룹 순서 저장",
    "reorder_groups"
  );

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
