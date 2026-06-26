# DropWeb 배포용 웹사이트 제작 가이드

> 이 문서는 AI 코딩 도구(Claude, Cursor, ChatGPT 등)에게 전달하여 DropWeb에 바로 업로드 가능한 정적 웹사이트를 만들기 위한 가이드입니다.
> 프로젝트 시작 시 이 문서를 AI에게 먼저 전달해주세요.

---

## 프로젝트 규칙

### 1. 기본 구조

프로젝트는 아래 구조를 따릅니다:

```
my-site/          ← 작업 폴더 (이 폴더 자체가 사이트 루트)
├── index.html          ← 메인 페이지 (필수)
├── style.css           ← 스타일시트
├── script.js           ← JavaScript (필요 시)
├── assets/             ← 이미지, 폰트 등
│   ├── logo.svg
│   └── hero.png
├── about.html          ← 추가 페이지 (필요 시)
└── contact.html
```

- `index.html`은 반드시 프로젝트 루트에 위치해야 합니다.
- **중요: 하위 폴더를 새로 만들어서 그 안에 사이트를 생성하지 마세요.** 현재 작업 폴더를 사이트 루트로 사용하여 이 경로에 바로 `index.html` 등의 파일을 생성합니다.
- 폴더째 ZIP으로 압축하여 DropWeb에 업로드합니다.

### 2. 경로 규칙 (가장 중요)

모든 파일 참조는 **상대 경로**를 사용합니다.

```html
<!-- ✅ 올바른 예시 (상대 경로) -->
<link rel="stylesheet" href="style.css">
<script src="script.js"></script>
<img src="assets/logo.svg" alt="로고">
<a href="about.html">소개</a>

<!-- ❌ 잘못된 예시 (절대 경로) -->
<link rel="stylesheet" href="/style.css">
<script src="/script.js"></script>
<img src="/assets/logo.svg" alt="로고">
<a href="/about">소개</a>
```

CSS 내부에서도 동일합니다:

```css
/* ✅ 올바른 예시 */
background-image: url(assets/bg.png);
@font-face { src: url(assets/fonts/custom.woff2); }

/* ❌ 잘못된 예시 */
background-image: url(/assets/bg.png);
```

홈으로 돌아가는 링크:

```html
<!-- ✅ 올바른 예시 -->
<a href="./">홈으로</a>

<!-- ❌ 잘못된 예시 -->
<a href="/">홈으로</a>
```

### 3. 허용 파일 형식

업로드 가능한 파일 확장자:

| 종류 | 확장자 |
|------|--------|
| 웹 문서 | `.html`, `.htm`, `.css`, `.js`, `.json` |
| 이미지 | `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.ico`, `.webp` |
| 폰트 | `.woff`, `.woff2`, `.ttf`, `.eot`, `.otf` |
| 기타 | `.map`, `.txt`, `.xml`, `.webmanifest` |

> `.php`, `.py`, `.sh`, `.exe` 등 서버 실행 파일은 업로드할 수 없습니다.

### 4. 외부 리소스 사용

CDN을 통한 외부 라이브러리 사용은 자유롭게 가능합니다:

```html
<!-- Tailwind CSS -->
<script src="https://cdn.tailwindcss.com"></script>

<!-- Google Fonts -->
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">

<!-- Alpine.js -->
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
```

### 5. 멀티 페이지 구성

여러 페이지를 만들 때 페이지 간 링크는 상대 경로를 사용합니다:

```
my-site/
├── index.html          ← 홈
├── about.html          ← 소개
├── contact.html        ← 문의
├── guides/
│   ├── index.html      ← 가이드 목록
│   └── getting-started.html
└── assets/
    └── style.css
```

```html
<!-- index.html 에서 -->
<a href="about.html">소개</a>
<a href="guides/">가이드</a>

<!-- guides/getting-started.html 에서 -->
<a href="../">홈으로</a>
<a href="../about.html">소개</a>
<link rel="stylesheet" href="../assets/style.css">
```

### 6. 업로드 제한

- 최대 파일 크기: **150MB** (ZIP 압축 상태)
- ZIP 파일만 업로드 가능

### 6-1. ZIP 생성 규칙

- 배포용 ZIP은 반드시 **`프로젝트루트/dropweb/` 폴더에 생성**한다 (폴더가 없으면 생성)
  ```bash
  mkdir -p dropweb
  zip -r dropweb/dropweb_prototype.zip index.html style.css script.js data.js i18n.js service-spec.md assets/ -x "*.DS_Store"
  ```
- ZIP에는 **배포 파일만 포함**한다: `index.html`, `style.css`, `script.js`, `data.js`, `i18n.js`, `service-spec.md`, `assets/`
- 포함 금지: `md/`, `scripts/`, `templates/`, `xlt/`, `dropweb/`(자기 자신), `.claude/`, `.git/`, 임시 파일(`translation_*.json` 등)

### 7. 서비스 기획서 자동 관리 (service-spec.md)

사이트 개발과 동시에 **`service-spec.md`** 파일을 작업 폴더에 생성하고, 기능 추가/수정/삭제 시 항상 최신 상태로 유지합니다.

이 문서는 유관부서(사업, 기획, 디자인, FE/BE 개발, QA)와 커뮤니케이션하기 위한 서비스 기획서 역할을 합니다. 추측이나 계획이 아닌, **현재 구현된 실제 내용**만 기록하세요.

`service-spec.md`에 포함할 항목:

| 항목 | 설명 |
|------|------|
| 서비스 개요 | 서비스명, 목적, 타겟 사용자, 핵심 가치 |
| 페이지 구성 (사이트맵) | 전체 페이지 목록과 계층 구조, 각 페이지의 역할 |
| 페이지별 상세 기능 | 각 페이지에 포함된 UI 요소, 인터랙션, 동작 설명 |
| 데이터 구조 | 사용되는 데이터 항목, 입력 폼 필드, 저장/표시 방식 |
| 디자인 가이드 | 컬러, 폰트, 레이아웃 방향, 반응형 기준, 참고 사이트 |
| 외부 연동 | 사용 중인 CDN, API, 외부 서비스 목록 |
| 변경 이력 | 주요 변경사항과 날짜 기록 |

> **규칙:**
> - 사이트 개발 시작 시 `service-spec.md`를 생성할 것
> - 기능 추가/수정/삭제가 발생할 때마다 해당 문서를 반드시 업데이트할 것
> - 기술 용어보다는 기능/동작 중심으로 비개발자도 이해할 수 있게 작성할 것

---

## AI에게 전달할 프롬프트 예시

아래 프롬프트를 참고하여 AI에게 요청하세요:

### 예시 1: 회사 소개 페이지

```
아래 가이드를 참고하여 회사 소개 정적 웹사이트를 만들어줘.

[이 문서 내용 붙여넣기]

요구사항:
- 회사명: OO컴퍼니
- 페이지: 메인, 서비스 소개, 팀 소개, 문의
- 디자인: 모던하고 깔끔한 스타일, Tailwind CSS 사용
- 반응형 지원 (모바일/데스크톱)
- 한국어
```

### 예시 2: 이벤트 랜딩 페이지

```
아래 가이드를 참고하여 이벤트 랜딩 페이지를 만들어줘.

[이 문서 내용 붙여넣기]

요구사항:
- 이벤트명: 2025 여름 프로모션
- 단일 페이지 (index.html 하나)
- 카운트다운 타이머 포함
- 참여 신청 폼 (이름, 이메일, 전화번호)
- 밝고 활기찬 디자인
```

---

## 체크리스트

ZIP 압축 전 아래 항목을 확인하세요:

- [ ] `index.html`이 프로젝트 루트에 있는가?
- [ ] 모든 파일 참조가 상대 경로인가? (`/`로 시작하지 않는가?)
- [ ] 홈 링크가 `href="./"`인가? (`href="/"`가 아닌가?)
- [ ] 이미지, CSS, JS 파일이 모두 포함되어 있는가?
- [ ] 허용되지 않는 파일 형식이 포함되어 있지 않은가?
- [ ] ZIP 파일 크기가 150MB 이하인가?
- [ ] `service-spec.md`가 현재 구현 내용과 일치하는가?
