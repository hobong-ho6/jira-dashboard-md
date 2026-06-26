// sections.js — 본문 영역(타임라인·범위밖·카드) 순서 조정 + 영속화 (docs/12, docs/13)
// 각 패널 헤더에 ▲▼ 버튼을 달아 순서를 바꾸고, state.ui.sectionOrder 로 서버에 영속한다.
import { state, setUiState } from "./state.js";

const $ = (s) => document.querySelector(s);
const DEFAULT_ORDER = ["timeline", "outOfRange", "cards"];

// 유효한 순서 = 저장값에서 알려진 섹션만 + 누락분을 기본 순서로 보충
function order() {
  const saved = Array.isArray(state.ui.sectionOrder) ? state.ui.sectionOrder : [];
  const out = saved.filter((id) => DEFAULT_ORDER.includes(id));
  for (const id of DEFAULT_ORDER) if (!out.includes(id)) out.push(id);
  return out;
}

export function applySectionOrder() {
  const content = $(".content");
  if (!content) return;
  const secs = [...content.querySelectorAll(":scope > section[data-section]")];
  const byId = new Map(secs.map((s) => [s.dataset.section, s]));
  for (const id of order()) {
    const s = byId.get(id);
    if (s) content.appendChild(s); // 기존 노드 이동(이벤트/내용 보존)
  }
}

function move(id, dir) {
  const o = order();
  const i = o.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= o.length) return;
  [o[i], o[j]] = [o[j], o[i]];
  setUiState({ sectionOrder: o }); // 메모리 반영 + emit + 서버 영속
  applySectionOrder();
}

export function initSections() {
  const content = $(".content");
  if (!content) return;
  for (const sec of content.querySelectorAll(":scope > section[data-section]")) {
    const head = sec.querySelector(".panel-title") || sec.firstElementChild;
    if (!head || head.querySelector(".sec-move")) continue;
    const ctrl = document.createElement("span");
    ctrl.className = "sec-move";
    ctrl.innerHTML =
      `<button class="sec-btn" data-dir="-1" title="위로" aria-label="영역 위로">▲</button>` +
      `<button class="sec-btn" data-dir="1" title="아래로" aria-label="영역 아래로">▼</button>`;
    ctrl.addEventListener("click", (e) => {
      const b = e.target.closest(".sec-btn");
      if (!b) return;
      move(sec.dataset.section, parseInt(b.dataset.dir, 10));
    });
    head.appendChild(ctrl);
  }
  applySectionOrder();
}
