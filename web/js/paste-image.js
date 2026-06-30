// paste-image.js — 설명(description) textarea 에 클립보드 이미지를 붙여넣으면
// 서버(/api/upload-image)에 저장하고 본문 커서 위치에 Jira wiki markup !파일명! 을 삽입한다.
// 저장된 파일 경로는 onAttach(path) 로 넘겨 create_issue/set_description 의 attachments 로 쓴다. (docs/11)
import { toast } from "./actions.js";

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(blob);
  });
}

function insertAtCursor(ta, text) {
  const s = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
  const e = ta.selectionEnd != null ? ta.selectionEnd : ta.value.length;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
  ta.selectionStart = ta.selectionEnd = s + text.length;
  ta.focus();
}

// textareaEl 에 paste 핸들러 부착(1회). onAttach(path): 업로드 성공 시 첨부 경로 수집 콜백.
export function wireImagePaste(textareaEl, onAttach) {
  if (!textareaEl || textareaEl._pasteWired) return;
  textareaEl._pasteWired = true;
  textareaEl.addEventListener("paste", async (e) => {
    const items = [...((e.clipboardData && e.clipboardData.items) || [])]
      .filter((it) => it.type && it.type.indexOf("image/") === 0);
    if (!items.length) return;            // 일반 텍스트 붙여넣기는 기본 동작 유지
    e.preventDefault();
    for (const it of items) {
      const blob = it.getAsFile();
      if (!blob) continue;
      const ext = ((blob.type.split("/")[1] || "png")).replace("jpeg", "jpg");
      try {
        const dataUrl = await blobToDataUrl(blob);
        const res = await fetch("/api/upload-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: blob.name || ("paste." + ext), dataUrl }),
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const j = await res.json();
        insertAtCursor(textareaEl, `!${j.filename}!`);
        if (typeof onAttach === "function") onAttach(j.path);
        toast(`이미지 첨부: ${j.filename} (process 때 Jira에 업로드)`, "ok");
      } catch (err) {
        toast("이미지 업로드 실패(로컬 서버 필요): " + err.message, "err");
      }
    }
  });
}
