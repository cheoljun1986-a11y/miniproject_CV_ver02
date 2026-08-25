# 복셀 디버그 맵 설계

작성일: 2026-08-25
대상 브랜치: private/baencho/better

## 1. 목적

스캔한 실제 공간의 복셀 맵이 방의 형상을 실제로 담고 있는지 **눈으로 확인 가능하게** 만든다.
궁극 목표(캐릭터가 물체 뒤로 숨고 물체를 피해 이동)로 가기 전에, 입력이 신뢰할 만한지부터
판별한다. 필터를 아무리 얹어도 입력이 망가져 있으면 결과는 나아지지 않는다.

## 2. 범위

### 포함
- 포즈 기반 키프레임 선정 (20cm 이동 또는 15° 회전)
- 키프레임 depth를 네이티브 해상도로 보관 → 재스캔 없이 필터 재적용
- 프레임 단위 중복 제거가 있는 복셀 누적
- 관측 횟수 / 높이 / 클러스터 색상 모드
- 운영자 뷰 확장 + AR 화면 wireframe 오버레이
- 키프레임 카메라 프러스텀 표시
- 파라미터 슬라이더, 관측 히스토그램, 샘플 폐기 통계
- 키프레임 JSON 내보내기/불러오기

### 제외
- 클러스터링 · 연결 성분 분석 (Phase 4)
- 바닥/벽 평면 제거 (Phase 4)
- occluder 메시 생성 (Phase 5)
- 레이캐스트 기반 가림 비율 판정과 캐릭터 배치 (Phase 6)
- 세그멘테이션 (Phase 7)
- 기존 `?depth=cloud` / `?occlusion=cpu` 동작 변경

## 3. 접속 방식과 모드 우선순위

`?voxel=debug`가 **최우선**으로 해석된다.

| URL | 모드 | depth usage |
|---|---|---|
| `?voxel=debug` | voxel-debug | cpu-optimized |
| `?occlusion=cpu` | cpu-occlusion | cpu-optimized |
| `?depth=cloud` | cloud | cpu-optimized |
| (기본) | gpu-occlusion | gpu-optimized |

voxel-debug를 먼저 검사하는 이유: `?voxel=debug&occlusion=cpu`에서 CPU occluder가 살아
있으면 실세계 깊이가 깊이 버퍼를 채우고, `depthTest: true`인 wireframe 오버레이가 가까운
실물 뒤에서 잘려나간다. **책상 뒤 복셀이 안 보인다**는 뜻인데, 그게 정확히 판단해야 할
대상이다.

## 4. 선택한 구현 방식

### 4-1. 기존 `DepthCloud` / `VoxelMap`을 쓰지 않는다

`depth-cloud.js:99`가 유일한 `voxelMap.observe()` 호출부인데 frameId 개념이 없다.
40×30 격자를 ~60° FOV에 뿌리면 1m에서 샘플 간격이 ~2.9cm이고 복셀은 5cm이므로,
**한 프레임이 같은 셀에 2~3표를 넣어 즉시 solid로 승격**시킨다.

이 결함은 거리 의존적이다 — 간격이 2m에서 5.8cm, 4m에서 11.6cm이므로 ~1.7m 너머는
실제로 여러 프레임이 필요하다. 결과적으로 **가까운 것은 초록, 먼 것은 빨강**인 맵이 나오는데,
이건 "다중 관측 검증이 작동 안 함" 증상과 구분이 불가능하다. 진단의 원인 귀속을 위해
이 writer를 voxel-debug 경로에서 배제한다.

두 모듈은 코드 한 줄 바꾸지 않고 기존 모드 전용으로 남는다.

### 4-2. 원본 보존: 키프레임 depth 격자

스캔 중에는 복셀 맵을 만들지 않고 재료만 쌓는다. 복셀 맵은 시각화 시점에 계산한다.
`depthInformation.width×height`(보통 160×120)를 기존 `getDepthInMeters(u,v)`로 훑어
Float32Array로 보관한다. `.data` / `rawValueToMeters` / `normDepthBufferFromNormView`는
건드리지 않아 uint16/float32 포맷 분기 코드가 없다.

15장 × 160×120 × 4B ≈ 1.2MB. `hcp.glb` 하나가 3.7MB인 걸 감안하면 무시 가능하다.

### 4-3. 프레임 중복 제거는 `lastFrameId`

spec 원문은 셀마다 `Set<frameId>`를 요구하지만, 20만 셀에 Set을 달면 다시 읽지도 않을
정보에 ~20MB가 든다. `rebuildVoxelGrid`가 키프레임을 **순서대로 하나씩 완전히 소진**하므로
`cell.lastFrameId !== frameId`가 정확히 동치다. 이 전제는 모듈 헤더에 명시하고 테스트로
고정했다 (`voxel-grid.test.mjs`의 interleaving 테스트).

## 5. 코드 구조

```
순수 (three/DOM 비의존, node --test)
  keyframe-gate.js       포즈 델타 키프레임 선정
  voxel-grid.js          셀 레코드 + 누적 + 히스토그램
  depth-grid-filter.js   범위 클립 + 4-이웃 그래디언트
  keyframe-store.js      스냅샷 저장 + 재구성 + JSON 코덱
  voxel-color-modes.js   색상 모드
  voxel-debug-params.js  컨트롤 스키마 + clamp

어댑터 (three / DOM)
  keyframe-capture.js        XRCPUDepthInformation → 스냅샷
  voxel-debug-controller.js  글루
  voxel-overlay.js           AR wireframe InstancedMesh
  voxel-debug-panel.js       런타임 생성 슬라이더 DOM
```

## 6. 성능 제한

- 키프레임 최대 15장, 최소 간격 250ms (프레임 예산 보호용이며 포즈 임계값을 넓히지 않음)
- 샘플 상한 40,000 — 초과 시 stride로 축소하고 유효 해상도를 기록
- 복셀 셀 상한 200,000, 운영자 뷰 인스턴스 상한 120,000
- AR 오버레이 인스턴스 6,000, 반경 4m, 카메라가 0.3m 이상 움직였을 때만 재구성
- 재구성 디바운스 150ms

## 7. 데이터 흐름

```
XRFrame + viewerPose
  → KeyframeGate.shouldCapture   (매 프레임 평가, ~7 flops)
  → CpuDepthFrameSource.read     (게이트 통과 시에만)
  → KeyframeCapture              (views[0]만, 네이티브 해상도)
  → KeyframeStore                (원본 보존)
        ↓ 슬라이더 조작 시 재실행
  → rebuildVoxelGrid             (범위 클립 → 그래디언트 → 역투영 → 프레임 중복 제거)
  → VoxelGrid                    (observationCount + 누적 평균 좌표)
  → selectCells(minObservations) (렌더 시점 필터, 재구성 없음)
  → OperatorView / VoxelOverlay
```

## 8. 오류 처리

- depth 획득 실패 → 캡처 건너뜀, 게이트 미소모
- `getDepthInMeters` throw → 해당 샘플 0 처리
- 저장소 가득 참 → 캡처 실패로 처리, 게이트와 포즈 기준선 미변경
- JSON 파싱 실패 / 버전 불일치 / 길이 불일치 → `null` 반환, 기존 상태 유지
- JSON 불러오기 성공 → AR 오버레이 강제 해제 (다른 XR local 원점 소속)
- `nearM >= farM` → `farM`을 한 스텝 밀어냄 (조용히 빈 맵이 되는 것 방지)
- 셀 상한 도달 → `truncated` 플래그로 HUD에 노출, 조용히 자르지 않음

## 9. 검증

`node --test tests/*.test.mjs` — 89개에서 156개로 증가, 0 실패.

핵심 단언:
- 같은 키프레임을 다른 frameId로 두 번 → `observationCount === 2`
- 아홉 픽셀이 한 키프레임 안에서 한 셀에 → `observationCount === 1`, `sampleCount === 9`
- 쿨다운이 포즈 임계값을 넓히지 않음
- 높이 램프가 `operator-view.js:88` 현재 출력과 비트 단위 동일

실기기 검증 절차는 `docs/superpowers/plans/2026-08-25-voxel-debug-map.md` 참조.

## 10. 완료 기준

- [x] `?voxel=debug`로 20초 스캔 후 복셀 맵이 렌더된다
- [x] 관측 임계값 슬라이더가 재스캔 없이 즉시 반응한다
- [x] 관측 1/2/3+ 히스토그램과 샘플 폐기 통계가 HUD에 표시된다
- [x] 키프레임 프러스텀을 켤 수 있다
- [x] AR 화면에 wireframe 오버레이를 겹칠 수 있다
- [x] 키프레임 JSON을 내보내고 다시 불러올 수 있다
- [x] 기존 세 모드가 동작 변경 없이 유지된다
- [ ] 실기기에서 Phase 2 진단표를 채운다 ← **다음 단계**
