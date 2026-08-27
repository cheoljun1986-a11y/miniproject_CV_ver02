# 지도 품질 후속 작업 (TSDF 이후) — 인계 문서

> 2026-08-26 세션 인계. 앞선 작업은 `docs/superpowers/plans/2026-08-26-tsdf-fusion.md`(TSDF fusion 구현 기록)에 있고, 이 문서는 **그 이후의 논의와 다음 할 일**이다.

## 현재 상태

- 브랜치 `private/baencho/tsdf-fusion`, 커밋 `9eddaaa`, **origin에 푸시 완료**. 작업 트리 깨끗.
- PR은 만들지 않았다(사용자 지시). 필요하면 `pull/new/private/baencho/tsdf-fusion`.
- 테스트 407개 통과. `?terrain=legacy`(옛 VoxelMap), `?fusion=count`(옛 카운팅)로 A/B 가능.
- **실기기 검증 결과 일부 확인됨** — 아래 "사용자 관찰" 참조.
- 별건: `serve.py`의 listen backlog(5 → 128) 수정이 **stash에 남아 있다**(`git stash list`). 터널 경유로 모듈 50개를 동시 요청할 때 502가 나던 문제. 서버는 이미 그 코드로 떠 있으나 커밋되지 않았다.

## 사용자 관찰 (실기기)

1. **노이즈는 크게 줄었다** — TSDF 효과 확인됨.
2. **촬영이 부족한 곳은 여전히 비어 있다** — 채워주지 않는다.
3. 하츄핑이 **땅에 박히거나 / 벽 뒤로 사라지거나 / 못 찾겠는** 경우가 있다.

## 진단 (코드 근거)

### 왜 안 채워지나
TSDF는 **광선이 지나간 곳만** 쓴다. 표면 앞뒤 ±10cm 밴드 안에서 광선 사이 틈을 잇는 것이 전부라
픽셀 간격(2m에서 ~6cm, 절반 해상도) 이상의 틈은 그대로 남는다. 카메라가 안 비춘 곳, 깊이 센서가
값을 못 준 곳(검은 바닥·유리·역광·비스듬한 면)은 광선 자체가 없다. 노이즈 억제 쪽으로 튜닝한
것(거리 가중치, band 0.3, 절반 해상도)도 채움을 줄이는 방향이다. **관측 밖을 추정하는 별도 단계가
필요하다.**

### 세 증상의 원인 분해

| 증상 | 지도 개선으로 해결 | 지도와 무관, 별도 수정 |
|---|---|---|
| 땅에 박힘 / 허공에 뜸 | 바닥 아래 노이즈 제거(TSDF가 일부 처리) | **슬랩 양자화** — `slabTopY()`가 10cm 슬랩 윗면에 세우므로 지도가 완벽해도 최대 10cm 오차 |
| 벽 뒤로 사라짐 | (역설적) 옆방이 잘 그려질수록 더 잘 통과함 | 칸 사이 벽 검사 없음 → **사용자 결정: 검사 대신 한 방으로 제한** |
| 눈앞에서 지워짐 | ✗ | CPU 가림 메시 바이어스 `CPU_OCCLUSION_DEPTH_BIAS_M=0.05` (실시간 depth, 지도 무관) |
| 못 찾겠음(구석에 갇힘) | ✓ 바닥 구멍 채우면 대부분 해결 | `escape` 로직 보완 여지 |
| 보이는데 게이지 안 참 | ✓ 노이즈 감소 | `visibleFraction`이 같은 지도를 씀 |

**결론**: 맵 개선만으로는 부족하다. 슬랩 양자화, 가림 바이어스는 지도가 아무리 좋아져도 남는다.

## 사용자 결정

- **칸 간 벽 검사는 구현하지 않는다.** 대신 플레이를 **한 방으로 제한**한다(방을 벗어난 영역을
  지형에서 배제하거나 목적지 후보에서 제외하는 방식).
- 슬랩 경계에서 뜨거나 박히는 현상의 원리는 이해했고, 수용 가능한 범위로 본다(수정은 선택).

## 진행 중이던 작업 (미적용)

**하츄핑 이동 경로 + ChaseLog 이벤트를 `game-*.json`에 저장해 서버로 전송하기.**
패치는 작성했으나 **적용되지 않았다**(작업 트리 깨끗). 내용:

- `ChaseLog`는 좌표가 아니라 **이벤트 링버퍼**(도망 시작/목적지 변경/경로 실패/재정착/갇힘 탈출/
  추적 끊김/검거)이고, **메모리에만** 있다. HUD `수치` 카드 하단에 최근 5줄만 보인다. 서버 전송 없음.
- 변경 계획:
  - `src/main.js`: `ninjaTrail = new PlayerTrail({minStep: TRAIL_MIN_STEP_M, maxPoints: TRAIL_MAX_POINTS})`
    추가, `updateChase`에서 `ninjaTrail.record(renderPos)`, 세션 리셋 2곳에 `ninjaTrail?.reset()`,
    `exportScan()`에서 `ninjaPath`/`events`(= `chaseLog.entries()`)를 넘김.
  - `src/voxel-cells-codec.js`: `ninjaPath`, `events` 필드 추가(왕복). 옛 파일은 빈 배열로 로드.
  - `src/voxel-terrain.js`: `exportJSON({playerPath, ninjaPath, events, sessionId})`.
  - `viewer.html`: 주황색 선으로 하츄핑 경로, 통계란에 이벤트 최근 5건. 카메라 경로 버튼과 같이 토글.
  - `tests/voxel-cells-codec.test.mjs`: 왕복 + 하위 호환 테스트.
- **좌표의 의미**: 기록되는 점은 `toRenderSpace(state.position)` — 수평은 20cm 칸 중심, 수직은
  `slabTopY()`(슬랩 **윗면** = 발 높이, 중심 아님). 노드 사이는 `ChaseRunner`가 보간하고
  `PlayerTrail`이 15cm마다 기록하므로 계단이 아닌 부드러운 선. 모델 표시 높이(`visualY`)와는 다르다.

## 다음 단계 (우선순위)

1. **하츄핑 경로·이벤트 저장** (위 미적용 패치) — 이후 문제를 추측이 아니라 지도 위에서 확인 가능.
2. **바닥 평면 확장** — `voxel-floor.js`의 `detectFloorY`로 높이를 잡고, 관측된 바닥 칸 경계 안쪽의
   빈 칸을 바닥으로 채움. "바닥은 연속"이라는 가정 하나로 구멍 대부분 해결, 벽·가구는 손대지 않음.
3. **통행 격자 2D 닫힘** — walkable에 둘러싸인 1~2칸 unseen 구멍을 walkable로. 가장 싸고 경로 끊김에 직접 효과.
4. **한 방 제한** (사용자 결정 사항) — 방 경계 판정 방식 설계 필요.
5. 선택: 슬랩 윗면 대신 **바닥 평면 높이**에 세우기(박힘/뜸 완화), 가림 바이어스 조정.
6. 선택: 원거리 확정이 느리면 `TSDF_DEPTH_WEIGHT_REF_M` 2.0 → 2.5~3.0.

## 서버 / 테스트 환경

- `python serve.py`(자동 재시작 루프 창), `cloudflared --url http://127.0.0.1:8000`(별도 창).
  터널 URL은 재시작마다 바뀐다. 이 세션 마지막: `https://generated-shorts-links-pens.trycloudflare.com`.
- 서버는 요청마다 디스크를 읽고 `Cache-Control: no-store`라 **git pull 후 재시작 불필요**
  (단 `serve.py` 자체가 바뀌면 재시작).
- 랜딩 `/`, 게임 `/app.html`, 도망 모드 `/v4-chase.html`, 뷰어 `/viewer.html`.
- 서버 콘솔 창에서 Ctrl+C를 누르면(로그 복사 시 흔함) 서버가 죽는다 — 드래그+Enter로 복사할 것.
