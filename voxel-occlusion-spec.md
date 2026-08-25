# AR 숨바꼭질 — 복셀 기반 Occlusion 파이프라인 구현 명세

## 배경과 목표

WebXR + Three.js + ARCore Depth API 환경에서, 스캔한 실제 공간의 물체 뒤로 가상 캐릭터를 숨기고 이동시킨다.

**핵심 요구사항 (스코프 축소됨)**
- 물체가 "무엇"인지 분류할 필요 없음. 어디에 뭔가 있는지만 알면 됨
- 완전 은폐 불필요. 책상 다리 사이로 캐릭터 일부가 보이는 건 정상적인 게임플레이
- 스캔 후 물체가 움직이지 않는다고 가정 (relocalization 불필요, 동일 세션 내 진행)

**기존 시도와 실패**
- YOLO 2D bounding box 기반 → 3D 투영 시 부정확
- Depth-only 복셀 → 허공에 복셀 생성, 캐릭터가 물체 앞으로 나옴, 픽셀 깨짐

**이번 접근의 전제**
필터를 더 얹기 전에, 복셀 맵이 실제로 방의 형상을 담고 있는지부터 눈으로 확인한다. 입력이 망가진 상태에서 후처리를 아무리 얹어도 결과는 나아지지 않는다.

**제약**
- WebXR은 ARCore의 depth confidence 채널을 노출하지 않음 (네이티브 전용). confidence 없이 진행
- 네이티브 Android 전환은 5일 일정상 배제

---

## Phase 0 — 프로젝트 구조 파악 및 테스트 페이지 골격

복셀 맵 관련 구현은 현재 없음. 신규로 작성한다.

### 0-1. 기존 코드에서 확인할 것

- [ ] WebXR immersive-ar 세션 초기화가 어디에서 이뤄지는가
- [ ] depth-sensing 기능을 이미 요청하고 있는가 (`requiredFeatures` / `optionalFeatures`에 `depth-sensing` 포함 여부)
- [ ] depth 데이터를 어떤 형식으로 받고 있는가 (`XRCPUDepthInformation` / `XRWebGLDepthInformation`)
- [ ] 매 프레임 `viewerPose`를 얻는 지점이 어디인가
- [ ] Three.js 씬·렌더러 초기화 코드의 위치와 재사용 가능 여부

확인 후 요약 보고.

### 0-2. 페이지 분리 구조

디버그 UI를 메인 게임 화면에 섞지 않는다. 별도 테스트 페이지로 만든다.

```
/                    메인 게임 (캐릭터, 숨바꼭질 로직)
/test-voxel          복셀 맵 테스트 페이지 (디버그 전용)
```

**공유 모듈로 분리할 것** — 테스트 페이지에서 검증한 로직을 그대로 메인에서 쓸 수 있어야 함.

```
src/
  xr/
    session.js        WebXR 세션 초기화 (공유)
    depth.js          depth 획득 + 역투영 (공유)
  voxel/
    VoxelMap.js       복셀 누적 자료구조 (공유)
    keyframe.js       키프레임 추출 (공유)
    filters.js        노이즈 필터 (공유)
    cluster.js        연결 성분 분석 (Phase 4, 공유)
    occluder.js       occluder 메시 생성 (Phase 5, 공유)
  debug/
    VoxelDebugRenderer.js   시각화 (테스트 전용)
    DebugPanel.js           통계·슬라이더 UI (테스트 전용)
```

`debug/` 아래 것만 테스트 페이지에서 import하고, 메인은 건드리지 않는다.

### 0-3. 테스트 페이지 요구사항

- 스캔 시작 / 중지 버튼
- 스캔 중 실시간 통계 표시 (키프레임 수, 누적 복셀 수, 경과 시간)
- 스캔 종료 후 복셀 맵 시각화 렌더링
- 파라미터 조정 UI (아래 Phase 1-4 참조) — 재스캔 없이 이미 수집한 데이터에 필터를 다시 적용할 수 있어야 함
- **원본 데이터 보존**: 필터를 건 결과가 아니라 필터 적용 전 복셀 맵을 메모리에 유지하고, 시각화 시점에 필터를 적용. 슬라이더를 움직일 때마다 재스캔하는 일이 없도록
- 키프레임 데이터를 JSON으로 export/import 할 수 있으면 좋음 (같은 스캔 데이터로 반복 실험 가능)

---

## Phase 1 — 복셀 맵 누적 구조 + 디버그 시각화

### 1-1. 복셀 누적 자료구조

```
VoxelMap {
  voxelSize: 0.03  // 3cm, 조정 가능하게
  worldOrigin: fixed vec3  // 세션 시작 시 고정, 이후 변경 금지
  cells: Map<string, VoxelCell>  // key = `${ix},${iy},${iz}`
}

VoxelCell {
  ix, iy, iz          // 정수 격자 인덱스
  observationCount    // 서로 다른 키프레임에서 관측된 횟수
  observedFrames      // Set<frameId>, 같은 프레임 중복 카운트 방지
  accumulatedPos      // 실제 3D 점들의 평균 (격자 중심이 아닌 실측 위치)
  clusterId           // Phase 4에서 채움, 초기 null
}
```

**중요**
- 인덱스는 반드시 `floor((worldPos - worldOrigin) / voxelSize)`로 계산
- `observedFrames`로 중복 방지 — 같은 키프레임에서 여러 픽셀이 같은 셀에 떨어져도 관측 1회로 카운트
- 스캔 20초 동안 **절대 리셋하지 않음**

### 1-2. 키프레임 추출

- 스캔 20초 동안 전체 프레임이 아니라 **키프레임 10~15장**만 사용
- 선정 기준: 직전 키프레임 대비 카메라 이동 20cm 이상 **또는** 회전 15도 이상
- 각 키프레임 저장 항목: frameId, camera pose (matrix), depth buffer, intrinsics

### 1-3. 역투영 + 최소 필터

각 키프레임의 depth 픽셀에 대해:

```
for each pixel (u, v):
    d = depth[u][v]
    if d == 0: continue                    // 미측정
    if d < 0.3 or d > 5.0: continue        // 유효 범위 클리핑
    if gradientCheck(u, v) fails: continue // 아래 참조
    worldPos = unproject(u, v, d, pose, intrinsics)
    voxelMap.observe(worldPos, frameId)
```

**gradientCheck**: 상하좌우 4-이웃과의 depth 차이를 계산해, 하나라도 10cm를 초과하면 해당 픽셀 폐기. 물체 경계에서 발생하는 flying pixel 제거용.

이 단계에서는 다중 관측 검증을 **적용하지 않는다**. 필터링 전 상태를 봐야 진단이 가능하므로, observationCount는 기록만 하고 필터는 시각화 단계에서 토글로 건다.

### 1-4. 디버그 렌더러

Three.js `InstancedMesh` 사용. 게임 화면 위에 오버레이로 그리고, 토글 버튼으로 on/off.

```js
const geo = new THREE.BoxGeometry(voxelSize, voxelSize, voxelSize);
const mat = new THREE.MeshBasicMaterial({ wireframe: true, transparent: true, opacity: 0.6 });
const mesh = new THREE.InstancedMesh(geo, mat, MAX_VOXELS);
// setMatrixAt(i, matrix), setColorAt(i, color)
```

**시각화 모드 (UI에서 전환 가능하게)**

1. **관측 횟수 모드** — 1회=빨강, 2회=노랑, 3회 이상=초록
2. **클러스터 모드** — 연결 성분별 랜덤 색상 (Phase 4 이후 활성)
3. **높이 모드** — Y좌표에 따른 그라디언트 (바닥 평면 확인용)

**추가 디버그 오버레이**

- 키프레임 카메라 위치를 절두체(frustum)로 표시 → pose 누적이 정상인지 확인
- 캐릭터 후보 위치를 반투명 구체로 표시 (Phase 6 이후)
- 화면 한쪽에 통계 표시: 총 복셀 수, 관측 1/2/3+ 각각의 개수, 클러스터 수

**필터 토글**: 관측 횟수 임계값(1/2/3/4)을 슬라이더로 실시간 조정 가능하게. 임계값을 올릴 때 허공 복셀이 사라지는지, 아니면 물체까지 같이 사라지는지 눈으로 확인하기 위함.

---

## Phase 2 — 진단 (사람이 눈으로 확인, 코드 아님)

Phase 1 완료 후 실제 공간에서 스캔하고 다음을 판별한다.

| 관찰되는 증상 | 원인 | 조치 |
|---|---|---|
| 복셀이 방 형태를 대략 따라감 | 정상 | Phase 3으로 진행 |
| 허공에 빨강(1회 관측)만 떠 있음 | 노이즈, 필터로 해결 가능 | Phase 3, 임계값 3 적용 |
| 허공에 초록(3회+)이 있음 | 다중 관측 검증이 작동 안 함 | 격자 정렬 재확인 (Phase 0-2번) |
| 표면이 두 겹·세 겹으로 번져 보임 | pose 드리프트 | 키프레임 수 축소, 스캔 시간 단축, 스캔 중 급격한 이동 금지 |
| 모든 복셀이 관측 1회 | 격자 정렬 문제 | `worldOrigin` 고정 여부, `floor` 계산식 재확인 |
| 복셀이 거의 없음 | depth 획득 실패 또는 필터 과다 | 범위 클리핑 값, depth buffer 포맷 확인 |

**이 표의 결과를 보고할 것.** 이후 단계는 여기서 나온 진단에 따라 달라진다.

---

## Phase 3 — 노이즈 필터링 (진단 후 적용)

단계별로 하나씩 켜면서 복셀 수와 육안 품질을 기록한다. 이 기록이 그대로 평가 지표가 된다.

- [ ] **유효 범위 클리핑** (Phase 1에 이미 포함) — 0.3~5m
- [ ] **Depth 그래디언트 필터** (Phase 1에 이미 포함) — 10cm 임계값
- [ ] **다중 관측 검증** — observationCount >= 3인 복셀만 유효로 채택
- [ ] **연결 성분 크기 필터** — 3D flood fill 후 부피 20cm³ 미만 클러스터 삭제

각 단계마다 기록:
- 총 복셀 수
- 육안 판정: 허공 복셀이 사라졌는가 / 물체가 손상되었는가

---

## Phase 4 — 물체 단위 분리

### 4-1. 바닥 평면 제거 (필수)

바닥을 제거하지 않으면 방의 모든 물체가 바닥을 통해 하나의 거대 덩어리로 이어진다.

- 방법 A: 복셀의 Y좌표 히스토그램에서 최빈값 근처(±5cm)를 바닥으로 간주하고 제거
- 방법 B: WebXR hit-test로 바닥 평면을 얻어 그 높이 기준으로 제거
- A가 구현이 간단하므로 먼저 시도

### 4-2. 벽 평면 제거 (선택)

벽에 붙은 물체를 분리하려면 필요. RANSAC 평면 피팅으로 큰 평면을 찾아 제거하거나, 방 경계 bounding box에서 일정 거리 이내 복셀을 제외.

우선순위 낮음 — 바닥 제거만으로 대부분 분리되는지 먼저 확인.

### 4-3. 연결 성분 분석

- 3D flood fill (6-connectivity 또는 26-connectivity)
- 각 복셀에 clusterId 부여
- 클러스터별 통계: 복셀 수, bounding box, 중심점, 최고 높이

**시각화 모드 2번으로 확인**: 소파 하나가 여러 덩어리로 쪼개졌는지, 서로 다른 물체가 하나로 뭉쳤는지.

---

## Phase 5 — Occluder 메시 생성

복셀 클러스터를 Three.js에서 보이지 않는 occluder로 변환한다.

```js
const occluderMat = new THREE.MeshBasicMaterial({
  colorWrite: false,   // 색상 렌더링 안 함
  depthWrite: true     // 깊이 버퍼에는 기록
});
occluderMesh.renderOrder = -1;  // 캐릭터보다 먼저 렌더
```

이렇게 하면 GPU 깊이 테스트가 자동으로 occlusion을 처리한다. 캐릭터가 occluder 뒤에 있으면 그 픽셀이 자동으로 탈락하고, 카메라를 어느 각도로 움직여도 일관되게 유지된다. 프레임당 추가 계산 없음.

**메시 생성 방식 (난이도 순)**

1. **복셀 큐브 그대로** — 가장 단순. 계단 현상이 보이지만 동작은 함. 먼저 이걸로 검증
2. **Greedy meshing** — 인접한 같은 클러스터 복셀의 면을 병합. 폴리곤 수가 크게 줄고 계단도 완화
3. **Marching cubes** — 부드러운 표면. 품질은 최고지만 구현 부담

1번으로 먼저 전체 파이프라인을 통과시키고, 시간이 남으면 2번으로 개선.

**병행 구조**: ARCore depth 기반 실시간 occlusion은 그대로 유지하고, occluder 메시는 스캔된 큰 물체용으로 추가. 스캔에 안 잡힌 대상(사람, 새로 놓인 물건)은 실시간 depth가 처리.

---

## Phase 6 — 숨을 곳 판정과 캐릭터 배치

### 6-1. 후보 위치 샘플링

- 각 클러스터에 대해, 클러스터 bounding box 주변에 후보 지점을 여러 개 생성
- 후보는 바닥 높이 + 캐릭터 반높이 위치에 배치 (공중 부양 방지)

### 6-2. 가림 비율 계산 (핵심)

물체를 인식할 필요 없이, **실제 렌더링 결과로 판정**한다.

```
for each 후보 위치:
    캐릭터 실루엣의 샘플 점 N개 (예: 20개)를 잡는다
    각 점마다 카메라 → 점 방향으로 레이캐스트
    occluder 메시에 막히는 점의 비율 = occlusionRatio
```

**채택 기준: occlusionRatio가 0.4 ~ 0.8 범위**
- 1.0에 가까우면 완전히 안 보여서 찾을 수 없음
- 0에 가까우면 숨은 게 아님
- 책상 다리 사이는 자연스럽게 이 범위에 들어옴

이 레이캐스트 검증 한 단계가 "숨었는데 물체 앞에 보이는" 증상을 대부분 해결한다. 후보 위치를 정한 뒤 반드시 이 검증을 통과해야만 실제 배치.

### 6-3. 이동 중 처리

캐릭터가 A 지점에서 B 지점으로 이동할 때:
- 경로상에서 occlusionRatio가 변하는 건 정상 (물체 뒤로 들어갔다 나왔다)
- 렌더링 자체는 Phase 5의 depth 테스트가 자동 처리하므로 추가 작업 없음
- 다만 이동 경로가 occluder 내부를 관통하지 않도록 경로 계획 시 클러스터 bounding box 회피

### 6-4. 이동 경로 계획 (TODO)

- [ ] 바닥 평면상에서 2D navmesh 또는 grid 생성
- [ ] 클러스터 bounding box를 장애물로 표시
- [ ] A* 또는 단순 직선 + 장애물 회피로 경로 산출
- [ ] 경로상 중간 지점들의 occlusionRatio를 미리 계산해두면, "숨었다 나타났다"를 게임 로직에서 활용 가능

---

## Phase 7 — 세그멘테이션 (조건부, 시간 여유 시)

**Phase 4에서 물체가 제대로 분리되지 않을 때만 진행한다.** 바닥 제거 + 연결 성분으로 충분하면 불필요.

### 적용 방식

세그멘테이션은 역투영 직전의 필터로 작동한다.

```
for each pixel p:
    if mask[p] == background: continue   ← 이 한 줄이 전부
    worldPos = unproject(p, depth[p], pose)
    voxelMap.observe(worldPos, frameId)
```

마스크 밖 픽셀은 역투영 자체를 하지 않으므로 노이즈 유입 경로가 입구에서 차단된다.

### 모델 선택

- **YOLO26-Seg / RF-DETR-Seg** — 빠르고 COCO 실내 가구 클래스 포함. 스캔 후처리용으로 충분. 먼저 시도
- **SAM 2.1** — 마스크 품질 최고. 클래스 라벨이 없어 검출기와 2단 구성 필요. 경계 품질이 아쉬울 때 refine 용도
- 서버(Flask)에서 스캔 종료 후 배치 처리. 런타임 왕복 없음

### 마스크 전처리

- 마스크 경계 2~3px erode 후 역투영. 경계 픽셀의 depth가 물체 앞뒤로 늘어지는 문제 완화

---

## 평가 지표 (발표용)

파이프라인 단계별로 측정해 개선을 정량화한다.

**노이즈 제거 효과**
- 필터 단계별(raw → 범위클리핑 → 그래디언트 → 다중관측 → 연결성분) 총 복셀 수
- 각 단계별 허공 복셀 개수 (수동 라벨링 또는 육안 카운트)

**숨을 곳 판정 정확도**
- 후보 배치 시도 중 허공 배치 발생률 (레이캐스트 검증 도입 전후 비교)
- 의도한 occlusionRatio vs 실제 렌더링된 가림 비율의 오차

**Occlusion 품질**
- 정해진 궤적으로 캐릭터를 물체 뒤로 통과시키고, 프레임별 GT 마스크와 비교한 occlusion IoU
- 비교군: depth-only occlusion vs occluder 메시 방식

**성능**
- 스캔 후 복셀 맵 구축 시간
- occluder 메시 생성 시간
- 런타임 FPS (occluder 유무 비교)

---

## 작업 순서 요약

1. Phase 0 — 기존 코드 확인 + 모듈 구조 잡기 + `/test-voxel` 페이지 골격
2. Phase 1 — 복셀 누적 구조 + 디버그 렌더러 (테스트 페이지에서) → 실제 스캔
3. Phase 2 — 진단 → **여기서 멈추고 결과 보고**
4. Phase 3 — 필터 적용 (진단 결과에 따라, 테스트 페이지 슬라이더로 튜닝)
5. Phase 4 — 바닥 제거 + 클러스터링 (테스트 페이지에서 육안 검증)
6. Phase 5 — occluder 메시 (큐브 방식 먼저), 여기서부터 메인 화면에 통합
7. Phase 6 — 레이캐스트 기반 배치 판정
8. (조건부) Phase 7 — 세그멘테이션

Phase 1~5는 `/test-voxel`에서 검증하고, 파라미터가 확정된 뒤 Phase 5부터 메인 게임 화면에 붙인다.

**Phase 2에서 반드시 멈추고 결과를 확인할 것.** 진단 없이 Phase 3 이후를 진행하면 이전 시도와 같은 실패를 반복하게 된다.
