# WebXR Hidden Ninja v3

이 버전은 **밖에서 짧은 시간에 WebXR/ARCore feasibility를 최대한 많이 확인**하기 위한 테스트용입니다.

## v3에 추가된 기능 (Object Detection + Occlusion)

- **Depth-sensing occlusion**: WebXR `depth-sensing`(ARCore Depth API)으로 닌자가 실제 물체 뒤에 있으면 **실시간으로 가려짐**. `가림 ON/OFF` 버튼으로 효과 비교 가능. HUD의 `depth` 줄에서 지원 여부 확인 (`gpu-optimized ●` = 정상 작동)
- **YOLO26n object detection (브라우저 내)**: `camera-access`(WebXR Raw Camera Access)로 AR 카메라 프레임을 받아 onnxruntime-web(WebGPU→WASM 폴백)으로 스캔 중 1초에 1회, 탐색 중 2.5초에 1회 물체 감지
- **물체 기반 숨기**: 감지된 물체(의자·백팩 등, 사람 제외)의 3D 위치를 표면 후보에 스냅해서 저장하고, 닌자가 **물체 근처·물체 뒤쪽**에 우선적으로 숨음. 발견 시 "◯◯ 근처에 숨어 있었습니다!" 표시, 2회 이상 miss 시 "◯◯ 근처에서 신호" 힌트
- **캡처 디버그 미리보기**: HUD의 metrics 카드를 탭하면 감지에 사용된 카메라 캡처 + bbox를 우측 상단에 표시 (프레임 방향/감지 품질 확인용)
- **2D 테스트 모드**: `test2d.html` — AR 없이 데스크톱/폰 웹캠으로 detection만 검증 (FPS·추론시간·백엔드 표시)

### 모델 준비

`models/yolo26n.onnx`가 필요합니다 (**FP32**, 약 10MB, end2end NMS-free, 입력 `images` [1,3,640,640], 출력 `[1,300,6]`).

- 간단: [zwh20081/yolo26-onnx](https://huggingface.co/zwh20081/yolo26-onnx)에서 `yolo26n.onnx`를 받아 `models/yolo26n.onnx`로 저장
- 직접 변환: `pip install ultralytics` 후
  ```
  yolo export model=yolo26n.pt format=onnx imgsz=640 simplify=True
  ```
- **주의: FP16 export는 쓰지 마세요** — onnxruntime-web WebGPU(JSEP)에서 fp16 `Resize` 커널이 없어 추론이 실패합니다(세션 생성은 성공해서 뒤늦게 터짐). detector가 이 경우 WASM으로 자동 폴백하지만 훨씬 느립니다. 비교용 FP16 사본은 `models/yolo26n_fp16.onnx`로 남겨둠 (`test2d.html?model=models/yolo26n_fp16.onnx`)
- detector는 YOLOv8 계열 raw 출력(`[1,84,8400]`)도 자동 인식하므로 `test2d.html?model=경로.onnx`로 다른 모델 비교 가능 (RF-DETR 등 비 YOLO 계열은 별도 파서 필요)

### 검증 순서

1. **데스크톱**: `python -m http.server 8000` → `http://localhost:8000/test2d.html` → 카메라 시작 → bbox 확인, output `[1,300,6]`·backend(webgpu/wasm)·추론 ms 확인
2. **폰 브라우저**(AR 없이): 같은 페이지를 HTTPS로 열어 모바일 추론 FPS 측정
3. **폰 AR**: `index.html` → START AR → HUD에서 `depth`, `카메라`, `모델` 상태 확인 → 발견한 닌자를 책상/기둥 뒤에서 바라보며 가려짐 확인(`가림` 토글로 비교) → 스캔 중 의자·가방을 비춰 `감지물체` 증가 확인

### v3에서 추가로 기록할 것

- depth 상태 (`gpu-optimized ●` 인가) / 가림 ON일 때 닌자가 실제 물체 뒤에서 사라지는가 (가장자리 품질 포함)
- 모델 백엔드(webgpu/wasm)와 추론 시간(ms)
- 감지물체 개수와 라벨이 실제 물체와 맞는가 / 미리보기에서 캡처 방향이 올바른가 (뒤집힘 여부)
- 물체 근처 숨기·힌트가 실제 위치와 맞는가

### 서버 추론으로 옮기기 (SAM2.1 / YOLOE / Track 등)

게임 코드는 `js/detector.js`의 계약(`detect(이미지) → [{x1,y1,x2,y2,score,label}]`)만 사용하므로,
`OnnxYoloDetector`를 `RemoteDetector`(JPEG POST → JSON 응답)로 바꾸면 무거운 모델을 Python 서버에서 돌릴 수 있습니다.

- 서버는 HTTPS(WSS)여야 함 — 로컬 서버라면 ngrok/cloudflared 터널 권장
- 감지 결과의 3D 투영에는 **캡처 시점의 pose**를 사용하도록 이미 설계되어 있어 왕복 지연(100~300ms)이 정합성에 영향 없음
- `test2d.html?remote=https://서버주소/detect` 로 서버 연동을 AR 없이 먼저 검증 가능

## v2 기능

- Android WebXR `immersive-ar`
- ARCore 기반 6DoF viewer pose 확인
- 20초 동안 hit-test 표면 좌표 수집
- 수집된 표면 후보 중 랜덤 위치에 Ninja 자동 숨기기
- Ninja를 약 13% 투명도로 숨김
- 화면 중앙 조준 + `SCAN`으로 발견 판정
- 발견 조건: 최대 5m, 화면 정면 약 ±12°
- 같은 맵 후보에서 `다시 숨기기`
- `+20초 스캔`으로 표면 후보 추가 수집
- 실제 이동경로 길이 / 최대변위 표시
- 기준점 저장 → 이동/360도 회전 → 복귀 오차 확인

## 10분 외부 테스트 순서

### 0~2분: WebXR 자체 확인
1. Android Chrome에서 HTTPS 주소 열기
2. START AR
3. 화면의 x/y/z가 폰 이동에 따라 변하는지 확인
4. `hit-test FOUND`가 뜨는지 확인

### 2~4분: 공간 스캔
1. 자동으로 20초 스캔 시작
2. 천천히 걸으며 바닥, 책상, 벤치 등 여러 표면을 비춤
3. `표면후보` 숫자가 증가하는지 확인
4. 부족하면 `+20초 스캔`

### 4~7분: 숨바꼭질
1. 스캔 종료 후 Ninja가 자동으로 후보 중 한 곳에 숨음
2. 실제로 걸어다니며 희미한 Ninja 탐색
3. 의심되는 곳을 화면 중앙 십자선에 맞춤
4. SCAN
5. 정답이면 DETECTED!, 아니면 NO SIGNAL
6. `다시 숨기기`로 2~3회 반복

### 7~10분: 추적 안정성/드리프트
1. 특정 바닥 위치에서 `기준점 저장`
2. 3~5m 이동하거나 360도 회전
3. 최대한 같은 위치와 같은 방향으로 돌아옴
4. `복귀 오차 확인`
5. 위치 오차(m) / 자세 오차(deg) 기록

## 화면에서 꼭 기록할 숫자

- x/y/z가 실제 이동에 따라 변하는가
- 이동경로(m)
- 최대변위(m)
- 표면후보 개수
- hit-test FOUND 비율 체감
- 복귀 오차 위치(m)
- 복귀 오차 각도(deg)
- Ninja가 현실의 같은 위치에 안정적으로 남는가

## 해석

### 좋은 결과
- 1~3m 이동 시 x/z가 자연스럽게 변함
- 표면 후보가 계속 쌓임
- Ninja가 화면에 붙어다니지 않고 실제 위치에 남음
- 같은 위치로 돌아왔을 때 복귀 오차가 작음

### 문제가 있는 결과
- hit-test가 거의 안 잡힘
- x/z가 튐
- 가상 물체가 현실 위치에서 미끄러짐
- 몇 m 이동 후 재현성이 크게 떨어짐

## 중요한 제한

이 버전은 아직 MediaPipe 손동작을 WebXR 카메라와 동시에 묶지 않았습니다.
현재 SCAN 버튼이 나중의 `주먹 → 가위 → 주먹` 트리거를 대신합니다.

즉 지금 검증하는 것은:
`ARCore/WebXR 공간추적 + depth occlusion + object detection 기반 숨기 + 이동 탐색 + 발견판정`
입니다.

v3에서 camera-access로 카메라 프레임 파이프라인이 이미 뚫려 있으므로,
다음 단계의 gesture trigger는 같은 프레임을 MediaPipe hand landmarker에 넣으면 됩니다.
