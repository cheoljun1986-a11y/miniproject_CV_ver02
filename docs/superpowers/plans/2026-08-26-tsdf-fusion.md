# TSDF Fusion Implementation Plan (완료 기록)

> 이 문서는 사후 기록이다. 계획을 세우고 실행한 순서대로 적되, 실제로 측정해서 결정을 바꾼 지점을 그대로 남긴다.

**Goal:** 게임 지형 복셀맵의 노이즈(허공 복셀)와 구멍을 줄여 하츄핑이 보이지 않는 곳으로 가거나 이상한 곳에 서는 문제를 해결한다. 조교 제안: TSDF fusion. 아울러 기본 게임이 키프레임 기반 지형을 쓰게 한다.

**Architecture:** `VoxelGrid.observe()`(맞은 칸 +1 카운팅) 자리를 순수 모듈 `TsdfGrid`로 바꾼다. 위(키프레임 캡처)와 아래(`TraversalGrid`·occluder·운영자 뷰)는 인터페이스를 유지한다. TSDF는 복셀을 취소할 수 있으므로 `onCleared` → `TraversalGrid.unobserve()` 경로를 새로 만든다.

**Tech Stack:** JavaScript ES modules, Node.js `node:test`, 저장 스캔 JSON(`results/scan-*.json`)으로 오프라인 검증

**Branch:** `private/baencho/tsdf-fusion` (origin/main `2f86b20`에서 분기)

## Global Constraints

- 옛 경로는 지우지 않는다: `?terrain=legacy`(VoxelMap), `?fusion=count`(카운팅)로 실기기 A/B가 가능해야 한다.
- 폰에서 키프레임당 처리 시간이 한 프레임 예산을 크게 넘지 않아야 한다 (400ms 간격으로 들어옴).
- 순수 모듈로 만들어 저장 스캔으로 Node에서 검증한다. 실기기 검증은 별도 항목.
- 튜닝 상수는 전부 `config.js`의 `TSDF_*`에 둔다.

---

### Task 1: `TsdfGrid` 순수 모듈 — 완료

**Files:** Create `src/tsdf-grid.js`, `tests/tsdf-grid.test.mjs`

- [x] 희소 해시 격자. 키는 문자열 대신 정수(축당 17비트)로 — 핫루프에서 수 배 빠름
- [x] `integrate(keyframe, filter)`: 픽셀마다 `filterDepthGrid`(기존 near/far/gradient 필터) → 역투영 → 카메라에서 광선
  - 밴드 `[L−τ, L+τ]` (τ = 2복셀 = 10cm)에 `sdf = (L−t)/τ` 가중 평균 누적, 셀 생성
  - 자유공간: `carveStride`(3) 서브샘플 광선이 카메라~밴드 사이를 지나며 **이미 있는 셀에만** +1 — 메모리가 부피가 아닌 표면적에 비례
  - 부동소수 누적 대신 정수 스텝 수 — 마지막 밴드 샘플이 반올림으로 빠지는 버그를 테스트가 잡음
- [x] 프레임당 1표: 같은 프레임의 여러 광선이 한 복셀을 지나면 표면에 가까운 값만 채택 (프레임 직전 상태를 저장해 되돌리고 재적용)
- [x] 거리 가중치 `min(1, (ref/L)^power)` — Task 5에서 측정 후 추가
- [x] solid = `weight ≥ minWeight && |tsdf| < surfaceBand`. `_flushTouched()`가 상태 전이를 `onSolid`/`onCleared`로 보고
- [x] `getSurfaceCells()`(내보내기용), `getHistogram()`, `evictUnconfirmed()` 등 VoxelGrid와 같은 읽기 인터페이스
- [x] 테스트 9개: 밴드 부호, minWeight 확정, **허공 노이즈가 뒤 표면 관측으로 철회됨**, 프레임당 1표, 같은 프레임 밴드가 카빙을 덮음, 가중치 상한, 만원 격자/축출, reset

### Task 2: `TraversalGrid.unobserve()` — 완료

**Files:** Modify `src/traversal-grid.js`, `tests/traversal-grid.test.mjs`

- [x] 슬랩 비트를 셀당 `Uint16Array` 참조 카운트로 보강. `unobserve`는 마지막 복셀이 빠질 때만 비트를 지우고, 빈 셀은 삭제해 "본 적 없음"으로 되돌림
- [x] 테스트 2개. 첫 시도에서 "30cm 위 허공 복셀이 칸을 막는다"고 가정했는데 실제로는 그 복셀이 **설 수 있는 선반**이 되어 walkable이 유지됨 — 테스트를 높이 검사로 고침

### Task 3: `VoxelTerrain` 융합 스위치 — 완료

**Files:** Modify `src/voxel-terrain.js`, `src/config.js`, `tests/voxel-terrain.test.mjs`

- [x] `fusion: 'tsdf' | 'count'` (기본 tsdf). `_makeGrid`가 `TsdfGrid` 또는 `VoxelGrid`
- [x] solid 목록에 `key → index` 맵을 둬 철회를 O(1) swap-remove로; `stats.carved`, `stats.cleared`
- [x] TSDF는 절반 해상도(80×60, `TSDF_KEYFRAME_MAX_SAMPLES=4800`)로 캡처 — Task 5 측정 근거
- [x] `exportJSON`은 TSDF일 때 표면 셀만 내보냄 (자유공간·내부 셀 제외)
- [x] 기존 카운팅 테스트는 `fusion:'count'`로 고정, TSDF 테스트 4개 추가 (기본값, 철회, 내보내기, reset)

### Task 4: 기본값 전환과 배선 — 완료

**Files:** Modify `src/app-mode.js`, `src/main.js`, `tests/app-mode.test.mjs`

- [x] `resolveTerrainSource`: 기본 `keyframe`, `?terrain=legacy`로 옵트아웃
- [x] `resolveFusionMode`: 기본 `tsdf`, `?fusion=count`
- [x] `main.js`: `VoxelTerrain({ fusion, onCleared: chaseGrid.unobserve })`

### Task 5: 저장 스캔으로 오프라인 검증·튜닝 — 완료

**Data:** `results/scan-20260826-155334.json`(304장), `results/scan-20260826-160320.json`(242장)
**Metrics:** solid 수, 고립 복셀(26-이웃 없음), `TraversalGrid` walkable/blocked/seen, 바닥 슬랩, 키프레임당 ms

- [x] **1차 측정 — TSDF가 더 나빴다.** τ=2, band 0.5, 전해상도: walkable 1816→1371 (−25%), blocked 453→1557, 18ms/장
- [x] **원인 진단.** 카운트에서 walkable인데 TSDF에서 blocked인 267칸을 슬랩 단위로 덤프:
  - 158칸은 막는 복셀이 없고 **설 수 있는 천장**(바닥+1.3m)에 걸림 → TSDF 바닥 슬랩이 2단 낮음(8 vs 11). TSDF가 복셀을 4배 내놓아 바닥 아래 노이즈 슬랩이 `floorMinCells=8`(절대값)을 넘긴 것
  - 나머지 109칸은 표면 두께(+1~+5 슬랩)
- [x] **수정 1 — 바닥 검출 상대화** (`floorMinFraction=0.3`, 가장 붐비는 슬랩 대비). 0.1/0.2/0.3/0.4를 쓸어 두 스캔 모두에서 바닥이 표면 슬랩에 놓이는 최소값이 0.3. 카운팅 쪽도 +50칸 개선
- [x] **수정 2 — band 0.5 → 0.3** (두꺼운 바닥이 자기 headroom을 먹음), **절반 해상도** (18ms → 5ms/장, 품질 손실 미미)
- [x] **수정 3 — farM 스윕**으로 남은 blocked 초과가 원거리 노이즈임을 확인 → **거리 가중치** 도입. `ref 1.5/2.0 × 선형/제곱` 비교, `ref 2.0 선형` 채택
- [x] 최종 (카운트 → TSDF): 고립 복셀 618→399 / 341→289, blocked 403→246 / 233→108, walkable 1866→1354 / 913→782 (원거리 확정 지연), 5.2ms/장

### Task 6: 비교 도구와 문서 — 완료

**Files:** Modify `viewer.html`, `README.md`, Create this file

- [x] `viewer.html`에 **카운트 / TSDF** 버튼 — 같은 스캔 JSON을 두 방식으로 재구성해 비교 (config.js 상수, 절반 해상도 그대로)
- [x] README: 타임라인 14행, 4-14절(문제·해결·검증표·기본값 변경), 5절 파라미터, 상태표, 다음 단계

## 검증

- [x] `node --test tests/*.test.mjs` 407개 통과 (신규 15개 포함), `tests/module-syntax.test.mjs` 통과
- [x] headless Edge로 `app.html?occlusion=cpu`, `v4-chase.html`, `viewer.html` 로드 — 콘솔 오류 없음
- [ ] **실기기 미검증** — 다음 항목을 폰에서 확인해야 한다:
  - 키프레임당 처리 시간 (`getLastIngestMs`, 운영자 뷰 상태줄)
  - 도망 모드 시작까지 걸어야 하는 거리 (walkable 120칸 도달)
  - `?fusion=count`, `?terrain=legacy`와 비교해 하츄핑 위치 이상·미표시 빈도

## 남긴 결정과 열린 문제

- 원거리 확정 지연(walkable −14~27%)은 거리 가중치의 대가다. 플레이어가 걸어다니며 채운다고 판단했지만, 실기기에서 시작까지 너무 오래 걸리면 `TSDF_DEPTH_WEIGHT_REF_M`을 2.5~3.0으로 올린다.
- 표면 추출은 `|tsdf| < band` 셸이다. 제로 크로싱/마칭큐브는 occluder 메시 품질이 필요해질 때.
- 통합은 메인 스레드에서 동기 실행한다. 폰에서 5ms×4배 이상이 나오면 Worker 또는 행 단위 분할로 옮긴다.
- 서버 `serve.py`의 listen backlog 수정(터널 경유 동시 요청 502)은 별도 stash에 있으며 이 브랜치와 무관하다.
