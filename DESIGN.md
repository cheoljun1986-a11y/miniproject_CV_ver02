# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-08-26
- Primary product surfaces: 모드 선택 홈, 하츄핑 도망 모드, WebXR 개발자·진단 모드
- Evidence reviewed: `README.md`, `index.html`, `app.html`, `v4-chase.html`, `src/ui.js`, `tests/static-site.test.mjs`, `tests/chase-page.test.mjs`

## Brand
- Personality: 장난스럽고 활기찬 AR 숨바꼭질 게임, 기술 데모보다 게임 경험을 먼저 보여준다.
- Trust signals: 지원 환경과 모드 목적을 진입 전에 명확히 안내하고, 진단 기능은 별도 영역으로 구분한다.
- Avoid: 게임과 개발 수치를 같은 시각적 우선순위로 노출하기, 의미 없는 색상 혼용, 한 화면에 모든 버튼 나열하기.

## Product goals
- Goals: 최상위 주소에서 목적에 맞는 모드를 쉽게 선택하고, 공개 데모는 하츄핑 도망 모드로 시작한다.
- Non-goals: 이번 변경에서 기존 WebXR 렌더링·게임 규칙·진단 동작을 재설계하지 않는다.
- Success signals: 첫 방문자가 공개 데모를 바로 식별하며, 기존 쿼리 링크도 동일한 모드로 이동한다.

## Personas and jobs
- Primary personas: AR 게임을 체험하는 방문자, 공간 인식 기능을 점검하는 개발자·발표자.
- User jobs: 게임을 시작한다, 특정 depth/복셀 진단 모드에 진입한다.
- Key contexts of use: Android Chrome의 세로형 휴대폰 화면, 데스크톱에서의 프로젝트 소개·진단 접근.

## Information architecture
- Primary navigation: 최상위 `index.html`에서 공개 데모와 진단 도구를 선택한다.
- Core routes/screens: `index.html` 모드 선택, `v4-chase.html` 공개 게임, `app.html?...` 진단 모드.
- Content hierarchy: 공개 데모를 가장 큰 카드로, 개발자·진단 도구를 작은 보조 카드로 표시한다.

## Design principles
- 게임 우선: 방문자의 기본 선택은 하츄핑 도망 모드다.
- 한 카드, 한 목적: 모드명과 짧은 설명, 이동 행동을 한 단위로 제공한다.
- Tradeoffs: 진단 기능의 즉시 노출은 줄지만 처음 방문자의 선택 부담과 실수는 감소한다.

## Visual language
- Color: 어두운 보라 배경, 핑크·보라 그라데이션을 공개 데모의 주요 강조색으로 사용한다.
- Typography: 시스템 산세리프, 큰 제목과 간결한 본문으로 계층을 만든다.
- Spacing/layout rhythm: 12px 카드 간격, 20px 내외 카드 패딩, 섹션 사이 40px 내외 여백.
- Shape/radius/elevation: 주요 카드 28px, 보조 카드 20px 반경과 절제된 그림자.
- Motion: 보조 카드의 짧은 hover 이동만 허용하며 reduced-motion을 존중한다.
- Imagery/iconography: 외부 이미지 없이 단순 기호와 그라데이션을 사용한다.

## Components
- Existing components to reuse: 기존 AR HUD와 `src/ui.js`의 UI 제어 함수.
- New/changed components: 공개 데모 카드, 진단 도구 카드, 지원 환경 안내.
- Variants and states: 주요 게임 카드 1종, 진단 카드 2종, 키보드 포커스 상태.
- Token/component ownership: 메인페이지 CSS 사용자 정의 속성은 `index.html`에서 소유한다.

## Accessibility
- Target standard: WCAG 2.1 AA 수준의 대비와 키보드 접근성을 지향한다.
- Keyboard/focus behavior: 모든 모드 카드는 링크이며 명확한 `:focus-visible` 외곽선을 제공한다.
- Contrast/readability: 밝은 텍스트와 충분히 어두운 배경을 사용하고 보조 텍스트도 읽을 수 있는 대비를 유지한다.
- Screen-reader semantics: 한 개의 `main`, 계층적인 제목, 공개 데모 링크의 구체적인 접근성 이름을 사용한다.
- Reduced motion and sensory considerations: `prefers-reduced-motion`에서 카드 전환 효과를 제거한다.

## Responsive behavior
- Supported breakpoints/devices: Android Chrome 중심, 일반 데스크톱 브라우저 보조 지원.
- Layout adaptations: 700px 이하에서 진단 카드 3열을 1열로 변경한다.
- Touch/hover differences: 카드 전체를 터치 대상으로 사용하며 hover는 필수 정보 전달에 사용하지 않는다.

## Interaction states
- Loading: 메인페이지는 정적 HTML로 즉시 표시한다.
- Empty: 해당 없음.
- Error: WebXR 실행 실패 안내는 각 실행 페이지의 기존 fallback을 유지한다.
- Success: 카드 선택 즉시 해당 실행 페이지로 이동한다.
- Disabled: 메인페이지에는 비활성 모드를 두지 않는다.
- Offline/slow network, if applicable: 메인 선택은 표시되지만 Three.js와 모델 로드는 네트워크 연결이 필요하다.

## Content voice
- Tone: 짧고 친근하며 행동 중심이다.
- Terminology: 방문자 영역은 “게임 시작”, 개발자 영역은 CPU·공간 복원·복셀 용어를 허용한다.
- Microcopy rules: 한 카드 설명은 한 문장으로 제한하고 내부 구현 세부사항은 README로 보낸다.

## Implementation constraints
- Framework/styling system: 빌드 없는 정적 HTML/CSS와 브라우저 ES 모듈.
- Design-token constraints: 메인페이지의 소수 CSS 변수만 사용하며 별도 디자인 시스템 의존성을 추가하지 않는다.
- Performance constraints: 메인페이지에서 외부 이미지·폰트·JavaScript 프레임워크를 로드하지 않는다.
- Compatibility constraints: GitHub Pages의 상대 경로와 기존 최상위 쿼리 주소를 유지한다.
- Test/screenshot expectations: 정적 사이트 테스트로 링크·리다이렉트·모듈 진입점을 검증하고 모바일 폭에서 카드가 한 열인지 확인한다.

## Open questions
- [ ] 실제 Android 기기에서 메인페이지 카드 크기와 공개 데모 진입 후 브라우저 뒤로가기 동선을 확인한다 / 개발팀 / 실기기 사용성
