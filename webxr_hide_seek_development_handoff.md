# WebXR Hidden Object Game — Development Handoff

> 목적: 현재까지 구현된 WebXR 기반 AR 숨바꼭질 데모의 개발 경과와 현재 구조, 그리고 이후 개발해야 할 기능을 정리한 문서입니다.
> Claude CLI에서 이어서 개발할 때 이 문서를 프로젝트 컨텍스트로 사용하면 됩니다.

---

## 1. 프로젝트 개요

스마트폰 카메라로 실제 공간을 스캔한 뒤, 스캔 과정에서 확보한 실제 공간의 3D 표면 좌표 중 한 곳에 가상 캐릭터를 숨기고 사용자가 스마트폰을 들고 실제 공간을 돌아다니며 찾는 AR 게임입니다.

현재 프로젝트의 핵심은 다음과 같습니다.

1. Android 스마트폰에서 WebXR을 실행
2. ARCore 기반 6DoF tracking으로 스마트폰의 위치/방향 추적
3. 일정 시간 동안 hit-test로 실제 표면 좌표 수집
4. 수집된 좌표를 hiding candidate로 저장
5. 후보 중 한 곳에 반투명 가상 캐릭터 배치
6. 사용자가 실제 공간을 이동하며 탐색
7. 화면 중앙을 의심 위치에 맞춘 뒤 `SCAN` 버튼으로 탐색 시도
8. 거리 및 시야각 조건을 만족하면 캐릭터 발견

> 중요: 현재의 "공간 스캔"은 정밀한 3D mesh를 생성하는 SLAM mapping이 아니라, WebXR hit-test를 통해 **가상 캐릭터를 배치할 수 있는 3D 표면 좌표 후보를 수집하는 과정**입니다.

---

# 2. 현재 기술 스택

## Front-end / AR

- HTML
- JavaScript
- Three.js
- WebXR
- Android Chrome
- ARCore 기반 6DoF tracking

## 주요 WebXR 기능

- `immersive-ar`
- `hit-test`
- local reference space
- viewer pose tracking
- ~~optional anchor support~~ → **현재 미사용.** target은 anchor가 아니라 local reference space 좌표에 직접 배치되어 있습니다(§8.3-ⓐ 참조).

---

# 3. 개발 과정

## Stage 0 — 초기 아이디어

초기 아이디어는 노트북 웹캠 또는 스마트폰 카메라를 이용해 숨바꼭질 형태의 Computer Vision 프로젝트를 만드는 것이었습니다.

초기에는 다음 흐름을 고려했습니다.

```text
Camera
→ 공간 인식
→ Map 생성
→ 숨은 객체 탐색
```

하지만 이후 게임 구조를 다음과 같이 구체화했습니다.

```text
사람 = 술래
가상 캐릭터 = 숨는 대상
```

즉, 사람이 숨는 것이 아니라 **시스템이 가상 캐릭터를 공간 안에 숨기고 사람이 이를 찾는 구조**로 변경했습니다.

---

## Stage 1 — Python Gesture Demo

첫 번째 프로토타입은 Python + OpenCV + MediaPipe로 제작했습니다.

목적은 AR 이전에 탐색 인터랙션 자체가 게임으로 성립하는지 검증하는 것이었습니다.

### 구현 기능

- 웹캠 입력
- MediaPipe Gesture Recognizer
- 손바닥 중심 계산
- `주먹 → 가위 → 주먹` 제스처 sequence 인식
- 손 주변 일정 반경을 scan area로 설정
- 숨겨진 2D target이 scan area에 있으면 `DETECTED`
- 없으면 `NO SIGNAL`

### 한계

- 2D 화면 좌표 기반
- 실제 공간 위치 tracking 불가
- 사용자가 걸어다니는 AR 게임 구조 불가

---

## Stage 2 — WebXR Feasibility Test

스마트폰의 장점을 활용하기 위해 Android Chrome + WebXR을 테스트했습니다.

목표는 다음 하나였습니다.

> 스마트폰을 실제로 이동했을 때 가상 물체가 현실의 같은 위치에 고정되는가?

### 검증 기능

- `immersive-ar`
- viewer pose의 x, y, z 출력
- hit-test
- 실제 표면 위에 테스트용 Ninja 배치
- 실제로 1~3m 이동해도 가상 객체가 같은 현실 위치에 남는지 확인

### 결과

실제 Android 스마트폰에서 정상 동작을 확인했습니다.

따라서 단순 자이로 회전 추적이 아니라,

```text
Camera + IMU
→ ARCore
→ WebXR
→ 6DoF Pose
```

기반으로 사용자의 실제 이동까지 추적할 수 있다는 것을 확인했습니다.

---

## Stage 3 — WebXR Hidden Ninja v2

Feasibility test 성공 후 실제 게임 구조를 추가했습니다.

현재 이 버전이 기본 개발 버전입니다.

---

# 4. 현재 구현된 기능

## 4.1 WebXR AR 실행

Android Chrome에서 `START AR`을 누르면 WebXR immersive AR session이 시작됩니다.

---

## 4.2 6DoF Viewer Tracking

스마트폰의 현재 위치와 방향을 추적합니다.

화면에 다음 값이 표시됩니다.

```text
viewer position

x
y
z
yaw
```

따라서 사용자가 실제로 이동하면 x/z 값이 변화합니다.

---

## 4.3 20초 공간 스캔

AR session 시작 후 기본적으로 20초 동안 주변 공간을 스캔합니다.

사용자가 스마트폰으로 다음과 같은 표면을 비춥니다.

- 바닥
- 책상
- 벤치
- 기타 수평 표면

WebXR hit-test 결과를 이용해 실제 공간의 3D 좌표를 수집합니다.

예:

```text
Candidate 1 = (x1, y1, z1)
Candidate 2 = (x2, y2, z2)
Candidate 3 = (x3, y3, z3)
...
```

---

## 4.4 Hiding Candidate Filtering

hit-test로 얻은 모든 좌표를 그대로 사용하는 것이 아니라 일정 간격 이상 떨어진 좌표만 저장합니다.

또한 가능한 경우 수평 표면을 우선 후보로 사용합니다.

현재 목적은 캐릭터가 자연스럽게 놓일 수 있는 위치를 확보하는 것입니다.

---

## 4.5 Random Hiding

20초 스캔 종료 후 수집된 후보 중 하나를 선택해 Ninja를 배치합니다.

현재는 완전한 random보다 다음 조건을 일부 고려합니다.

- 사용자와 너무 가까운 위치는 피함
- 처음부터 정면에 너무 잘 보이는 위치는 피함
- 일정 거리 범위 내 후보를 우선

다만 아직 본격적인 hiding score 기반 알고리즘은 아닙니다.

---

## 4.6 Camouflage Prototype

현재 Ninja는 약 13% opacity로 렌더링됩니다.

즉 실제 semantic camouflage가 아니라 단순 반투명 처리입니다.

현재 목적은:

> "숨겨진 가상 물체를 찾아야 한다"

는 게임 메커니즘 검증입니다.

---

## 4.7 실제 이동 탐색

가상 캐릭터는 화면 좌표에 고정된 것이 아니라 WebXR world coordinate에 존재합니다.

따라서 사용자는 실제 공간을 걸어다니며 캐릭터를 여러 방향에서 볼 수 있습니다.

---

## 4.8 중앙 조준점

화면 중앙에 crosshair가 표시됩니다.

사용자는 캐릭터가 있을 것으로 예상되는 위치를 화면 중앙에 맞춥니다.

---

## 4.9 SCAN 버튼

초기에는 손동작으로 scan을 trigger하려 했지만 현재는 **SCAN 버튼 유지**로 결정했습니다.

이유:

- gesture recognition이 별도의 문제를 추가함
- 프로젝트 핵심인 공간 tracking 및 hiding과 직접 관련성이 낮음
- 모바일 WebXR camera frame과 MediaPipe를 동시에 사용하는 구현 복잡도가 높음
- 버튼 방식이 게임 인터랙션과 발표 데모 측면에서 충분히 직관적임

따라서 이후 개발에서도 기본 scan trigger는 버튼을 유지합니다.

---

## 4.10 탐색 판정

SCAN 버튼을 누르면 다음 두 조건을 확인합니다.

### 거리

현재 기준:

```text
target distance <= 5 m
```

### 시야각

현재 기준:

```text
camera forward vs target direction <= 약 12°
```

두 조건을 모두 만족하면:

```text
DETECTED!
```

그렇지 않으면:

```text
NO SIGNAL
```

---

## 4.11 발견 후 Reveal

발견 성공 시:

- Ninja opacity를 100%로 변경
- 강조 ring 표시
- `DETECTED!` 출력

---

## 4.12 다시 숨기기

`다시 숨기기` 버튼을 누르면 기존에 수집된 hiding candidate 중 다른 위치를 선택해 다시 게임을 시작합니다.

따라서 매 게임마다 공간을 다시 스캔할 필요가 없습니다.

---

## 4.13 +20초 스캔

초기 스캔으로 후보가 부족할 경우 `+20초 스캔` 기능을 이용해 추가 후보를 수집할 수 있습니다.

---

## 4.14 Tracking Metrics

현재 화면에서 다음 값을 확인할 수 있습니다.

- viewer x/y/z
- 이동경로 길이
- 시작점 기준 최대 변위
- hiding candidate 개수
- hit-test 여부
- scan 횟수
- miss 횟수

---

## 4.15 Drift 간이 측정

다음 기능이 구현되어 있습니다.

```text
기준점 저장
→ 이동 또는 360° 회전
→ 최대한 같은 위치/방향으로 복귀
→ 복귀 오차 확인
```

결과:

```text
position error (m)
orientation error (deg)
```

를 확인할 수 있습니다.

이 값은 정밀 측정값은 아니지만 게임에 필요한 tracking stability를 평가하는 지표로 사용할 수 있습니다.

---

# 5. 현재 전체 Architecture

```text
Android Smartphone
        │
        ▼
Camera + IMU
        │
        ▼
ARCore
        │
        ▼
WebXR
        │
        ├──────────────┐
        │              │
        ▼              ▼
6DoF Pose          Hit Test
        │              │
        │              ▼
        │        Surface Candidates
        │              │
        │              ▼
        │        Hiding Position
        │              │
        └──────┬───────┘
               ▼
         Three.js Rendering
               │
               ▼
         Hidden Ninja
               │
               ▼
     User walks through space
               │
               ▼
          Crosshair + SCAN
               │
               ▼
      Distance + Angle Test
          │             │
        Pass           Fail
          │             │
      DETECTED      NO SIGNAL
```

---

# 6. 현재 프로젝트의 핵심 성과

현재까지의 가장 중요한 기술적 검증은 다음과 같습니다.

## 1. Web에서도 실제 이동 tracking 가능

단순 `DeviceOrientation` 자이로 기반이 아니라 WebXR을 통해 ARCore의 6DoF tracking을 사용할 수 있음을 확인했습니다.

## 2. 실제 공간에 가상 객체 고정 가능

사용자가 걸어다녀도 가상 Ninja가 현실의 특정 위치에 남는 것을 확인했습니다.

## 3. Hit-test 기반 hiding candidate 생성 가능

실제 표면 좌표를 수집해 가상 캐릭터의 숨기기 후보로 사용할 수 있음을 확인했습니다.

## 4. 기본적인 AR 탐색 게임 loop 완성

```text
Scan
→ Hide
→ Walk
→ Aim
→ SCAN
→ Found / Miss
```

가 실제 스마트폰에서 동작합니다.

---

# 7. 현재 한계

현재 버전에는 다음 한계가 있습니다.

## 7.1 정밀 3D Map이 아님

현재 mapping은 hit-test point collection입니다.

따라서 다음 정보는 아직 충분히 알 수 없습니다.

- 공간 전체 mesh
- 벽 구조
- 물체 volume
- free-space
- obstacle geometry
- object semantics

---

## 7.2 Hiding Position이 충분히 똑똑하지 않음

현재는 candidate 중 랜덤 요소가 큽니다.

좋은 숨기기 위치의 기준이 아직 명확히 정의되지 않았습니다.

---

## 7.3 Camouflage가 단순 투명도

현재는 주변 환경에 적응하는 보호색이 아니라 opacity만 낮춘 상태입니다.

---

## 7.4 Occlusion 미구현

실제 물체가 가상 Ninja보다 앞에 있더라도 Ninja가 물체를 뚫고 보일 수 있습니다.

---

## 7.5 대규모 공간 대응 미검증

150m × 30m 정도의 큰 공간에서는 다음 문제가 예상됩니다.

- drift 누적
- scan candidate 증가
- tracking loss
- session stability
- relocalization

현재는 소규모/중규모 공간 중심의 prototype입니다.

> 2026-08-24 갱신: 대규모 공간 지원은 **구현 목표에서 제외**하고 측정된 한계로 문서화하기로 방향을 수정했습니다. 근거는 §8.2-④를 참조하십시오.

---

# 8. 기존 계획에 대한 리뷰 (2026-08-24, 코드 대조 후)

`index.html`의 실제 구현과 기존 로드맵(Priority 1~7)을 대조한 결과, 계획의 **방향은 맞지만 순서와 일부 실현 가능성 판단이 틀렸습니다.** 아래는 동의하는 부분과 반대하는 부분입니다.

---

## 8.1 동의하는 부분

- **SCAN 버튼 유지 결정은 옳습니다.** WebXR camera frame과 MediaPipe를 동시에 돌리는 것은 GPU/CPU 예산상 모바일에서 프레임 드랍이 확실하고, 프로젝트의 기여도와도 무관합니다.
- **Occlusion을 넣으면 게임 느낌이 크게 올라간다**는 판단도 옳습니다. 다만 우선순위가 너무 뒤에 있습니다(8.2-③ 참조).
- **v3에서 기능을 세 개로 줄이자**는 판단은 옳습니다. 다만 고른 세 개가 틀렸습니다.

---

## 8.2 반대하는 부분

### ① 측정(Metrics)이 3순위인 것은 순서가 거꾸로입니다

Priority 1(Smart Hiding)을 먼저 만들면, **그것이 랜덤보다 나아졌는지 증명할 수단이 없는 상태로** 만들게 됩니다. "숨기기가 똑똑해졌다"는 주장은 정의상 비교 실험을 요구합니다.

또한 Metrics는 구현 비용이 가장 낮고(반나절), 발표 자료에 그대로 들어가는 산출물입니다.

> **결론: Metrics + Logging + `random` / `smart` 모드 토글을 1순위로 올립니다.**

### ② Adaptive Camouflage(기존 P4)는 기술적으로 오해가 있습니다

"주변 실제 환경의 color/texture를 분석"하려면 WebXR에서 카메라 픽셀에 접근해야 하고, 이는 `camera-access` optional feature를 요구합니다. Android Chrome에서 되기는 하지만,

- 카메라 텍스처를 framebuffer에 바인딩해 `readPixels`로 내려받아야 하고,
- 매 프레임 하면 성능이 무너지므로 샘플링 주기를 따로 설계해야 하고,
- 기기/브라우저 버전에 따라 feature 요청 자체가 거부될 수 있습니다.

**훨씬 싼 대체재가 있습니다: `light-estimation`.** ARCore가 추정한 ambient spherical harmonics / light probe를 WebXR이 그대로 제공하므로, 코드 수십 줄로 "환경의 지배적 색·밝기"를 얻어 Ninja 머티리얼에 반영할 수 있습니다. 정밀도는 낮지만 **데모에서 눈에 보이는 효과는 거의 같습니다.**

> **결론: 1단계는 `light-estimation` 기반 색 적응. `camera-access` 픽셀 분석은 시간이 남을 때만.**

### ③ Occlusion(기존 P5)은 Smart Hiding과 같은 데이터를 씁니다 — 붙여서 해야 합니다

"좋은 숨을 곳"의 본질은 **"어떤 시점에서 안 보이는 곳"**, 즉 가시성/가림 판정입니다. 그런데 기존 P1의 HideScore는 거리·각도·표면법선을 가중합한 **순수 휴리스틱**이고, 여기엔 CV가 없습니다. "이게 왜 Computer Vision 프로젝트인가"라는 질문에 방어가 안 됩니다.

WebXR **Depth API**(`depth-sensing`)를 켜면 depth buffer 하나로 두 가지가 동시에 풀립니다.

- 렌더 단계: depth 비교 → **occlusion 구현**
- 배치 단계: 후보 지점을 여러 시점에서 depth와 비교 → **"실제로 가려지는 자리"를 계산한 진짜 visibility score**

즉 Occlusion은 Smart Hiding의 *다음* 기능이 아니라 *전제*입니다.

> **결론: Depth 기반 occlusion + visibility score를 하나의 작업 단위로 묶고, 이것을 프로젝트의 핵심 기여로 내세웁니다.**

### ④ 150m × 30m 대규모 공간(기존 P7)은 구현 목표에서 빼야 합니다

솔직하게 말하면 이건 현재 스택으로 안 됩니다.

- ARCore 단일 세션은 loop closure가 제한적이라 수십 m 이동 시 drift가 누적됩니다.
- WebXR에는 **Cloud Anchors가 없고, 세션 간 persistent anchor도 없습니다.** 새로고침하면 공간 정보가 전부 사라집니다.
- QR / AprilTag relocalization은 `camera-access` + 마커 검출기 + 좌표계 정합이 필요한, 그 자체로 하나의 프로젝트입니다.

억지로 시도하면 "발표 당일 데모가 깨지는" 가장 유력한 후보가 됩니다.

> **결론: 데모 범위를 한 개 Zone(약 10~15m)으로 명시적으로 고정하고, 대규모 공간은 "구현할 기능"이 아니라 "drift 데이터로 측정한 한계"로 보고서에 넣습니다.** 이게 깨진 150m 데모보다 훨씬 강한 결과입니다.

---

## 8.3 계획에 아예 빠져 있던 것들 (이게 더 급합니다)

### ⓐ Anchor 미사용 — 문서와 코드가 다릅니다

문서 §2에는 "optional anchor support"라고 되어 있지만, 실제 `hideNewTarget()`은

```js
target = { object: obj, anchor: null, position: p.clone(), mode: 'local-space' };
```

로 **local reference space 좌표에 그냥 박아둡니다.** 이러면 drift가 누적될 때 Ninja가 현실에서 미끄러집니다. `hitTestResult.createAnchor()`로 anchor를 만들어 매 프레임 pose를 갱신하는 것이 표준 완화책이고 Android Chrome에서 지원됩니다. `updateTargetAnchor()` 함수는 이미 작성되어 있으니 **연결만 하면 됩니다.**

### ⓑ 데스크톱 시뮬레이션 모드가 없습니다 — 지금 가장 큰 개발 병목

현재는 한 줄 고칠 때마다 HTTPS 배포 → 폰 → 실제로 걸어다니기가 필요합니다. 이 사이클이 몇 분씩 걸리면 알고리즘 튜닝은 사실상 불가능합니다.

**가짜 pose 소스(마우스=회전, WASD=이동)와 저장된 candidate 세트를 재생하는 non-XR 모드**를 만들면 HideScore·탐지 임계값·metrics를 브라우저에서 즉시 반복 실험할 수 있습니다. 기능이 아니라 **개발 인프라**이고, 투자 대비 회수가 가장 빠릅니다.

### ⓒ 탐지 임계값(5 m / 12°)이 게임을 무의미하게 만듭니다

기하학적으로 확인해 보면, 5 m 거리에서 12° 원뿔의 반지름은 **약 1.06 m**입니다. 즉 5 m 밖에서 **지름 2 m짜리 과녁**을 맞히면 성공입니다. 대충 휘두르다 눌러도 맞습니다.

더 나쁜 점은, 이렇게 관대하면 **tracking 정확도가 게임 결과에 영향을 주지 않는다**는 것입니다. 프로젝트가 자랑하려는 6DoF 정밀도가 판정에 전혀 반영되지 않습니다.

대안: 각도 허용치를 거리에 연동해 **현실 세계의 조준 오차 반경을 일정하게** 유지합니다.

```text
tolerance_deg = clamp( atan(MISS_RADIUS_M / dist), 4°, 20° )
MISS_RADIUS_M = 0.5
```

이러면 가까이 갈수록 각도는 관대해지되 실제 조준 정밀도는 일정해지고, `MISS_RADIUS_M`이 그대로 난이도 노브가 되며, **drift가 실제로 승패에 영향을 주므로 tracking 실험과 게임이 연결됩니다.**

### ⓓ 13% opacity는 "숨기기"가 아니라 "안 보이게 하기"입니다

13%에 `depthWrite:false`면 어지간한 배경에서는 눈으로 절대 못 찾습니다. 그러면 플레이어는 **보고 찾는 게 아니라 아무 데나 조준하고 SCAN을 난사**하게 되고, camouflage 연구는 게임 플레이에 아무 영향을 주지 못합니다.

opacity를 난이도 파라미터로 분리하십시오(예: Easy 0.6 / Normal 0.3 / Hard 0.13). 그래야 "환경 적응 camouflage가 탐색 시간을 늘렸다"는 **측정 가능한 주장**이 성립합니다.

### ⓔ Tracking loss 처리가 없습니다

`session.visibilityState` 변화나 `getViewerPose()`가 `null`을 반환하는 경우(추적 상실)에 대한 처리가 없습니다. 실제 시연 환경(조명 변화, 빠른 이동, 특징 없는 벽)에서 반드시 발생합니다. 최소한 "추적을 잃었습니다 — 천천히 주변을 비춰주세요" 배너와 카운터 지표가 필요합니다.

---

# 9. 수정된 개발 로드맵

기존 Priority 1~7을 아래로 대체합니다. 원칙은 두 가지입니다.

1. **측정 수단을 먼저 만든다.** 그래야 이후 모든 개선을 주장이 아니라 숫자로 말할 수 있습니다.
2. **핵심 기여를 하나로 좁힌다.** = Depth 기반 가시성 추론(occlusion + hiding score). 나머지는 이것을 뒷받침하는 부속입니다.

---

## Phase 0 — 기반 정비 (선행, 약 1일)

게임 기능이 아니라 이후 작업 전체의 속도를 결정하는 부분입니다.

| 항목 | 내용 |
|---|---|
| 0-1 | **Anchor 연결.** `createAnchor()` 사용, 실패 시 현재 local-space 방식으로 자동 fallback |
| 0-2 | **데스크톱 시뮬레이션 모드.** 마우스/WASD 가짜 pose + candidate 세트 JSON 저장·로드 |
| 0-3 | **Tracking loss 처리.** pose null / visibilityState 감지, 배너 + `trackingLossCount` 지표 |
| 0-4 | **파라미터 일원화.** 흩어진 상수를 `CONFIG` 객체 하나로 통합 |

---

## Phase 1 — 측정 및 게임 규칙 (약 1일)

| 항목 | 내용 |
|---|---|
| 1-1 | **SCAN 횟수 제한** `MAX_SCAN = 5`, UI에 `SCAN 3/5` 표시 |
| 1-2 | **거리 연동 탐지 임계값** (§8.3-ⓒ의 `MISS_RADIUS_M` 방식) |
| 1-3 | **게임 결과 화면** 발견시간 / scan 횟수 / miss / 이동거리 / 최대변위 / 후보 수 / target 거리 |
| 1-4 | **세션 로그 JSON 다운로드** 라운드별 레코드 배열 → 그대로 실험 데이터로 사용 |
| 1-5 | **배치 모드 토글** `random` / `smart` — 이후 A/B 비교의 기준선(baseline) |

Phase 1이 끝나면 **아직 아무 알고리즘도 개선하지 않았지만, 개선을 증명할 준비는 끝납니다.**

---

## Phase 2 — Depth 기반 가시성 (핵심 기여, 약 2~3일)

프로젝트에서 가장 CV다운 부분이며 발표의 중심이 될 파트입니다.

```text
XR depth-sensing
        │
        ├─────────────► 렌더 단계: depth 비교 → Occlusion
        │
        └─────────────► 배치 단계: 후보 지점 가시성 평가
                              │
                        여러 시점에서
                        depth vs 후보 거리 비교
                              │
                              ▼
                     visibility ratio (0~1)
                              │
                              ▼
                    "잘 안 보이는 자리" = 좋은 은신처
```

| 항목 | 내용 |
|---|---|
| 2-1 | `depth-sensing` feature 요청, 미지원 기기 fallback 경로 확보 |
| 2-2 | **Occlusion 렌더링** — 실제 물체가 앞에 있으면 Ninja를 가림 |
| 2-3 | **Visibility score** — 후보별 "보이는 시점 비율" 계산·캐싱 |
| 2-4 | **HideScore 통합** — `visibility`(주), `distance`·`edge`·`surface`(보조), 랜덤 소량 |
| 2-5 | **A/B 실험** — random vs smart, 각 N회, 발견시간·scan 횟수 비교표 |

> 2-5의 표가 나오는 순간 이 프로젝트는 "만들어 봤다"에서 "측정해서 개선했다"로 바뀝니다.

**미지원 기기 대비책:** Depth API가 없으면 수집된 hit-test point cloud만으로 근사 가시성(후보→시점 선분이 다른 후보점 근방을 지나는지)을 계산하는 경량 버전을 둡니다. 정확도는 낮지만 파이프라인은 동일하게 유지됩니다.

---

## Phase 3 — Camouflage 및 난이도 (약 1일)

| 항목 | 내용 |
|---|---|
| 3-1 | **`light-estimation` 기반 색 적응** (§8.2-② 참조) |
| 3-2 | **난이도 프리셋** Easy / Normal / Hard = opacity + `MISS_RADIUS_M` + `MAX_SCAN` 조합 |
| 3-3 | (여유 시) `camera-access` 픽셀 샘플링으로 지배색 정밀화 |

---

## Phase 4 — 평가 실험 및 보고 (약 1~2일)

Phase 1의 로그를 이용해 다음 표를 채웁니다.

**스캔 시간 대 후보 품질**

| Scan Time | Candidates | 수평면 비율 | 공간 커버리지 |
|---|---:|---:|---:|
| 20 s | | | |
| 40 s | | | |
| 60 s | | | |

**이동 거리 대 drift**

| 이동 거리 | 복귀 위치 오차 | 복귀 각도 오차 |
|---|---:|---:|
| 5 m | | |
| 10 m | | |
| 20 m | | |

**배치 알고리즘 비교**

| 모드 | 평균 발견 시간 | 평균 SCAN 횟수 | 실패율 |
|---|---:|---:|---:|
| random | | | |
| smart | | | |

---

## Phase 5 — 범위 밖(Out of Scope)으로 명시

아래는 **하지 않는다**고 문서에 못 박습니다. 시도했다가 미완으로 남기는 것이 가장 나쁜 결과입니다.

- 150m × 30m 전체 공간 mapping
- QR / AprilTag / ArUco 기반 relocalization
- 세션 간 persistent anchor (WebXR 미지원)
- 정밀 3D mesh reconstruction
- Gesture 기반 SCAN trigger (§4.9에서 이미 기각)

대신 §7.5의 한계를 **Phase 4의 drift 측정 데이터로 정량화**하여 "왜 안 되는가"를 근거와 함께 서술합니다.

---

# 10. 수정된 v3 Scope

기존 문서의 v3 3종(Smart Hiding / SCAN 제한 / Result)을 다음으로 교체합니다.

```text
v3 = Phase 0 + Phase 1
     (기반 정비 + 측정 가능한 게임)

v4 = Phase 2
     (Depth 기반 occlusion + visibility hiding score)   ← 핵심 기여

v5 = Phase 3 + Phase 4
     (camouflage / 난이도 + 평가 실험)
```

v3에서 Smart Hiding을 빼는 것이 핵심 변경입니다. **측정 수단과 baseline 없이 만든 Smart Hiding은 개선을 증명할 수 없기 때문입니다.**

---

# 11. 개발 시 주의사항

## 유지해야 하는 것

- WebXR 기반 Android Chrome 실행 / `immersive-ar`
- hit-test 기반 surface candidate collection
- 6DoF viewer tracking
- 실제 공간 이동 탐색
- SCAN 버튼 방식
- 기존 tracking / debug metrics
- 20초 및 +20초 mapping, 다시 숨기기, drift test

## 핵심 loop는 변경하지 않음

```text
Mapping → Candidate generation → Hiding → Walk/Search → SCAN → Detection
```

## 새로 추가되는 원칙

1. **Feature detection 필수.** `depth-sensing`, `light-estimation`, `anchors`, `camera-access`는 모두 optional feature로 요청하고, 거부되었을 때의 fallback 경로를 반드시 함께 구현합니다. 미지원 기기에서 검은 화면이 뜨는 것이 최악입니다.
2. **파라미터는 `CONFIG` 한 곳에서.** 실험 중 값이 코드 여기저기 흩어지면 어떤 설정으로 얻은 결과인지 추적이 불가능해집니다. 로그에 `CONFIG` 스냅샷을 함께 기록합니다.
3. **시뮬레이션 모드를 깨뜨리지 않습니다.** XR 전용 API 호출은 전부 추상화 레이어 뒤에 둡니다.
4. **한 번에 하나의 Phase만.** 여러 Phase를 섞으면 데모가 깨졌을 때 원인 분리가 불가능합니다.

## WebXR 코드 수정 시 확인 항목

- Android Chrome 지원 여부 / HTTPS secure context
- session lifecycle, reference space, hit-test source lifecycle
- session 종료 시 리소스 정리 (현재 `onSessionEnd`의 hitTestSource 해제는 되어 있음)

---

# 12. 다음 작업 지시문 (Claude CLI용)

```text
이 문서의 Phase 0을 구현해줘.

1. hitTestResult.createAnchor()로 target을 anchor에 고정하고,
   anchor 생성이 실패하면 현재 local-space 방식으로 자동 fallback.
   updateTargetAnchor()는 이미 있으니 연결만 해줘.

2. 비-XR 데스크톱 시뮬레이션 모드 추가.
   - 마우스 드래그 = 시선 회전, WASD = 이동
   - candidate 세트를 JSON으로 저장/로드
   - XR 경로 코드는 건드리지 말고 pose 소스만 추상화

3. tracking loss 처리.
   - getViewerPose()가 null이거나 visibilityState가 visible이 아닐 때 배너 표시
   - trackingLossCount 지표 추가

4. 흩어진 상수(MAP_SECONDS, MIN_CANDIDATE_SPACING,
   DETECT_MAX_DISTANCE_M, DETECT_MAX_ANGLE_DEG, ninja opacity 0.13 등)를
   CONFIG 객체 하나로 통합.

기존 게임 loop와 기존 metric은 절대 제거하지 마.
```

---

# 13. 프로젝트의 현재 한 문장 정의

> WebXR/ARCore를 이용해 실제 공간의 3D 표면 위치를 수집하고, 공간 내에 위장된 가상 객체를 자동 배치한 뒤 사용자가 실제 공간을 이동하며 탐색하는 AR Hidden Object Game Prototype.

---

# 14. 수정된 향후 목표 한 문장 정의

> WebXR Depth API로 얻은 공간 가시성 정보를 이용해 후보 지점의 은신 적합도를 정량적으로 평가하고, occlusion과 환경 적응 camouflage를 적용한 뒤, 랜덤 배치 대비 개선 효과를 실측 데이터로 검증하는 AR 탐색 게임.

기존 정의와의 차이는 **"확장한다" → "검증한다"** 입니다. 기능 목록이 아니라 측정된 결과가 프로젝트의 산출물이 되어야 합니다.


---

# 15. 파일 버전 규칙

이후 작업은 `index.html`을 덮어쓰지 않고 **버전 + 대표 기능**으로 파일을 분리합니다.

```text
index.html          v2 (기존 안정 버전, 건드리지 않음)
v3-mapview.html     v3 — MAP POINT 시각화 / 스캔 커버리지 진단
v4-occlusion.html   v4 — Depth 기반 occlusion (예정)
v5-planes.html      v5 — plane detection 기반 후보 생성 (예정)
```

규칙: `v{번호}-{대표기능}.html`, 기능명은 한 단어. 정적 호스팅에서는 `https://<host>/v3-mapview.html`로 접속합니다.

---

# 16. v3 — MAP POINT 뷰 (구현 완료)

`hideNewTarget()`이 "특정 영역에서만" 캐릭터를 만든다는 현상을 눈으로 확인하기 위해 추가한 진단 기능입니다. **게임 로직은 v2와 동일하게 두었습니다** — 현재 동작을 있는 그대로 관찰하는 것이 목적이기 때문입니다.

## 기능

- `MAP` 버튼으로 토글 (세션 시작 시 자동 ON, 스캔 중 포인트가 쌓이는 것을 실시간으로 볼 수 있음)
- **3D 뷰**: 수집된 hit-test 포인트를 공간에 팔면체로 표시. 초록 = 수평면(`up.y > 0.62`), 주황 = 그 외
- **상단 우측 top-down 미니맵**: 포인트 분포 + 실제 이동 경로(파랑) + 세션 시작점(흰 원) + 현재 위치/시선(청록) + 격자 스케일
- **진단 수치**: 포인트 수 / 수평 포인트 수 / 포인트 XZ 범위 / 이동거리 / 최대 변위 / hit-test 성공 거리 범위
- 발견 후에만 target 위치를 빨간 X로 표시(그 전에는 스포일러 방지)

## 이 뷰로 확인해야 하는 것

**"이동거리"와 "포인트 범위"의 차이.** 50 m 복도를 걸었는데 포인트 범위가 5 × 3 m로 나온다면 맵이 만들어지지 않은 것이고, 원인은 §17에 정리했습니다.

---

# 17. 넓은 복도(15 m × 50 m)에서 특정 영역에만 캐릭터가 생기는 원인

코드를 확인한 결과 원인은 네 가지이며, **가장 큰 원인은 4번**입니다.

## 17.1 hit-test는 화면 중앙 한 줄기 광선만 봅니다

`requestHitTestSource({space: viewerSpace})`는 뷰어 기준 −Z 방향 **광선 하나**의 첫 교차점만 돌려줍니다(`results[0]`). 250 ms 간격으로 20초 = **최대 80개 포인트**이고, 그것도 크로스헤어를 겨눈 자리만입니다. 이것은 "공간의 맵"이 아니라 **"크로스헤어가 지나간 궤적"**입니다.

## 17.2 ARCore hit-test의 유효 거리가 짧습니다

평면 추정이 신뢰 가능한 범위는 실질적으로 수 미터입니다. 50 m 복도 저편 바닥은 아무리 겨눠도 hit이 나오지 않습니다. 미니맵의 `hit 거리` 수치로 실제 상한을 확인할 수 있습니다.

## 17.3 `MIN_CANDIDATE_SPACING`이 클러스터링을 막지 못합니다

`lastCandidate`(직전 1개)와만 비교하므로, 같은 자리를 좌우로 훑으면 근접 중복 포인트가 계속 쌓입니다. 밀도가 균일해지지 않습니다.

## 17.4 배치 점수가 "현재 위치 1~8 m"를 사실상 강제합니다 ← 핵심

```js
let score = Math.random();          // 0 ~ 1
if (dist >= 1.0 && dist <= 8.0) score += 2;
if (angle >= 25)                score += 1.5;
```

두 조건을 만족하는 후보의 최소 점수(2.0)가 만족하지 못하는 후보의 최대 점수(1.0)보다 **항상 큽니다.** 따라서 8 m 밖의 후보는 후보가 아무리 많아도 **선택될 확률이 0**입니다. 50 m 복도에서 캐릭터가 늘 근처에만 나타나는 이유가 이것입니다.

## 17.5 수평면 필터가 복도에서 불리합니다

`up.y > 0.62` 조건 때문에 벽면은 `candidates`에서 제외되고, 복도처럼 벽이 대부분인 공간에서는 발밑 바닥 포인트만 남습니다.

## 대응 방향 (아직 미적용)

1. **가중합을 곱셈형 확률로 교체.** 하드 컷 대신 `w = f(dist) * g(angle)` 형태의 가중 랜덤 샘플링으로 바꾸면 먼 후보도 확률적으로 선택됩니다.
2. **공간 격자 기반 균등 샘플링.** XZ를 1~2 m 셀로 나눠 셀 단위로 먼저 고르고, 셀 안에서 포인트를 고릅니다. 밀집 구역 편향이 사라집니다.
3. **후보 수집 자체를 plane 기반으로 교체.** §18 참조.

---

# 18. Occlusion / 평면 인식 — 가능 여부

## 18.1 Occlusion — 가능 (조건부)

WebXR **Depth Sensing API**(`depth-sensing`)를 optional feature로 요청하면 ARCore Depth가 제공하는 depth map을 프레임마다 받을 수 있습니다.

- 지원: ARCore Depth API 지원 Android 기기 + 최신 Chrome
- 용도: 셰이더에서 실제 depth와 가상 객체 depth를 비교해 가려진 픽셀을 버림 → **진짜 occlusion**
- 부수 효과: 같은 depth 데이터로 후보 지점의 **가시성 점수**를 계산할 수 있습니다(§9 Phase 2)

주의: 저해상도(대략 160×120급)에 노이즈가 있어 경계가 지저분합니다. 실사용에는 soft-edge 블렌딩이 필요합니다. **미지원 기기 fallback을 반드시 함께 구현합니다.**

## 18.2 평면 인식 — 가능하며, 현재 방식보다 확실히 낫습니다

WebXR **Plane Detection API**(`plane-detection`)를 요청하면 ARCore가 추정한 평면을 **폴리곤(다각형 경계) + 방향(horizontal/vertical) + 자세**로 직접 받을 수 있습니다.

현재 방식과의 차이는 결정적입니다.

| | hit-test (현재) | plane-detection |
|---|---|---|
| 얻는 것 | 광선이 맞은 점 1개 | 평면의 **면적 전체** |
| 커버리지 | 크로스헤어가 지나간 곳만 | 카메라가 인식한 평면 전부 |
| 수직면 | 별도 판별 필요 | `orientation`으로 즉시 구분 |
| 후보 생성 | 20초에 80점 | 평면 내부를 원하는 밀도로 무제한 샘플링 |
| 넓은 공간 | 매우 취약 | 훨씬 유리 |

즉 §17.1의 근본 원인이 사라집니다. 복도 바닥 평면 하나만 잡혀도 그 폴리곤 내부를 격자로 샘플링해 **수십 m 범위의 균등한 후보**를 만들 수 있습니다.

주의: 지원이 hit-test만큼 보편적이지는 않으므로 **hit-test 경로를 fallback으로 유지**해야 합니다.

## 18.3 권장 순서

```text
v3  MAP POINT 진단            ← 완료. 먼저 현상을 눈으로 확인
     │
v4  plane-detection 후보 생성  ← 배치 편중 문제의 근본 해결
     │
v5  depth-sensing occlusion    ← 가시성 점수까지 함께
```

기존 §9 로드맵에서 **plane-detection을 Phase 2 앞에 넣는 것**이 이번 관찰의 결론입니다. occlusion보다 먼저 후보 분포를 고쳐야 넓은 공간에서 게임이 성립하기 때문입니다.

---

# 19. 하츄핑 도망 모드 (v4) — 별도 문서

도망 모드는 이 문서 이후에 만들어진 기능이라, 내용이 길어 별도 파일로 분리했습니다.

**→ [`chase-mode-handoff.md`](./chase-mode-handoff.md)**

그 문서에 들어 있는 것:

- 저장소·브랜치 지도와 GitHub Pages 설정, 다른 PC에서 이어서 시작하는 방법
- 도망 모드의 동작을 시간 순서로 설명 (원점 → 복셀 → 통과 가능 격자 → 목적지 선택 → 경로 → 속도 → 검거)
- 조정 가능한 숫자들과 그 위치
- 갤럭시 S25 1차 실기기 테스트에서 나온 문제와 수정 내역 (속도 과다, 천장 등반, 길게 누르기로 인한 Chrome 종료, 버튼 위치, 상단 통계 가림)
- 작업 중 발견해 수정한 팀 코드의 anchor 버그 — **팀에 아직 공유하지 않았습니다**
- 다음 작업: 팀이 고친 운영자 모드에 도망 모드를 얹는 병합 절차와 충돌 예상 지점
