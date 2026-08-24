# XRAnchor와 공유 CPU Depth 기반 AR 구조 설계

- 작성일: 2026-08-25
- 대상 브랜치: `cj_develop`
- 구현 범위: 하나의 WebXR AR 세션 안에서 Ninja 위치 고정, 실시간 가림, 누적 공간지도와 운영자 화면 통합
- 실기기 대상: Samsung Galaxy S26 Ultra의 WebXR 지원 브라우저

## 1. 목표

현재 프로젝트를 다음 데이터 흐름으로 정리한다.

```text
ARCore / WebXR 공간 추적
├─ XRAnchor
│  └─ Ninja의 현실 위치를 같은 AR 세션 동안 안정적으로 유지
└─ cpu-optimized Depth
   ├─ 최신 깊이 프레임 → 동적 삼각형 메시 → 실시간 가림
   └─ 저속 누적 샘플 → 복셀 공간지도 → 운영자 화면
```

통합 게임 검증 주소는 `?occlusion=cpu`로 정한다. 이 모드에서는 하나의 CPU depth 정보를 실시간 오클루전과 복셀 지도 양쪽에서 공유한다. 기본 URL의 GPU 오클루전 동작은 유지하고, `?depth=cloud`는 공간 복원만 확인하는 진단 모드로 남긴다.

## 2. 현재 코드의 문제와 원인

### 2.1 Ninja 위치는 아직 실제 anchor가 아니다

현재 `NinjaGame`의 target에는 `anchor` 필드와 anchor pose를 읽는 코드가 있지만, Ninja 배치 시 `XRAnchor`를 생성하지 않는다. 따라서 실제 상태는 `local-space` 좌표 한 점을 저장한 것에 가깝다. WebXR의 local reference space도 한 세션 안에서 추적 기준을 제공하지만, 기기가 공간을 다시 이해하고 보정할 때 특정 현실 지점을 위한 별도의 anchor 갱신을 받지는 못한다.

또한 현재 anchor pose를 행렬에 복사하는 코드는 Three.js의 자동 행렬 갱신과 충돌할 가능성이 있다. anchor를 사용할 때는 `matrixAutoUpdate = false`로 두고 최신 anchor 행렬을 직접 적용해야 한다.

### 2.2 복셀 지도는 위치 고정 장치가 아니다

복셀 지도는 여러 depth 샘플을 작은 3차원 칸에 누적한 시각화 데이터다. 이 지도는 방의 형태, 장애물 후보, 숨을 장소 후보를 표현할 수 있지만, Ninja 좌표를 ARCore 추적 좌표에 다시 결속시키는 기능은 없다. 즉, 공간을 많이 점으로 찍었다고 해서 그 점들이 자동으로 Ninja의 기준점이 되지는 않는다.

이번 구조에서 역할을 명확히 나눈다.

- `XRAnchor`: Ninja의 현실 위치 고정
- 최신 depth mesh: 손이나 책처럼 움직이는 물체의 즉시 가림
- 누적 voxel map: 운영자 공간 시각화와 향후 정적 충돌·배치 후보 분석

복셀 지도는 이번 범위에서 Ninja의 위치를 보정하지 않는다.

### 2.3 CPU depth가 두 경로에서 중복 조회될 수 있다

현재 `CpuDepthOccluder`와 `DepthCloud`는 각각 `XRFrame.getViewerPose()`와 `XRFrame.getDepthInformation(view)`를 호출한다. 두 기능을 동시에 켜면 같은 XR frame의 depth를 중복해서 읽을 수 있다. 모바일 환경에서 불필요한 호출과 변환 작업을 줄이기 위해 한 프레임의 원본 depth 조회 결과를 공유해야 한다.

### 2.4 Ninja와 배치 표면이 너무 가깝다

현재 Ninja는 선택 지점에서 단순히 Y축으로 약간 이동한다. 벽과 같은 수직면에서는 Y축 이동이 표면으로부터 Ninja를 떼어놓지 못한다. 그 결과 Ninja와 현실 표면의 depth가 거의 같아져, depth 오차와 bias 때문에 머리나 몸 전체가 잘릴 수 있다.

해결책은 화면 전체의 depth bias를 크게 올리는 것이 아니라 선택 표면의 normal을 구한 뒤 Ninja를 viewer 쪽으로 필요한 만큼만 이동하는 것이다.

## 3. 범위와 제외 사항

### 이번 구현에 포함

- WebXR `XRAnchor` 생성과 매 프레임 pose 갱신
- anchor 미지원, 생성 실패, 일시적 tracking 손실 처리
- 표면 normal에 따른 Ninja 위치 분리
- CPU depth 한 번 조회 후 오클루전과 공간지도에 공유
- `?occlusion=cpu`의 통합 게임 모드
- 운영자 화면의 복셀, Ninja, anchor 상태, 플레이어 위치와 이동 경로
- HUD의 depth usage, depth format, 삼각형 수, 복셀 수, 고정 상태
- 자동 테스트, JavaScript 구문 검사, README 설명 및 배포 확인

### 이번 구현에서 제외

- 앱이나 AR 세션 종료 후 같은 현실 위치 복원
- Persistent Anchor 또는 Cloud Anchor 서버 연동
- 복셀 지도를 이용한 Ninja 위치 보정
- 복셀 기반 정적 충돌 처리나 자동 숨을 장소 선택
- 기본 GPU 오클루전 파이프라인의 동작 변경

앱 종료 후 복원은 브라우저의 한 세션 좌표만으로 해결할 수 없다. 장기간 보존되는 persistent anchor나 여러 세션이 공유하는 cloud anchor가 필요하므로 README의 후속 단계로만 설명한다.

## 4. 전체 구조와 데이터 흐름

```text
XR animation frame
│
├─ NinjaGame.update(frame)
│  ├─ 대기 중이면 현재 frame에서 XRAnchor 생성
│  └─ anchorSpace의 최신 pose → Ninja 행렬과 탐지 좌표 동기화
│
└─ CpuDepthFrameSource.read(frame, referenceSpace)
   ├─ 같은 XRFrame이면 캐시된 viewer pose/depth 반환
   ├─ CpuDepthOccluder (약 15 Hz, 80×60)
   │  └─ 최신 동적 삼각형 메시 → depth-only 가림
   └─ DepthCloud (약 5 Hz, 40×30)
      └─ VoxelMap 누적 → OperatorView

PlayerTrail ───────────────────────────────→ OperatorView
Ninja 위치 + anchor 상태 ─────────────────→ HUD / OperatorView
```

두 소비자는 갱신 주기를 독립적으로 판단한다. 해당 소비자의 시간이 되었을 때만 공유 source를 읽는다. 우연히 같은 `XRFrame`에서 둘 다 읽으면 실제 `getDepthInformation(view)` 호출은 한 번뿐이며, 두 번째 소비자는 캐시된 snapshot을 받는다.

## 5. XRAnchor 생명주기

### 5.1 과거 hit-test 결과를 저장하지 않는다

WebXR hit-test 결과는 그 결과가 만들어진 활성 frame의 정보다. 운영자가 공간을 먼저 스캔하고 나중에 Ninja를 숨길 수 있으므로, 예전에 받은 `XRHitTestResult`를 저장했다가 나중에 `createAnchor()`에 사용하는 방식은 채택하지 않는다.

공간 후보에는 선택 당시 local reference space 기준의 pose 행렬과 위치만 저장한다. Ninja 숨기기 버튼을 누르면 그 pose를 기반으로 최종 배치 위치를 먼저 계산한다.

### 5.2 활성 XRFrame에서 anchor를 생성한다

`hideNewTarget()`은 DOM 클릭 이벤트에서 실행되므로 활성 `XRFrame`이 아닐 수 있다. 이 함수는 다음 작업만 한다.

1. Ninja를 계산된 local 위치에 즉시 배치한다.
2. target 상태를 `anchor-pending`으로 만든다.
3. target 세대 번호 또는 고유 token을 발급한다.

그 다음 animation loop의 활성 frame에서 한 번만 다음 형태로 생성한다.

```js
frame.createAnchor(
  new XRRigidTransform({ x, y, z }),
  localReferenceSpace,
)
```

이는 `XRFrame.createAnchor(pose, space)`가 활성 animation frame에서 호출되어야 한다는 [WebXR Anchors 사양](https://immersive-web.github.io/anchors/)의 제약을 따른다. 공식 [Hit Test with Anchors 예제](https://github.com/immersive-web/webxr-samples/blob/main/hit-test-anchors.html)의 frame 기반 추적 방식도 참고한다.

### 5.3 상태 정의

| 내부 상태 | HUD 표시 | 의미 |
|---|---|---|
| target 없음 | `고정 -` | Ninja가 아직 배치되지 않음 |
| `anchor-pending` | `고정 anchor 준비` | 다음 활성 frame에서 생성을 시도할 예정이거나 Promise 처리 중 |
| `anchor` | `고정 anchor` | anchor가 생성되었고 현재 pose를 얻을 수 있음 |
| `anchor-lost` | `고정 anchor (추적 일시 손실)` | anchor는 있지만 현재 frame에서 pose를 얻지 못함 |
| `local` | `고정 local` | API 미지원 또는 anchor 생성 실패로 local-space 방식을 사용함 |

### 5.4 매 프레임 갱신

anchor 생성에 성공하면 Ninja object에 `matrixAutoUpdate = false`를 설정한다. 매 frame마다 다음을 수행한다.

1. `frame.getPose(anchor.anchorSpace, localReferenceSpace)`를 호출한다.
2. pose가 있으면 그 행렬을 Ninja object에 적용하고 `matrixWorldNeedsUpdate = true`로 표시한다.
3. 같은 pose의 translation을 게임 탐지용 `target.position`에도 복사한다.
4. 운영자 화면 역시 같은 `target.position`을 사용한다.

따라서 화면에 렌더링된 위치, 플레이어와의 거리 판정 위치, 운영자 화면의 Ninja 위치가 항상 같은 좌표를 가리킨다.

### 5.5 tracking 일시 손실과 fallback

- `getPose()`가 잠시 `null`이면 마지막으로 확인된 행렬과 위치를 유지하고 `anchor-lost`로 표시한다.
- 일시 손실을 이유로 local 좌표로 즉시 전환하지 않는다. pose가 다시 나오면 자동으로 `anchor` 상태로 복구한다.
- `frame.createAnchor`가 없거나 생성 Promise가 reject되면 처음 계산한 최종 local 위치를 유지하고 `local` 상태로 전환한다.
- anchor 생성 Promise가 끝나기 전에 target이 교체되거나 지워졌다면, 늦게 생성된 낡은 anchor는 즉시 `delete()`한다.
- target 제거와 XR session 종료 시 현재 anchor의 `delete()`를 호출한다.

## 6. 표면 normal과 Ninja 위치 분리

새 순수 로직 모듈 `surface-placement.js`에서 계산한다. WebXR/Three.js의 column-major 표면 행렬에서 local Y축을 표면 normal로 사용한다.

```text
normal = normalize([matrix[4], matrix[5], matrix[6]])
toViewer = normalize(viewerPosition - surfacePosition)
if dot(normal, toViewer) < 0:
    normal = -normal
```

이렇게 하면 hit-test가 반환한 normal 방향이 viewer 반대편을 향하더라도 Ninja는 항상 viewer 쪽으로 분리된다.

표면 구분과 offset은 config 상수로 둔다.

```text
HORIZONTAL_SURFACE_THRESHOLD = 0.62
HORIZONTAL_SURFACE_OFFSET_M = 0.02
VERTICAL_SURFACE_OFFSET_M = 0.12
```

- `abs(normal.y) >= 0.62`: 수평면으로 보고 normal 방향으로 2 cm 이동한다. 현재 공간 후보 분류에 쓰는 `0.62`와 같은 기준을 공유한다.
- 그 외 수직·경사면: viewer 쪽으로 정렬된 normal 방향으로 12 cm 이동한다.
- Ninja의 회전은 세워진 identity 방향을 유지한다. 바닥 normal을 따라 캐릭터 전체가 기울어지지 않는다.
- 최종 좌표는 `surfacePosition + orientedNormal * offset`이다.
- 이 최종 좌표 하나를 렌더링, 탐지, anchor 초기 pose에 똑같이 사용한다.

CPU 오클루전의 전역 depth bias는 현재 5 cm를 유지한다. 표면 겹침은 배치 offset으로 해결하고, bias를 무작정 키워 손이나 책의 가림 정확도를 희생하지 않는다.

## 7. CPU depth 공유 설계

### 7.1 `CpuDepthFrameSource`

새 source는 정확히 같은 `XRFrame` 객체에 대한 결과를 캐시한다. 공개 인터페이스는 다음 책임을 가진다.

```text
read(frame, referenceSpace)
→ {
    frame,
    viewerPose,
    views: [{ view, depthInformation }],
    usage,
    format
  }
```

- 새 frame이면 viewer pose와 각 view의 depth를 한 번 조회한다.
- 같은 frame이면 저장된 snapshot을 반환한다.
- frame이 바뀌면 이전 snapshot 참조를 교체한다.
- depth가 없거나 조회 중 예외가 발생하면 빈 결과와 진단 상태를 반환해 한 소비자의 실패가 animation loop 전체를 멈추지 않게 한다.

snapshot은 현재 frame에서만 소비한다. 장기간 누적할 데이터는 복셀 지도처럼 필요한 값만 별도 복사한다.

### 7.2 독립 갱신 주기

성능 조정 상수는 한 곳에서 분리한다.

| 소비자 | 기본 주기 | 목표 해상도 | 목적 |
|---|---:|---:|---|
| 동적 오클루전 | 66 ms, 약 15 Hz | 80×60 | 가까운 손·책의 즉시 가림 |
| 복셀 누적 | 200 ms, 약 5 Hz | 40×30 | 저속 공간지도 누적 |
| 오래된 오클루전 메시 | 250 ms 후 숨김 | 해당 없음 | 낡은 depth가 계속 가리는 현상 방지 |

각 소비자가 source 호출 전에 자신의 시간을 검사하므로 한 기능의 주기를 낮춰도 다른 기능에는 영향을 주지 않는다.

### 7.3 메모리 재사용

- `CpuDepthOccluder`의 vertex/index TypedArray와 Three.js `BufferAttribute`를 최대 크기로 한 번 만들고 재사용한다.
- 데이터가 바뀐 attribute에만 `needsUpdate = true`를 설정한다.
- 동적 버퍼는 `DynamicDrawUsage`를 유지한다.
- `DepthCloud`와 복셀 샘플링도 반복 사용 가능한 배열을 우선한다.
- 운영자 모드에서는 `DepthCloud`를 `renderPoints: false`로 사용하고, 보이지 않는 point geometry의 불필요한 갱신과 `computeBoundingSphere()`는 하지 않는다.

## 8. URL 모드 호환성

| URL 모드 | 오클루전 | 복셀 누적 | 운영자 화면 | 용도 |
|---|---|---|---|---|
| 기본 URL | 기존 GPU | 없음 | 없음 | 기존 GPU 게임 유지 |
| `?occlusion=cpu` | CPU 동적 메시 | 사용 | 사용 | 통합 게임 및 실기기 완료 조건 검증 |
| `?depth=cloud` | 사용하지 않음 | 사용 | 사용 | 공간 복원 진단 |

CPU 통합 모드와 cloud 진단 모드 모두 `CpuDepthFrameSource`를 사용한다. 기본 GPU 모드는 기존 초기화와 렌더링 경로를 유지해 회귀 범위를 최소화한다.

## 9. 운영자 화면과 HUD

### 운영자 화면

계속 표시할 정보는 다음과 같다.

- 누적 voxel 공간
- Ninja의 최신 실제 위치
- Ninja 고정 상태
- 플레이어의 현재 위치
- 플레이어 이동 경로

anchor 상태는 운영자 overlay의 상태 텍스트로 추가하고, 3D 장면은 기존 `OperatorView`의 Ninja 표식, 플레이어 표식, 경로, voxel 렌더링을 사용한다. 운영자 화면 열기·닫기는 DOM overlay와 보조 렌더링 표시만 전환한다. XR animation loop, depth 읽기, voxel 누적, anchor 갱신은 중단하지 않는다.

### HUD

HUD에는 다음 값을 동시에 표시한다.

- `depth usage`: 실제 세션이 보고한 값, CPU 성공 시 `cpu-optimized`
- `depth format`: 실제 세션이 보고한 형식
- 오클루전 모드와 동적 삼각형 수
- 실제 solid voxel 수
- Ninja 고정 상태

예시:

```text
가림 CPU · 삼각형 8,732 · 복셀 12,406
깊이 cpu-optimized / float32
고정 anchor
```

복셀 수는 raw depth point 수가 아니라 `VoxelMap.getSolidCount()`의 실제 누적 복셀 수를 사용한다.

## 10. 오류 처리 원칙

- anchor 기능 미지원: 게임을 중단하지 않고 `고정 local`로 진행한다.
- anchor 생성 reject: 오류를 진단 로그에 남기고 local fallback으로 진행한다.
- anchor pose 일시 손실: 마지막 pose를 유지하며 일시 손실 상태를 표시한다.
- CPU depth 없음: 오클루전 메시를 stale 제한 시간 뒤 숨기고 HUD에 사용 불가 상태를 표시한다.
- 일부 view의 depth 조회 실패: 사용 가능한 view만 처리하고 전체 frame loop는 유지한다.
- target 교체 중 비동기 anchor 완료: 새 target에 연결하지 않고 낡은 anchor를 삭제한다.

fallback은 기능을 숨기는 우회가 아니라, 브라우저가 optional anchor 기능을 제공하지 않는 환경에서도 기존 local-space 게임이 계속 실행되도록 하는 명시적 호환 경로다.

## 11. 테스트 전략

버그 수정과 새 순수 로직은 실패하는 테스트를 먼저 작성한 뒤 최소 구현으로 통과시킨다.

### 순수 로직 테스트

- column-major 행렬에서 normal 추출과 정규화
- viewer 반대편 normal 뒤집기
- 수평면과 수직·경사면 offset 선택
- 렌더 위치와 탐지 target 좌표의 동일성
- URL별 GPU, CPU 통합, cloud 진단 모드 선택
- HUD의 usage, format, 삼각형, 복셀, anchor 상태 출력
- 운영자 anchor 상태 문자열 출력

### anchor 생명주기 테스트

- 활성 frame에서 pending target의 anchor 생성
- `createAnchor` API 미지원 시 local fallback
- 생성 Promise reject 시 local fallback
- target 교체 뒤 늦게 만들어진 anchor 삭제
- `getPose()` 일시 손실 시 마지막 위치 유지와 `anchor-lost` 상태
- pose가 돌아왔을 때 `anchor` 상태 복구
- target 제거와 session 종료 시 anchor 삭제

### CPU depth 공유 테스트

- 같은 XRFrame에서 두 소비자가 읽어도 `getDepthInformation(view)`가 view당 한 번만 호출됨
- 새 XRFrame에서는 새 depth를 조회함
- 오클루전과 복셀 소비자의 갱신 주기가 서로 독립적임
- 오래된 오클루전 메시가 제한 시간 뒤 숨겨짐
- `renderPoints: false`에서 불필요한 point geometry 갱신을 하지 않음

### 최종 자동 검증

- 전체 `node --test tests/*.test.mjs`
- 프로젝트의 모든 JavaScript 파일에 대한 `node --check`
- 실제 통과한 테스트 수를 README에 반영
- `git diff`와 staged 파일을 확인하여 `img/`가 커밋에 포함되지 않았는지 검증

## 12. 실기기 검증 절차와 완료 조건

자동 테스트는 브라우저 API 호출 순서와 좌표 계산을 검증할 수 있지만, Galaxy S26 Ultra에서 ARCore가 제공하는 실제 depth 품질과 anchor 안정성은 배포 후 사용자가 확인해야 한다. 코드 구현만으로 다음 항목을 확인했다고 주장하지 않는다.

1. 배포된 `?occlusion=cpu` 주소를 WebXR AR 지원 브라우저에서 연다.
2. HUD의 depth usage가 `cpu-optimized`인지 확인한다.
3. Ninja를 숨긴 뒤 HUD가 `고정 anchor` 또는 지원 불가 환경에서는 `고정 local`을 표시하는지 확인한다.
4. 카메라를 들고 3~5 m 이동하고 방향을 바꾼 뒤 Ninja가 같은 현실 위치에 남는지 확인한다.
5. 운영자 화면에서 복셀 수와 플레이어 이동 경로가 계속 증가하는지 확인한다.
6. 손이나 물체가 없을 때 Ninja 전체가 보이는지 확인한다.
7. 손이나 책을 Ninja 앞에 놓았을 때 겹치는 부분만 가려지는지 확인한다.
8. 벽, 베개, 헤드보드와 비슷한 깊이에서도 Ninja 전체가 잘리지 않는지 확인한다.
9. 운영자 화면을 닫아도 게임, anchor tracking, 공간 누적이 계속되는지 확인한다.

기기·브라우저가 `anchors` 또는 `depth-sensing` optional feature를 제공하지 않을 수 있다. 이 경우 HUD의 실제 상태와 브라우저 콘솔 오류를 함께 기록해 지원 문제와 구현 문제를 구분한다.

## 13. 예상 코드 변경 구조

구현 계획에서 실제 저장소 구조를 다시 확인하되, 현재 설계상 변경 대상은 다음과 같다.

- `src/surface-placement.js`: 표면 normal, 방향 반전, offset 계산 순수 로직
- `src/cpu-depth-frame-source.js`: XRFrame 단위 CPU depth 공유와 진단 상태
- `src/ninja-game.js`: anchor pending/생성/추적/fallback/정리와 좌표 일치
- `src/cpu-depth-occluder.js`: 공유 depth snapshot 소비와 버퍼 재사용 유지
- `src/depth-cloud.js`: 공유 snapshot 소비, 저속 누적, 비표시 geometry 작업 제거
- `src/main.js`: URL 모드별 구성과 CPU 통합 파이프라인 연결
- `src/operator-view.js` 및 UI 관련 모듈: anchor 상태와 통합 통계 표시
- `tests/*.test.mjs`: 순수 로직과 mock XRFrame 기반 회귀 테스트
- `README.md`: 발표용 한국어 기술 설명, 실기기 절차, 실제 테스트 수와 코드 구조

각 파일의 책임을 작게 유지하고 WebXR 객체 접근은 frame source와 anchor 생명주기 경계에 집중시킨다. 표면 계산, 상태 표시, 모드 선택은 가능한 한 브라우저 없이 테스트할 수 있는 순수 함수로 분리한다.

## 14. Git 및 배포 안전

- 모든 구현과 문서는 `cj_develop` 브랜치에서만 작업한다.
- `main` 브랜치는 checkout, merge, push하지 않는다.
- 사용자 자료인 `img/`는 수정, stage, commit하지 않는다.
- 기능별 테스트와 전체 검증을 통과한 변경 파일만 커밋한다.
- 최종 구현 커밋을 `origin/cj_develop`에 push한 뒤 GitHub Pages의 새 커밋이 built 상태인지 확인한다.
- Pages 배포가 다른 브랜치나 workflow 정책에 의해 제한되면 임의로 `main`을 변경하지 않고 정확한 제약을 보고한다.

## 15. 설계 판단 요약

이 구조는 위치 고정과 공간 이해를 분리한다. Ninja는 `XRAnchor`가 책임지고, 실시간 가림은 가장 최신의 CPU depth가 책임지며, 운영자용 공간지도는 낮은 빈도로 누적된 voxel이 책임진다. 같은 depth 원본을 공유하되 각 소비자의 속도와 데이터 수명은 분리한다. 그 결과 운영자 화면을 켜도 게임 추적이 멈추지 않고, 움직이는 손은 즉시 가리며, 오래된 누적 지도는 시각화와 향후 게임 로직을 위한 자료로 남는다.
