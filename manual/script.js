// Jira MCP Dashboard 매뉴얼 — 네비게이션 인터랙션 (의존성 없음)
(function () {
  var sidebar = document.getElementById("sidebar");
  var menuBtn = document.getElementById("menuBtn");
  var navLinks = Array.prototype.slice.call(document.querySelectorAll("#nav a"));
  var sections = navLinks
    .map(function (a) { return document.querySelector(a.getAttribute("href")); })
    .filter(Boolean);

  // 모바일 메뉴 토글
  if (menuBtn && sidebar) {
    menuBtn.addEventListener("click", function () { sidebar.classList.toggle("open"); });
    // 링크 클릭 시 닫기
    navLinks.forEach(function (a) {
      a.addEventListener("click", function () { sidebar.classList.remove("open"); });
    });
    // 바깥 클릭 시 닫기
    document.addEventListener("click", function (e) {
      if (sidebar.classList.contains("open") && !sidebar.contains(e.target) && e.target !== menuBtn) {
        sidebar.classList.remove("open");
      }
    });
  }

  // 스크롤스파이 — 현재 보이는 섹션의 네비 항목 강조
  function onScroll() {
    var pos = window.scrollY + 120;
    var current = sections[0];
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].offsetTop <= pos) current = sections[i];
    }
    navLinks.forEach(function (a) {
      a.classList.toggle("active", current && a.getAttribute("href") === "#" + current.id);
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("load", onScroll);
  onScroll();

  // 코드 블록 복사 버튼 자동 부착
  document.querySelectorAll("pre").forEach(function (pre) {
    var btn = document.createElement("button");
    btn.className = "copy";
    btn.type = "button";
    btn.textContent = "복사";
    btn.addEventListener("click", function () {
      var code = pre.querySelector("code");
      var text = code ? code.innerText : pre.innerText;
      navigator.clipboard.writeText(text).then(function () {
        btn.textContent = "복사됨!";
        setTimeout(function () { btn.textContent = "복사"; }, 1500);
      }).catch(function () { btn.textContent = "실패"; });
    });
    pre.appendChild(btn);
  });
})();
