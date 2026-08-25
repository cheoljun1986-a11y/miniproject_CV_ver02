# Voxel Debug Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `?voxel=debug`에서 20초 스캔 후 복원된 복셀 맵을 운영자 뷰와 AR 오버레이로 보고, 재스캔 없이 필터 파라미터를 조정하며 Phase 2 진단표를 채운다.

**Architecture:** 순수 로직(키프레임 게이트, 복셀 격자, depth 필터, 스냅샷 저장/재구성, 색상 모드, 파라미터 스키마)은 three.js/DOM/WebXR 비의존으로 `node --test` 대상이다. 어댑터(캡처, 컨트롤러, AR 오버레이, 디버그 패널)만 three.js와 DOM을 만진다.

**Tech Stack:** 브라우저 네이티브 ES 모듈, three.js r0.180.0 (importmap), WebXR depth-sensing (cpu-optimized), `node:test`

**Spec:** `docs/superpowers/specs/2026-08-25-voxel-debug-map-design.md`

## Global Constraints

- 현재 브랜치 `private/baencho/better`에서 작업. `main` 수정 금지.
- 추적되지 않은 `triposr/`, `.DS_Store` 보존.
- 기존 세 모드(`/`, `?occlusion=cpu`, `?depth=cloud`) 동작 무변경. `voxel-map.js`, `depth-cloud.js`, `cpu-depth-occluder.js`, `depth-math.js`, `cpu-depth-frame-source.js`, `index.html`은 한 줄도 바꾸지 않는다.
- 튜닝 값: 키프레임 20cm / 15° / 최대 15장 / 최소 간격 250ms, 근거리 0.3m, 원거리 5.0m, 그래디언트 0.10m, 복셀 0.05m, 샘플 상한 40,000, 셀 상한 200,000, 운영자 인스턴스 120,000, AR 오버레이 6,000 / 반경 4m, 재구성 디바운스 150ms.
- `tests/static-site.test.mjs`는 수정하지 않는다 — 디버그 패널은 런타임 생성이라 `index.html`의 module script 개수를 건드리지 않는다.
- 완료 후 README 갱신.

---

### Task 1: `?voxel=debug` 모드

**Files:** Modify `src/app-mode.js`, `tests/app-mode.test.mjs`

**Interfaces:**
`Produces: usesDepthCloud(mode: string): boolean`
`Extends: APP_MODES.VOXEL_DEBUG`, `resolveAppMode` 우선순위

- [x] **Step 1:** 4개 단언 추가 — `?voxel=debug` 해석, `?voxel=debug&occlusion=cpu` 우선순위, `depthUsageForMode`/`usesSpaceMapping`, `usesDepthCloud`
- [x] **Step 2:** 실패 확인 (`usesDepthCloud` export 없음)
- [x] **Step 3:** 구현. `voxel=debug`를 **최우선** 검사
- [x] **Step 4:** 기존 4개 테스트 무변경 통과 확인

### Task 2-7: 순수 모듈

각 모듈은 실패 테스트 → 실패 사유 확인 → 최소 구현 → 통과 순서로 진행한다.

- [x] **Task 2:** `src/keyframe-gate.js` — `quaternionAngleDeg`, `isKeyframe`, `KeyframeGate` (8 tests)
- [x] **Task 3:** `src/voxel-grid.js` — `VoxelGrid`, `cellMeanPosition`, `selectCells`, `histogramDisplayCount` (11 tests)
- [x] **Task 4:** `src/depth-grid-filter.js` — `isDepthInRange`, `neighborGradientOk`, `filterDepthGrid` (7 tests)
- [x] **Task 5:** `src/keyframe-store.js` — `KeyframeStore`, `keyframeStoreFromJSON`, `rebuildVoxelGrid` (10 tests)
- [x] **Task 6:** `src/voxel-color-modes.js` — `voxelColorRGB`, `nextColorMode` (6 tests)
- [x] **Task 7:** `src/voxel-debug-params.js` — `VOXEL_DEBUG_CONTROLS`, `applyParam`, `normalizeParams` (6 tests)

### Task 8-9: HUD와 상수

- [x] **Task 8:** `formatVoxelDebugStatus` in `src/ui.js` (+2 tests). 기존 포매터 무변경
- [x] **Task 9:** `src/config.js` 상수 추가

### Task 10-11: 어댑터

- [x] **Task 10:** `src/keyframe-capture.js` — three-stub 테스트 6개. 포즈 게이트 우선, `views[0]`만, 네이티브 해상도, 저장 실패 시 게이트 미소모
- [x] **Task 11:** `src/voxel-debug-controller.js` — three-stub 테스트 7개. 디바운스, `minObservations` 무재구성, JSON 왕복

### Task 12-15: 렌더링과 배선

- [x] **Task 12:** `src/operator-view.js` 순수 추가 확장. `render()`의 레거시 분기는 `solidVoxels &&` 가드 한 개만 추가
- [x] **Task 13:** `src/voxel-overlay.js` — `renderOrder = 3`, `depthWrite: false`, 반경 컬링
- [x] **Task 14:** `src/voxel-debug-panel.js` — `pointer-events: auto`, `z-index: 25`(운영자 오버레이 20보다 위)
- [x] **Task 15:** `src/main.js` 배선

### Task 16-18: 검증과 문서

- [x] **Task 16:** `node --test tests/*.test.mjs` — 89 → 156, 0 실패
- [x] **Task 17:** 모든 `src/*.js` 구문 검사 + 순수 모듈 로드 검증
- [x] **Task 18:** spec/plan 문서 쌍 작성
- [ ] **Task 19:** README 갱신
- [ ] **Task 20:** 실기기 Phase 2 진단 ← **여기서 멈추고 결과 보고**

---

## 실기기 검증 절차 (Phase 2)

**준비.** ~1.5m 거리에 독립적으로 선 물체(의자/작은 탁자), ~3m 벽, 보이는 바닥이 있는 방.
ARCore 폰 Chrome에서 `?voxel=debug` 접속 → START AR. 스캔은 세션 시작과 함께 자동 개시.
물체 주위로 20초간 천천히 호를 그리며 걷는다. 제자리 회전 금지, 초당 한 걸음 이하.

**스캔 종료 시 읽을 값:**

| # | HUD 필드 | 정상 | 이상하면 |
|---|---|---|---|
| 1 | `키프레임 n/15` | 10–15 | `<5` → 포즈 게이트 미발동. 3초 만에 15 → 추적 떨림 |
| 2 | `경과 t s` | ~20 | 훨씬 작으면 조기 종료 |
| 3 | `버림 0값` | 30–60% | `>90%` → depth 미도달. `#metrics`의 `depth usage`/`format` 확인 |
| 4 | `버림 범위` | 5–25% | `>60%` → near 0.2 / far 6.0 시도 |
| 5 | `버림 경사` | 5–20% | `>50%` → 그래디언트 0.20으로 |
| 6 | `복셀 N` (임계 1) | 3,000–30,000 | `<200` → "거의 없음" 행 |
| 7 | `관측 1회/2회/3+회` | 예 60/25/15% | **`3+회 == 0`이 헤드라인** |
| 8 | `재구성 Nms` | `<400` | `>2000` → 복셀 0.05로 |

**재스캔 없이 이어서:**

1. 운영자 뷰 → 색상 **관측 횟수** → 탑다운 오빗
2. **관측 임계값** 1→2→3→4 드래그, `표시 M` 변화 관찰 — **핵심 실험**
3. 색상 **높이** → 바닥이 일정한 Y에서 한 색 띠인지
4. **프러스텀** 켜기 → 매끄러운 호인지
5. AR 복귀 → **AR 오버레이** → 물체로 접근 → wireframe이 물체 위/앞/뒤 중 어디인지
6. 세션 종료 전 **JSON 내보내기**

**진단표:**

| 증상 | 읽히는 값 | 원인 | 조치 |
|---|---|---|---|
| 방 형태를 따라감 | `3+회` 10–30%, 임계 3에서 물체·바닥 유지 | 정상 | Phase 3 진행 |
| 허공에 빨강만 | `1회` ≥70%, 임계 3이 허공 제거 | 노이즈 | Phase 3, 임계 3 |
| 허공에 초록(3+) | 모든 프러스텀에서 ≥3m 떨어진 초록 | 1순위 스테레오 이중 카운트, 2순위 역투영 부호 | 격자 정렬 재확인 |
| 두 겹·세 겹 | 벽에 5–15cm 간격 시트 2장, 프러스텀 호 꺾임 | 포즈 드리프트 | 키프레임 8장, 12초, 더 천천히 |
| 모든 복셀 1회 | 키프레임 12인데 `2회==0 && 3+회==0` | 격자 정렬 또는 키프레임 미중첩 | 프러스텀이 공유 볼륨 향하는지 |
| 거의 없음 | `복셀 <200` 또는 `0값 >90%` | depth 실패 또는 과필터 | 그래디언트 0, near 0.2/far 8.0으로 **같은 키프레임** 재구성 |

**가장 중요한 결과:** `3+회`가 건강한 비율이고 초록 복셀이 실제 표면에 붙어 있으면 다중 시점
검증이 작동하는 것이고, 기존 `DepthCloud` writer가 문제의 전부였다는 뜻이다. 키프레임 12장인데
`3+회 == 0`이면 20cm/15° 임계값이 이 방에 너무 공격적이다 — 절반으로 낮추고 **재스캔 대신
내보낸 JSON으로 재구성**한다.
