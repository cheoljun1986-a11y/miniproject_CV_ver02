# WebXR Hidden Ninja Demo v2 - 팀 공유용 정리

## 1. 이 데모를 만든 목적

이 데모의 목적은 **스마트폰 브라우저만으로 실제 공간을 이동하며 가상 인형을 찾는 AR 숨바꼭질이 가능한지 빠르게 검증하는 것**입니다.

특히 아래 질문을 확인하기 위해 만들었습니다.

1. Android Chrome에서 WebXR을 통해 ARCore 기반 6DoF 위치/자세 추적이 가능한가?
2. 사용자가 실제로 걸어도 가상 인형이 현실 공간의 같은 위치에 남아 있는가?
3. 주변 바닥/책상 같은 표면에서 '숨을 위치 후보'를 만들 수 있는가?
4. 실제 이동 + 화면 방향을 이용해 탐색/발견 게임 로직을 만들 수 있는가?
5. 추후 손동작 인식, 보호색, occlusion 같은 기능을 붙일 수 있는 구조인가?

> **중요:** 현재의 20초 '맵 스캔'은 방 전체의 정밀 3D mesh를 복원하는 기능이 아닙니다. WebXR hit-test로 카메라가 바라본 실제 표면의 3D 좌표를 여러 개 수집하여 **숨기기 후보 지점 집합**을 만드는 단계입니다.

---

## 2. 전체 동작 흐름

```text
Galaxy Chrome
    ↓
START AR
    ↓
WebXR / ARCore 6DoF Tracking
    ↓
20초 동안 실제 표면 Hit-Test
    ↓
3D 숨기기 후보 좌표 수집
    ↓
후보 중 한 위치 랜덤 선택
    ↓
반투명 Ninja 배치
    ↓
사용자가 실제 공간을 이동하며 탐색
    ↓
화면 중앙에 의심 지점을 조준
    ↓
SCAN 버튼
    ↓
거리 + 시야각 조건 판정
    ├─ 성공: DETECTED! + Ninja 공개
    └─ 실패: NO SIGNAL
```

---

## 3. 현재 들어가 있는 주요 모듈

| 모듈 | 사용 기술 | 역할 | 현재 상태 |
|---|---|---|---|
| WebXR Session | WebXR `immersive-ar` | 브라우저에서 AR 세션 시작 | 구현 완료 |
| 6DoF Pose Tracking | WebXR + ARCore | 스마트폰의 3D 위치(x,y,z)와 회전 추적 | 구현 완료 |
| Rendering | Three.js | Reticle, Ninja, UI용 3D 오브젝트 렌더링 | 구현 완료 |
| Surface Hit-Test | WebXR Hit Test | 바닥/책상 등 실제 표면의 3D 좌표 획득 | 구현 완료 |
| Mapping Candidate Collector | 자체 JS 로직 | 20초 동안 숨기기 후보 좌표 수집 | 구현 완료 |
| Hiding Spot Selector | 자체 JS 로직 | 후보 중 적절한 위치를 랜덤 선택 | 구현 완료 |
| Camouflage Renderer | Three.js material | Ninja를 약 13% 투명도로 표시 | 기초 구현 |
| Hunt / Scan Logic | 자체 JS 로직 | 거리와 시야각으로 발견 여부 판정 | 구현 완료 |
| Re-hide | 자체 JS 로직 | 기존 후보를 재사용해 다시 숨기기 | 구현 완료 |
| Pose / Distance Logger | WebXR pose | 이동경로, 최대 변위 등 표시 | 구현 완료 |
| Drift Check | 자체 JS 로직 | 기준점 저장 후 복귀 위치/각도 오차 확인 | 구현 완료 |
| Gesture Trigger | MediaPipe 예정 | `주먹 → 가위 → 주먹`으로 SCAN 실행 | 미구현 |

---

## 4. 모듈별 동작 설명

### 4.1 WebXR / ARCore 6DoF Tracking

스마트폰의 단순 자이로 값만 사용하는 것이 아니라, WebXR을 통해 ARCore가 계산한 **6DoF pose**를 사용합니다.

- Translation: `x, y, z`
- Rotation: roll / pitch / yaw에 해당하는 회전 정보

따라서 사용자가 폰을 들고 실제로 2~3m 이동하면 화면의 좌표도 함께 변합니다. 이 기능이 있기 때문에 Ninja를 화면에 붙여 두는 것이 아니라 **현실 공간의 한 위치에 고정**할 수 있습니다.

### 4.2 Surface Hit-Test

카메라 중앙 방향으로 WebXR hit-test를 수행하여 실제 표면과 만나는 위치를 얻습니다.

예시:

```text
카메라 중심 ray
      ↓
      ↓
------●------ 바닥
      ↑
  hit-test point
```

현재 스캔에서는 이 hit-test 좌표를 계속 저장합니다.

### 4.3 20초 Mapping Candidate Collector

스캔 시간 동안 약 250ms 간격으로 표면 좌표를 확인하고, 이전 후보와 너무 가까운 점은 중복으로 저장하지 않습니다.

현재 목적은 정밀 지도 생성이 아니라 다음과 같습니다.

```text
Candidate 1 = (x1, y1, z1)
Candidate 2 = (x2, y2, z2)
Candidate 3 = (x3, y3, z3)
...
```

즉, **'인형을 놓을 수 있는 실제 공간의 좌표 목록'**을 만드는 것입니다.

### 4.4 Hiding Spot Selector

수집된 후보 중 하나를 선택해 Ninja 위치로 사용합니다.

현재는 단순 완전 랜덤보다 다음 조건을 약간 우선합니다.

- 현재 사용자와 너무 가깝지 않은 지점
- 처음부터 카메라 정면에 너무 잘 보이지 않는 지점
- 대략적인 탐색이 가능한 거리의 지점

### 4.5 Camouflage

현재 Ninja는 약 **13% opacity**로 렌더링됩니다.

따라서 기능적으로는 '반투명 위장'만 구현되어 있습니다. 아직 주변 배경의 실제 색/texture를 분석하는 진짜 보호색은 아닙니다.

### 4.6 Scan / Detection

사용자가 의심되는 방향을 화면 중앙 십자선에 맞춘 후 `SCAN` 버튼을 누릅니다.

현재 기본 조건은:

- Ninja까지 거리: **5m 이내**
- 카메라 정면과 Ninja 방향의 각도: **12도 이내**

두 조건을 만족하면 `DETECTED!`, 아니면 `NO SIGNAL`입니다.

### 4.7 Drift Check

`기준점 저장`을 누르면 현재 pose를 저장합니다. 이후 이동하거나 회전한 뒤 같은 위치/방향으로 돌아와 `복귀 오차 확인`을 누르면:

- 위치 오차 (m)
- 회전 오차 (degree)

를 간단히 확인합니다.

이 값은 정밀 측정 장비 수준의 ground truth가 아니라 **실제 게임에서 tracking이 충분히 안정적인지 빠르게 보는 진단용**입니다.

---

## 5. 현재 데모에서 검증된 핵심 기능

현재 실제 Galaxy Chrome에서 다음 동작이 성공적으로 확인되었습니다.

- WebXR AR 세션 실행
- 스마트폰의 3D 위치/회전 추적
- 실제 표면 hit-test
- 20초 동안 표면 후보 수집
- 후보 중 Ninja 위치 선택
- 반투명 Ninja 렌더링
- 사용자가 실제로 이동하면서 다른 시점에서 Ninja 관찰
- 화면 중앙 조준 + SCAN
- 거리/시야각 기반 발견 판정
- 같은 후보 집합에서 다시 숨기기
- 이동거리/최대 변위 표시
- 기준점 복귀 오차 확인

---

## 6. 현재 한계

### 6.1 정밀 3D Map이 아님

현재 스캔은 sparse한 surface point 후보를 모으는 방식입니다.

따라서 현재 버전이 알고 있는 것은 대략:

```text
'여기에 실제 표면 좌표가 있었다'
```

정도이며, 아래는 아직 모릅니다.

- 이 표면이 책상인지 침대인지
- 물체의 정확한 3D mesh
- 벽/가구의 semantic label
- 물체 뒤쪽의 가려짐 구조

### 6.2 손동작 미연결

원래 목표인:

```text
주먹 → 가위 → 주먹 → SCAN
```

은 아직 WebXR AR 화면과 통합하지 않았습니다. 현재는 `SCAN` 버튼이 이 이벤트를 대신합니다.

### 6.3 진짜 보호색 미구현

현재는 단순 반투명입니다. 주변 카메라 색상/texture를 읽어서 Ninja의 색을 동적으로 맞추는 기능은 아직 없습니다.

### 6.4 Occlusion 미구현

현재 Ninja가 책상 뒤에 있을 때 실제 책상이 Ninja를 자연스럽게 가리는 기능은 없습니다. 추후 depth/mesh 기능이 필요합니다.

### 6.5 큰 공간 대응 미검증

20초 스캔은 작은 데모 공간을 대상으로 만든 값입니다. 150m x 30m 같은 공간에서는 구역화, 장시간 tracking 안정성, 재위치화 전략을 별도로 설계해야 합니다.

---

## 7. 추가 개발 가능한 기능

### 우선순위 A - 바로 붙일 기능

1. **손동작 Trigger**
   - MediaPipe Hands / Gesture Recognizer
   - `주먹 → 가위 → 주먹` 상태 머신
   - 현재 `SCAN` 버튼을 gesture event로 교체

2. **실제 Naruto 이미지 또는 3D 캐릭터 모델**
   - PNG billboard 또는 glTF/GLB 3D model
   - 크기/방향 랜덤화

3. **난이도 조절**
   - 투명도
   - 발견 가능 거리
   - 발견 시야각
   - 힌트 제공 주기

### 우선순위 B - 게임성을 높일 기능

4. **주변 색 기반 보호색**
   - 카메라 영상에서 target 주변 평균 색 또는 특징 추출
   - 캐릭터 texture tint를 동적으로 조절

5. **좋은 숨기기 위치 자동 선정**
   - 단순 후보 랜덤이 아니라 구석, 가구 근처, 시야에서 덜 노출된 지점 우선
   - depth/plane 정보를 활용한 hiding score

6. **Occlusion**
   - 실제 물체가 가상 Ninja 앞에 있을 경우 가려지도록 처리
   - WebXR Depth / ARCore Depth API 계열 검토

7. **힌트 시스템**
   - Hot / Cold
   - 거리별 진동/소리
   - 스캔 결과 강도 표시

### 우선순위 C - 연구/발표 확장 기능

8. **Semantic Mapping**
   - '바닥', '벽', '책상', '의자' 등의 의미 정보 추가
   - 숨기기 규칙과 연결

9. **대규모 공간 Zone Mapping**
   - 긴 공간을 여러 Zone으로 분할
   - Zone별 후보 저장
   - 구역 전환/재위치화

10. **Tracking 성능 평가**
    - 경로별 drift 비교
    - 조명/texture 조건별 성능 비교
    - 20초/40초/60초 스캔 후보 수와 탐색 성공률 비교

---

## 8. 추천 개발 순서

```text
[현재 완료]
WebXR + ARCore 6DoF
        ↓
Hit-Test + 후보 수집
        ↓
Ninja 숨기기
        ↓
이동 탐색 + SCAN

[다음]
        ↓
MediaPipe 손동작 통합
        ↓
Naruto 실제 asset 적용
        ↓
보호색 강화
        ↓
숨기기 위치 평가 알고리즘
        ↓
Occlusion / Depth
        ↓
대규모 공간 Zone Mapping
```

현재 프로젝트에서는 **손동작 통합 → 캐릭터 asset → 보호색/숨기기 품질 개선** 순서가 가장 현실적입니다.

---

## 9. 역할 분담 예시

| 역할 | 담당 기능 |
|---|---|
| AR/Tracking | WebXR, ARCore pose, hit-test, anchor 안정성 |
| Mapping/Game Logic | 후보 수집, 숨기기 위치 선정, 거리/각도 판정 |
| Gesture | MediaPipe, 주먹-가위-주먹 sequence detection |
| Rendering | Ninja asset, 투명도, 보호색, 시각 효과 |
| Evaluation | drift, scan time, 성공률, device/환경별 성능 측정 |

---

## 10. 한 문장 요약

> **현재 데모는 Android Chrome에서 WebXR/ARCore로 현실 공간의 위치와 표면을 추적하고, 실제 표면 좌표 중 하나에 반투명 가상 캐릭터를 숨긴 뒤, 사용자가 공간을 이동하면서 거리와 시야각을 이용해 찾는 AR 숨바꼭질 프로토타입입니다.**

다음 핵심 개발 목표는 **현재 SCAN 버튼을 `주먹 → 가위 → 주먹` 손동작 인식으로 교체하고, 숨기기 품질을 보호색/occlusion/semantic 정보로 높이는 것**입니다.
